import {
  TextBufferRenderable,
  type RenderContext,
  type TextBufferOptions,
} from "@opentui/core";
import { PersistentTerminal } from "ghostty-opentui";
import { terminalDataToStyledText } from "ghostty-opentui/terminal-buffer";

export interface ViewportTerminalOptions extends TextBufferOptions {
  cols: number;
  rows: number;
}

// GhosttyTerminalRenderable serializes the whole scrollback every frame and
// shows it from the top; a live PTY needs only the bottom `rows` lines.
export class ViewportTerminalRenderable extends TextBufferRenderable {
  readonly term: PersistentTerminal;
  private dirty = true;
  stats = { frames: 0, renderMs: 0 };

  constructor(ctx: RenderContext, options: ViewportTerminalOptions) {
    super(ctx, { ...options, wrapMode: "none" });
    this.term = new PersistentTerminal({
      cols: options.cols,
      rows: options.rows,
    });
  }

  feed(data: Uint8Array | string): void {
    this.term.feed(data);
    this.dirty = true;
    this.requestRender();
  }

  resizeTerminal(cols: number, rows: number): void {
    this.term.resize(cols, rows);
    this.dirty = true;
    this.requestRender();
  }

  protected override renderSelf(
    buffer: Parameters<TextBufferRenderable["renderSelf"]>[0],
  ): void {
    if (this.dirty) {
      const t0 = performance.now();
      const rows = this.term.rows;
      const { totalLines } = this.term.getJson({
        offset: Number.MAX_SAFE_INTEGER >>> 0,
        limit: 1,
      });
      const offset = Math.max(0, totalLines - rows);
      const data = this.term.getJson({ offset, limit: rows });
      const cursor = data.cursorVisible
        ? { x: data.cursor[0], y: data.cursor[1], style: "block" as const }
        : undefined;
      this.textBuffer.setStyledText(
        terminalDataToStyledText(data, undefined, cursor),
      );
      this.updateTextInfo();
      this.dirty = false;
      this.stats.frames++;
      this.stats.renderMs += performance.now() - t0;
    }
    super.renderSelf(buffer);
  }

  // Not tied to removal: the renderable is re-parented when its pane remounts.
  destroyTerminal(): void {
    if (!this.term.destroyed) this.term.destroy();
  }
}
