// GitHub PR domain view-models (analogous to tilt's Resource types)

export const PRStatus = {
  Draft: "draft",
  Open: "open",
  Merged: "merged",
  Closed: "closed",
} as const;
export type PRStatus = (typeof PRStatus)[keyof typeof PRStatus];

// Normalized status for a check/workflow run, used for glyphs and colors.
export const CheckStatus = {
  Success: "success",
  Failure: "failure",
  Running: "running",
  Pending: "pending",
  Neutral: "neutral",
  Skipped: "skipped",
} as const;
export type CheckStatus = (typeof CheckStatus)[keyof typeof CheckStatus];

export interface RepoContext {
  owner: string;
  repo: string;
  branch: string;
}

export interface Author {
  login: string;
  isBot: boolean;
}

// A repository label, as attached to a PR or offered in the repo.
export interface Label {
  name: string;
  // 6-char hex (no leading #), as GitHub returns it.
  color: string;
  description?: string;
}

export const FeedItemKind = {
  Comment: "comment", // top-level issue comment
  Review: "review", // review submission (approved / changes requested / commented)
  ThreadComment: "thread", // comment inside a review thread
} as const;
export type FeedItemKind = (typeof FeedItemKind)[keyof typeof FeedItemKind];

export type ReviewState =
  | "APPROVED"
  | "CHANGES_REQUESTED"
  | "COMMENTED"
  | "DISMISSED"
  | "PENDING";

export interface FeedItem {
  id: string;
  kind: FeedItemKind;
  author: Author;
  body: string;
  createdAt: string;
  url: string;
  // review submissions only
  reviewState?: ReviewState;
  // review-thread comments only
  threadId?: string;
  threadPath?: string;
  threadLine?: number | null;
  threadResolved?: boolean;
  isReply?: boolean;
}

export interface ReviewThread {
  id: string;
  path: string;
  line: number | null;
  isResolved: boolean;
  comments: FeedItem[];
}

export interface Annotation {
  level: "notice" | "warning" | "failure";
  message: string;
  title?: string;
  path?: string;
  startLine?: number;
}

export interface CheckRun {
  id: string;
  name: string;
  workflowName?: string;
  status: CheckStatus;
  conclusion?: string;
  url?: string;
  startedAt?: string;
  completedAt?: string;
  annotations: Annotation[];
}

export const MergeBlockerKind = {
  Draft: "draft",
  Conflicts: "conflicts",
  RequiredReview: "required-review",
  UnresolvedThread: "unresolved-thread",
  FailingCheck: "failing-check",
  BehindBase: "behind-base",
} as const;
export type MergeBlockerKind =
  (typeof MergeBlockerKind)[keyof typeof MergeBlockerKind];

export interface MergeBlocker {
  kind: MergeBlockerKind;
  description: string;
  // true = requirement satisfied (no longer blocking the merge)
  satisfied: boolean;
}

export type Mergeable = "MERGEABLE" | "CONFLICTING" | "UNKNOWN";

// A PR's entry in the repository merge queue, if it has been queued.
export interface MergeQueueEntry {
  // QUEUED | AWAITING_CHECKS | LOCKED | MERGEABLE | UNMERGEABLE
  state: string;
  position: number | null;
  enqueuedAt?: string;
  // GitHub's estimate, in seconds.
  estimatedTimeToMerge?: number;
}

// One row of the base branch's merge queue, as shown in the Merge queue section.
export interface MergeQueueItem {
  id: string;
  position: number | null;
  state: string;
  number: number;
  title: string;
  url: string;
  author: Author;
  enqueuedAt?: string;
  // Rollup of the checks on the entry's merge-group commit; null before CI starts.
  checkStatus: CheckStatus | null;
  isCurrent: boolean;
}
export type ReviewDecision =
  | "APPROVED"
  | "CHANGES_REQUESTED"
  | "REVIEW_REQUIRED"
  | null;

// A reviewer GitHub is still waiting on (a pending review request). Populated
// from the PR's `reviewRequests`; used to name *which* required reviews are
// missing rather than just "review required".
export interface ReviewRequest {
  // "org/team-slug" for a team (matches GitHub's own display, e.g.
  // "octo-org/platform-reviewers"), "@login" for an individual.
  name: string;
  isTeam: boolean;
}

export interface PullRequest {
  number: number;
  nodeId: string;
  title: string;
  body: string;
  labels: Label[];
  url: string;
  status: PRStatus;
  isDraft: boolean;
  headRef: string;
  baseRef: string;
  author: Author;
  mergeable: Mergeable;
  mergeStateStatus: string;
  reviewDecision: ReviewDecision;
  // Reviewers still pending (empty once every requested reviewer has responded).
  reviewRequests: ReviewRequest[];
  mergeQueue: MergeQueueEntry | null;
  createdAt: string;
  updatedAt: string;
}

// A lightweight PR summary for the "open one of my PRs" picker. Carries just
// enough to display a row and re-point the dashboard (owner/repo/number).
export interface PrListItem {
  number: number;
  title: string;
  url: string;
  isDraft: boolean;
  updatedAt: string;
  owner: string;
  repo: string;
}

// The full dashboard payload for the current PR, produced by GithubClient.
export interface PRDashboard {
  pr: PullRequest;
  feed: FeedItem[];
  reviewThreads: ReviewThread[];
  checks: CheckRun[];
  mergeBlockers: MergeBlocker[];
  // Empty unless the PR is in the merge queue.
  mergeQueueItems: MergeQueueItem[];
  // Checks for this PR's merge-group run (not its head commit).
  mergeQueueChecks: CheckRun[];
}

export const SectionKey = {
  Info: "info",
  Feed: "feed",
  Actions: "actions",
  MergeQueue: "merge-queue",
  Mergeability: "mergeability",
} as const;
export type SectionKey = (typeof SectionKey)[keyof typeof SectionKey];
