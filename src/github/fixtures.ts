// Canned dashboards for UI iteration. Gated by GHDASH_FIXTURE so tweaking the
// UI needs no GitHub token, no network round-trip, and no worktree with an open
// PR — pair with `bun run dev:watch` for a tight edit loop. The env value is
// either a built-in fixture name (see FIXTURES) or a path to a JSON file
// holding `{ repo, dashboard }` (e.g. one captured from a live run).

import {
  CheckStatus,
  FeedItemKind,
  MergeBlockerKind,
  type PRDashboard,
  type RepoContext,
} from "./types";

export interface Fixture {
  repo: RepoContext;
  dashboard: PRDashboard;
}

const human = { login: "octocat", isBot: false };
const reviewer = { login: "hubot", isBot: false };
const bot = { login: "github-actions", isBot: true };

const now = Date.now();
const ago = (mins: number) => new Date(now - mins * 60_000).toISOString();

const baseRepo: RepoContext = {
  owner: "andycmaj",
  repo: "ghdash",
  branch: "feat/hot-reload",
};

const basePr: PRDashboard["pr"] = {
  number: 42,
  nodeId: "PR_kwDOxxxx",
  title: "Add vite-like hot-reload loop for OpenTUI Solid",
  body: [
    "## What",
    "",
    "Adds a `dev:watch` script and a fixture mode so the UI can be iterated on",
    "without a live GitHub connection.",
    "",
    "- hot-reload loop for the Solid renderer",
    "- canned dashboard fixtures gated by `GHDASH_FIXTURE`",
  ].join("\n"),
  labels: [
    { name: "enhancement", color: "a2eeef" },
    { name: "dx", color: "5c9cf5" },
  ],
  url: "https://github.com/andycmaj/ghdash/pull/42",
  status: "open",
  isDraft: false,
  headRef: "feat/hot-reload",
  baseRef: "main",
  author: human,
  mergeable: "MERGEABLE",
  mergeStateStatus: "CLEAN",
  reviewDecision: "APPROVED",
  reviewRequests: [],
  mergeQueue: null,
  createdAt: ago(240),
  updatedAt: ago(6),
};

const baseFeed: PRDashboard["feed"] = [
  {
    id: "c1",
    kind: FeedItemKind.Comment,
    author: human,
    body: "Opening this up for review — adds `dev:watch` and a fixture mode.",
    createdAt: ago(230),
    url: "https://github.com/x/1",
  },
  {
    id: "r1",
    kind: FeedItemKind.Review,
    author: reviewer,
    body: "Nice, the fixture states make this much easier to eyeball.",
    createdAt: ago(40),
    url: "https://github.com/x/2",
    reviewState: "APPROVED",
  },
  {
    id: "t1",
    kind: FeedItemKind.ThreadComment,
    author: reviewer,
    body: "Can we cover the merge-queue state too?",
    createdAt: ago(35),
    url: "https://github.com/x/3",
    threadId: "th1",
    threadPath: "src/github/fixtures.ts",
    threadLine: 12,
    threadResolved: false,
  },
];

const baseThreads: PRDashboard["reviewThreads"] = [
  {
    id: "th1",
    path: "src/github/fixtures.ts",
    line: 12,
    isResolved: false,
    comments: [baseFeed[2]],
  },
];

const passingChecks: PRDashboard["checks"] = [
  {
    id: "ck1",
    name: "build",
    workflowName: "CI",
    status: CheckStatus.Success,
    conclusion: "SUCCESS",
    annotations: [],
    startedAt: ago(20),
    completedAt: ago(18),
  },
  {
    id: "ck2",
    name: "test",
    workflowName: "CI",
    status: CheckStatus.Success,
    conclusion: "SUCCESS",
    annotations: [],
    startedAt: ago(20),
    completedAt: ago(15),
  },
];

function dashboard(over: Partial<PRDashboard> = {}): PRDashboard {
  return {
    pr: basePr,
    feed: baseFeed,
    reviewThreads: baseThreads,
    checks: passingChecks,
    mergeBlockers: [],
    mergeQueueItems: [],
    mergeQueueChecks: [],
    ...over,
  };
}

export const FIXTURES: Record<string, Fixture> = {
  // A clean, approved, mergeable PR.
  default: {
    repo: baseRepo,
    dashboard: dashboard(),
  },

  // Draft PR with a running check — the "just opened" state.
  draft: {
    repo: baseRepo,
    dashboard: dashboard({
      pr: {
        ...basePr,
        status: "draft",
        isDraft: true,
        reviewDecision: "REVIEW_REQUIRED",
        reviewRequests: [{ name: "octo-org/platform-reviewers", isTeam: true }],
        mergeStateStatus: "DRAFT",
      },
      checks: [
        {
          ...passingChecks[0],
          status: CheckStatus.Running,
          conclusion: undefined,
          completedAt: undefined,
        },
        {
          ...passingChecks[1],
          status: CheckStatus.Pending,
          conclusion: undefined,
          startedAt: undefined,
          completedAt: undefined,
        },
      ],
      mergeBlockers: [
        {
          kind: MergeBlockerKind.Draft,
          description: "PR is a draft",
          satisfied: false,
        },
        {
          kind: MergeBlockerKind.RequiredReview,
          description:
            "Required review not yet approved — waiting on octo-org/platform-reviewers",
          satisfied: false,
        },
      ],
    }),
  },

  // Blocked: changes requested, an unresolved thread, and a failing check.
  blocked: {
    repo: baseRepo,
    dashboard: dashboard({
      pr: {
        ...basePr,
        mergeable: "CONFLICTING",
        mergeStateStatus: "DIRTY",
        reviewDecision: "CHANGES_REQUESTED",
      },
      checks: [
        passingChecks[0],
        {
          id: "ck2",
          name: "test",
          workflowName: "CI",
          status: CheckStatus.Failure,
          conclusion: "FAILURE",
          url: "https://github.com/x/run/2",
          startedAt: ago(20),
          completedAt: ago(12),
          annotations: [
            {
              level: "failure",
              title: "Test failed",
              message: "expected true to be false",
              path: "src/app.test.tsx",
              startLine: 88,
            },
          ],
        },
      ],
      mergeBlockers: [
        {
          kind: MergeBlockerKind.Conflicts,
          description: "Merge conflicts with base",
          satisfied: false,
        },
        {
          kind: MergeBlockerKind.RequiredReview,
          description: "Changes requested",
          satisfied: false,
        },
        {
          kind: MergeBlockerKind.UnresolvedThread,
          description: "1 unresolved thread",
          satisfied: false,
        },
        {
          kind: MergeBlockerKind.FailingCheck,
          description: "test is failing",
          satisfied: false,
        },
        {
          kind: MergeBlockerKind.BehindBase,
          description: "Branch is behind base",
          satisfied: true,
        },
      ],
    }),
  },

  // Queued for merge.
  queued: {
    repo: baseRepo,
    dashboard: dashboard({
      pr: {
        ...basePr,
        mergeStateStatus: "QUEUED",
        mergeQueue: {
          state: "AWAITING_CHECKS",
          position: 3,
          enqueuedAt: ago(9),
          estimatedTimeToMerge: 720,
        },
      },
      mergeQueueItems: [
        {
          id: "mq1",
          position: 1,
          state: "AWAITING_CHECKS",
          number: 38,
          title: "Bump octokit to v4.1",
          url: "https://github.com/andycmaj/ghdash/pull/38",
          author: { login: "dependabot", isBot: true },
          enqueuedAt: ago(14),
          checkStatus: CheckStatus.Running,
          isCurrent: false,
        },
        {
          id: "mq2",
          position: 2,
          state: "AWAITING_CHECKS",
          number: 40,
          title: "Fix flaky poll-loop backoff test",
          url: "https://github.com/andycmaj/ghdash/pull/40",
          author: reviewer,
          enqueuedAt: ago(11),
          checkStatus: CheckStatus.Failure,
          isCurrent: false,
        },
        {
          id: "mq3",
          position: 3,
          state: "AWAITING_CHECKS",
          number: 42,
          title: basePr.title,
          url: basePr.url,
          author: human,
          enqueuedAt: ago(9),
          checkStatus: CheckStatus.Running,
          isCurrent: true,
        },
        {
          id: "mq4",
          position: 4,
          state: "QUEUED",
          number: 44,
          title: "Document fixture mode in the README",
          url: "https://github.com/andycmaj/ghdash/pull/44",
          author: reviewer,
          enqueuedAt: ago(3),
          checkStatus: null,
          isCurrent: false,
        },
      ],
      mergeQueueChecks: [
        {
          id: "mqck1",
          name: "build",
          workflowName: "CI",
          status: CheckStatus.Success,
          conclusion: "SUCCESS",
          url: "https://github.com/x/actions/runs/900/job/1",
          annotations: [],
          startedAt: ago(8),
          completedAt: ago(6),
        },
        {
          id: "mqck2",
          name: "test",
          workflowName: "CI",
          status: CheckStatus.Running,
          url: "https://github.com/x/actions/runs/900/job/2",
          annotations: [],
          startedAt: ago(8),
        },
        {
          id: "mqck3",
          name: "e2e",
          workflowName: "CI",
          status: CheckStatus.Pending,
          annotations: [],
        },
      ],
    }),
  },

  // Already merged.
  merged: {
    repo: baseRepo,
    dashboard: dashboard({
      pr: {
        ...basePr,
        status: "merged",
        mergeStateStatus: "CLEAN",
        updatedAt: ago(2),
      },
    }),
  },
};

export function fixtureNames(): string[] {
  return Object.keys(FIXTURES);
}

// Resolve GHDASH_FIXTURE to a Fixture. A value ending in `.json` is read as a
// file; anything else is looked up as a built-in name.
export async function loadFixture(value: string): Promise<Fixture> {
  const name = value.trim();

  if (name.endsWith(".json")) {
    const file = Bun.file(name);
    if (!(await file.exists())) {
      throw new Error(`Fixture file not found: ${name}`);
    }
    return (await file.json()) as Fixture;
  }

  const fixture = FIXTURES[name];
  if (!fixture) {
    throw new Error(
      `Unknown fixture "${name}". Available: ${fixtureNames().join(", ")}`,
    );
  }
  return fixture;
}
