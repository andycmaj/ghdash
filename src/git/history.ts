// Local git history for the TiVo view: the PR's changeset against its
// merge-base, and per-file timelines of the commits that touched each file.
// Everything comes from the local checkout; nothing here talks to GitHub.

import { $ } from "bun";

export const MAX_TIVO_LINES = 5000;

export class MissingBaseError extends Error {
  readonly hint: string;
  constructor(baseRef: string) {
    super(`origin/${baseRef} is not available locally`);
    this.hint = `git fetch origin ${baseRef}`;
  }
}

export interface ChangedFile {
  path: string;
  added: number;
  removed: number;
  binary: boolean;
  commits: number;
}

export interface TimelineStop {
  // Empty for the merge-base stop's subject; the view shows the base ref there.
  sha: string;
  shortSha: string;
  subject: string;
  author: string;
  date: string;
  isMerge: boolean;
}

export interface Changeset {
  mergeBase: string;
  head: string;
  files: ChangedFile[];
}

const SEP = "\x1f";

function git(cwd: string, args: string[]) {
  return $`git ${args}`.cwd(cwd).nothrow().quiet();
}

async function revParse(cwd: string, rev: string): Promise<string | null> {
  const r = await git(cwd, [
    "rev-parse",
    "--verify",
    "--quiet",
    `${rev}^{commit}`,
  ]);
  if (r.exitCode !== 0) return null;
  return r.stdout.toString().trim() || null;
}

// Paths in a changeset are relative to the repo root, so every git call runs
// from there regardless of where ghdash was started.
export async function getTopLevel(cwd: string): Promise<string | null> {
  const r = await git(cwd, ["rev-parse", "--show-toplevel"]);
  if (r.exitCode !== 0) return null;
  return r.stdout.toString().trim() || null;
}

export async function getBranch(cwd: string): Promise<string | null> {
  const r = await git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (r.exitCode !== 0) return null;
  const branch = r.stdout.toString().trim();
  return branch && branch !== "HEAD" ? branch : null;
}

export async function getHead(cwd: string): Promise<string | null> {
  return revParse(cwd, "HEAD");
}

export async function getBaseTip(
  cwd: string,
  baseRef: string,
): Promise<string | null> {
  return revParse(cwd, `refs/remotes/origin/${baseRef}`);
}

export async function getMergeBase(
  cwd: string,
  baseRef: string,
): Promise<string> {
  const tip = await getBaseTip(cwd, baseRef);
  if (!tip) throw new MissingBaseError(baseRef);
  const r = await git(cwd, ["merge-base", tip, "HEAD"]);
  const sha = r.stdout.toString().trim();
  if (r.exitCode !== 0 || !sha) {
    throw new Error(`No merge-base between origin/${baseRef} and HEAD`);
  }
  return sha;
}

// numstat -z records: "added\tremoved\tpath\0"; binary files report "-\t-".
export function parseNumstat(out: string): Omit<ChangedFile, "commits">[] {
  const files: Omit<ChangedFile, "commits">[] = [];
  for (const record of out.split("\0")) {
    if (!record) continue;
    const [added, removed, ...rest] = record.split("\t");
    const path = rest.join("\t");
    if (!path) continue;
    const binary = added === "-" && removed === "-";
    files.push({
      path,
      added: binary ? 0 : Number(added),
      removed: binary ? 0 : Number(removed),
      binary,
    });
  }
  return files;
}

// `git log --format=<SEP><sha> --name-only -z` output → commits per path.
export function countCommitsPerPath(out: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const token of out.split("\0")) {
    for (const line of token.split("\n")) {
      const path = line.trim();
      if (!path || path.startsWith(SEP)) continue;
      counts.set(path, (counts.get(path) ?? 0) + 1);
    }
  }
  return counts;
}

export async function listChangeset(
  cwd: string,
  mergeBase: string,
): Promise<ChangedFile[]> {
  const [diff, log] = await Promise.all([
    git(cwd, ["diff", "--numstat", "-z", "--no-renames", mergeBase, "HEAD"]),
    // --cc lists a merge's files only where it differs from every parent, which
    // matches the history simplification `git log -- <path>` uses for timelines.
    git(cwd, [
      "log",
      `--format=${SEP}%H`,
      "--name-only",
      "-z",
      "--no-renames",
      "--cc",
      `${mergeBase}..HEAD`,
    ]),
  ]);
  if (diff.exitCode !== 0) {
    throw new Error(`git diff failed: ${diff.stderr.toString().trim()}`);
  }
  const counts = countCommitsPerPath(log.stdout.toString());
  return parseNumstat(diff.stdout.toString()).map((f) => ({
    ...f,
    commits: counts.get(f.path) ?? 0,
  }));
}

export function parseTimeline(out: string): TimelineStop[] {
  const stops: TimelineStop[] = [];
  for (const line of out.split("\n")) {
    if (!line) continue;
    const [sha, parents, author, date, ...subject] = line.split(SEP);
    stops.push({
      sha,
      shortSha: sha.slice(0, 7),
      subject: subject.join(SEP),
      author,
      date,
      isMerge: parents.trim().split(" ").length > 1,
    });
  }
  return stops;
}

// Stops for one file: merge-base first, then each commit in merge-base..HEAD
// that touched the file, oldest first. No --first-parent, so merges that
// changed the file show up as stops of their own.
export async function getTimeline(
  cwd: string,
  mergeBase: string,
  baseRef: string,
  path: string,
): Promise<TimelineStop[]> {
  const format = ["%H", "%P", "%an", "%aI", "%s"].join(SEP);
  const r = await git(cwd, [
    "log",
    "--topo-order",
    "--reverse",
    "--no-renames",
    `--format=${format}`,
    `${mergeBase}..HEAD`,
    "--",
    path,
  ]);
  if (r.exitCode !== 0) {
    throw new Error(`git log failed: ${r.stderr.toString().trim()}`);
  }
  const base: TimelineStop = {
    sha: mergeBase,
    shortSha: mergeBase.slice(0, 7),
    subject: baseRef,
    author: "",
    date: "",
    isMerge: false,
  };
  return [base, ...parseTimeline(r.stdout.toString())];
}

// File content at a commit, split into lines; null when the file does not
// exist there (added later on the branch, or deleted by that commit).
export async function readAt(
  cwd: string,
  sha: string,
  path: string,
): Promise<string[] | null> {
  const r = await git(cwd, ["show", `${sha}:${path}`]);
  if (r.exitCode !== 0) return null;
  return splitLines(r.stdout.toString());
}

export function splitLines(text: string): string[] {
  if (text === "") return [];
  const lines = text.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

export function looksBinary(lines: string[]): boolean {
  for (const line of lines) if (line.includes("\0")) return true;
  return false;
}
