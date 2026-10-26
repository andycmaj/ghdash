# Agents

## Coding Guidelines

## Typescript Constraints

- never use `any`. if you find you need to, try other methods, or pause and discuss
- Don't use any browser-specific types or interfaces. node types only
- Avoid type assertions (`as T`, `as unknown as T`, non-null `!`) whenever possible.
  They silence the checker instead of proving the type, and oxlint flags them
  (`no-unsafe-type-assertion`, `no-unnecessary-type-assertion`). Prefer, in order:
  - let inference or control-flow narrowing do it (often the assertion is already unnecessary)
  - tighten the source type (e.g. `os: "linux" | "darwin"` instead of `string`)
  - `oneOf(VALUES, raw)` from `src/utils/guards.ts` to narrow a single string
    (GraphQL enum, env var) to a union
  - validate untrusted data (`JSON.parse`, `Bun.file().json()`, config files) with a
    zod schema and derive the type via `z.infer`, rather than casting the result
  - `as const` is fine; it's not a narrowing cast
  - if an assertion is truly unavoidable, leave a comment saying why

## Typescript Style

- Comments: Minimal comments, NO JSDoc. Only use comments to explain WHY something was done, not to describe what it's doing.
- Naming: camelCase for variables/functions, PascalCase for classes/interfaces, UPPER_CASE for constants
- Types: Strict TypeScript, use interfaces for options/configs, explicit return types for public APIs
- Formatting: oxfmt (`bun run format`); linting: oxlint (`bun run lint`)
- Imports: Use explicit imports, group by: built-ins, external deps, internal modules

## Bun Guidelines

This project uses bun as its runtime, not nodejs or browser.

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bun test` instead of `jest` or `vitest`
- Use `bun install` instead of `npm install` or `yarn install` or `pnpm install`
- Use `bun run <script>` instead of `npm run <script>`
- Bun automatically loads .env, so don't use dotenv.
- Prefer `Bun.file` over `node:fs`'s readFile/writeFile
- Use `Bun.$` instead of execa for shelling out (e.g. to `git` / `gh`).

## Architecture

`@opentui/solid` TUI built on [`@andycmaj/opentui-app`](https://github.com/andycmaj/opentui-app)
(boot, keymap, focus, theme, toast, modal primitives). Framework changes go
there; this repo pins it via npm.

Boot (`src/index.tsx`) → nested Solid Context providers
as DI (`src/app.tsx`) → one `createStore` domain store in `src/context/github.tsx`
mutated via `produce`, fed by an Effection polling loop → declarative
keymap/command/focus layer (`src/keymap.ts` scope table, `src/commands.ts`,
`src/keyboard/`, `src/context/focus.tsx`) on `@opentui/keymap` → `<Show>`-gated
modal overlays. Panes are real OpenTUI focus targets (`usePane`), each owning a
focus-within `useScope` layer; modals take focus into their own high-priority
layer, so keys only ever reach one handler.

- Data layer: `src/github/` (Octokit GraphQL + REST). `client.ts` fetches the
  whole dashboard for the current worktree's open PR; `status-utils.ts` maps
  statuses and computes merge blockers; `repo-context.ts` derives owner/repo/branch.
- Views: left pane `components/section-tree.tsx` (Feed / Actions / Merge queue
  (only while queued) / Mergeability),
  right pane `components/section-view.tsx` (the selected section's content).
  Feed rows (thread grouping, filter, collapse) come from
  `components/sections/feed-model.ts`.
- Embedded terminal: `src/terminal/` + `context/terminal.tsx` +
  `components/terminal-pane.tsx` (ported from kube-tui, ghostty-opentui PTY).
  Replaces the content pane while open; used to view job logs in `$EDITOR`.

## Testing the TUI

This app is a TUI, and as such won't be able to show output on stdout.

- use `bun dev` to start the app (run it from a repo dir whose current branch has an open PR)
- use `tmux capture-pane` to run tui tests.
- use a unique tmux session name to prevent conflicts with user-sessions.
- **NEVER run `tmux kill-server`.** It destroys every tmux session on the machine,
  including the user's own sessions and other agent sessions. Only ever clean up
  your own sessions by name: `tmux kill-session -t <your-unique-name>`.
- in order to see console output, run the app with `SHOW_CONSOLE=true`.
- you can also open the console at any time with the `` ` `` key.
- Reproduce issues in a test case. Use debug logs to see what is happening. DO NOT GUESS.

Auth: needs a GitHub token via `GITHUB_TOKEN`/`GH_TOKEN`, else it falls back to
`gh auth token`. Scopes needed: `repo`, `read:org` (and `workflow` for Actions).
