# Spec: PR TiVo

Status: draft · Owner: @andycmaj · Branch: `feat/pr-tivo`

<!--
Spec style: one markdown file per feature, under docs/specs/.
Sections, in order: Why → What (requirements, numbered R#) → How (design
sketch) → Out of scope → Open questions → Plan (checklist).
Requirements are the contract: each R# is testable and gets checked off in
Plan when implemented + verified. Edit the spec when reality changes; the
spec and the code should never disagree at merge time.
-->

## Why

Reviewing a PR as one squashed diff hides _how_ the change was built. Seeing a
file evolve commit by commit — what was tried, reverted, refactored — makes the
author's intent much easier to follow, and helps the author re-check their own
history before asking for review.

## What

A new **TiVo** view: pick a file in the PR's changeset, then scrub back and
forth along a timeline of that file's commits. As the playhead moves, the
visible file content changes in place, with the edited lines animated.

### Terms

- **Merge-base**: `git merge-base origin/<baseRef> HEAD`, where `baseRef` is the
  PR's base branch (`PullRequest.baseRef`).
- **Changeset**: files in `git diff --name-only <merge-base>..HEAD`.
- **Timeline**: for the selected file, the ordered list of stops
  `[merge-base, c1, c2, …, cN]`, where `c1..cN` are the commits in
  `<merge-base>..HEAD` that touched the file, oldest first.
- **Playhead**: the currently selected stop. Index `0` is merge-base.

### Requirements

Entry and file selection

- **R1** A new `TiVo` row appears in the section tree (left pane) whenever the
  PR has a non-empty changeset. Selecting it shows the TiVo view in the
  content pane.
- **R2** The TiVo view lists changeset files (path, +/− counts, number of
  commits touching it). `j`/`k` move, `enter` opens a file into the player.
- **R3** Files added on the branch have a merge-base stop with empty content;
  files deleted on the branch end on an empty stop. Both render a
  "(file does not exist)" placeholder at those stops.

Timeline

- **R4** The player shows a timeline bar: one tick per stop, `0` labelled
  `base`, the rest labelled with short SHA. The playhead tick is highlighted.
  Below the bar: the current stop's short SHA, subject, author, relative date
  (merge-base shows the base branch name instead of a subject).
- **R5** `l`/`right` steps playhead forward one stop, `h`/`left` steps back.
  `0` jumps to merge-base, `$` jumps to HEAD. Steps clamp at both ends (no
  wrap).
- **R6** Merge commits (e.g. base merged into the branch) that touched the
  file are normal stops, rendered with a `merge` marker on their tick.
- **R7** Opening a file puts the playhead at HEAD (most familiar state), so
  the first interaction is rewinding.

Content and animation

- **R8** The content area shows the full file at the playhead stop, with line
  numbers, scrollable with `ctrl+d`/`ctrl+u`/`pageup`/`pagedown`/`g`/`G`.
- **R9** Moving the playhead from stop A to stop B computes a line diff A→B
  and animates only lines in or near the viewport:
  - added lines: inserted, background flashes `success` color, fades out
  - removed lines: background flashes `error` color, then collapse out
  - modified lines (paired remove+add in the same hunk): flash `warning`
    color, text swaps mid-animation
- **R10** Animation total duration ≈ 400ms. A new step while an animation
  is running finishes the current one instantly (snap) and starts the next,
  so held-key scrubbing stays responsive and never queues.
- **R11** Scroll anchoring: after a step, if the viewport contains no changed
  lines, scroll so the first changed hunk is visible (top third). Otherwise
  keep the line under the top of the viewport stable.
- **R12** Lines touched between `merge-base` and the playhead get a subtle
  gutter marker, so the cumulative change stays visible after animations
  fade.
- **R13** `esc` returns from player to file list; leaving the section
  drops cached content.

Blame

- **R18** `b` toggles a blame gutter: each line shows the short SHA of the
  stop (≤ playhead) that last touched it; `base` for lines unchanged since
  merge-base. Lines last touched by the playhead commit are highlighted.
- **R19** Blame is derived from the cached snapshots + line diffs of stops
  `0..playhead` (no `git blame`), so it stays consistent with the animation
  and updates as the playhead moves. Blame state persists across steps and
  file switches.

Data

- **R14** All history comes from local git via `Bun.$` (no GitHub API).
  If `origin/<baseRef>` is missing locally, show an error with the
  `git fetch origin <baseRef>` hint instead of the view.
- **R15** File snapshots are fetched lazily per stop
  (`git show <sha>:<path>`) and cached per (sha, path). Neighbours of the
  playhead (±1) are prefetched so stepping does not wait on git.
- **R16** Changeset + timelines refresh on the existing poll/refresh (`r`)
  when HEAD changes; playhead is preserved by SHA when it still exists,
  else clamped to HEAD.
- **R17** Files over 5k lines or detected as binary show a placeholder,
  not the player.

## How (design sketch)

- `src/git/history.ts` — pure-ish data module over `Bun.$`:
  `getMergeBase(baseRef)`, `listChangeset(mergeBase)`,
  `getTimeline(mergeBase, path)` (`git log --reverse --format=... <mb>..HEAD -- <path>`),
  `readAt(sha, path)`. No `--first-parent`, so merge commits appear (R6). Unit-tested against a temp repo built in the test.
- `src/tivo/line-diff.ts` — line diff (Myers) between two snapshots →
  ops `{ kind: "add" | "remove" | "modify" | "same", … }`. Pure, unit-tested.
- `src/tivo/animation.ts` — given ops, produces per-frame row styles from a
  `t ∈ [0,1]`; driven by a single timer (~30fps) owned by the view, so
  `snap()` = jump to `t=1`. Pure frame function, unit-tested.
- `src/tivo/blame.ts` — folds line-diff ops over stops `0..playhead` into
  per-line origin stop index. Pure, unit-tested; memoized per (path, stop).
- `src/context/tivo.tsx` — store: selected file, timeline, playhead,
  snapshot cache, blame toggle. Exposes `step(±1)`, `seek(i)`,
  `toggleBlame()`.
- `src/components/sections/tivo-section.tsx` — file list + player
  (timeline bar, header, content rows). Uses `usePane("content")` scope.
- `SectionKey.TiVo = "tivo"`; keys added under a new `tivo` scope in
  `src/keymap.ts`, with `relevant` gating on file-list vs player.

## Out of scope (v1)

- Following renames across commits (`--follow`). Stop at the rename commit.
- Uncommitted working-tree changes as a final stop.
- Side-by-side or split diff views; syntax highlighting.
- Autoplay.
- Timelines spanning multiple files, or commits outside `merge-base..HEAD`.
- Showing PR review comments anchored on the timeline.

## Decisions

- D1 Merge commits from base are shown as stops, not hidden (R6).
- D2 Per-line blame at playhead is in v1 (R18, R19).
- D3 No autoplay in v1.

## Open questions

- none

## Plan

- [ ] `git/history.ts` + tests (R3, R14, R15, R17)
- [ ] `tivo/line-diff.ts` + tests (R9)
- [ ] `tivo/animation.ts` + tests (R9, R10)
- [ ] `tivo/blame.ts` + tests (R19)
- [ ] `context/tivo.tsx` store (R5, R7, R13, R16, R18)
- [ ] section tree row + `SectionKey.TiVo` (R1)
- [ ] file list view (R2)
- [ ] player: timeline bar + header (R4, R6), content + scroll (R8, R11, R12)
- [ ] blame gutter (R18)
- [ ] keymap + help entries (R5, R13, R18)
- [ ] tmux-driven manual check on a real multi-commit PR
