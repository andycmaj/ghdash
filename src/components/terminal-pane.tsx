// The content pane while an embedded terminal session (e.g. $EDITOR on a job
// log) is open. While focused it receives every key except the detach chord;
// detaching moves focus to the sections pane and Tab re-attaches. When the
// program exits the pane closes and the section view comes back.

import { createEffect, createMemo, onCleanup, onMount, Show } from "solid-js";
import type { BoxRenderable } from "@opentui/core";
import { useKeyPassthrough, usePane } from "@andycmaj/opentui-app";
import { useFocus } from "../context/focus";
import { useToast } from "../context/toast";
import { useTerminal, type Terminal } from "../context/terminal";
import { useScope } from "../keyboard/keymap-utils";
import { Commands } from "../commands";
import { focusBorder } from "../theme/theme";
import { useTheme } from "@/hooks/useTheme";
import { encodeKey } from "@/terminal/key-encode";
import { PaneHeader } from "./pane-header";

export function TerminalPane() {
  const terminal = useTerminal();
  const theme = useTheme();
  const pane = usePane("content");
  const { setActivePane } = useFocus();
  const { showToast } = useToast();
  const state = () => terminal.state();
  const running = () => state()?.running ?? false;
  const attached = () => running() && pane.isFocused();

  let host: BoxRenderable | undefined;
  let current: Terminal | null = null;
  let size = { cols: 0, rows: 0 };

  function fit() {
    if (!host || !current) return;
    const cols = Math.max(10, host.width);
    const rows = Math.max(3, host.height);
    if (cols === size.cols && rows === size.rows) return;
    size = { cols, rows };
    current.view.resizeTerminal(cols, rows);
    current.session.resize(cols, rows);
  }

  onMount(() => {
    // Layout isn't computed until the first frame; start at the real size so
    // the program doesn't draw for 80x24 and then reflow.
    const start = () => {
      if (!host || host.width <= 0 || host.height <= 0) {
        setTimeout(start, 16);
        return;
      }
      current = terminal.attach(host.width, host.height);
      if (!current) return;
      size = { cols: 0, rows: 0 };
      host.add(current.view);
      fit();
      host.onSizeChange = fit;
    };
    start();
    setActivePane("content");
  });

  onCleanup(() => {
    if (host && current) host.remove(current.view);
  });

  // An editor on a log has nothing to show once it quits, so return to the
  // dashboard rather than leaving a dead terminal up.
  createEffect(() => {
    const s = state();
    if (!s || s.running) return;
    if (s.exitCode) showToast(`Exited with code ${s.exitCode}`, 3000, "error");
    terminal.close();
    setActivePane("content");
  });

  useKeyPassthrough(
    "terminal",
    (event) => {
      const bytes = encodeKey(event);
      if (bytes) current?.session.write(bytes);
    },
    { target: pane.target, enabled: running },
  );

  useScope(
    "terminal",
    {
      [Commands.TERMINAL_DETACH]: () => setActivePane("sections"),
    },
    { target: pane.target },
  );

  const status = createMemo(() =>
    attached()
      ? { text: "attached", color: theme.success }
      : { text: "detached · Tab to attach", color: theme.warning },
  );

  return (
    <box
      ref={pane.ref}
      flexDirection="column"
      flexGrow={1}
      marginTop={1}
      marginBottom={1}
      marginRight={1}
      paddingLeft={pane.isFocused() ? 0 : 1}
      {...focusBorder(theme, pane.isFocused())}
    >
      <PaneHeader title={state()?.request.title ?? "Terminal"}>
        <text flexShrink={0}>
          <Show when={state()?.request.tag}>
            <span style={{ fg: theme.textMuted }}>
              [{state()?.request.tag}]{" "}
            </span>
          </Show>
          <span style={{ fg: status().color }}>[{status().text}]</span>
        </text>
      </PaneHeader>
      <box
        ref={(r: BoxRenderable) => (host = r)}
        marginLeft={2}
        marginRight={1}
        flexGrow={1}
      />
      <box padding={1} paddingBottom={0} paddingLeft={2} flexShrink={0}>
        <text>
          <span style={{ fg: theme.primary }}>^]</span>
          <span style={{ fg: theme.textMuted }}>
            {" "}
            detach · quit the editor to close
          </span>
        </text>
      </box>
    </box>
  );
}
