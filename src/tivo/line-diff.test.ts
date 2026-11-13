import { describe, expect, test } from "bun:test";
import {
  adjacentHunk,
  changedLines,
  diffLines,
  hunkStarts,
  type DiffOp,
} from "./line-diff";

// Apply ops to recover both sides; any valid diff must round-trip.
function sides(ops: DiffOp[]): { a: string[]; b: string[] } {
  const a: string[] = [];
  const b: string[] = [];
  for (const op of ops) {
    if (op.kind === "same") {
      a.push(op.text);
      b.push(op.text);
    } else if (op.kind === "remove") a.push(op.text);
    else if (op.kind === "add") b.push(op.text);
    else {
      a.push(op.from);
      b.push(op.to);
    }
  }
  return { a, b };
}

const kinds = (ops: DiffOp[]) => ops.map((o) => o.kind);

describe("diffLines", () => {
  test("identical inputs are all same", () => {
    expect(kinds(diffLines(["a", "b"], ["a", "b"]))).toEqual(["same", "same"]);
  });

  test("empty to content is all adds, and back", () => {
    expect(kinds(diffLines([], ["a", "b"]))).toEqual(["add", "add"]);
    expect(kinds(diffLines(["a", "b"], []))).toEqual(["remove", "remove"]);
  });

  test("pairs a replaced line into a modify", () => {
    const ops = diffLines(["a", "b", "c"], ["a", "B", "c"]);
    expect(ops[1]).toEqual({ kind: "modify", a: 1, b: 1, from: "b", to: "B" });
    expect(kinds(ops)).toEqual(["same", "modify", "same"]);
  });

  test("surplus removes and adds stay unpaired", () => {
    expect(kinds(diffLines(["a", "x", "y", "c"], ["a", "X", "c"]))).toEqual([
      "same",
      "modify",
      "remove",
      "same",
    ]);
    expect(kinds(diffLines(["a", "c"], ["a", "X", "Y", "c"]))).toEqual([
      "same",
      "add",
      "add",
      "same",
    ]);
  });

  test("insertions in the middle keep surrounding lines same", () => {
    const a = ["1", "2", "3", "4", "5"];
    const b = ["1", "2", "new", "3", "4", "5"];
    const ops = diffLines(a, b);
    expect(ops.filter((o) => o.kind !== "same")).toEqual([
      { kind: "add", b: 2, text: "new" },
    ]);
  });

  test("round-trips arbitrary edits", () => {
    const a = "the quick brown fox jumps over the lazy dog".split(" ");
    const b = "a quick red fox leaps over lazy dogs and cats".split(" ");
    const ops = diffLines(a, b);
    expect(sides(ops)).toEqual({ a, b });
  });

  test("round-trips random inputs", () => {
    let seed = 7;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed;
    };
    for (let i = 0; i < 50; i++) {
      const a = Array.from({ length: rand() % 20 }, () => `${rand() % 5}`);
      const b = Array.from({ length: rand() % 20 }, () => `${rand() % 5}`);
      expect(sides(diffLines(a, b))).toEqual({ a, b });
    }
  });
});

describe("changedLines", () => {
  test("collects new-side indexes of adds and modifies", () => {
    const ops = diffLines(["a", "b", "c"], ["a", "B", "c", "d"]);
    expect([...changedLines(ops)].sort((x, y) => x - y)).toEqual([1, 3]);
  });
});

describe("hunkStarts", () => {
  test("one start per run of changes, at its new-side line", () => {
    const a = ["1", "2", "3", "4", "5", "6", "7"];
    const b = ["1", "TWO", "3", "4", "6", "7", "8"];
    // modify at 1, removal of "5" (now before line 4), add at 6.
    expect(hunkStarts(diffLines(a, b))).toEqual([1, 4, 6]);
  });

  test("adjacent changes form a single hunk", () => {
    expect(hunkStarts(diffLines(["a", "b"], ["A", "B", "c"]))).toEqual([0]);
  });

  test("no changes, no hunks", () => {
    expect(hunkStarts(diffLines(["a"], ["a"]))).toEqual([]);
  });
});

describe("adjacentHunk", () => {
  const starts = [3, 10, 20];
  test("finds the next hunk strictly after", () => {
    expect(adjacentHunk(starts, 0, 1)).toBe(3);
    expect(adjacentHunk(starts, 10, 1)).toBe(20);
    expect(adjacentHunk(starts, 20, 1)).toBeNull();
  });
  test("finds the previous hunk strictly before", () => {
    expect(adjacentHunk(starts, 25, -1)).toBe(20);
    expect(adjacentHunk(starts, 10, -1)).toBe(3);
    expect(adjacentHunk(starts, 3, -1)).toBeNull();
  });
});
