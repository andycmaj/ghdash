import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";
import {
  getMergeBase,
  getTimeline,
  listChangeset,
  MissingBaseError,
  readAt,
  splitLines,
} from "./history";

let dir = "";

async function write(path: string, text: string) {
  await Bun.write(join(dir, path), text);
}

async function commit(message: string): Promise<string> {
  await $`git add -A`.cwd(dir).quiet();
  await $`git commit -q -m ${message}`.cwd(dir).quiet();
  return (await $`git rev-parse HEAD`.cwd(dir).text()).trim();
}

const shas: Record<string, string> = {};

// main:   base ── m1 (keep.txt bottom)
// branch: base ── c1 (a.txt, new.txt, keep.txt top) ── c2 (a.txt, bin)
//                ── merge m1 ── c3 (delete new.txt)
// origin/main points at m1, so the merge-base is m1.
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "ghdash-history-"));
  const git = $.cwd(dir);
  await git`git init -q -b main`.quiet();
  await git`git config user.email t@example.com`.quiet();
  await git`git config user.name Tester`.quiet();
  await git`git config commit.gpgsign false`.quiet();

  await write("a.txt", "one\ntwo\nthree\n");
  await write("keep.txt", "k1\nk2\nk3\nk4\nk5\nk6\n");
  shas.base = await commit("base");

  await git`git checkout -q -b feature`.quiet();
  await write("a.txt", "one\nTWO\nthree\n");
  await write("new.txt", "fresh\n");
  await write("keep.txt", "K1\nk2\nk3\nk4\nk5\nk6\n");
  shas.c1 = await commit("c1: edit a, add new");
  await write("a.txt", "one\nTWO\nthree\nfour\n");
  await write("bin.dat", "\0\x01\x02");
  shas.c2 = await commit("c2: extend a");

  await git`git checkout -q main`.quiet();
  await write("keep.txt", "k1\nk2\nk3\nk4\nk5\nK6\n");
  shas.m1 = await commit("m1: main edits keep");
  await git`git update-ref refs/remotes/origin/main ${shas.m1}`.quiet();

  await git`git checkout -q feature`.quiet();
  await git`git merge -q --no-edit main`.quiet();
  shas.merge = (await git`git rev-parse HEAD`.text()).trim();
  await git`git rm -q new.txt`.quiet();
  shas.c3 = await commit("c3: drop new");
});

afterAll(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe("getMergeBase", () => {
  test("resolves against origin/<baseRef>", async () => {
    expect(await getMergeBase(dir, "main")).toBe(shas.m1);
  });

  test("throws a fetch hint when origin/<baseRef> is missing", async () => {
    const err = await getMergeBase(dir, "release").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MissingBaseError);
    expect((err as MissingBaseError).hint).toBe("git fetch origin release");
  });
});

describe("listChangeset", () => {
  test("lists changed files with counts and commit totals", async () => {
    const files = await listChangeset(dir, shas.m1);
    const byPath = Object.fromEntries(files.map((f) => [f.path, f]));
    expect(Object.keys(byPath).sort()).toEqual([
      "a.txt",
      "bin.dat",
      "keep.txt",
    ]);
    expect(byPath["a.txt"]).toMatchObject({ added: 2, removed: 1, commits: 2 });
    expect(byPath["bin.dat"].binary).toBe(true);
    // c1 plus the merge, which differs from both parents for keep.txt.
    expect(byPath["keep.txt"].commits).toBe(2);
  });
});

describe("getTimeline", () => {
  test("starts at merge-base and lists touching commits oldest first", async () => {
    const stops = await getTimeline(dir, shas.m1, "main", "a.txt");
    expect(stops.map((s) => s.sha)).toEqual([shas.m1, shas.c1, shas.c2]);
    expect(stops[0].subject).toBe("main");
    expect(stops[1]).toMatchObject({
      subject: "c1: edit a, add new",
      author: "Tester",
      isMerge: false,
    });
  });

  test("includes merge commits that touched the file", async () => {
    const stops = await getTimeline(dir, shas.m1, "main", "keep.txt");
    expect(stops.map((s) => s.sha)).toEqual([shas.m1, shas.c1, shas.merge]);
    expect(stops[2].isMerge).toBe(true);
  });

  test("a file added and deleted on the branch ends on its delete", async () => {
    const stops = await getTimeline(dir, shas.m1, "main", "new.txt");
    expect(stops.map((s) => s.sha)).toEqual([shas.m1, shas.c1, shas.c3]);
  });
});

describe("readAt", () => {
  test("reads lines at a commit", async () => {
    expect(await readAt(dir, shas.c2, "a.txt")).toEqual([
      "one",
      "TWO",
      "three",
      "four",
    ]);
  });

  test("returns null where the file does not exist", async () => {
    expect(await readAt(dir, shas.m1, "new.txt")).toBeNull();
    expect(await readAt(dir, shas.c3, "new.txt")).toBeNull();
  });
});

describe("splitLines", () => {
  test("drops only the trailing newline", () => {
    expect(splitLines("")).toEqual([]);
    expect(splitLines("a\n\nb\n")).toEqual(["a", "", "b"]);
    expect(splitLines("a")).toEqual(["a"]);
  });
});
