// Section Picker - space-bar modal for jumping straight to a section (PR Info /
// Feed / Actions / Mergeability) with filtering. On enter it selects the
// section and focuses the content pane. Esc cancels.

import { TextAttributes } from "@opentui/core";
import { createMemo, For, Show } from "solid-js";
import { useTheme } from "@/hooks/useTheme";
import { contrastingForeground } from "@/theme/color";
import { useListNavigation } from "@/hooks/useListNavigation";
import { useGithub } from "../context/github";
import { useFocus } from "../context/focus";
import { SectionKey } from "@/github/types";
import {
  useSections,
  useSectionSummary,
  type SectionDef,
} from "./section-summary";
import { Modal } from "./modal/modal";
import { ModalHeader } from "./modal/modal-header";
import { ModalFilterInput } from "./modal/modal-filter-input";
import { ModalCommands, modalNavBindings } from "@andycmaj/opentui-app";

const INFO_SECTION: SectionDef = { key: SectionKey.Info, label: "PR Info" };

interface SectionPickerProps {
  onClose: () => void;
}

export function SectionPicker(props: SectionPickerProps) {
  const theme = useTheme();
  const { state, selectSection } = useGithub();
  const { setActivePane } = useFocus();
  const sectionSummary = useSectionSummary();
  const sections = useSections();

  const nav = useListNavigation({
    itemCount: () => filtered().length,
    scrollRef: () => undefined,
  });

  const filtered = createMemo(() => {
    const needle = nav.filter().toLowerCase();
    const all = [INFO_SECTION, ...sections()];
    if (!needle) return all;
    return all.filter((s) => s.label.toLowerCase().includes(needle));
  });

  function handleSelect() {
    const section = filtered()[nav.selected()];
    if (!section) return;
    selectSection(section.key);
    setActivePane("content");
    props.onClose();
  }

  return (
    <Modal
      size="sm"
      onClose={props.onClose}
      bindings={modalNavBindings}
      commands={{
        [ModalCommands.MODAL_UP]: () => nav.move(-1),
        [ModalCommands.MODAL_DOWN]: () => nav.move(1),
        [ModalCommands.MODAL_SELECT]: handleSelect,
      }}
    >
      <ModalHeader title="Sections" hint="↑↓ move · enter open · esc" />

      <ModalFilterInput
        onInput={(v) => nav.setFilter(v)}
        placeholder="Type to filter..."
      />

      <Show
        when={filtered().length > 0}
        fallback={
          <box paddingLeft={2} paddingRight={2} paddingBottom={1}>
            <text fg={theme.textMuted}>No sections found</text>
          </box>
        }
      >
        <box
          flexDirection="column"
          paddingLeft={1}
          paddingRight={1}
          paddingBottom={1}
        >
          <For each={filtered()}>
            {(section, index) => {
              const isCursor = () => index() === nav.selected();
              const isCurrent = () => section.key === state.selectedSection;
              const summary = createMemo(() => sectionSummary(section.key));
              const fg = () =>
                isCursor() ? contrastingForeground(theme.primary) : theme.text;
              return (
                <box
                  flexDirection="row"
                  justifyContent="space-between"
                  paddingLeft={1}
                  paddingRight={1}
                  backgroundColor={isCursor() ? theme.primary : undefined}
                >
                  <box flexDirection="row" gap={1}>
                    <text
                      fg={fg()}
                      attributes={isCursor() ? TextAttributes.BOLD : undefined}
                    >
                      {section.label}
                    </text>
                    <Show when={isCurrent()}>
                      <text fg={isCursor() ? fg() : theme.textMuted}>
                        (current)
                      </text>
                    </Show>
                  </box>
                  <text fg={isCursor() ? fg() : summary().color}>
                    {summary().text}
                  </text>
                </box>
              );
            }}
          </For>
        </box>
      </Show>
    </Modal>
  );
}
