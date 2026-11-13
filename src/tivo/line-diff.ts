// Line diff between two file snapshots (Myers, O(ND)), folded into ops the
// TiVo player animates. A hunk's removes and adds are paired in order into
// "modify" ops; any surplus stays a plain remove or add.

export type DiffOp =
  | { kind: "same"; a: number; b: number; text: string }
  | { kind: "remove"; a: number; text: string }
  | { kind: "add"; b: number; text: string }
  | { kind: "modify"; a: number; b: number; from: string; to: string };

type Edit = { kind: "same" | "remove" | "add"; a: number; b: number };

// Shortest edit script; a/b are indexes into the old/new arrays.
function myers(a: string[], b: string[]): Edit[] {
  const n = a.length;
  const m = b.length;
  const max = n + m;
  const offset = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];

  outer: for (let d = 0; d <= max; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x =
        k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])
          ? v[offset + k + 1]
          : v[offset + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) break outer;
    }
  }

  const edits: Edit[] = [];
  let x = n;
  let y = m;
  for (let d = trace.length - 1; d >= 0; d--) {
    const vd = trace[d];
    const k = x - y;
    const prevK =
      k === -d || (k !== d && vd[offset + k - 1] < vd[offset + k + 1])
        ? k + 1
        : k - 1;
    const prevX = vd[offset + prevK];
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      x--;
      y--;
      edits.push({ kind: "same", a: x, b: y });
    }
    if (d > 0) {
      if (x === prevX) {
        y--;
        edits.push({ kind: "add", a: x, b: y });
      } else {
        x--;
        edits.push({ kind: "remove", a: x, b: y });
      }
    }
  }
  return edits.reverse();
}

export function diffLines(a: string[], b: string[]): DiffOp[] {
  // Trimming the common prefix/suffix keeps Myers' trace small for the usual
  // case of a small edit in a large file.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }

  const ops: DiffOp[] = [];
  for (let i = 0; i < start; i++)
    ops.push({ kind: "same", a: i, b: i, text: a[i] });

  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  const edits = myers(midA, midB);
  let removes: number[] = [];
  let adds: number[] = [];
  const flush = () => {
    const pairs = Math.min(removes.length, adds.length);
    for (let i = 0; i < pairs; i++) {
      ops.push({
        kind: "modify",
        a: removes[i] + start,
        b: adds[i] + start,
        from: midA[removes[i]],
        to: midB[adds[i]],
      });
    }
    for (const r of removes.slice(pairs))
      ops.push({ kind: "remove", a: r + start, text: midA[r] });
    for (const ad of adds.slice(pairs))
      ops.push({ kind: "add", b: ad + start, text: midB[ad] });
    removes = [];
    adds = [];
  };
  for (const e of edits) {
    if (e.kind === "remove") removes.push(e.a);
    else if (e.kind === "add") adds.push(e.b);
    else {
      flush();
      ops.push({
        kind: "same",
        a: e.a + start,
        b: e.b + start,
        text: midA[e.a],
      });
    }
  }
  flush();

  for (let i = 0; i < a.length - endA; i++) {
    ops.push({ kind: "same", a: endA + i, b: endB + i, text: a[endA + i] });
  }
  return ops;
}

// Indexes of lines in `b` that are new or changed relative to `a`.
export function changedLines(ops: DiffOp[]): Set<number> {
  const out = new Set<number>();
  for (const op of ops) {
    if (op.kind === "add" || op.kind === "modify") out.add(op.b);
  }
  return out;
}

export function isChange(op: DiffOp): boolean {
  return op.kind !== "same";
}

// New-snapshot line where each hunk (run of non-same ops) starts; a pure
// removal starts at the line that now follows it.
export function hunkStarts(ops: DiffOp[]): number[] {
  const starts: number[] = [];
  let inHunk = false;
  let bNext = 0;
  for (const op of ops) {
    if (op.kind === "same") inHunk = false;
    else if (!inHunk) {
      inHunk = true;
      starts.push(op.kind === "remove" ? bNext : op.b);
    }
    if (op.kind !== "remove") bNext = op.b + 1;
  }
  return starts;
}

// The hunk to jump to from `from`, or null when there are none that way.
export function adjacentHunk(
  starts: number[],
  from: number,
  direction: 1 | -1,
): number | null {
  if (direction > 0) return starts.find((s) => s > from) ?? null;
  for (let i = starts.length - 1; i >= 0; i--) {
    if (starts[i] < from) return starts[i];
  }
  return null;
}
