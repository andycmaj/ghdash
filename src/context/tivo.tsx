// TiVo store: the PR's changeset from local git, the file open in the player,
// its timeline and playhead, and a snapshot cache keyed by (sha, path). The
// changeset follows the GitHub poll (and `r`), re-reading only when HEAD or
// the base branch tip moved.

import {
  createEffect,
  createSignal,
  on,
  onCleanup,
  type Accessor,
  type ParentProps,
} from "solid-js";
import { createStore, produce } from "solid-js/store";
import { createRequiredContext } from "@andycmaj/opentui-app";
import { useGithub } from "./github";
import {
  getBaseTip,
  getBranch,
  getHead,
  getMergeBase,
  getTimeline,
  getTopLevel,
  listChangeset,
  looksBinary,
  MAX_TIVO_LINES,
  MissingBaseError,
  readAt,
  type ChangedFile,
  type TimelineStop,
} from "@/git/history";
import { blameThrough, type Snapshot } from "@/tivo/blame";
import { SectionKey } from "@/github/types";

export interface TivoState {
  // Whether the local checkout is the PR's head branch; history is meaningless
  // for a PR opened by number from some other checkout.
  available: boolean;
  loading: boolean;
  error: string | null;
  hint: string | null;
  baseRef: string | null;
  mergeBase: string | null;
  head: string | null;
  files: ChangedFile[];
  path: string | null;
  stops: TimelineStop[];
  timelineLoading: boolean;
  playhead: number;
  blame: boolean;
}

interface TivoContextValue {
  state: TivoState;
  open: (path: string) => void;
  close: () => void;
  // Open the changed file before/after the open one; false at either end.
  openSibling: (delta: 1 | -1) => boolean;
  sibling: (delta: 1 | -1) => ChangedFile | undefined;
  step: (delta: number) => void;
  seek: (index: number) => void;
  toggleBlame: () => void;
  // Content at a stop of the open file: undefined until loaded, null when the
  // file does not exist there.
  snapshot: (index: number) => Snapshot | undefined;
  load: (index: number) => Promise<Snapshot>;
  // Why the open file can't be played (binary / too large), if so.
  unplayable: Accessor<string | null>;
  // Per-line origin stop for the playhead snapshot, once blame is computable.
  blameAt: (index: number) => number[] | undefined;
}

const [TivoContext, useTivo] = createRequiredContext<TivoContextValue>("Tivo");
export { useTivo };

export function TivoProvider(props: ParentProps) {
  const github = useGithub();
  const [state, setState] = createStore<TivoState>({
    available: false,
    loading: false,
    error: null,
    hint: null,
    baseRef: null,
    mergeBase: null,
    head: null,
    files: [],
    path: null,
    stops: [],
    timelineLoading: false,
    playhead: 0,
    blame: false,
  });

  let root: string | null = null;
  let baseTip: string | null = null;
  let generation = 0;
  const snapshots = new Map<string, Snapshot>();
  const pending = new Map<string, Promise<Snapshot>>();
  let blameMemo: number[][] = [];
  const [cacheVersion, setCacheVersion] = createSignal(0);
  const [unplayable, setUnplayable] = createSignal<string | null>(null);

  const keyFor = (sha: string, path: string) => `${sha}:${path}`;

  async function repoRoot(): Promise<string | null> {
    root ??= await getTopLevel(process.cwd());
    return root;
  }

  async function refreshChangeset() {
    const pr = github.state.pr;
    if (!pr) return;
    const gen = ++generation;
    const cwd = await repoRoot();
    const branch = cwd ? await getBranch(cwd) : null;
    const available =
      !!cwd && (branch === pr.headRef || !!process.env.GHDASH_FIXTURE);
    if (gen !== generation) return;
    if (!available || !cwd) {
      setState({ available: false, files: [], error: null, hint: null });
      return;
    }
    const [head, tip] = await Promise.all([
      getHead(cwd),
      getBaseTip(cwd, pr.baseRef),
    ]);
    if (gen !== generation) return;
    const unchanged =
      state.available &&
      head === state.head &&
      tip === baseTip &&
      pr.baseRef === state.baseRef;
    if (unchanged) return;

    setState({ available: true, loading: true, baseRef: pr.baseRef });
    try {
      const mergeBase = await getMergeBase(cwd, pr.baseRef);
      const files = await listChangeset(cwd, mergeBase);
      if (gen !== generation) return;
      baseTip = tip;
      setState({
        loading: false,
        error: null,
        hint: null,
        mergeBase,
        head,
        files,
      });
      if (state.path) {
        if (files.some((f) => f.path === state.path))
          await loadTimeline(state.path, true);
        else close();
      }
    } catch (err) {
      if (gen !== generation) return;
      baseTip = tip;
      setState({
        loading: false,
        head,
        files: [],
        error: err instanceof Error ? err.message : String(err),
        hint: err instanceof MissingBaseError ? err.hint : null,
      });
    }
  }

  // Re-check after every dashboard fetch: the poll loop and `r` both land here.
  createEffect(
    on(
      () => github.state.lastFetchedAt,
      () => void refreshChangeset(),
    ),
  );

  // Leaving the section drops cached file content (the changeset stays, since
  // the sidebar row depends on it).
  createEffect(
    on(
      () => github.state.selectedSection,
      (section, prev) => {
        if (prev === SectionKey.TiVo && section !== SectionKey.TiVo) close();
      },
    ),
  );

  // With nothing left to show, don't strand the user on an empty section.
  createEffect(() => {
    if (
      github.state.selectedSection === SectionKey.TiVo &&
      !state.loading &&
      state.files.length === 0 &&
      !state.error
    ) {
      github.selectSection(SectionKey.Feed);
    }
  });

  function clearCache() {
    snapshots.clear();
    pending.clear();
    blameMemo = [];
    setCacheVersion((v) => v + 1);
  }

  async function loadTimeline(path: string, preserve: boolean) {
    const cwd = await repoRoot();
    if (!cwd || !state.mergeBase || !state.baseRef) return;
    const previousSha = preserve ? state.stops[state.playhead]?.sha : undefined;
    setState("timelineLoading", true);
    const stops = await getTimeline(cwd, state.mergeBase, state.baseRef, path);
    if (state.path !== path) return;
    const kept = previousSha
      ? stops.findIndex((s) => s.sha === previousSha)
      : -1;
    clearCache();
    setState(
      produce((s) => {
        s.stops = stops;
        s.playhead = kept >= 0 ? kept : stops.length - 1;
        s.timelineLoading = false;
      }),
    );
    void checkPlayable(path);
    prefetch();
  }

  async function checkPlayable(path: string) {
    setUnplayable(null);
    const file = state.files.find((f) => f.path === path);
    if (file?.binary) {
      setUnplayable("Binary file");
      return;
    }
    const head = await load(state.stops.length - 1);
    if (state.path !== path) return;
    if (head && looksBinary(head)) setUnplayable("Binary file");
    else if (head && head.length > MAX_TIVO_LINES)
      setUnplayable(`File is over ${MAX_TIVO_LINES} lines`);
  }

  function load(index: number): Promise<Snapshot> {
    const path = state.path;
    const stop = state.stops[index];
    if (!path || !stop) return Promise.resolve(null);
    const key = keyFor(stop.sha, path);
    if (snapshots.has(key)) return Promise.resolve(snapshots.get(key) ?? null);
    const inflight = pending.get(key);
    if (inflight) return inflight;
    const promise = (async () => {
      const cwd = await repoRoot();
      const lines = cwd ? await readAt(cwd, stop.sha, path) : null;
      // (sha, path) content never changes, so a load that outlived a cache
      // clear is still correct to keep.
      snapshots.set(key, lines);
      pending.delete(key);
      setCacheVersion((v) => v + 1);
      return lines;
    })();
    pending.set(key, promise);
    return promise;
  }

  function snapshot(index: number): Snapshot | undefined {
    cacheVersion();
    const stop = state.stops[index];
    if (!state.path || !stop) return undefined;
    return snapshots.get(keyFor(stop.sha, state.path));
  }

  // Neighbours of the playhead, plus merge-base for the touched-line gutter
  // and every earlier stop while blame is on.
  function prefetch() {
    const p = state.playhead;
    for (const i of [p, p - 1, p + 1, 0]) {
      if (i >= 0 && i < state.stops.length) void load(i);
    }
    if (state.blame) for (let i = 0; i < p; i++) void load(i);
  }

  function blameAt(index: number): number[] | undefined {
    cacheVersion();
    if (blameMemo.length > index) return blameMemo[index];
    const snaps: Snapshot[] = [];
    for (let i = 0; i <= index; i++) {
      const s = snapshot(i);
      if (s === undefined) return undefined;
      snaps.push(s);
    }
    return blameThrough(snaps, index, blameMemo)[index];
  }

  function open(path: string) {
    if (state.path === path && state.stops.length > 0) return;
    setState({ path, stops: [], playhead: 0 });
    void loadTimeline(path, false);
  }

  function sibling(delta: 1 | -1): ChangedFile | undefined {
    const i = state.files.findIndex((f) => f.path === state.path);
    if (i < 0) return undefined;
    return state.files[i + delta];
  }

  function openSibling(delta: 1 | -1): boolean {
    const file = sibling(delta);
    if (!file) return false;
    open(file.path);
    return true;
  }

  function close() {
    setState({ path: null, stops: [], playhead: 0, timelineLoading: false });
    setUnplayable(null);
    clearCache();
  }

  function seek(index: number) {
    const last = state.stops.length - 1;
    if (last < 0) return;
    const next = Math.max(0, Math.min(last, index));
    if (next === state.playhead) return;
    setState("playhead", next);
    prefetch();
  }

  function step(delta: number) {
    seek(state.playhead + delta);
  }

  function toggleBlame() {
    setState("blame", (b) => !b);
    prefetch();
  }

  onCleanup(() => generation++);

  return (
    <TivoContext.Provider
      value={{
        state,
        open,
        close,
        openSibling,
        sibling,
        step,
        seek,
        toggleBlame,
        snapshot,
        load,
        unplayable,
        blameAt,
      }}
    >
      {props.children}
    </TivoContext.Provider>
  );
}
