# ghdash-tui

A terminal UI that shows an interactive status dashboard for **the current git
worktree's open PR** on GitHub — the PR feed (comments + reviews + review
threads), Actions/workflow status (with annotations), and merge blockers.

Built with [`@opentui/solid`](https://github.com/anomalyco/opentui). Layout,
styling, and interaction model are adapted from `tilt-tui`.

## Requirements

- [bun](https://bun.sh)
- A GitHub token: `GITHUB_TOKEN`/`GH_TOKEN`, or an authenticated `gh` CLI
  (the app falls back to `gh auth token`). Scopes: `repo`, `read:org`, `workflow`.

## Installing

Releases are GitHub release assets, installed with [mise](https://mise.jdx.dev):

```
mise use -g github:<owner>/<repo>          # latest release
mise use -g github:<owner>/<repo>@pr-123   # beta build for PR #123
```

- **Beta:** every PR touching ghdash-tui (or the shared packages) gets a
  `pr-<number>` prerelease, rebuilt on each push and deleted when the PR closes
  (`.github/workflows/ghdash-beta.yml`).
- **Release:** run the "ghdash-tui Release" workflow from `main` (Actions →
  Run workflow), picking patch/minor/major or an explicit version. It bumps
  `package.json`, tags `vX.Y.Z`, moves `latest`, builds, and publishes
  (`.github/workflows/ghdash-release.yml`, `script/version.ts`).

## Running

```
bun install
cd /path/to/a/repo/with/an/open/pr/on/the/current/branch
bun run --conditions=browser --preload @opentui/solid/preload /path/to/ghdash-tui/src/index.tsx
```

Or, from inside this project during development, `bun dev` (resolves the PR from
the current working directory's git repo + branch).

### Targeting a specific PR

By default the app shows the PR for the current worktree's branch — open,
merged, or closed. Merged/closed PRs are labeled in the header and the
Mergeability view; a PR in the repository merge queue shows its queue state and
position. Pass a PR explicitly as the first argument:

```
ghdash-tui 14354                                       # PR #14354 in the current repo
ghdash-tui octocat/hello-world#14354                   # fully qualified — no git repo needed
ghdash-tui https://github.com/octocat/hello-world/pull/14354
```

A bare number still uses the current worktree's `origin` to resolve owner/repo;
the `owner/repo#number` and URL forms work from anywhere.

### Flags

- `--poll <ms>` — poll interval (default 15000, or `pollIntervalMs` from config).

## Compiling a binary

Compile a standalone binary for the current platform:

```
bun run build:binary:single
# → ./dist/ghdash-tui-<os>-<arch>/bin/ghdash-tui
```

`bun run build:binary` cross-compiles for all supported targets
(linux/darwin × arm64/x64). Set `GHDASH_TUI_BUILD_VERSION` to override the
embedded version without bumping `package.json`.

## Keys

- `Tab` switch pane · `j/k` `g/G` navigate · `Enter` select section
- `o` open PR in browser · `r` refresh · `:` command palette · `?` help
- `Ctrl+E` toggle sidebar · `q` / `Ctrl+C` quit

## Configuration

Loads user settings from `~/.config/ghdash-tui/config.json`:

```json
{
  "theme": "default",
  "pollIntervalMs": 15000,
  "githubToken": "ghp_…"
}
```

Themes: `default`, `terminal`, `mono`, `tokyo-night`.

`l` opens the PR's preview-environment logs (namespace `dev-<number>`) in
Grafana Explore. Set `GHDASH_LOKI_URL` to your Grafana Explore URL (e.g.
`https://grafana.example.com/explore`) to enable it.

## Merging

When the PR is open and all requirements in the **Mergeability** view are met, a
**Merge PR — add to merge queue** command appears in the command palette (`:`).
Selecting it asks for confirmation, then adds the PR to the repository's merge
queue (the equivalent of GitHub's "Merge when ready" button). The repository
must have a merge queue configured on the base branch.

## Limitations (v1)

- Read-only (no inline replies / approve / merge yet).
- Same-repo PRs only — cross-fork PRs (where the head branch lives in a fork)
  are not yet resolved.
