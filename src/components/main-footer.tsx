// MainFooter component - context-aware help
// Dynamically generates help text from keymap

import { createMemo, For } from "solid-js";
import { useTerminalDimensions } from "@opentui/solid";
import { useFocus } from "../context/focus";
import { useHelpContext } from "../context/help-context";
import { useTheme } from "@/hooks/useTheme";
import { useHelpItems } from "../keyboard/keymap-utils";

export function MainFooter() {
  const { sidebarVisible } = useFocus();
  const { context } = useHelpContext();
  const theme = useTheme();
  const dimensions = useTerminalDimensions();

  // Approximate content-pane width (sidebar width 42 + 2 margins = 44).
  const contentWidth = createMemo(() => {
    const terminalWidth = dimensions().width;
    if (sidebarVisible()) {
      return terminalWidth - 44;
    }
    return terminalWidth;
  });

  // Help items from the bindings reachable in the active pane, limited to
  // those relevant to the active section and selected item
  const allHelpItems = useHelpItems(context);

  // When the content pane is narrow (< 80 chars), show only the help shortcut
  const helpItems = createMemo(() => {
    const items = allHelpItems();
    if (contentWidth() < 80) {
      return items.filter((item) => item.text === "help");
    }
    return items;
  });

  return (
    <box
      padding={1}
      paddingBottom={0}
      paddingLeft={2}
      paddingRight={2}
      flexShrink={0}
      flexDirection="row"
      justifyContent="space-between"
    >
      <box flexDirection="row" flexShrink={1}>
        <For each={helpItems()}>
          {(item, index) => (
            <>
              {index() > 0 && <text fg={theme.textMuted}> · </text>}
              <text fg={theme.primary}>{item.keys}</text>
              <text fg={theme.textMuted}> {item.text}</text>
            </>
          )}
        </For>
      </box>
    </box>
  );
}
