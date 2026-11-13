import { describe, expect, test } from "bun:test";
import { GLYPH, layoutRail, type RailRun, type RailStopInfo } from "./rail";

const text = (runs: RailRun[]) => runs.map((r) => r.text).join("");
const styleAt = (runs: RailRun[], x: number) => {
  let at = 0;
  for (const r of runs) {
    if (x < at + r.text.length) return r.style;
    at += r.text.length;
  }
  return undefined;
};

const stops = (n: number, merges: number[] = []): RailStopInfo[] =>
  Array.from({ length: n }, (_, i) => ({
    label: i === 0 ? "base" : `c${i}`.padEnd(7, "0"),
    isMerge: merges.includes(i),
  }));

describe("layoutRail", () => {
  test("rows span the full width", () => {
    const { labels, track } = layoutRail(stops(4), 1, 1, 60);
    expect(text(labels)).toHaveLength(60);
    expect(text(track)).toHaveLength(60);
  });

  test("fills the track up to the playhead and dashes the rest", () => {
    const { track } = layoutRail(stops(3), 1, 1, 40);
    const t = text(track).trim();
    const cursor = t.indexOf(GLYPH.cursor);
    expect(t.startsWith(GLYPH.base)).toBe(true);
    expect(t.slice(1, cursor)).toMatch(new RegExp(`^${GLYPH.trackPast}+$`));
    expect(t.slice(cursor + 1, -1)).toMatch(
      new RegExp(`^${GLYPH.trackFuture}+$`),
    );
    expect(t.endsWith(GLYPH.dotFuture)).toBe(true);
  });

  test("marks merge stops", () => {
    const { track } = layoutRail(stops(4, [2]), 3, 3, 50);
    expect(text(track)).toContain(GLYPH.mergePast);
    const ahead = layoutRail(stops(4, [2]), 1, 1, 50).track;
    expect(text(ahead)).toContain(GLYPH.mergeFuture);
  });

  test("labels every stop when there's room, playhead highlighted", () => {
    const { labels } = layoutRail(stops(4), 2, 2, 60);
    const l = text(labels);
    for (const s of stops(4)) expect(l).toContain(s.label);
    expect(styleAt(labels, l.indexOf("c200000"))).toBe("labelActive");
    expect(styleAt(labels, l.indexOf("c300000"))).toBe("labelFuture");
  });

  test("dense rails only label the playhead and the ends", () => {
    const { labels } = layoutRail(stops(12), 6, 6, 50);
    const l = text(labels);
    expect(l).toContain("c600000");
    expect(l).toContain("base");
    expect(l).not.toContain("c500000");
  });

  test("windows very long timelines around the playhead", () => {
    const { track } = layoutRail(stops(100), 50, 50, 40);
    const t = text(track);
    expect(t).toContain(GLYPH.moreLeft);
    expect(t).toContain(GLYPH.moreRight);
    expect(t).toContain(GLYPH.cursor);
    expect(t).not.toContain(GLYPH.base);
  });

  test("a fractional position slides the marker between dots", () => {
    const at = (p: number) =>
      text(layoutRail(stops(3), 2, p, 40).track).indexOf(GLYPH.cursor);
    expect(at(1)).toBeLessThan(at(1.5));
    expect(at(1.5)).toBeLessThan(at(2));
  });

  test("a single stop renders just the base", () => {
    const { track } = layoutRail(stops(1), 0, 0, 20);
    expect(text(track).trim()).toBe(GLYPH.cursor);
  });
});
