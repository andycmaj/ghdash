import { describe, test, expect } from "bun:test";
import {
  actionsJobId,
  aggregateStatus,
  canMerge,
  checksVerdict,
  computeMergeBlockers,
  countChecks,
  groupChecksByWorkflow,
  markSupersededRuns,
  normalizeCheckStatus,
  normalizeStatusContextState,
  prStatus,
  rollupNotice,
  workflowExpandedByDefault,
} from "./status-utils";
import {
  CheckStatus,
  MergeBlockerKind,
  PRStatus,
  type CheckRun,
  type MergeBlocker,
  type PullRequest,
  type ReviewStatus,
  type ReviewThread,
} from "./types";

function makeCheck(status: CheckStatus): CheckRun {
  return { id: "1", name: "c", status, annotations: [] };
}

function makeJob(
  name: string,
  workflowName: string | undefined,
  status: CheckStatus,
  url?: string,
): CheckRun {
  return { id: name, name, workflowName, status, url, annotations: [] };
}

function runJob(
  name: string,
  workflowName: string,
  status: CheckStatus,
  run: { id: number; number: number; attempt?: number; event?: string },
): CheckRun {
  return {
    ...makeJob(name, workflowName, status),
    run: { attempt: 1, event: "pull_request", ...run },
  };
}

function makePR(overrides: Partial<PullRequest> = {}): PullRequest {
  return {
    number: 1,
    nodeId: "PR_1",
    title: "t",
    body: "",
    labels: [],
    url: "u",
    status: PRStatus.Open,
    isDraft: false,
    headRef: "feature",
    baseRef: "main",
    author: { login: "me", isBot: false },
    mergeable: "MERGEABLE",
    mergeStateStatus: "CLEAN",
    reviewDecision: null,
    reviewRequests: [],
    mergeQueue: null,
    createdAt: "",
    updatedAt: "",
    ...overrides,
  };
}

describe("normalizeCheckStatus", () => {
  test("in-progress maps to running", () => {
    expect(normalizeCheckStatus("IN_PROGRESS", undefined)).toBe(
      CheckStatus.Running,
    );
  });
  test("queued maps to pending", () => {
    expect(normalizeCheckStatus("QUEUED", undefined)).toBe(CheckStatus.Pending);
  });
  test("completed+success maps to success", () => {
    expect(normalizeCheckStatus("COMPLETED", "SUCCESS")).toBe(
      CheckStatus.Success,
    );
  });
  test("completed+failure maps to failure", () => {
    expect(normalizeCheckStatus("COMPLETED", "FAILURE")).toBe(
      CheckStatus.Failure,
    );
  });
  test("completed+skipped maps to skipped", () => {
    expect(normalizeCheckStatus("COMPLETED", "SKIPPED")).toBe(
      CheckStatus.Skipped,
    );
  });
});

describe("normalizeStatusContextState", () => {
  test("maps legacy states", () => {
    expect(normalizeStatusContextState("SUCCESS")).toBe(CheckStatus.Success);
    expect(normalizeStatusContextState("ERROR")).toBe(CheckStatus.Failure);
    expect(normalizeStatusContextState("PENDING")).toBe(CheckStatus.Pending);
  });
});

describe("prStatus", () => {
  test("draft open PR", () => {
    expect(prStatus({ state: "OPEN", isDraft: true })).toBe(PRStatus.Draft);
  });
  test("merged", () => {
    expect(prStatus({ state: "MERGED", isDraft: false })).toBe(PRStatus.Merged);
  });
});

describe("countChecks", () => {
  test("tallies by status", () => {
    const counts = countChecks([
      makeCheck(CheckStatus.Success),
      makeCheck(CheckStatus.Success),
      makeCheck(CheckStatus.Failure),
      makeCheck(CheckStatus.Running),
    ]);
    expect(counts.success).toBe(2);
    expect(counts.failure).toBe(1);
    expect(counts.running).toBe(1);
    expect(counts.total).toBe(4);
  });
});

describe("aggregateStatus", () => {
  const base = {
    success: 0,
    failure: 0,
    running: 0,
    pending: 0,
    neutral: 0,
    skipped: 0,
    total: 0,
  };
  test("failure wins", () => {
    expect(aggregateStatus({ ...base, failure: 1, success: 5 })).toBe(
      CheckStatus.Failure,
    );
  });
  test("running over success", () => {
    expect(aggregateStatus({ ...base, running: 1, success: 5 })).toBe(
      CheckStatus.Running,
    );
  });
  test("all success", () => {
    expect(aggregateStatus({ ...base, success: 3 })).toBe(CheckStatus.Success);
  });
});

describe("groupChecksByWorkflow", () => {
  test("groups by workflow, preserves order, rolls up status", () => {
    const groups = groupChecksByWorkflow([
      makeJob(
        "build",
        "CI",
        CheckStatus.Success,
        "https://github.com/o/r/actions/runs/1/job/10",
      ),
      makeJob("test", "CI", CheckStatus.Failure),
      makeJob("lint", "Lint", CheckStatus.Success),
      makeJob("legacy", undefined, CheckStatus.Success),
    ]);

    expect(groups.map((g) => g.key)).toEqual(["CI", "Lint", "Other"]);
    const ci = groups[0];
    expect(ci.jobs.length).toBe(2);
    expect(ci.status).toBe(CheckStatus.Failure); // failure rolls up
    expect(ci.url).toBe("https://github.com/o/r/actions/runs/1"); // /job/ stripped
    expect(groups[2].name).toBe("Other");
  });
});

describe("markSupersededRuns", () => {
  const older = { id: 100, number: 7 };
  const newer = { id: 200, number: 8 };

  test("older runs of a workflow on the same event are superseded", () => {
    const checks = markSupersededRuns([
      runJob("results", "CI", CheckStatus.Failure, older),
      runJob("results", "CI", CheckStatus.Success, newer),
      runJob("lint", "Lint", CheckStatus.Success, { id: 300, number: 1 }),
      makeJob("legacy", undefined, CheckStatus.Success),
    ]);
    expect(checks.map((c) => !!c.superseded)).toEqual([
      true,
      false,
      false,
      false,
    ]);
  });

  test("a re-run attempt supersedes nothing but its own earlier jobs' run", () => {
    const checks = markSupersededRuns([
      runJob("a", "CI", CheckStatus.Success, {
        id: 100,
        number: 7,
        attempt: 2,
      }),
      runJob("b", "CI", CheckStatus.Success, {
        id: 100,
        number: 7,
        attempt: 2,
      }),
    ]);
    expect(checks.some((c) => c.superseded)).toBe(false);
  });

  test("runs from different events stay independent", () => {
    const checks = markSupersededRuns([
      runJob("build", "CI", CheckStatus.Success, { ...older, event: "push" }),
      runJob("build", "CI", CheckStatus.Failure, newer),
    ]);
    expect(checks.some((c) => c.superseded)).toBe(false);
  });
});

describe("groupChecksByWorkflow with duplicate runs", () => {
  const checks = markSupersededRuns([
    runJob("results", "CI", CheckStatus.Failure, { id: 100, number: 7 }),
    runJob("lint", "Lint", CheckStatus.Success, { id: 300, number: 1 }),
    runJob("results", "CI", CheckStatus.Success, { id: 200, number: 8 }),
    runJob("smoke", "CI", CheckStatus.Pending, { id: 200, number: 8 }),
  ]);

  test("one group per run, current run first with its superseded run after", () => {
    const groups = groupChecksByWorkflow(checks);
    expect(
      groups.map((g) => [g.name, g.runLabel, g.superseded, g.jobs.length]),
    ).toEqual([
      ["CI", "#8", false, 2],
      ["CI", "#7", true, 1],
      ["Lint", undefined, false, 1],
    ]);
    expect(groups[1]?.status).toBe(CheckStatus.Failure);
  });

  test("superseded runs collapse even when they failed", () => {
    const [current, stale] = groupChecksByWorkflow(checks);
    expect(current && workflowExpandedByDefault(current)).toBe(true);
    expect(stale && workflowExpandedByDefault(stale)).toBe(false);
  });

  test("labels a lone re-run with its attempt", () => {
    const [group] = groupChecksByWorkflow([
      runJob("build", "CI", CheckStatus.Success, {
        id: 1,
        number: 4,
        attempt: 2,
      }),
    ]);
    expect(group?.runLabel).toBe("#4 attempt 2");
  });
});

describe("checksVerdict", () => {
  const superseded = markSupersededRuns([
    runJob("results", "CI", CheckStatus.Failure, { id: 100, number: 7 }),
    runJob("results", "CI", CheckStatus.Success, { id: 200, number: 8 }),
  ]);

  test("ignores superseded runs, notes GitHub counting them", () => {
    const verdict = checksVerdict(superseded, CheckStatus.Failure);
    expect(verdict.status).toBe(CheckStatus.Success);
    expect(verdict.counts.total).toBe(1);
    expect(verdict.rollupMismatch).toBe(CheckStatus.Failure);
    expect(verdict.explainedBySuperseded).toBe(true);
    expect(rollupNotice(verdict)).toBe(
      "GitHub reports failure for this commit, counting superseded runs",
    );
  });

  test("flags a rollup the loaded checks can't explain", () => {
    const verdict = checksVerdict(
      [makeJob("build", "CI", CheckStatus.Success)],
      CheckStatus.Failure,
    );
    expect(verdict.explainedBySuperseded).toBe(false);
    expect(rollupNotice(verdict)).toContain("some checks may be missing");
  });

  test("agreeing rollups (and pending vs running) are no mismatch", () => {
    expect(
      checksVerdict(
        [makeJob("build", "CI", CheckStatus.Running)],
        CheckStatus.Pending,
      ).rollupMismatch,
    ).toBeNull();
    expect(
      checksVerdict(
        [makeJob("build", "CI", CheckStatus.Skipped)],
        CheckStatus.Success,
      ).rollupMismatch,
    ).toBeNull();
    expect(checksVerdict([], null).rollupMismatch).toBeNull();
  });
});

describe("canMerge", () => {
  const sat = (satisfied: boolean): MergeBlocker => ({
    kind: MergeBlockerKind.Draft,
    description: "",
    satisfied,
  });

  test("false when no PR", () => {
    expect(canMerge(null, [])).toBe(false);
  });
  test("false when PR not open", () => {
    expect(canMerge(makePR({ status: PRStatus.Draft }), [sat(true)])).toBe(
      false,
    );
  });
  test("false when a requirement is unmet", () => {
    expect(canMerge(makePR(), [sat(true), sat(false)])).toBe(false);
  });
  test("true when open and all satisfied", () => {
    expect(canMerge(makePR(), [sat(true), sat(true)])).toBe(true);
  });
  test("false when already in the merge queue", () => {
    expect(
      canMerge(makePR({ mergeQueue: { state: "QUEUED", position: 1 } }), [
        sat(true),
      ]),
    ).toBe(false);
  });
});

describe("computeMergeBlockers", () => {
  test("clean PR: draft/conflict satisfied", () => {
    const blockers = computeMergeBlockers(makePR(), [], []);
    const draft = blockers.find((b) => b.kind === MergeBlockerKind.Draft);
    expect(draft?.satisfied).toBe(true);
  });

  test("draft PR is a blocker", () => {
    const blockers = computeMergeBlockers(makePR({ isDraft: true }), [], []);
    const draft = blockers.find((b) => b.kind === MergeBlockerKind.Draft);
    expect(draft?.satisfied).toBe(false);
  });

  test("conflicts are a blocker", () => {
    const blockers = computeMergeBlockers(
      makePR({ mergeable: "CONFLICTING" }),
      [],
      [],
    );
    const conflict = blockers.find(
      (b) => b.kind === MergeBlockerKind.Conflicts,
    );
    expect(conflict?.satisfied).toBe(false);
  });

  test("unresolved threads block", () => {
    const threads: ReviewThread[] = [
      { id: "1", path: "a", line: 1, isResolved: false, comments: [] },
      { id: "2", path: "b", line: 2, isResolved: true, comments: [] },
    ];
    const blockers = computeMergeBlockers(makePR(), [], threads);
    const unresolved = blockers.find(
      (b) => b.kind === MergeBlockerKind.UnresolvedThread,
    );
    expect(unresolved?.satisfied).toBe(false);
    expect(unresolved?.description).toContain("1 unresolved");
  });

  test("failing check blocks", () => {
    const blockers = computeMergeBlockers(
      makePR(),
      [makeCheck(CheckStatus.Failure)],
      [],
    );
    const check = blockers.find(
      (b) => b.kind === MergeBlockerKind.FailingCheck,
    );
    expect(check?.satisfied).toBe(false);
  });

  test("a failure in a superseded run doesn't block", () => {
    const checks = markSupersededRuns([
      runJob("results", "CI", CheckStatus.Failure, { id: 100, number: 7 }),
      runJob("results", "CI", CheckStatus.Success, { id: 200, number: 8 }),
    ]);
    const check = computeMergeBlockers(
      makePR(),
      checks,
      [],
      null,
      CheckStatus.Failure,
    ).find((b) => b.kind === MergeBlockerKind.FailingCheck);
    expect(check).toEqual({
      kind: MergeBlockerKind.FailingCheck,
      description:
        "All checks passing · 1 in superseded runs ignored · GitHub reports failure",
      satisfied: true,
    });
  });

  test("GitHub's failing rollup wins when our checks look green", () => {
    const check = computeMergeBlockers(
      makePR(),
      [makeCheck(CheckStatus.Success)],
      [],
      null,
      CheckStatus.Failure,
    ).find((b) => b.kind === MergeBlockerKind.FailingCheck);
    expect(check?.satisfied).toBe(false);
    expect(check?.description).toBe(
      "All checks passing · GitHub reports failure",
    );
  });

  test("required review satisfied when approved", () => {
    const blockers = computeMergeBlockers(
      makePR({ reviewDecision: "APPROVED" }),
      [],
      [],
    );
    const review = blockers.find(
      (b) => b.kind === MergeBlockerKind.RequiredReview,
    );
    expect(review?.satisfied).toBe(true);
  });

  test("required review names the pending reviewers", () => {
    const blockers = computeMergeBlockers(
      makePR({
        reviewDecision: "REVIEW_REQUIRED",
        reviewRequests: [
          {
            name: "octo-org/platform-reviewers",
            isTeam: true,
            asCodeOwner: true,
          },
          { name: "@octocat", isTeam: false, asCodeOwner: false },
        ],
      }),
      [],
      [],
    );
    const review = blockers.find(
      (b) => b.kind === MergeBlockerKind.RequiredReview,
    );
    expect(review?.satisfied).toBe(false);
    expect(review?.description).toBe(
      "Required review not yet approved — waiting on octo-org/platform-reviewers, @octocat",
    );
  });

  test("required review omits the waiting-on suffix when no requests are pending", () => {
    const blockers = computeMergeBlockers(
      makePR({ reviewDecision: "REVIEW_REQUIRED", reviewRequests: [] }),
      [],
      [],
    );
    const review = blockers.find(
      (b) => b.kind === MergeBlockerKind.RequiredReview,
    );
    expect(review?.description).toBe("Required review not yet approved");
  });

  test("behind base is a blocker", () => {
    const blockers = computeMergeBlockers(
      makePR({ mergeStateStatus: "BEHIND" }),
      [],
      [],
    );
    const behind = blockers.find((b) => b.kind === MergeBlockerKind.BehindBase);
    expect(behind?.satisfied).toBe(false);
  });
});

describe("computeMergeBlockers with inferred review status", () => {
  function status(over: Partial<ReviewStatus> = {}): ReviewStatus {
    return {
      required: true,
      requiredApprovals: 1,
      approvedBy: [],
      changesRequestedBy: [],
      requirements: [],
      otherRequests: [],
      satisfied: false,
      githubDecision: "REVIEW_REQUIRED",
      ...over,
    };
  }

  function reviewRows(review: ReviewStatus): MergeBlocker[] {
    return computeMergeBlockers(makePR(), [], [], review).filter(
      (b) => b.kind === MergeBlockerKind.RequiredReview,
    );
  }

  test("credits a team with its member's approval and names who can still approve", () => {
    const rows = reviewRows(
      status({
        approvedBy: ["alice"],
        requirements: [
          {
            reviewer: "octo-org/platform",
            isTeam: true,
            approvedBy: ["alice"],
            candidates: ["alice"],
            satisfied: true,
          },
          {
            reviewer: "octo-org/payments",
            isTeam: true,
            approvedBy: [],
            candidates: ["bob", "carol"],
            satisfied: false,
          },
          {
            reviewer: "@dave",
            isTeam: false,
            approvedBy: [],
            candidates: ["dave"],
            satisfied: false,
          },
        ],
      }),
    );
    expect(rows.map((r) => [r.satisfied, r.description])).toEqual([
      [true, "Approved by @alice (1 required)"],
      [true, "octo-org/platform approved by @alice"],
      [false, "Needs approval from octo-org/payments — one of @bob, @carol"],
      [false, "Needs approval from @dave"],
    ]);
  });

  test("says when team members aren't visible", () => {
    const [row] = reviewRows(
      status({
        requiredApprovals: 0,
        requirements: [
          {
            reviewer: "octo-org/secret",
            isTeam: true,
            approvedBy: [],
            candidates: null,
            satisfied: false,
          },
        ],
      }),
    );
    expect(row?.description).toBe(
      "Needs approval from octo-org/secret — team members not visible",
    );
  });

  test("flags disagreement with GitHub's decision", () => {
    const [approved] = reviewRows(
      status({ approvedBy: ["a"], satisfied: true }),
    );
    expect(approved?.description).toBe(
      "Approved by @a (1 required) · GitHub still reports review required",
    );
    const [blocked] = reviewRows(status({ githubDecision: "APPROVED" }));
    expect(blocked?.satisfied).toBe(false);
    expect(blocked?.description).toBe(
      "0 of 1 required approval · GitHub reports approved",
    );
  });

  test("lists pending optional reviewers and change requests", () => {
    const rows = reviewRows(
      status({
        otherRequests: [{ name: "@dave", isTeam: false, asCodeOwner: false }],
        changesRequestedBy: ["bob"],
      }),
    );
    expect(rows.map((r) => r.description)).toEqual([
      "0 of 1 required approval — waiting on @dave",
      "Changes requested by @bob",
    ]);
  });

  test("no review rows when nothing is required", () => {
    expect(reviewRows(status({ required: false }))).toEqual([]);
  });
});

describe("actionsJobId", () => {
  test("parses the job id from an Actions details URL", () => {
    expect(actionsJobId("https://github.com/o/r/actions/runs/1/job/10")).toBe(
      10,
    );
    expect(
      actionsJobId("https://github.com/o/r/actions/runs/1/job/10?pr=3"),
    ).toBe(10);
  });
  test("returns null for non-Actions checks", () => {
    expect(actionsJobId("https://ci.example.com/build/5")).toBeNull();
    expect(actionsJobId("https://github.com/o/r/actions/runs/1")).toBeNull();
  });
});
