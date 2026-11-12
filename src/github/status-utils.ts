// Status mapping and merge-blocker computation for the current PR.

import {
  CheckStatus,
  MergeBlockerKind,
  PRStatus,
  type CheckRun,
  type MergeBlocker,
  type PullRequest,
  type ReviewStatus,
  type ReviewerRequirement,
  type ReviewThread,
  type WorkflowRunRef,
} from "./types";

// A PR can be enqueued (from our side) when it is open, not already in the
// merge queue, and every computed requirement is satisfied. GitHub may still
// reject it (branch protection, no queue); that surfaces on the attempt.
export function canMerge(
  pr: PullRequest | null,
  blockers: MergeBlocker[],
): boolean {
  if (!pr || pr.status !== PRStatus.Open || pr.mergeQueue) return false;
  return blockers.every((b) => b.satisfied);
}

export function prStatusLabel(status: PRStatus): string {
  switch (status) {
    case PRStatus.Open:
      return "open";
    case PRStatus.Draft:
      return "draft";
    case PRStatus.Merged:
      return "merged";
    case PRStatus.Closed:
      return "closed";
    default:
      return status;
  }
}

// Map a GitHub check-run status/conclusion pair to our normalized CheckStatus.
// `status` is one of QUEUED | IN_PROGRESS | COMPLETED | PENDING (GraphQL enums
// are upper snake case). `conclusion` is only meaningful once completed.
export function normalizeCheckStatus(
  status: string | undefined,
  conclusion: string | undefined,
): CheckStatus {
  const s = (status ?? "").toUpperCase();
  if (s !== "COMPLETED" && s !== "") {
    if (s === "QUEUED" || s === "PENDING" || s === "WAITING")
      return CheckStatus.Pending;
    return CheckStatus.Running;
  }

  switch ((conclusion ?? "").toUpperCase()) {
    case "SUCCESS":
      return CheckStatus.Success;
    case "FAILURE":
    case "TIMED_OUT":
    case "STARTUP_FAILURE":
    case "ACTION_REQUIRED":
      return CheckStatus.Failure;
    case "CANCELLED":
    case "STALE":
      return CheckStatus.Failure;
    case "NEUTRAL":
      return CheckStatus.Neutral;
    case "SKIPPED":
      return CheckStatus.Skipped;
    default:
      return CheckStatus.Pending;
  }
}

// Map a legacy commit-status state (StatusContext: SUCCESS/PENDING/FAILURE/ERROR/EXPECTED).
export function normalizeStatusContextState(state: string): CheckStatus {
  switch (state.toUpperCase()) {
    case "SUCCESS":
      return CheckStatus.Success;
    case "FAILURE":
    case "ERROR":
      return CheckStatus.Failure;
    case "PENDING":
    case "EXPECTED":
      return CheckStatus.Pending;
    default:
      return CheckStatus.Neutral;
  }
}

export function prStatus(pr: { state: string; isDraft: boolean }): PRStatus {
  const state = pr.state.toUpperCase();
  if (state === "MERGED") return PRStatus.Merged;
  if (state === "CLOSED") return PRStatus.Closed;
  return pr.isDraft ? PRStatus.Draft : PRStatus.Open;
}

export interface CheckCounts {
  success: number;
  failure: number;
  running: number;
  pending: number;
  neutral: number;
  skipped: number;
  total: number;
}

export function countChecks(checks: CheckRun[]): CheckCounts {
  const counts: CheckCounts = {
    success: 0,
    failure: 0,
    running: 0,
    pending: 0,
    neutral: 0,
    skipped: 0,
    total: checks.length,
  };
  for (const check of checks) {
    switch (check.status) {
      case CheckStatus.Success:
        counts.success++;
        break;
      case CheckStatus.Failure:
        counts.failure++;
        break;
      case CheckStatus.Running:
        counts.running++;
        break;
      case CheckStatus.Pending:
        counts.pending++;
        break;
      case CheckStatus.Neutral:
        counts.neutral++;
        break;
      case CheckStatus.Skipped:
        counts.skipped++;
        break;
    }
  }
  return counts;
}

// Roll a set of check statuses up into one: failure wins, then running,
// then pending, then success.
export function aggregateStatus(counts: CheckCounts): CheckStatus {
  if (counts.failure > 0) return CheckStatus.Failure;
  if (counts.running > 0) return CheckStatus.Running;
  if (counts.pending > 0) return CheckStatus.Pending;
  if (counts.success > 0) return CheckStatus.Success;
  if (counts.neutral > 0) return CheckStatus.Neutral;
  return CheckStatus.Skipped;
}

// Checks that count toward the PR's verdict: everything but superseded runs.
export function activeChecks(checks: CheckRun[]): CheckRun[] {
  return checks.filter((c) => !c.superseded);
}

// One commit can carry several runs of one workflow (a re-push of the same
// SHA, a re-triggered event). Only the newest run per workflow and event is
// current; GitHub's required checks look at the latest run too. Runs from
// different events (push vs pull_request) are independent, so neither
// supersedes the other.
export function markSupersededRuns(checks: CheckRun[]): CheckRun[] {
  const latest = new Map<string, WorkflowRunRef>();
  for (const check of checks) {
    const run = check.run;
    if (!run) continue;
    const key = runFamily(check);
    const seen = latest.get(key);
    if (!seen || compareRuns(run, seen) > 0) latest.set(key, run);
  }
  return checks.map((check) => {
    if (!check.run) return check;
    const superseded = latest.get(runFamily(check))?.id !== check.run.id;
    return superseded === !!check.superseded ? check : { ...check, superseded };
  });
}

function runFamily(check: CheckRun): string {
  return `${check.workflowName ?? ""}\u0000${check.run?.event ?? ""}`;
}

function compareRuns(a: WorkflowRunRef, b: WorkflowRunRef): number {
  if (a.number !== b.number) return a.number - b.number;
  if (a.attempt !== b.attempt) return a.attempt - b.attempt;
  return (a.createdAt ?? "").localeCompare(b.createdAt ?? "");
}

// Worst-first buckets for comparing our verdict with GitHub's rollup, which
// has no running/pending or neutral/skipped distinction.
function verdictBucket(status: CheckStatus): 0 | 1 | 2 {
  if (status === CheckStatus.Failure) return 2;
  if (status === CheckStatus.Running || status === CheckStatus.Pending)
    return 1;
  return 0;
}

export interface ChecksVerdict {
  // Rolled up from the current (non-superseded) checks.
  status: CheckStatus;
  counts: CheckCounts;
  // GitHub's statusCheckRollup.state, when it disagrees with `status`.
  rollupMismatch: CheckStatus | null;
  // The mismatch comes from superseded runs GitHub still counts, not from
  // checks we failed to load.
  explainedBySuperseded: boolean;
}

export function checksVerdict(
  checks: CheckRun[],
  rollup: CheckStatus | null,
): ChecksVerdict {
  const counts = countChecks(activeChecks(checks));
  const status = aggregateStatus(counts);
  const mismatch =
    rollup != null &&
    (counts.total > 0 || verdictBucket(rollup) > 0) &&
    verdictBucket(rollup) !== verdictBucket(status);
  return {
    status,
    counts,
    rollupMismatch: mismatch ? rollup : null,
    explainedBySuperseded:
      mismatch &&
      verdictBucket(rollup) ===
        verdictBucket(aggregateStatus(countChecks(checks))),
  };
}

// A one-line note for when GitHub's rollup disagrees with the loaded checks.
export function rollupNotice(verdict: ChecksVerdict): string | null {
  const rollup = verdict.rollupMismatch;
  if (!rollup) return null;
  return verdict.explainedBySuperseded
    ? `GitHub reports ${rollup} for this commit, counting superseded runs`
    : `GitHub reports ${rollup} for this commit; some checks may be missing here`;
}

export interface WorkflowGroup {
  key: string;
  name: string;
  // "#<run number>", plus the attempt when re-run. Set only when it helps tell
  // runs apart: the workflow ran more than once or was re-run.
  runLabel?: string;
  superseded: boolean;
  status: CheckStatus;
  url?: string;
  jobs: CheckRun[];
  counts: CheckCounts;
}

// A workflow row is expanded by default only while it still needs attention:
// in-progress or failed runs. Completed, successful ones collapse to cut noise,
// as do superseded runs whatever their outcome.
export function workflowExpandedByDefault(
  group: Pick<WorkflowGroup, "status" | "superseded">,
): boolean {
  if (group.superseded) return false;
  return (
    group.status === CheckStatus.Failure ||
    group.status === CheckStatus.Running ||
    group.status === CheckStatus.Pending
  );
}

// The Actions job id in a check's details URL (…/actions/runs/<run>/job/<id>),
// or null for checks that aren't Actions jobs (e.g. third-party apps).
export function actionsJobId(url: string): number | null {
  const match = url.match(/\/actions\/runs\/\d+\/job(?:s)?\/(\d+)/);
  return match ? Number(match[1]) : null;
}

// The run URL for a workflow is a job's details URL without the /job/<id> tail.
function workflowRunUrl(job: CheckRun): string | undefined {
  if (!job.url) return undefined;
  const match = job.url.match(/^(.*\/actions\/runs\/\d+)/);
  return match ? match[1] : job.url;
}

// Group check runs by workflow run, so two runs of one workflow on the same
// commit don't merge their jobs under one header.
// Checks with no workflow (e.g. legacy commit statuses) fall under "Other".
export function groupChecksByWorkflow(checks: CheckRun[]): WorkflowGroup[] {
  const order: string[] = [];
  const byKey = new Map<string, CheckRun[]>();

  for (const check of checks) {
    const name = check.workflowName || "Other";
    const key = check.run ? `${name}#${check.run.id}` : name;
    let jobs = byKey.get(key);
    if (!jobs) {
      jobs = [];
      byKey.set(key, jobs);
      order.push(key);
    }
    jobs.push(check);
  }

  const groups = order.map((key): WorkflowGroup => {
    const jobs = byKey.get(key) ?? [];
    const first = jobs[0];
    const counts = countChecks(jobs);
    const withUrl = jobs.find((j) => j.url);
    return {
      key,
      name: first?.workflowName || "Other",
      superseded: jobs.every((j) => j.superseded),
      status: aggregateStatus(counts),
      url: withUrl ? workflowRunUrl(withUrl) : undefined,
      jobs,
      counts,
    };
  });

  const runsPerName = new Map<string, number>();
  for (const g of groups)
    runsPerName.set(g.name, (runsPerName.get(g.name) ?? 0) + 1);
  for (const g of groups) {
    const run = g.jobs[0]?.run;
    if (!run) continue;
    if ((runsPerName.get(g.name) ?? 0) > 1 || run.attempt > 1) {
      g.runLabel = `#${run.number}${run.attempt > 1 ? ` attempt ${run.attempt}` : ""}`;
    }
  }

  // Workflows keep first-appearance order; within one, the current run leads
  // and superseded runs follow newest first.
  const nameOrder = [...new Set(groups.map((g) => g.name))];
  const rank = (g: WorkflowGroup) => nameOrder.indexOf(g.name);
  const out = groups.toSorted((a, b) => {
    if (rank(a) !== rank(b)) return rank(a) - rank(b);
    if (a.superseded !== b.superseded) return a.superseded ? 1 : -1;
    const ra = a.jobs[0]?.run;
    const rb = b.jobs[0]?.run;
    return ra && rb ? compareRuns(rb, ra) : 0;
  });
  return out;
}

// Derive the merge-blocker checklist from the PR, its checks and review threads.
// A blocker with satisfied=false is actively blocking the merge. With an
// inferred review status, review rows come from it instead of GitHub's
// reviewDecision.
export function computeMergeBlockers(
  pr: PullRequest,
  checks: CheckRun[],
  reviewThreads: ReviewThread[],
  review?: ReviewStatus | null,
  checksRollup?: CheckStatus | null,
): MergeBlocker[] {
  const blockers: MergeBlocker[] = [];

  blockers.push({
    kind: MergeBlockerKind.Draft,
    description: pr.isDraft ? "PR is a draft" : "PR is ready for review",
    satisfied: !pr.isDraft,
  });

  const conflicting = pr.mergeable === "CONFLICTING";
  blockers.push({
    kind: MergeBlockerKind.Conflicts,
    description: conflicting
      ? "Merge conflicts with base branch"
      : "No merge conflicts",
    satisfied: !conflicting,
  });

  const reviewApproved = pr.reviewDecision === "APPROVED";
  const reviewChanges = pr.reviewDecision === "CHANGES_REQUESTED";
  const reviewRequired = pr.reviewDecision === "REVIEW_REQUIRED";
  if (review) {
    if (review.required) blockers.push(...reviewBlockers(review));
  } else if (reviewChanges || reviewRequired || reviewApproved) {
    // Name who we're still waiting on so an unsatisfied review requirement is
    // actionable (e.g. "waiting on octo-org/platform-reviewers") instead
    // of a bare "review required".
    const waitingOn = pr.reviewRequests.map((r) => r.name).join(", ");
    const suffix = waitingOn ? ` — waiting on ${waitingOn}` : "";
    blockers.push({
      kind: MergeBlockerKind.RequiredReview,
      description: reviewApproved
        ? "Required reviews approved"
        : reviewChanges
          ? `Changes requested by reviewers${suffix}`
          : `Required review not yet approved${suffix}`,
      satisfied: reviewApproved,
    });
  }

  const unresolved = reviewThreads.filter((t) => !t.isResolved).length;
  if (reviewThreads.length > 0) {
    blockers.push({
      kind: MergeBlockerKind.UnresolvedThread,
      description:
        unresolved === 0
          ? "All review threads resolved"
          : `${unresolved} unresolved review thread${unresolved === 1 ? "" : "s"}`,
      satisfied: unresolved === 0,
    });
  }

  const checkBlocker = failingCheckBlocker(checks, checksRollup ?? null);
  if (checkBlocker) blockers.push(checkBlocker);

  if (pr.mergeStateStatus.toUpperCase() === "BEHIND") {
    blockers.push({
      kind: MergeBlockerKind.BehindBase,
      description: "Branch is behind the base branch",
      satisfied: false,
    });
  }

  return blockers;
}

// Superseded runs don't block, as with GitHub's required checks. When
// GitHub's rollup disagrees and superseded runs don't explain it, we may be
// missing checks, so GitHub's verdict wins.
function failingCheckBlocker(
  checks: CheckRun[],
  rollup: CheckStatus | null,
): MergeBlocker | null {
  const verdict = checksVerdict(checks, rollup);
  const c = verdict.counts;
  if (c.total === 0 && !verdict.rollupMismatch) return null;
  const running = c.running + c.pending;
  let description =
    c.failure > 0
      ? `${c.failure} failing check${c.failure === 1 ? "" : "s"}`
      : running > 0
        ? `${running} check${running === 1 ? "" : "s"} still running`
        : c.total > 0
          ? "All checks passing"
          : "No checks loaded";
  let satisfied = c.failure === 0 && running === 0;
  const stale = checks.length - c.total;
  if (stale > 0) description += ` · ${stale} in superseded runs ignored`;
  if (verdict.rollupMismatch) {
    description += ` · GitHub reports ${verdict.rollupMismatch}`;
    if (!verdict.explainedBySuperseded) {
      satisfied = satisfied && verdictBucket(verdict.rollupMismatch) === 0;
    }
  }
  return { kind: MergeBlockerKind.FailingCheck, description, satisfied };
}

const MAX_NAMES = 5;

function names(list: string[]): string {
  const shown = list.slice(0, MAX_NAMES).join(", ");
  const more = list.length - MAX_NAMES;
  return more > 0 ? `${shown} +${more}` : shown;
}

function at(logins: string[]): string[] {
  return logins.map((l) => `@${l}`);
}

function requirementBlocker(req: ReviewerRequirement): MergeBlocker {
  if (req.satisfied) {
    const via = req.isTeam ? ` by ${names(at(req.approvedBy))}` : "";
    return {
      kind: MergeBlockerKind.RequiredReview,
      description: `${req.reviewer} approved${via}`,
      satisfied: true,
    };
  }
  const who = !req.isTeam
    ? ""
    : req.candidates === null
      ? " — team members not visible"
      : req.candidates.length === 0
        ? " — no eligible reviewer besides the author"
        : ` — one of ${names(at(req.candidates))}`;
  return {
    kind: MergeBlockerKind.RequiredReview,
    description: `Needs approval from ${req.reviewer}${who}`,
    satisfied: false,
  };
}

// The review rows: required approval count, one row per required reviewer, and
// any outstanding change requests. Where this disagrees with GitHub's own
// reviewDecision, the first row says so.
function reviewBlockers(review: ReviewStatus): MergeBlocker[] {
  const rows: MergeBlocker[] = [];

  if (review.requiredApprovals > 0) {
    const have = review.approvedBy.length;
    const need = review.requiredApprovals;
    const enough = have >= need;
    const by = have > 0 ? ` by ${names(at(review.approvedBy))}` : "";
    const waiting =
      !enough && review.otherRequests.length > 0
        ? ` — waiting on ${names(review.otherRequests.map((r) => r.name))}`
        : "";
    rows.push({
      kind: MergeBlockerKind.RequiredReview,
      description: enough
        ? `Approved${by} (${need} required)`
        : `${have} of ${need} required approval${need === 1 ? "" : "s"}${by}${waiting}`,
      satisfied: enough,
    });
  }

  rows.push(...review.requirements.map(requirementBlocker));

  if (review.changesRequestedBy.length > 0) {
    rows.push({
      kind: MergeBlockerKind.RequiredReview,
      description: `Changes requested by ${names(at(review.changesRequestedBy))}`,
      satisfied: false,
    });
  }

  const notes: string[] = [];
  if (review.githubDecision === "APPROVED" && !review.satisfied) {
    notes.push("GitHub reports approved");
  } else if (
    review.githubDecision !== null &&
    review.githubDecision !== "APPROVED" &&
    review.satisfied
  ) {
    notes.push(
      `GitHub still reports ${review.githubDecision.toLowerCase().replace("_", " ")}`,
    );
  }
  const first = rows[0];
  if (first && notes.length > 0) {
    first.description += ` · ${notes.join("; ")}`;
  }

  return rows;
}
