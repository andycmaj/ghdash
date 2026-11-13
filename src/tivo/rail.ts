// Layout for the TiVo timeline rail: a row of commit labels over a track with
// a dot per stop. The track is filled up to the playhead, and the playhead
// marker sits at a fractional position so it can slide between dots while a
// step animates. Pure: returns styled runs the view maps onto theme colours.

export type RailStyle =
  | "trackPast"
  | "trackFuture"
  | "dotPast"
  | "dotFuture"
  | "mergePast"
  | "mergeFuture"
  | "base"
  | "cursor"
  | "label"
  | "labelActive"
  | "labelFuture"
  | "labelMerge"
  | "more"
  | "blank";

export interface RailRun {
  text: string;
  style: RailStyle;
}

export interface RailStopInfo {
  label: string;
  isMerge: boolean;
}

export interface RailLayout {
  labels: RailRun[];
  track: RailRun[];
}

export const GLYPH = {
  trackPast: "━",
  trackFuture: "╌",
  base: "◆",
  dotPast: "●",
  dotFuture: "○",
  mergePast: "◈",
  mergeFuture: "◇",
  cursor: "◉",
  moreLeft: "‹",
  moreRight: "›",
} as const;

// Widest gap worth spreading a few stops across, and the narrowest gap that
// still fits a label over every dot (short SHAs are 7 wide, plus a space).
const MAX_GAP = 16;
const LABELLED_GAP = 9;
const MIN_GAP = 2;

interface Cell {
  ch: string;
  style: RailStyle;
}

function runs(cells: Cell[]): RailRun[] {
  const out: RailRun[] = [];
  for (const c of cells) {
    const last = out[out.length - 1];
    if (last && last.style === c.style) last.text += c.ch;
    else out.push({ text: c.ch, style: c.style });
  }
  return out;
}

function put(row: Cell[], x: number, text: string, style: RailStyle) {
  for (let i = 0; i < text.length; i++) {
    const at = x + i;
    if (at >= 0 && at < row.length) row[at] = { ch: text[i], style };
  }
}

// Whether [x, x+len) is free of non-blank cells (with a one-cell margin).
function free(row: Cell[], x: number, len: number): boolean {
  for (let i = x - 1; i <= x + len; i++) {
    if (i >= 0 && i < row.length && row[i].style !== "blank") return false;
  }
  return x >= 0 && x + len <= row.length;
}

export function layoutRail(
  stops: RailStopInfo[],
  playhead: number,
  // Fractional stop index of the playhead marker (== playhead when settled).
  position: number,
  width: number,
): RailLayout {
  const blankRow = (): Cell[] =>
    Array.from({ length: Math.max(0, width) }, () => ({
      ch: " ",
      style: "blank" as const,
    }));
  const labels = blankRow();
  const track = blankRow();
  const n = stops.length;
  if (n === 0 || width <= 0)
    return { labels: runs(labels), track: runs(track) };

  // Labels are centred on their dots, so leave half a label of margin.
  const margin = 4;
  const usable = Math.max(1, width - margin * 2);

  let start = 0;
  let end = n;
  let gap = n > 1 ? Math.min(MAX_GAP, Math.floor(usable / (n - 1))) : 0;
  if (n > 1 && gap < MIN_GAP) {
    // Too many stops: show a window of them around the playhead.
    gap = MIN_GAP;
    const fit = Math.floor(usable / gap) + 1;
    start = Math.max(0, Math.min(playhead - Math.floor(fit / 2), n - fit));
    end = Math.min(n, start + fit);
  }
  const xOf = (i: number) => margin + Math.round((i - start) * gap);
  const lastX = xOf(end - 1);

  // Track: filled up to the marker, dashed beyond.
  const cursorX = xOf(Math.max(start, Math.min(end - 1, position)));
  for (let x = xOf(start); x <= lastX; x++) {
    put(
      track,
      x,
      x <= cursorX ? GLYPH.trackPast : GLYPH.trackFuture,
      x <= cursorX ? "trackPast" : "trackFuture",
    );
  }
  if (start > 0) put(track, margin - 2, GLYPH.moreLeft, "more");
  if (end < n) put(track, lastX + 2, GLYPH.moreRight, "more");

  for (let i = start; i < end; i++) {
    const past = i <= position;
    const s = stops[i];
    if (i === 0) put(track, xOf(i), GLYPH.base, "base");
    else if (s.isMerge)
      put(
        track,
        xOf(i),
        past ? GLYPH.mergePast : GLYPH.mergeFuture,
        past ? "mergePast" : "mergeFuture",
      );
    else
      put(
        track,
        xOf(i),
        past ? GLYPH.dotPast : GLYPH.dotFuture,
        past ? "dotPast" : "dotFuture",
      );
  }
  put(track, cursorX, GLYPH.cursor, "cursor");

  // Labels: the playhead's first so it always wins the space, then the rest
  // wherever they fit without crowding.
  const labelStyle = (i: number): RailStyle =>
    i === playhead
      ? "labelActive"
      : stops[i].isMerge
        ? "labelMerge"
        : i > playhead
          ? "labelFuture"
          : "label";
  const placeLabel = (i: number) => {
    const text = stops[i].label;
    const x = Math.max(
      0,
      Math.min(width - text.length, xOf(i) - Math.floor(text.length / 2)),
    );
    if (i === playhead || free(labels, x, text.length))
      put(labels, x, text, labelStyle(i));
  };
  if (playhead >= start && playhead < end) placeLabel(playhead);
  if (gap >= LABELLED_GAP) {
    for (let i = start; i < end; i++) if (i !== playhead) placeLabel(i);
  } else {
    // Dense: just the ends, if there's room.
    for (const i of [start, end - 1]) if (i !== playhead) placeLabel(i);
  }

  return { labels: runs(labels), track: runs(track) };
}
