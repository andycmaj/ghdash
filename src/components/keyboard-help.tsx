// Keyboard Help Modal - shows the keyboard shortcuts relevant to the active
// section and selected item, grouped by scope

import { TextAttributes } from "@opentui/core";
import type { ScrollBoxRenderable } from "@opentui/core";
import { createMemo, For } from "solid-js";
import { BaseCommands, navBindings } from "@andycmaj/opentui-app";
import { useTheme } from "@/hooks/useTheme";
import { APP_VERSION } from "../version";
import { Modal } from "./modal/modal";
import { ModalHeader } from "./modal/modal-header";
import { keymap } from "../keymap";
import { useHelpContext } from "../context/help-context";
import {
  filterRelevant,
  getScopeBindings,
  type HelpBinding,
} from "../keyboard/keymap-utils";

interface KeyboardHelpProps {
  onClose: () => void;
}

interface HelpGroup {
  title: string;
  bindings: HelpBinding[];
}

const SCOPES = [
  { scope: "app", title: "Global" },
  { scope: "sections", title: "Sections List" },
  { scope: "content", title: "Content View" },
];

// Extra close keys beyond escape (handled by Modal). The help modal has no
// text field, so printable keys are safe here.
const CLOSE_KEYS = ["?", "q"].map((key) => ({
  key,
  cmd: "help.close",
  desc: "close",
}));

export function KeyboardHelp(props: KeyboardHelpProps) {
  const theme = useTheme();
  const { context } = useHelpContext();

  let scrollRef: ScrollBoxRenderable | undefined;

  const groups = createMemo((): HelpGroup[] =>
    SCOPES.map(({ scope, title }) => {
      const seen = new Set<string>();
      const bindings = filterRelevant(
        getScopeBindings(keymap, scope),
        context(),
      ).filter((b) => {
        if (seen.has(b.cmd)) return false;
        seen.add(b.cmd);
        return true;
      });
      return { title, bindings };
    }),
  );

  const maxHeight = 15;

  return (
    <Modal
      size="md"
      onClose={props.onClose}
      bindings={[...CLOSE_KEYS, ...navBindings()]}
      commands={{
        "help.close": props.onClose,
        [BaseCommands.NAV_DOWN]: () => scrollRef?.scrollBy(1),
        [BaseCommands.NAV_UP]: () => scrollRef?.scrollBy(-1),
        [BaseCommands.NAV_TOP]: () => scrollRef?.scrollTo(0),
        [BaseCommands.NAV_BOTTOM]: () => scrollRef?.scrollTo(9999),
      }}
    >
      <ModalHeader title="Keyboard Shortcuts" hint="j/k scroll · esc/q/?" />

      <scrollbox
        ref={(r: ScrollBoxRenderable) => (scrollRef = r)}
        maxHeight={maxHeight}
        paddingLeft={1}
        paddingRight={1}
        paddingTop={1}
        paddingBottom={1}
      >
        <For each={groups()}>
          {(group, groupIndex) => (
            <>
              <box paddingTop={groupIndex() > 0 ? 1 : 0} paddingLeft={1}>
                <text fg={theme.accent} attributes={TextAttributes.BOLD}>
                  {group.title}
                </text>
              </box>

              <For each={group.bindings}>
                {(binding) => (
                  <box flexDirection="row" paddingLeft={2} paddingRight={2}>
                    <box width={12}>
                      <text fg={theme.primary} attributes={TextAttributes.BOLD}>
                        {binding.keys}
                      </text>
                    </box>
                    <text fg={theme.text} flexGrow={1}>
                      {binding.desc}
                    </text>
                  </box>
                )}
              </For>
            </>
          )}
        </For>
      </scrollbox>

      <box
        paddingLeft={2}
        paddingRight={2}
        paddingTop={1}
        paddingBottom={1}
        flexDirection="column"
      >
        <text fg={theme.textMuted}>ghdash v{APP_VERSION}</text>
      </box>
    </Modal>
  );
}
