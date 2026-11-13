import { describe, expect, test } from "bun:test";
import {
  anchorTop,
  COLLAPSE_AT,
  frameRows,
  progress,
  rowIndexForPos,
  settledRows,
  SWAP_AT,
} from "./animation";
import { blameThrough, foldBlame } from "./blame";
import { diffLines } from "./line-diff";

const A = ["one", "two", "three", "four"];
const B = ["one", "TWO", "four", "five"];
const ops = diffLines(A, B);

describe("frameRows", () => {
  test("t=0 shows old text with removed rows flashing", () => {
    const rows = frameRows(ops, 0);
    expect(rows.map((r) => r.text)).toEqual([
      "one",
      "two",
      "three",
      "four",
      "five",
    ]);
    expect(rows.map((r) => r.tone)).toEqual([
      null,
      "modify",
      "remove",
      null,
      "add",
    ]);
    expect(rows[2].line).toBeNull();
  });

  test("modified text swaps mid-animation", () => {
    expect(frameRows(ops, SWAP_AT - 0.01)[1].text).toBe("two");
    expect(frameRows(ops, SWAP_AT)[1].text).toBe("TWO");
  });

  test("removed rows collapse out", () => {
    expect(frameRows(ops, COLLAPSE_AT - 0.01)).toHaveLength(5);
    expect(frameRows(ops, COLLAPSE_AT)).toHaveLength(4);
  });

  test("tints fade toward the settled state", () => {
    const added = (t: number) =>
      frameRows(ops, t).find((r) => r.line === 3)?.strength ?? -1;
    const early = added(0.2);
    const late = added(0.8);
    expect(early).toBeGreaterThan(late);
    expect(late).toBeGreaterThan(0);
  });

  test("t=1 equals the settled new snapshot", () => {
    expect(frameRows(ops, 1)).toEqual(settledRows(B));
  });

  test("removed rows sit at the position of the next new line", () => {
    const rows = frameRows(ops, 0);
    expect(rows.map((r) => r.pos)).toEqual([0, 1, 2, 2, 3]);
    expect(rowIndexForPos(rows, 2)).toBe(2);
    expect(rowIndexForPos(rows, 3)).toBe(4);
  });
});

describe("progress", () => {
  test("clamps elapsed time to [0,1]", () => {
    expect(progress(-5, 400)).toBe(0);
    expect(progress(200, 400)).toBe(0.5);
    expect(progress(900, 400)).toBe(1);
  });
});

describe("anchorTop", () => {
  const lines = (n: number, prefix = "l") =>
    Array.from({ length: n }, (_, i) => `${prefix}${i}`);

  test("keeps the top line stable when changes are on screen", () => {
    const a = lines(100);
    const b = [...a.slice(0, 50), "x", "y", ...a.slice(50)];
    const top = anchorTop({
      ops: diffLines(a, b),
      top: 45,
      height: 20,
      newLength: b.length,
    });
    expect(top).toBe(45);
  });

  test("keeps the same line on top when lines are inserted above it", () => {
    const a = lines(100);
    const b = [...a.slice(0, 50), "x", "y", ...a.slice(50)];
    // Change at old line 50 is inside [48, 68).
    const top = anchorTop({
      ops: diffLines(a, b),
      top: 48,
      height: 20,
      newLength: b.length,
    });
    expect(b[top]).toBe("l48");
  });

  test("jumps to the first hunk in the top third when it is off screen", () => {
    const a = lines(200);
    const b = [...a];
    b[150] = "changed";
    const top = anchorTop({
      ops: diffLines(a, b),
      top: 0,
      height: 30,
      newLength: b.length,
    });
    expect(top).toBe(150 - 10);
  });

  test("clamps to the end of the new snapshot", () => {
    const a = lines(100);
    const b = a.slice(0, 10);
    const top = anchorTop({
      ops: diffLines(a, b),
      top: 80,
      height: 20,
      newLength: b.length,
    });
    expect(top).toBe(0);
  });
});

describe("blame", () => {
  test("foldBlame keeps origins of unchanged lines", () => {
    expect(foldBlame([0, 0, 0, 0], ops, 3)).toEqual([0, 3, 0, 3]);
  });

  test("blameThrough folds every stop and reuses its memo", () => {
    const snaps = [["a", "b"], ["a", "B"], ["a", "B", "c"], null];
    const memo = blameThrough(snaps, 2);
    expect(memo).toEqual([
      [0, 0],
      [0, 1],
      [0, 1, 2],
    ]);
    let calls = 0;
    const counting = (a: string[], b: string[]) => {
      calls++;
      return diffLines(a, b);
    };
    blameThrough(snaps, 3, memo, counting);
    expect(calls).toBe(1);
    expect(memo[3]).toEqual([]);
  });

  test("files added on the branch start empty at merge-base", () => {
    const memo = blameThrough([null, ["x"], ["x", "y"]], 2);
    expect(memo[2]).toEqual([1, 2]);
  });
});
