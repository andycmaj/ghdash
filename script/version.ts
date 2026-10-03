#!/usr/bin/env bun

// Main-channel release: bump package.json, commit, tag, push, move latest, and create a
// draft GitHub release with auto-generated notes. Downstream CI jobs attach
// cross-platform binaries and un-draft the release. Installs are served via
// mise straight from the GitHub release assets — no npm, no private registry.
//
// Inputs (env, set from workflow_dispatch):
//   GHDASH_TUI_BUMP     - "major" | "minor" | "patch" (default "patch")
//   GHDASH_TUI_VERSION  - explicit version override (wins over bump)
//
// Tags are plain vX.Y.Z: ghdash is the only thing released from this repo,
// and unprefixed tags keep `mise use github:<repo>@1.2.3` pinning natural.
import path from "path";
import { $ } from "bun";
import { appendFile } from "fs/promises";
import { fileURLToPath } from "url";

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(dir);

type Bump = "major" | "minor" | "patch";

function bumpVersion(current: string, bump: Bump): string {
  const [major, minor, patch] = current
    .replace(/^v/, "")
    .split("-")[0]
    .split(".")
    .map((n) => Number.parseInt(n, 10));

  if ([major, minor, patch].some((n) => Number.isNaN(n))) {
    throw new Error(`Cannot parse semver from "${current}"`);
  }

  switch (bump) {
    case "major":
      return `${major + 1}.0.0`;
    case "minor":
      return `${major}.${minor + 1}.0`;
    case "patch":
      return `${major}.${minor}.${patch + 1}`;
  }
}

const pkgPath = path.join(dir, "package.json");
const pkg = await Bun.file(pkgPath).json();

const override = process.env.GHDASH_TUI_VERSION?.trim();
const bump = (process.env.GHDASH_TUI_BUMP?.trim() || "patch") as Bump;

const version = override
  ? override.replace(/^v/, "")
  : bumpVersion(pkg.version, bump);
const tag = `v${version}`;
const latestTag = "latest";

console.log(`Bumping ${pkg.version} -> ${version} (tag ${tag})`);

pkg.version = version;
await Bun.write(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

await $`git add package.json`;
await $`git commit -m ${`chore: release ${tag}`}`;
await $`git tag ${tag}`;
await $`git push origin HEAD --tags`;

const sha = (await $`git rev-parse HEAD`.text()).trim();

await $`git tag -f ${latestTag} ${sha}`;
await $`git push origin refs/tags/${latestTag} --force`;

await $`gh release create ${tag} -d --target ${sha} --title ${tag} --generate-notes`;

const release =
  await $`gh release view ${tag} --json tagName,databaseId`.json();

const output = [
  `version=${version}`,
  `tag=${tag}`,
  `latest_tag=${latestTag}`,
  `release=${release.databaseId}`,
];
console.log(output.join("\n"));

if (process.env.GITHUB_OUTPUT) {
  await appendFile(process.env.GITHUB_OUTPUT, output.join("\n") + "\n");
}
