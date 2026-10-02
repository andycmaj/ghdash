#!/usr/bin/env bun

// Shared install instructions for GitHub releases, using mise.
//
// Single source of truth for both the main-channel release (.github/workflows/ghdash-release.yml)
// and the per-PR beta release (.github/workflows/ghdash-beta.yml). No npm, no private
// registry — mise installs the binary straight from the GitHub release assets.
//
// As a module:  import { installNotes } from "./install-notes";
// As a CLI:      bun run script/install-notes.ts <owner/repo> [tag] [--beta]

export function installNotes(
  repo: string,
  tag?: string,
  isBeta = !!tag,
): string {
  const ref = tag ? `${repo}@${tag}` : repo;
  const lines = [
    isBeta ? "## Install (beta)" : "## Install",
    "",
    "Install and update `ghdash-tui` with [mise](https://mise.jdx.dev):",
    "",
    "```sh",
    `mise use -g github:${ref}`,
    "```",
    "",
    isBeta
      ? `This is a prerelease build (\`${tag}\`). Re-run the command after new pushes to pick up the latest build for this PR.`
      : `Re-run \`mise use -g github:${repo}\` later to upgrade to the newest release.`,
  ];
  return lines.join("\n");
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const stable = args.includes("--stable");
  const beta = args.includes("--beta");
  const [repo, tag] = args.filter((a) => !a.startsWith("--"));
  if (!repo) {
    console.error(
      "usage: install-notes.ts <owner/repo> [tag] [--beta|--stable]",
    );
    process.exit(1);
  }
  const isBeta = beta || (!stable && !!tag);
  console.log(installNotes(repo, tag || undefined, isBeta));
}
