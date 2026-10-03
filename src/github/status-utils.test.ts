import { describe, test, expect } from "bun:test";
import {
  aggregateStatus,
  canMerge,
  computeMergeBlockers,
  countChecks,
  groupChecksByWorkflow,
  normalizeCheckStatus,
  normalizeStatusContextState,
  prStatus,
} from "./status-utils";
import {
  CheckStatus,
  MergeBlockerKind,
  PRStatus,
  type CheckRun,
  type MergeBlocker,
  type PullRequest,
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
          { name: "octo-org/platform-reviewers", isTeam: true },
          { name: "@octocat", isTeam: false },
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
