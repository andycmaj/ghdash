// The embedded terminal session (e.g. $EDITOR on a job log) shown in place of
// the content pane. The session and its renderable live here rather than in
// the pane so they survive the pane remounting (e.g. toggling the sidebar).

import { createSignal, onCleanup, type ParentProps } from "solid-js";
import { useRenderer } from "@opentui/solid";
import { createRequiredContext } from "@andycmaj/opentui-app";
import { useTheme } from "@/hooks/useTheme";
import { PtySession } from "@/terminal/pty-session";
import { terminalReplies } from "@/terminal/replies";
import { ViewportTerminalRenderable } from "@/terminal/viewport-terminal";

export interface TerminalRequest {
  title: string;
  tag?: string;
  command: string[];
  env?: Record<string, string>;
  // Runs once the session ends, however it ends (exit or close).
  onEnd?: (code: number | null) => void;
}

export interface TerminalState {
  request: TerminalRequest;
  running: boolean;
  exitCode: number | null;
}

export interface Terminal {
  view: ViewportTerminalRenderable;
  session: PtySession;
}

interface TerminalContextValue {
  state: () => TerminalState | null;
  open: (request: TerminalRequest) => void;
  close: () => void;
  // Starts the session at the host's size on first call; later calls return it.
  attach: (cols: number, rows: number) => Terminal | null;
}

const [TerminalContext, useTerminal] =
  createRequiredContext<TerminalContextValue>("Terminal");
export { useTerminal };

export function TerminalProvider(props: ParentProps) {
  const renderer = useRenderer();
  const theme = useTheme();
  const hex = (color: string | undefined, fallback: string) =>
    color && /^#[0-9a-f]{6}/i.test(color) ? color : fallback;
  const [state, setState] = createSignal<TerminalState | null>(null);
  let current: Terminal | null = null;
  let ended = false;

  function end(request: TerminalRequest, code: number | null) {
    if (ended) return;
    ended = true;
    request.onEnd?.(code);
  }

  function teardown() {
    const s = state();
    if (s) end(s.request, s.exitCode);
    if (!current) return;
    current.session.kill();
    current.view.destroyTerminal();
    current = null;
  }

  function open(request: TerminalRequest) {
    teardown();
    ended = false;
    setState({ request, running: true, exitCode: null });
  }

  function close() {
    teardown();
    setState(null);
  }

  function attach(cols: number, rows: number): Terminal | null {
    const s = state();
    if (!s) return null;
    if (current) return current;
    const view = new ViewportTerminalRenderable(renderer, {
      cols,
      rows,
      flexGrow: 1,
    });
    const decoder = new TextDecoder();
    const session: PtySession = new PtySession(s.request.command, {
      cols,
      rows,
      env: s.request.env,
      onData: (data) => {
        view.feed(data);
        const replies = terminalReplies(
          decoder.decode(data, { stream: true }),
          {
            cursor: view.term.getCursor(),
            foreground: hex(theme.text, "#c0c0c0"),
            background: hex(theme.background, "#000000"),
          },
        );
        if (replies) session.write(replies);
      },
      onExit: (code) => {
        setState((prev) =>
          prev ? { ...prev, running: false, exitCode: code } : prev,
        );
        end(s.request, code);
      },
    });
    current = { view, session };
    return current;
  }

  onCleanup(teardown);

  return (
    <TerminalContext.Provider value={{ state, open, close, attach }}>
      {props.children}
    </TerminalContext.Provider>
  );
}
