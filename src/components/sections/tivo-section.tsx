// TiVo view: the PR's changed files, and a player that scrubs one file
// through the commits that touched it. The player renders only the rows in
// its viewport, so large files and per-frame animation stay cheap.

import {
  createEffect,
  createMemo,
  createSignal,
  For,
  Index,
  on,
  onCleanup,
  Show,
} from "solid-js";
import type { Renderable } from "@opentui/core";
import { useTivo } from "@/context/tivo";
import { useTheme } from "@/hooks/useTheme";
import { useScope } from "@/keyboard/keymap-utils";
import { Commands } from "@/commands";
import { formatRelativeTime } from "@/theme/theme";
import { mix } from "@/theme/color";
import { truncate } from "@/utils/truncate";
import {
  ANIMATION_MS,
  anchorTop,
  FRAME_MS,
  frameRows,
  progress,
  rowIndexForPos,
  settledRows,
  type FrameRow,
  type Tone,
} from "@/tivo/animation";
import { changedLines, diffLines, type DiffOp } from "@/tivo/line-diff";
import type { Snapshot } from "@/tivo/blame";
import type { Theme } from "@/theme/theme";
import { Marker } from "./common";

const HEX = /^#[0-9a-f]{6}$/i;

function toneColor(theme: Theme, tone: Tone): string | undefined {
  if (tone === "add") return theme.success;
  if (tone === "remove") return theme.error;
  return theme.warning;
}

// Terminal cells have no alpha, so a fade is a blend from the tone colour
// toward the pane background (or a cut-off when either isn't a hex colour).
function rowBackground(theme: Theme, row: FrameRow): string | undefined {
  if (!row.tone || row.strength <= 0) return undefined;
  const color = toneColor(theme, row.tone);
  if (!color) return undefined;
  const bg = theme.contentPane;
  if (HEX.test(color) && HEX.test(bg))
    return mix(bg, color, row.strength * 0.6);
  return row.strength > 0.3 ? color : undefined;
}

const expandTabs = (text: string) => text.replace(/\t/g, "  ");

export function TivoSection(props: {
  width: number;
  target: () => Renderable | undefined;
}) {
  const tivo = useTivo();
  const theme = useTheme();

  const [height, setHeight] = createSignal(20);
  let viewport: Renderable | undefined;
  const measure = () => {
    if (viewport) setHeight(Math.max(1, viewport.height));
  };

  // --- file list ---
  const [cursor, setCursor] = createSignal(0);
  const [listTop, setListTop] = createSignal(0);
  createEffect(
    on(
      () => tivo.state.files.length,
      (n) => {
        if (cursor() > n - 1) setCursor(Math.max(0, n - 1));
      },
    ),
  );
  function moveCursor(next: number) {
    const n = tivo.state.files.length;
    if (n === 0) return;
    const c = Math.max(0, Math.min(n - 1, next));
    setCursor(c);
    if (c < listTop()) setListTop(c);
    else if (c >= listTop() + height()) setListTop(c - height() + 1);
  }

  // --- player ---
  // What the player is showing: the stop it settles on, and its lines.
  const [shown, setShown] = createSignal<{
    path: string;
    index: number;
    lines: Snapshot;
  } | null>(null);
  const [rows, setRows] = createSignal<FrameRow[]>([]);
  // Viewport top as a line index in the shown snapshot.
  const [top, setTop] = createSignal(0);
  let timer: ReturnType<typeof setInterval> | undefined;
  let running: { ops: DiffOp[]; start: number } | null = null;

  function snap() {
    if (timer) clearInterval(timer);
    timer = undefined;
    if (running) setRows(frameRows(running.ops, 1));
    running = null;
  }
  onCleanup(snap);

  function maxTop(): number {
    return Math.max(0, (shown()?.lines?.length ?? 0) - height());
  }
  function scrollTo(next: number) {
    setTop(Math.max(0, Math.min(maxTop(), next)));
  }

  function show(path: string, index: number, lines: Snapshot) {
    snap();
    const from = shown();
    setShown({ path, index, lines });
    if (!from || from.path !== path) {
      setRows(settledRows(lines ?? []));
      setTop(0);
      return;
    }
    if (from.index === index) return;
    const ops = diffLines(from.lines ?? [], lines ?? []);
    setTop(
      anchorTop({
        ops,
        top: top(),
        height: height(),
        newLength: lines?.length ?? 0,
      }),
    );
    running = { ops, start: Date.now() };
    setRows(frameRows(ops, 0));
    timer = setInterval(() => {
      if (!running) return;
      const t = progress(Date.now() - running.start, ANIMATION_MS);
      if (t >= 1) snap();
      else setRows(frameRows(running.ops, t));
    }, FRAME_MS);
  }

  createEffect(
    on(
      () =>
        [
          tivo.state.path,
          tivo.state.playhead,
          tivo.state.stops.length,
        ] as const,
      ([path, playhead, count]) => {
        if (!path) {
          snap();
          setShown(null);
          setRows([]);
          return;
        }
        if (count === 0) return;
        void tivo.load(playhead).then((lines) => {
          // A later step supersedes this one; it will animate from what's on screen.
          if (tivo.state.path !== path || tivo.state.playhead !== playhead)
            return;
          show(path, playhead, lines);
        });
      },
    ),
  );

  const visibleRows = createMemo(() => {
    const all = rows();
    const start = rowIndexForPos(all, top());
    return all.slice(start, start + height());
  });

  // Lines changed between merge-base and the playhead stay marked in the gutter.
  const touched = createMemo(() => {
    const s = shown();
    const base = tivo.snapshot(0);
    if (!s || base === undefined || s.index === 0) return new Set<number>();
    return changedLines(diffLines(base ?? [], s.lines ?? []));
  });

  const blame = createMemo(() => {
    const s = shown();
    if (!tivo.state.blame || !s) return undefined;
    return tivo.blameAt(s.index);
  });

  const gutterWidth = createMemo(() =>
    Math.max(3, `${shown()?.lines?.length ?? 0}`.length),
  );
  const textWidth = createMemo(
    () => props.width - gutterWidth() - 3 - (tivo.state.blame ? 8 : 0),
  );

  // --- keys ---
  const inPlayer = () => !!tivo.state.path;
  const halfPage = () => Math.max(1, Math.floor(height() / 2));

  useScope(
    "tivo",
    {
      [Commands.NAV_DOWN]: () =>
        inPlayer() ? scrollTo(top() + 1) : moveCursor(cursor() + 1),
      [Commands.NAV_UP]: () =>
        inPlayer() ? scrollTo(top() - 1) : moveCursor(cursor() - 1),
      [Commands.NAV_TOP]: () => (inPlayer() ? scrollTo(0) : moveCursor(0)),
      [Commands.NAV_BOTTOM]: () =>
        inPlayer()
          ? scrollTo(maxTop())
          : moveCursor(tivo.state.files.length - 1),
      [Commands.SCROLL_HALF_DOWN]: () =>
        inPlayer()
          ? scrollTo(top() + halfPage())
          : moveCursor(cursor() + halfPage()),
      [Commands.SCROLL_HALF_UP]: () =>
        inPlayer()
          ? scrollTo(top() - halfPage())
          : moveCursor(cursor() - halfPage()),
      [Commands.SCROLL_PAGEDOWN]: () =>
        inPlayer()
          ? scrollTo(top() + height())
          : moveCursor(cursor() + height()),
      [Commands.SCROLL_PAGEUP]: () =>
        inPlayer()
          ? scrollTo(top() - height())
          : moveCursor(cursor() - height()),
      [Commands.TIVO_OPEN]: () => {
        if (inPlayer()) return;
        const file = tivo.state.files[cursor()];
        if (file) tivo.open(file.path);
      },
      [Commands.TIVO_BACK]: () => {
        // Esc in the file list falls through to whatever else wants it.
        if (!inPlayer()) return false;
        tivo.close();
        return true;
      },
      [Commands.TIVO_NEXT]: () => tivo.step(1),
      [Commands.TIVO_PREV]: () => tivo.step(-1),
      [Commands.TIVO_FIRST]: () => tivo.seek(0),
      [Commands.TIVO_LAST]: () => tivo.seek(tivo.state.stops.length - 1),
      [Commands.TIVO_BLAME]: () => tivo.toggleBlame(),
    },
    { target: props.target, priority: 1 },
  );

  const visibleFiles = createMemo(() =>
    tivo.state.files
      .slice(listTop(), listTop() + height())
      .map((file, i) => ({ file, index: listTop() + i })),
  );

  const stop = createMemo(() => tivo.state.stops[tivo.state.playhead]);
  const unplayable = () => tivo.unplayable();

  return (
    <box flexDirection="column" flexGrow={1} paddingLeft={2} paddingRight={1}>
      <Show
        when={!tivo.state.error}
        fallback={
          <box flexDirection="column">
            <text fg={theme.error}>{tivo.state.error}</text>
            <Show when={tivo.state.hint}>
              <text fg={theme.textMuted}>Try: {tivo.state.hint}</text>
            </Show>
          </box>
        }
      >
        <Show when={tivo.state.path}>
          <TimelineBar width={props.width} />
          <box flexDirection="row" gap={1} marginBottom={1}>
            <Show when={stop()}>
              {(s) => (
                <>
                  <text fg={theme.primary} attributes={1}>
                    {s().shortSha}
                  </text>
                  <Show
                    when={tivo.state.playhead > 0}
                    fallback={
                      <text fg={theme.textMuted}>
                        merge-base with {s().subject}
                      </text>
                    }
                  >
                    <text fg={theme.text}>
                      {truncate(s().subject, Math.max(10, props.width - 40))}
                    </text>
                    <text fg={theme.textMuted}>
                      {s().author} · {formatRelativeTime(s().date)}
                    </text>
                  </Show>
                </>
              )}
            </Show>
          </box>
        </Show>

        <box
          ref={(r: Renderable) => {
            viewport = r;
            measure();
          }}
          onSizeChange={measure}
          flexDirection="column"
          flexGrow={1}
          overflow="hidden"
        >
          <Show
            when={tivo.state.path}
            fallback={
              <Show
                when={tivo.state.files.length > 0}
                fallback={
                  <text fg={theme.textMuted}>
                    {tivo.state.loading
                      ? "Reading history…"
                      : "No changed files."}
                  </text>
                }
              >
                <For each={visibleFiles()}>
                  {(entry) => (
                    <box flexDirection="row" gap={1}>
                      <Marker selected={entry.index === cursor()} />
                      <text
                        fg={
                          entry.index === cursor() ? theme.primary : theme.text
                        }
                        attributes={entry.index === cursor() ? 1 : 0}
                      >
                        {truncate(
                          entry.file.path,
                          Math.max(10, props.width - 28),
                        )}
                      </text>
                      <Show
                        when={!entry.file.binary}
                        fallback={<text fg={theme.textMuted}>binary</text>}
                      >
                        <text fg={theme.success}>+{entry.file.added}</text>
                        <text fg={theme.error}>−{entry.file.removed}</text>
                      </Show>
                      <text fg={theme.textMuted}>
                        {entry.file.commits} commit
                        {entry.file.commits === 1 ? "" : "s"}
                      </text>
                    </box>
                  )}
                </For>
              </Show>
            }
          >
            <Show
              when={!unplayable()}
              fallback={<text fg={theme.textMuted}>{unplayable()}</text>}
            >
              <Show
                when={shown()}
                fallback={<text fg={theme.textMuted}>Loading…</text>}
              >
                <Show
                  when={shown()?.lines || rows().length > 0}
                  fallback={
                    <text fg={theme.textMuted}>(file does not exist)</text>
                  }
                >
                  <Index each={visibleRows()}>
                    {(row) => (
                      <PlayerRow
                        row={row()}
                        touched={
                          row().line !== null && touched().has(row().line!)
                        }
                        blame={blame()}
                        gutterWidth={gutterWidth()}
                        textWidth={textWidth()}
                      />
                    )}
                  </Index>
                </Show>
              </Show>
            </Show>
          </Show>
        </box>
      </Show>
    </box>
  );

  function PlayerRow(p: {
    row: FrameRow;
    touched: boolean;
    blame: number[] | undefined;
    gutterWidth: number;
    textWidth: number;
  }) {
    const origin = () =>
      p.row.line === null ? undefined : p.blame?.[p.row.line];
    const blameLabel = () => {
      const o = origin();
      if (o === undefined) return "".padEnd(7);
      return o === 0
        ? "base".padEnd(7)
        : (tivo.state.stops[o]?.shortSha ?? "").padEnd(7);
    };
    const blameHot = () => origin() === tivo.state.playhead && origin() !== 0;
    return (
      <box flexDirection="row" backgroundColor={rowBackground(theme, p.row)}>
        <text fg={theme.accent}>{p.touched ? "▎" : " "}</text>
        <Show when={tivo.state.blame}>
          <text
            fg={blameHot() ? theme.primary : theme.textMuted}
            attributes={blameHot() ? 1 : 0}
          >
            {blameLabel()}{" "}
          </text>
        </Show>
        <text fg={theme.textMuted}>
          {p.row.line === null
            ? "-".padStart(p.gutterWidth)
            : `${p.row.line + 1}`.padStart(p.gutterWidth)}{" "}
        </text>
        <text fg={p.row.tone === "remove" ? theme.textMuted : theme.text}>
          {truncate(expandTabs(p.row.text), Math.max(1, p.textWidth))}
        </text>
      </box>
    );
  }

  function TimelineBar(p: { width: number }) {
    // Ticks are fixed width; show a window around the playhead that fits.
    const TICK = 9;
    const windowed = createMemo(() => {
      const stops = tivo.state.stops;
      const fit = Math.max(1, Math.floor((p.width - 12) / TICK));
      const half = Math.floor(fit / 2);
      const start = Math.max(
        0,
        Math.min(tivo.state.playhead - half, stops.length - fit),
      );
      return {
        start,
        end: Math.min(stops.length, start + fit),
      };
    });
    const ticks = createMemo(() =>
      tivo.state.stops
        .slice(windowed().start, windowed().end)
        .map((s, i) => ({ stop: s, index: windowed().start + i })),
    );
    return (
      <box flexDirection="column" marginBottom={1}>
        <box flexDirection="row" justifyContent="space-between">
          <text fg={theme.text} attributes={1}>
            {truncate(tivo.state.path ?? "", Math.max(10, p.width - 24))}
          </text>
          <text fg={theme.textMuted}>
            {tivo.state.playhead === 0
              ? "base"
              : `${tivo.state.playhead}/${tivo.state.stops.length - 1}`}
            {tivo.state.blame ? " · blame" : ""}
          </text>
        </box>
        <box flexDirection="row">
          <text fg={theme.textMuted}>{windowed().start > 0 ? "… " : "  "}</text>
          <For each={ticks()}>
            {(t) => {
              const active = () => t.index === tivo.state.playhead;
              const label = () =>
                (t.index === 0 ? "base" : t.stop.shortSha) +
                (t.stop.isMerge ? "⑂" : "");
              return (
                <box
                  flexDirection="row"
                  backgroundColor={active() ? theme.primary : undefined}
                >
                  <text
                    fg={
                      active()
                        ? theme.background
                        : t.stop.isMerge
                          ? theme.info
                          : t.index <= tivo.state.playhead
                            ? theme.text
                            : theme.textMuted
                    }
                    attributes={active() ? 1 : 0}
                  >
                    {` ${label()} `.padEnd(TICK - 1)}
                  </text>
                  <text fg={theme.textMuted}>│</text>
                </box>
              );
            }}
          </For>
          <text fg={theme.textMuted}>
            {windowed().end < tivo.state.stops.length ? " …" : ""}
          </text>
        </box>
      </box>
    );
  }
}
