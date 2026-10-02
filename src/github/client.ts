// GitHub data client. Fetches everything the dashboard needs for a PR —
// including check annotations — in a single GraphQL query (one request per
// poll), so it stays well within API rate limits.

import { $ } from "bun";
import { Octokit } from "octokit";
import {
  FeedItemKind,
  type Annotation,
  type Author,
  type CheckRun,
  type FeedItem,
  type Label,
  type Mergeable,
  type MergeQueueItem,
  type PRDashboard,
  type PrListItem,
  type PullRequest,
  type RepoContext,
  type ReviewDecision,
  type ReviewRequest,
  type ReviewState,
  type ReviewThread,
} from "./types";
import {
  computeMergeBlockers,
  normalizeCheckStatus,
  normalizeStatusContextState,
  prStatus,
} from "./status-utils";

export class GithubAuthError extends Error {}
export class PrNotFoundError extends Error {}

// Resolve a token from the environment, falling back to the `gh` CLI so an
// already-authenticated machine works with no extra setup.
export async function resolveToken(override?: string): Promise<string> {
  const fromEnv = override || process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (fromEnv) return fromEnv;

  const result = await $`gh auth token`.nothrow().quiet();
  if (result.exitCode === 0) {
    const token = result.stdout.toString().trim();
    if (token) return token;
  }

  throw new GithubAuthError(
    "No GitHub token found. Set GITHUB_TOKEN/GH_TOKEN or run `gh auth login`.",
  );
}

// Check runs + legacy statuses on a commit's rollup. Shared by the PR head
// commit and the merge-group commit of its merge-queue entry.
const CHECK_CONTEXTS = `
  contexts(first: 100) {
    nodes {
      __typename
      ... on CheckRun {
        name
        status
        conclusion
        detailsUrl
        startedAt
        completedAt
        checkSuite { workflowRun { workflow { name } } }
        annotations(first: 20) {
          nodes {
            annotationLevel
            message
            title
            path
            location { start { line } }
          }
        }
      }
      ... on StatusContext {
        context
        state
        targetUrl
        createdAt
      }
    }
  }
`;

// The queue is selected through the PR's own entry, so it resolves to null for
// PRs that aren't queued. Other entries only need a one-line rollup state.
const MERGE_QUEUE_ENTRY = `
  mergeQueueEntry {
    state
    position
    enqueuedAt
    estimatedTimeToMerge
    headCommit {
      statusCheckRollup { ${CHECK_CONTEXTS} }
    }
    mergeQueue {
      entries(first: 50) {
        nodes {
          id
          state
          position
          enqueuedAt
          headCommit { statusCheckRollup { state } }
          pullRequest {
            number
            title
            url
            author { login __typename }
          }
        }
      }
    }
  }
`;

// Shared field selection for a PR, used by both the by-branch and by-number
// queries below.
const PR_FIELDS = `
  id
  number
  title
  body
  url
  state
  isDraft
  labels(first: 20) {
    nodes { name color description }
  }
  createdAt
  updatedAt
  mergeable
  mergeStateStatus
  reviewDecision
  reviewRequests(first: 20) {
    nodes {
      requestedReviewer {
        __typename
        ... on User { login }
        ... on Team { combinedSlug }
        ... on Mannequin { login }
      }
    }
  }
  ${MERGE_QUEUE_ENTRY}
  headRefName
  baseRefName
  author { login __typename }
  comments(first: 100) {
    nodes { id url body createdAt author { login __typename } }
  }
  reviews(first: 100) {
    nodes { id url body state createdAt author { login __typename } }
  }
  reviewThreads(first: 100) {
    nodes {
      id
      isResolved
      path
      line
      comments(first: 50) {
        nodes { id url body createdAt author { login __typename } }
      }
    }
  }
  commits(last: 1) {
    nodes {
      commit {
        statusCheckRollup {
          ${CHECK_CONTEXTS}
        }
      }
    }
  }
`;

const PR_BY_BRANCH_QUERY = `
query PRByBranch($owner: String!, $repo: String!, $branch: String!) {
  repository(owner: $owner, name: $repo) {
    pullRequests(headRefName: $branch, first: 5, orderBy: {field: UPDATED_AT, direction: DESC}) {
      nodes { ${PR_FIELDS} }
    }
  }
}`;

const PR_BY_NUMBER_QUERY = `
query PRByNumber($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) { ${PR_FIELDS} }
  }
}`;

// The current user's open PRs across all repos, most-recently-updated first.
// Uses search so it isn't scoped to the current worktree's repo.
const MY_OPEN_PRS_QUERY = `
query MyOpenPrs($q: String!, $first: Int!) {
  search(query: $q, type: ISSUE, first: $first) {
    nodes {
      ... on PullRequest {
        number
        title
        url
        isDraft
        updatedAt
        repository { name owner { login } }
      }
    }
  }
}`;

const ENQUEUE_MUTATION = `
mutation Enqueue($id: ID!) {
  enqueuePullRequest(input: { pullRequestId: $id }) {
    mergeQueueEntry { id state position }
  }
}`;

// Update a PR's title and/or body. Null fields are omitted by the caller so
// only the supplied fields change.
const UPDATE_PR_MUTATION = `
mutation UpdatePr($id: ID!, $title: String, $body: String) {
  updatePullRequest(input: { pullRequestId: $id, title: $title, body: $body }) {
    pullRequest { id title body }
  }
}`;

const REPLY_TO_THREAD_MUTATION = `
mutation ReplyToThread($threadId: ID!, $body: String!) {
  addPullRequestReviewThreadReply(input: { pullRequestReviewThreadId: $threadId, body: $body }) {
    comment { id }
  }
}`;

interface GqlActor {
  login?: string;
  __typename?: string;
}

function toAuthor(actor: GqlActor | null | undefined): Author {
  return {
    login: actor?.login ?? "ghost",
    isBot: actor?.__typename === "Bot",
  };
}

export interface GithubClientOptions {
  tokenOverride?: string;
}

export class GithubClient {
  private octokit: Octokit | null = null;
  private readonly tokenOverride?: string;

  constructor(options: GithubClientOptions = {}) {
    this.tokenOverride = options.tokenOverride;
  }

  private async getOctokit(): Promise<Octokit> {
    if (!this.octokit) {
      const auth = await resolveToken(this.tokenOverride);
      this.octokit = new Octokit({ auth });
    }
    return this.octokit;
  }

  // Fetch the open PR for the current branch of a repo.
  async getDashboard(ctx: RepoContext): Promise<PRDashboard> {
    const octokit = await this.getOctokit();
    const data = await octokit.graphql<PRByBranchResult>(PR_BY_BRANCH_QUERY, {
      owner: ctx.owner,
      repo: ctx.repo,
      branch: ctx.branch,
    });

    // Prefer an open PR for the branch; otherwise fall back to the most
    // recently updated (e.g. a merged or closed PR).
    const nodes = data.repository?.pullRequests?.nodes ?? [];
    const node = nodes.find((n) => n.state === "OPEN") ?? nodes[0];
    if (!node) {
      throw new PrNotFoundError(
        `No PR found for branch "${ctx.branch}" in ${ctx.owner}/${ctx.repo}.`,
      );
    }

    return this.nodeToDashboard(node);
  }

  // Fetch a specific PR by number (any state).
  async getDashboardByNumber(
    owner: string,
    repo: string,
    number: number,
  ): Promise<PRDashboard> {
    const octokit = await this.getOctokit();
    const data = await octokit.graphql<PRByNumberResult>(PR_BY_NUMBER_QUERY, {
      owner,
      repo,
      number,
    });

    const node = data.repository?.pullRequest;
    if (!node) {
      throw new PrNotFoundError(`PR #${number} not found in ${owner}/${repo}.`);
    }

    return this.nodeToDashboard(node);
  }

  // The current user's open PRs (as `author:@me`), across every repo they can
  // see, most-recently-updated first — the source list for the PR picker.
  async listMyOpenPrs(): Promise<PrListItem[]> {
    const octokit = await this.getOctokit();
    const data = await octokit.graphql<MyOpenPrsResult>(MY_OPEN_PRS_QUERY, {
      q: "is:open is:pr author:@me sort:updated-desc",
      first: 50,
    });
    const nodes = data.search?.nodes ?? [];
    const items: PrListItem[] = [];
    for (const n of nodes) {
      // Search can return non-PR issue nodes; the inline fragment leaves those
      // without a number, so skip anything that didn't resolve to a PR.
      if (!n || typeof n.number !== "number" || !n.repository) continue;
      items.push({
        number: n.number,
        title: n.title ?? "",
        url: n.url ?? "",
        isDraft: !!n.isDraft,
        updatedAt: n.updatedAt ?? "",
        owner: n.repository.owner?.login ?? "",
        repo: n.repository.name ?? "",
      });
    }
    return items;
  }

  // Add a PR to the repository's merge queue (what the GitHub UI's
  // "Merge when ready" button does). Throws with GitHub's message if the
  // repo/base branch has no merge queue or the PR isn't eligible.
  async enqueuePr(prNodeId: string): Promise<void> {
    const octokit = await this.getOctokit();
    await octokit.graphql(ENQUEUE_MUTATION, { id: prNodeId });
  }

  // Update a PR's title and/or body. Only the provided fields are sent.
  async updatePr(
    prNodeId: string,
    fields: { title?: string; body?: string },
  ): Promise<void> {
    const octokit = await this.getOctokit();
    await octokit.graphql(UPDATE_PR_MUTATION, {
      id: prNodeId,
      title: fields.title ?? null,
      body: fields.body ?? null,
    });
  }

  async replyToThread(threadId: string, body: string): Promise<void> {
    const octokit = await this.getOctokit();
    await octokit.graphql(REPLY_TO_THREAD_MUTATION, { threadId, body });
  }

  // The repo's labels, offered when editing a PR's labels. REST keeps this a
  // single paginated call and returns names + colors directly.
  async getRepoLabels(owner: string, repo: string): Promise<Label[]> {
    const octokit = await this.getOctokit();
    const { data } = await octokit.rest.issues.listLabelsForRepo({
      owner,
      repo,
      per_page: 100,
    });
    return data.map((l) => ({
      name: l.name,
      color: l.color ?? "",
      description: l.description ?? undefined,
    }));
  }

  // Replace a PR's labels with exactly the given set (by name). setLabels is a
  // full replace, so it doubles as both add and remove.
  async setPrLabels(
    owner: string,
    repo: string,
    number: number,
    labels: string[],
  ): Promise<void> {
    const octokit = await this.getOctokit();
    await octokit.rest.issues.setLabels({
      owner,
      repo,
      issue_number: number,
      labels,
    });
  }

  private nodeToDashboard(node: PRNode): PRDashboard {
    const pr: PullRequest = {
      number: node.number,
      nodeId: node.id,
      title: node.title,
      body: node.body ?? "",
      labels: (node.labels?.nodes ?? []).map((l) => ({
        name: l.name,
        color: l.color ?? "",
        description: l.description ?? undefined,
      })),
      url: node.url,
      status: prStatus({ state: node.state, isDraft: node.isDraft }),
      isDraft: node.isDraft,
      headRef: node.headRefName,
      baseRef: node.baseRefName,
      author: toAuthor(node.author),
      mergeable: (node.mergeable as Mergeable) ?? "UNKNOWN",
      mergeStateStatus: node.mergeStateStatus ?? "UNKNOWN",
      reviewDecision: (node.reviewDecision as ReviewDecision) ?? null,
      reviewRequests: mapReviewRequests(node),
      mergeQueue: node.mergeQueueEntry
        ? {
            state: node.mergeQueueEntry.state,
            position: node.mergeQueueEntry.position ?? null,
            enqueuedAt: node.mergeQueueEntry.enqueuedAt ?? undefined,
            estimatedTimeToMerge:
              node.mergeQueueEntry.estimatedTimeToMerge ?? undefined,
          }
        : null,
      createdAt: node.createdAt,
      updatedAt: node.updatedAt,
    };

    const reviewThreads = mapReviewThreads(node);
    const feed = buildFeed(node, reviewThreads);
    const checks = mapChecks(
      node.commits?.nodes?.[0]?.commit?.statusCheckRollup?.contexts?.nodes,
    );
    const mergeBlockers = computeMergeBlockers(pr, checks, reviewThreads);
    const entry = node.mergeQueueEntry;
    const mergeQueueItems = mapMergeQueueItems(entry, node.number);
    const mergeQueueChecks = mapChecks(
      entry?.headCommit?.statusCheckRollup?.contexts?.nodes,
    );

    return {
      pr,
      feed,
      reviewThreads,
      checks,
      mergeBlockers,
      mergeQueueItems,
      mergeQueueChecks,
    };
  }
}

// Annotations are fetched inline via the GraphQL query (CheckRun.annotations),
// so there are no per-check REST calls.
function mapChecks(contexts: GqlCheckContext[] = []): CheckRun[] {
  const checks: CheckRun[] = [];
  for (const c of contexts) {
    if (c.__typename === "CheckRun") {
      checks.push({
        id: c.name ?? "check",
        name: c.name ?? "check",
        workflowName: c.checkSuite?.workflowRun?.workflow?.name,
        status: normalizeCheckStatus(c.status, c.conclusion),
        conclusion: c.conclusion ?? undefined,
        url: c.detailsUrl ?? undefined,
        startedAt: c.startedAt ?? undefined,
        completedAt: c.completedAt ?? undefined,
        annotations: mapAnnotations(c.annotations?.nodes),
      });
    } else if (c.__typename === "StatusContext") {
      checks.push({
        id: c.context ?? "status",
        name: c.context ?? "status",
        status: normalizeStatusContextState(c.state ?? ""),
        url: c.targetUrl ?? undefined,
        startedAt: c.createdAt ?? undefined,
        annotations: [],
      });
    }
  }

  return checks;
}

function mapMergeQueueItems(
  entry: GqlMergeQueueEntry | null | undefined,
  currentNumber: number,
): MergeQueueItem[] {
  const nodes = entry?.mergeQueue?.entries?.nodes ?? [];
  const items: MergeQueueItem[] = [];
  for (const n of nodes) {
    if (!n?.pullRequest) continue;
    const rollup = n.headCommit?.statusCheckRollup?.state;
    items.push({
      id: n.id,
      position: n.position ?? null,
      state: n.state,
      number: n.pullRequest.number,
      title: n.pullRequest.title,
      url: n.pullRequest.url,
      author: toAuthor(n.pullRequest.author),
      enqueuedAt: n.enqueuedAt ?? undefined,
      checkStatus: rollup ? normalizeStatusContextState(rollup) : null,
      isCurrent: n.pullRequest.number === currentNumber,
    });
  }
  items.sort((a, b) => (a.position ?? Infinity) - (b.position ?? Infinity));
  return items;
}

function mapAnnotations(nodes: GqlAnnotation[] | undefined): Annotation[] {
  if (!nodes) return [];
  return nodes.map((a): Annotation => {
    const level = (a.annotationLevel ?? "").toUpperCase();
    return {
      level:
        level === "FAILURE"
          ? "failure"
          : level === "WARNING"
            ? "warning"
            : "notice",
      message: a.message ?? "",
      title: a.title ?? undefined,
      path: a.path ?? undefined,
      startLine: a.location?.start?.line ?? undefined,
    };
  });
}

// The reviewers a PR is still waiting on. Teams (typically CODEOWNERS) surface
// as "org/team-slug" via combinedSlug; individuals as "@login".
function mapReviewRequests(node: PRNode): ReviewRequest[] {
  const nodes = node.reviewRequests?.nodes ?? [];
  const requests: ReviewRequest[] = [];
  for (const n of nodes) {
    const reviewer = n.requestedReviewer;
    if (!reviewer) continue;
    if (reviewer.__typename === "Team") {
      if (reviewer.combinedSlug) {
        requests.push({ name: reviewer.combinedSlug, isTeam: true });
      }
    } else if (reviewer.login) {
      requests.push({ name: `@${reviewer.login}`, isTeam: false });
    }
  }
  return requests;
}

function mapReviewThreads(node: PRNode): ReviewThread[] {
  const threads = node.reviewThreads?.nodes ?? [];
  return threads.map((t): ReviewThread => {
    const comments = (t.comments?.nodes ?? []).map((c, i): FeedItem => ({
      id: c.id,
      kind: FeedItemKind.ThreadComment,
      author: toAuthor(c.author),
      body: c.body ?? "",
      createdAt: c.createdAt,
      url: c.url,
      threadId: t.id,
      threadPath: t.path ?? undefined,
      threadLine: t.line ?? null,
      threadResolved: t.isResolved,
      isReply: i > 0,
    }));
    return {
      id: t.id,
      path: t.path ?? "",
      line: t.line ?? null,
      isResolved: t.isResolved,
      comments,
    };
  });
}

// Merge issue comments, review submissions and thread comments into one
// timeline sorted oldest-first.
function buildFeed(node: PRNode, reviewThreads: ReviewThread[]): FeedItem[] {
  const items: FeedItem[] = [];

  for (const c of node.comments?.nodes ?? []) {
    items.push({
      id: c.id,
      kind: FeedItemKind.Comment,
      author: toAuthor(c.author),
      body: c.body ?? "",
      createdAt: c.createdAt,
      url: c.url,
    });
  }

  for (const r of node.reviews?.nodes ?? []) {
    // A bodiless PENDING/COMMENTED review is just the wrapper GitHub creates
    // around inline thread comments, which already appear in the feed.
    const state = r.state ?? "";
    const isWrapper = state === "PENDING" || state === "COMMENTED";
    if (isWrapper && !(r.body ?? "").trim()) continue;
    items.push({
      id: r.id,
      kind: FeedItemKind.Review,
      author: toAuthor(r.author),
      body: r.body ?? "",
      createdAt: r.createdAt,
      url: r.url,
      reviewState: (r.state as ReviewState) ?? "COMMENTED",
    });
  }

  for (const thread of reviewThreads) {
    items.push(...thread.comments);
  }

  items.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return items;
}

// --- GraphQL response shapes (only the fields we request) ---

interface GqlComment {
  id: string;
  url: string;
  body?: string;
  createdAt: string;
  author?: GqlActor | null;
}

interface GqlReview extends GqlComment {
  state?: string;
}

interface GqlReviewThread {
  id: string;
  isResolved: boolean;
  path?: string;
  line?: number | null;
  comments?: { nodes?: GqlComment[] };
}

interface GqlAnnotation {
  annotationLevel?: string;
  message?: string;
  title?: string;
  path?: string;
  location?: { start?: { line?: number } };
}

interface GqlCheckContext {
  __typename: string;
  // CheckRun
  name?: string;
  status?: string;
  conclusion?: string;
  detailsUrl?: string;
  startedAt?: string;
  completedAt?: string;
  checkSuite?: { workflowRun?: { workflow?: { name?: string } } };
  annotations?: { nodes?: GqlAnnotation[] };
  // StatusContext
  context?: string;
  state?: string;
  targetUrl?: string;
  createdAt?: string;
}

interface GqlCheckRollup {
  state?: string;
  contexts?: { nodes?: GqlCheckContext[] };
}

interface GqlMergeQueueEntry {
  id?: string;
  state: string;
  position?: number | null;
  enqueuedAt?: string | null;
  estimatedTimeToMerge?: number | null;
  headCommit?: { statusCheckRollup?: GqlCheckRollup | null } | null;
  mergeQueue?: {
    entries?: { nodes?: (GqlQueuedEntry | null)[] };
  } | null;
}

interface GqlQueuedEntry {
  id: string;
  state: string;
  position?: number | null;
  enqueuedAt?: string | null;
  headCommit?: { statusCheckRollup?: GqlCheckRollup | null } | null;
  pullRequest?: {
    number: number;
    title: string;
    url: string;
    author?: GqlActor | null;
  } | null;
}

interface GqlLabel {
  name: string;
  color?: string;
  description?: string | null;
}

interface GqlReviewRequest {
  requestedReviewer?: {
    __typename?: string;
    // User / Mannequin
    login?: string;
    // Team
    combinedSlug?: string;
  } | null;
}

interface PRNode {
  id: string;
  number: number;
  title: string;
  body?: string;
  labels?: { nodes?: GqlLabel[] };
  url: string;
  state: string;
  isDraft: boolean;
  createdAt: string;
  updatedAt: string;
  mergeable?: string;
  mergeStateStatus?: string;
  reviewDecision?: string | null;
  reviewRequests?: { nodes?: GqlReviewRequest[] };
  mergeQueueEntry?: GqlMergeQueueEntry | null;
  headRefName: string;
  baseRefName: string;
  author?: GqlActor | null;
  comments?: { nodes?: GqlComment[] };
  reviews?: { nodes?: GqlReview[] };
  reviewThreads?: { nodes?: GqlReviewThread[] };
  commits?: {
    nodes?: {
      commit?: {
        statusCheckRollup?: GqlCheckRollup | null;
      };
    }[];
  };
}

interface PRByBranchResult {
  repository?: {
    pullRequests?: { nodes?: PRNode[] };
  } | null;
}

interface PRByNumberResult {
  repository?: {
    pullRequest?: PRNode | null;
  } | null;
}

interface MyOpenPrNode {
  number?: number;
  title?: string;
  url?: string;
  isDraft?: boolean;
  updatedAt?: string;
  repository?: { name?: string; owner?: { login?: string } } | null;
}

interface MyOpenPrsResult {
  search?: {
    nodes?: (MyOpenPrNode | null)[];
  } | null;
}
