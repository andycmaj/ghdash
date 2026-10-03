import {
  createContext,
  useContext,
  onMount,
  onCleanup,
  createSignal,
  type Accessor,
  type ParentProps,
  batch,
} from "solid-js";
import { createStore, produce } from "solid-js/store";
import {
  run,
  sleep,
  call,
  race,
  createSignal as createEffectionSignal,
  type Task,
  type Operation,
  type Signal,
} from "effection";
import { GithubClient } from "../github/client";
import { getRepoContext } from "../github/repo-context";
import { loadFixture } from "../github/fixtures";
import type { PRSpec } from "../github/pr-spec";
import {
  SectionKey,
  type CheckRun,
  type FeedItem,
  type Label,
  type MergeBlocker,
  type MergeQueueItem,
  type PRDashboard,
  type PrListItem,
  type PullRequest,
  type RepoContext,
  type ReviewThread,
} from "../github/types";
import type { ConnectionStatus } from "../theme/theme";

const DEFAULT_POLL_MS = 15000;
const ERROR_BACKOFF_MS = 5000;

interface GithubState {
  connectionStatus: ConnectionStatus;
  repo: RepoContext | null;
  pr: PullRequest | null;
  feed: FeedItem[];
  reviewThreads: ReviewThread[];
  checks: CheckRun[];
  mergeBlockers: MergeBlocker[];
  mergeQueueItems: MergeQueueItem[];
  mergeQueueChecks: CheckRun[];
  selectedSection: SectionKey;
  lastFetchedAt: string | null;
  error: string | null;
}

interface GithubContextValue {
  state: GithubState;
  client: GithubClient;
  selectSection: (section: SectionKey) => void;
  refresh: () => void;
  merging: Accessor<boolean>;
  enqueuePr: () => Promise<void>;
  // PR editing
  updatePrTitle: (title: string) => Promise<void>;
  updatePrBody: (body: string) => Promise<void>;
  getRepoLabels: () => Promise<Label[]>;
  setPrLabels: (labels: Label[]) => Promise<void>;
  replyToThread: (item: FeedItem, body: string) => Promise<void>;
  // PR switching
  listMyOpenPrs: () => Promise<PrListItem[]>;
  openPr: (item: PrListItem) => void;
}

// What the poll loop is currently fetching. Held in a mutable ref so `openPr`
// can re-point the dashboard at runtime and the next tick picks it up.
type FetchTarget =
  | { kind: "branch"; owner: string; repo: string; branch: string }
  | { kind: "number"; owner: string; repo: string; number: number };

const GithubContext = createContext<GithubContextValue>();

export interface GithubProviderProps {
  pollMs?: number;
  tokenOverride?: string;
  prSpec?: PRSpec;
}

export function GithubProvider(props: ParentProps<GithubProviderProps>) {
  const client = new GithubClient({ tokenOverride: props.tokenOverride });

  const [state, setState] = createStore<GithubState>({
    connectionStatus: "connecting",
    repo: null,
    pr: null,
    feed: [],
    reviewThreads: [],
    checks: [],
    mergeBlockers: [],
    mergeQueueItems: [],
    mergeQueueChecks: [],
    selectedSection: SectionKey.Feed,
    lastFetchedAt: null,
    error: null,
  });

  // Effection signal used to wake the poll loop early for a manual refresh.
  const refreshSignal: Signal<void, never> = createEffectionSignal();

  let mainTask: Task<void> | null = null;

  // Mutable so openPr can switch which PR the poll loop fetches; the loop reads
  // it fresh each tick.
  let currentTarget: FetchTarget | null = null;

  function fetchForTarget(t: FetchTarget): () => Promise<PRDashboard> {
    if (t.kind === "number") {
      return () => client.getDashboardByNumber(t.owner, t.repo, t.number);
    }
    return () =>
      client.getDashboard({ owner: t.owner, repo: t.repo, branch: t.branch });
  }

  function applyDashboard(dashboard: PRDashboard) {
    setState(
      produce((s) => {
        s.connectionStatus = "connected";
        s.pr = dashboard.pr;
        s.feed = dashboard.feed;
        s.reviewThreads = dashboard.reviewThreads;
        s.checks = dashboard.checks;
        s.mergeBlockers = dashboard.mergeBlockers;
        // `?? []` keeps JSON fixtures captured before the merge queue was added loading.
        s.mergeQueueItems = dashboard.mergeQueueItems ?? [];
        s.mergeQueueChecks = dashboard.mergeQueueChecks ?? [];
        // The section disappears once the PR leaves the queue.
        if (
          s.selectedSection === SectionKey.MergeQueue &&
          !dashboard.pr.mergeQueue
        ) {
          s.selectedSection = SectionKey.Mergeability;
        }
        s.lastFetchedAt = new Date().toISOString();
        s.error = null;
        // Fill the real head branch once known (relevant when targeting a PR by number).
        if (s.repo) s.repo.branch = dashboard.pr.headRef;
      }),
    );
  }

  // Wait until the poll interval elapses OR a manual refresh is requested.
  function* waitNextTick(ms: number): Operation<void> {
    yield* race([sleep(ms), waitForRefresh()]);
  }

  function* waitForRefresh(): Operation<void> {
    const subscription = yield* refreshSignal;
    yield* subscription.next();
  }

  function* fixtureOperation(fixtureValue: string): Operation<void> {
    // Fixture mode: no network, no git. Load canned data once, then re-load on
    // each manual refresh so editing a `.json` fixture and pressing refresh
    // shows the change without a restart.
    while (true) {
      try {
        const fixture = yield* call(() => loadFixture(fixtureValue));
        setState("repo", fixture.repo);
        applyDashboard(fixture.dashboard);
      } catch (err) {
        batch(() => {
          setState("connectionStatus", "disconnected");
          setState("error", errorMessage(err));
        });
      }
      yield* waitForRefresh();
    }
  }

  function* mainOperation(): Operation<void> {
    const fixtureValue = process.env.GHDASH_FIXTURE;
    if (fixtureValue) {
      yield* fixtureOperation(fixtureValue);
      return;
    }

    // Resolve the initial fetch target at startup: either an explicit PR (by
    // number, optionally with owner/repo) or the current worktree branch.
    // openPr can later re-point currentTarget; the loop below reads it per tick.
    try {
      const spec = props.prSpec;
      if (spec?.number != null) {
        let owner = spec.owner;
        let repo = spec.repo;
        // A bare number needs the owner/repo from the current worktree.
        if (!owner || !repo) {
          const rc = yield* call(() => getRepoContext());
          owner = rc.owner;
          repo = rc.repo;
        }
        const number = spec.number;
        setState("repo", { owner: owner!, repo: repo!, branch: `#${number}` });
        currentTarget = { kind: "number", owner: owner!, repo: repo!, number };
      } else {
        const rc = yield* call(() => getRepoContext());
        setState("repo", rc);
        currentTarget = {
          kind: "branch",
          owner: rc.owner,
          repo: rc.repo,
          branch: rc.branch,
        };
      }
    } catch (err) {
      batch(() => {
        setState("connectionStatus", "disconnected");
        setState("error", errorMessage(err));
      });
      return;
    }

    while (true) {
      if (state.connectionStatus !== "connected") {
        setState("connectionStatus", "connecting");
      }

      try {
        const dashboard = yield* call(fetchForTarget(currentTarget!));
        applyDashboard(dashboard);
      } catch (err) {
        batch(() => {
          setState("connectionStatus", "disconnected");
          setState("error", errorMessage(err));
        });
        yield* sleep(ERROR_BACKOFF_MS);
        continue;
      }

      yield* waitNextTick(props.pollMs ?? DEFAULT_POLL_MS);
    }
  }

  onMount(() => {
    mainTask = run(mainOperation);
  });

  onCleanup(() => {
    if (mainTask) {
      mainTask.halt();
      mainTask = null;
    }
  });

  function selectSection(section: SectionKey) {
    setState("selectedSection", section);
  }

  function refresh() {
    refreshSignal.send();
  }

  const [merging, setMerging] = createSignal(false);

  // Add the PR to the merge queue.
  async function enqueuePr() {
    const pr = state.pr;
    if (!pr || merging()) return;
    setMerging(true);
    try {
      await client.enqueuePr(pr.nodeId);
      refresh(); // pull the updated (queued) state
    } finally {
      setMerging(false);
    }
  }

  // Fixture mode has no network/git, so edits mutate the local store instead of
  // calling GitHub. This keeps the editing UI fully exercisable via GHDASH_FIXTURE.
  const fixtureMode = () => !!process.env.GHDASH_FIXTURE;

  async function updatePrTitle(title: string) {
    const pr = state.pr;
    if (!pr) return;
    if (fixtureMode()) {
      setState("pr", "title", title);
      return;
    }
    await client.updatePr(pr.nodeId, { title });
    refresh();
  }

  async function updatePrBody(body: string) {
    const pr = state.pr;
    if (!pr) return;
    if (fixtureMode()) {
      setState("pr", "body", body);
      return;
    }
    await client.updatePr(pr.nodeId, { body });
    refresh();
  }

  // Common repo labels used to seed the label picker in fixture mode.
  const FIXTURE_LABELS: Label[] = [
    { name: "enhancement", color: "a2eeef" },
    { name: "bug", color: "d73a4a" },
    { name: "dx", color: "5c9cf5" },
    { name: "documentation", color: "0075ca" },
    { name: "good first issue", color: "7057ff" },
  ];

  async function getRepoLabels(): Promise<Label[]> {
    const repo = state.repo;
    if (fixtureMode() || !repo) {
      // Union the PR's current labels with the canned set so everything the PR
      // already has is toggleable.
      const byName = new Map<string, Label>();
      for (const l of [...FIXTURE_LABELS, ...(state.pr?.labels ?? [])]) {
        byName.set(l.name, l);
      }
      return [...byName.values()];
    }
    return client.getRepoLabels(repo.owner, repo.repo);
  }

  async function setPrLabels(labels: Label[]) {
    const pr = state.pr;
    const repo = state.repo;
    if (!pr) return;
    if (fixtureMode() || !repo) {
      setState("pr", "labels", labels);
      return;
    }
    await client.setPrLabels(
      repo.owner,
      repo.repo,
      pr.number,
      labels.map((l) => l.name),
    );
    refresh();
  }

  async function replyToThread(item: FeedItem, body: string) {
    if (!item.threadId) throw new Error("Not a review-thread comment");
    if (fixtureMode()) {
      const reply: FeedItem = {
        ...item,
        id: `fixture-reply-${Date.now()}`,
        author: { login: "you", isBot: false },
        body,
        createdAt: new Date().toISOString(),
        isReply: true,
      };
      setState(
        produce((s) => {
          s.feed.push(reply);
          s.reviewThreads
            .find((t) => t.id === item.threadId)
            ?.comments.push(reply);
        }),
      );
      return;
    }
    await client.replyToThread(item.threadId, body);
    refresh();
  }

  // The current user's open PRs, offered by the PR picker. In fixture mode
  // there's no network, so surface the single canned PR as the only choice.
  async function listMyOpenPrs(): Promise<PrListItem[]> {
    if (fixtureMode()) {
      const pr = state.pr;
      const repo = state.repo;
      if (!pr || !repo) return [];
      return [
        {
          number: pr.number,
          title: pr.title,
          url: pr.url,
          isDraft: pr.isDraft,
          updatedAt: pr.updatedAt,
          owner: repo.owner,
          repo: repo.repo,
        },
      ];
    }
    return client.listMyOpenPrs();
  }

  // Re-point the dashboard at a different PR. Updates the poll target and wakes
  // the loop so the new PR loads immediately. No-op in fixture mode (no fetch).
  function openPr(item: PrListItem) {
    if (fixtureMode()) return;
    currentTarget = {
      kind: "number",
      owner: item.owner,
      repo: item.repo,
      number: item.number,
    };
    batch(() => {
      setState("repo", {
        owner: item.owner,
        repo: item.repo,
        branch: `#${item.number}`,
      });
      setState("pr", null);
      setState("connectionStatus", "connecting");
    });
    refresh();
  }

  const value: GithubContextValue = {
    state,
    client,
    selectSection,
    refresh,
    merging,
    enqueuePr,
    updatePrTitle,
    updatePrBody,
    getRepoLabels,
    setPrLabels,
    replyToThread,
    listMyOpenPrs,
    openPr,
  };

  return (
    <GithubContext.Provider value={value}>
      {props.children}
    </GithubContext.Provider>
  );
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function useGithub() {
  const context = useContext(GithubContext);
  if (!context) {
    throw new Error("useGithub must be used within a GithubProvider");
  }
  return context;
}
