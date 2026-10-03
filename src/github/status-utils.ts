// Status mapping and merge-blocker computation for the current PR.

import {
  CheckStatus,
  MergeBlockerKind,
  PRStatus,
  type CheckRun,
  type MergeBlocker,
  type PullRequest,
  type ReviewThread,
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

export interface WorkflowGroup {
  key: string;
  name: string;
  status: CheckStatus;
  url?: string;
  jobs: CheckRun[];
  counts: CheckCounts;
}

// A workflow row is expanded by default only while it still needs attention:
// in-progress or failed runs. Completed, successful ones collapse to cut noise.
export function workflowExpandedByDefault(status: CheckStatus): boolean {
  return (
    status === CheckStatus.Failure ||
    status === CheckStatus.Running ||
    status === CheckStatus.Pending
  );
}

// The run URL for a workflow is a job's details URL without the /job/<id> tail.
function workflowRunUrl(job: CheckRun): string | undefined {
  if (!job.url) return undefined;
  const match = job.url.match(/^(.*\/actions\/runs\/\d+)/);
  return match ? match[1] : job.url;
}

// Group check runs by their workflow, preserving first-appearance order.
// Checks with no workflow (e.g. legacy commit statuses) fall under "Other".
export function groupChecksByWorkflow(checks: CheckRun[]): WorkflowGroup[] {
  const order: string[] = [];
  const byKey = new Map<string, CheckRun[]>();

  for (const check of checks) {
    const key = check.workflowName || "Other";
    if (!byKey.has(key)) {
      byKey.set(key, []);
      order.push(key);
    }
    byKey.get(key)!.push(check);
  }

  return order.map((key) => {
    const jobs = byKey.get(key)!;
    const counts = countChecks(jobs);
    const withUrl = jobs.find((j) => j.url);
    return {
      key,
      name: key,
      status: aggregateStatus(counts),
      url: withUrl ? workflowRunUrl(withUrl) : undefined,
      jobs,
      counts,
    };
  });
}

// Derive the merge-blocker checklist from the PR, its checks and review threads.
// A blocker with satisfied=false is actively blocking the merge.
export function computeMergeBlockers(
  pr: PullRequest,
  checks: CheckRun[],
  reviewThreads: ReviewThread[],
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
  if (reviewChanges || reviewRequired || reviewApproved) {
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

  const failing = checks.filter((c) => c.status === CheckStatus.Failure).length;
  const running = checks.filter(
    (c) => c.status === CheckStatus.Running || c.status === CheckStatus.Pending,
  ).length;
  if (checks.length > 0) {
    blockers.push({
      kind: MergeBlockerKind.FailingCheck,
      description:
        failing > 0
          ? `${failing} failing check${failing === 1 ? "" : "s"}`
          : running > 0
            ? `${running} check${running === 1 ? "" : "s"} still running`
            : "All checks passing",
      satisfied: failing === 0 && running === 0,
    });
  }

  if (pr.mergeStateStatus.toUpperCase() === "BEHIND") {
    blockers.push({
      kind: MergeBlockerKind.BehindBase,
      description: "Branch is behind the base branch",
      satisfied: false,
    });
  }

  return blockers;
}
