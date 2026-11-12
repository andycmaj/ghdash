// Blame from the TiVo's own snapshots: for each line of the playhead's
// snapshot, the index of the stop that last touched it (0 = unchanged since
// merge-base). Built by folding the same line diffs the animation uses, so the
// gutter always agrees with what the player showed.

import { diffLines, type DiffOp } from "./line-diff";

// Carry origins from the old snapshot's lines across one step to the new one.
export function foldBlame(
  prev: number[],
  ops: DiffOp[],
  stop: number,
): number[] {
  const next: number[] = [];
  for (const op of ops) {
    if (op.kind === "same") next[op.b] = prev[op.a] ?? 0;
    else if (op.kind === "add" || op.kind === "modify") next[op.b] = stop;
  }
  return next;
}

export type Snapshot = string[] | null;

// Origins for every stop 0..upTo; `memo` holds already-folded stops so
// scrubbing forward only folds the new ones.
export function blameThrough(
  snapshots: Snapshot[],
  upTo: number,
  memo: number[][] = [],
  diff: (a: string[], b: string[]) => DiffOp[] = diffLines,
): number[][] {
  if (memo.length === 0) memo.push((snapshots[0] ?? []).map(() => 0));
  for (let i = memo.length; i <= upTo; i++) {
    const ops = diff(snapshots[i - 1] ?? [], snapshots[i] ?? []);
    memo.push(foldBlame(memo[i - 1], ops, i));
  }
  return memo;
}
