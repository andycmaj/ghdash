// A child process on a pseudo-terminal (e.g. $EDITOR on a job log) rendered
// inside a pane. Live sessions are killed when the app exits for any reason,
// including the terminal closing (SIGHUP), so no orphaned editor is left behind.

import type { Subprocess } from "bun";

const live = new Set<PtySession>();
let hooksInstalled = false;

function installExitHooks(): void {
  if (hooksInstalled) return;
  hooksInstalled = true;
  const killAll = () => {
    for (const session of live) session.kill();
  };
  process.on("exit", killAll);
  process.on("SIGHUP", () => {
    killAll();
    process.exit(129);
  });
}

export interface PtySessionOptions {
  cols: number;
  rows: number;
  env?: Record<string, string>;
  onData: (data: Uint8Array) => void;
  onExit: (code: number | null) => void;
}

export class PtySession {
  private proc: Subprocess;
  exitCode: number | null = null;
  running = true;

  constructor(command: string[], options: PtySessionOptions) {
    installExitHooks();
    this.proc = Bun.spawn(command, {
      env: {
        ...process.env,
        TERM: "xterm-256color",
        COLORTERM: "truecolor",
        ...options.env,
      },
      terminal: {
        cols: options.cols,
        rows: options.rows,
        data: (_terminal, data) => options.onData(data),
      },
    });
    live.add(this);
    void this.proc.exited.then((code) => {
      this.running = false;
      this.exitCode = code;
      live.delete(this);
      options.onExit(code);
    });
  }

  write(data: string): void {
    if (this.running) this.proc.terminal?.write(data);
  }

  resize(cols: number, rows: number): void {
    if (this.running) this.proc.terminal?.resize(cols, rows);
  }

  kill(): void {
    if (this.running) this.proc.kill();
  }
}
