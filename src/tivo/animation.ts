// Frames for the TiVo step animation. Given the A→B line diff and a progress
// t ∈ [0,1], frameRows says which rows exist and how strongly each one is
// tinted. t = 1 is the settled state (B, untinted), so snapping an animation
// is just rendering t = 1.

import type { DiffOp } from "./line-diff";

export const ANIMATION_MS = 400;
export const FRAME_MS = 33;

// Removed rows hold their flash, then collapse out at this point.
export const COLLAPSE_AT = 0.6;
// Modified rows swap from old to new text at this point.
export const SWAP_AT = 0.5;

export type Tone = "add" | "remove" | "modify";

export interface FrameRow {
  key: string;
  text: string;
  // Index of this row's line in the new snapshot; null for a removed line.
  line: number | null;
  // The new-snapshot index this row sits at (a removed row sits before it),
  // used to keep the viewport anchored while removed rows come and go.
  pos: number;
  tone: Tone | null;
  strength: number;
}

const easeOut = (t: number) => 1 - (1 - t) * (1 - t);

export function progress(elapsedMs: number, durationMs = ANIMATION_MS): number {
  if (durationMs <= 0) return 1;
  return Math.max(0, Math.min(1, elapsedMs / durationMs));
}

export function frameRows(ops: DiffOp[], t: number): FrameRow[] {
  const fade = t >= 1 ? 0 : 1 - easeOut(t);
  const rows: FrameRow[] = [];
  let pos = 0;
  for (const op of ops) {
    switch (op.kind) {
      case "same":
        rows.push({
          key: `b${op.b}`,
          text: op.text,
          line: op.b,
          pos: pos++,
          tone: null,
          strength: 0,
        });
        break;
      case "add":
        rows.push({
          key: `b${op.b}`,
          text: op.text,
          line: op.b,
          pos: pos++,
          tone: fade > 0 ? "add" : null,
          strength: fade,
        });
        break;
      case "remove":
        if (t < COLLAPSE_AT) {
          rows.push({
            key: `a${op.a}`,
            text: op.text,
            line: null,
            pos,
            tone: "remove",
            strength: 1,
          });
        }
        break;
      case "modify": {
        // Hold full strength until the text swaps, then fade.
        const strength =
          t < SWAP_AT
            ? 1
            : t >= 1
              ? 0
              : 1 - easeOut((t - SWAP_AT) / (1 - SWAP_AT));
        rows.push({
          key: `b${op.b}`,
          text: t < SWAP_AT ? op.from : op.to,
          line: op.b,
          pos: pos++,
          tone: strength > 0 ? "modify" : null,
          strength,
        });
        break;
      }
    }
  }
  return rows;
}

export function settledRows(lines: string[]): FrameRow[] {
  return lines.map((text, i) => ({
    key: `b${i}`,
    text,
    line: i,
    pos: i,
    tone: null,
    strength: 0,
  }));
}

// First row of the viewport whose new-snapshot position is at or after `top`.
export function rowIndexForPos(rows: FrameRow[], top: number): number {
  let lo = 0;
  let hi = rows.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (rows[mid].pos < top) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export interface AnchorInput {
  ops: DiffOp[];
  // Top of the viewport in old-snapshot line numbers, and its height in rows.
  top: number;
  height: number;
  newLength: number;
}

// Where the viewport top should sit in the new snapshot after a step (R11):
// keep the old top line in place when changes are on screen, otherwise jump
// so the first changed hunk lands in the top third.
export function anchorTop(input: AnchorInput): number {
  const { ops, top, height, newLength } = input;
  const bottom = top + height;
  let visibleChange = false;
  let firstChange: number | null = null;
  let mappedTop: number | null = null;
  let aNext = 0;
  let bNext = 0;
  for (const op of ops) {
    // An add sits between old lines and a remove between new ones; place each
    // at the next line on the side it lacks.
    const aPos = op.kind === "add" ? aNext : op.a;
    const bPos = op.kind === "remove" ? bNext : op.b;
    if (op.kind !== "same") {
      firstChange ??= bPos;
      if (aPos >= top && aPos < bottom) visibleChange = true;
    }
    if (mappedTop === null && op.kind !== "add" && op.a >= top)
      mappedTop = bPos;
    if (op.kind !== "add") aNext = op.a + 1;
    if (op.kind !== "remove") bNext = op.b + 1;
  }
  const maxTop = Math.max(0, newLength - height);
  if (firstChange === null || visibleChange) {
    return clamp(mappedTop ?? bNext, 0, maxTop);
  }
  return clamp(firstChange - Math.floor(height / 3), 0, maxTop);
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
