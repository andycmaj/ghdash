// Section list (sidebar): Feed / Actions / Mergeability for the current PR.

import {
  createSignal,
  createMemo,
  createEffect,
  For,
  Show,
  createSelector,
} from "solid-js";
import { useGithub } from "../context/github";
import { usePane } from "@andycmaj/opentui-app";
import { useFocus } from "../context/focus";
import { useScope } from "../keyboard/keymap-utils";
import { focusBorder, prStatusColor } from "../theme/theme";
import { contrastingForeground } from "@/theme/color";
import { useTheme } from "@/hooks/useTheme";
import { ConnectionStatus } from "./connection-status";
import { PaneHeader } from "./pane-header";
import { useToast } from "../context/toast";
import { Commands } from "@/commands";
import { prStatusLabel } from "@/github/status-utils";
import { PRStatus, SectionKey } from "@/github/types";
import { useSections, useSectionSummary } from "./section-summary";
import { truncate } from "@/utils/truncate";
import { openUrl } from "@/utils/open-url";

export function SectionTree() {
  const { state, selectSection } = useGithub();
  const { setActivePane } = useFocus();
  const pane = usePane("sections");
  const { showToast } = useToast();
  const theme = useTheme();

  // Navigable rows: the PR header (index 0 → Info) followed by the sections.
  const sections = useSections();
  const navCount = () => sections().length + 1;
  const keyForIndex = (index: number): SectionKey =>
    index === 0 ? SectionKey.Info : sections()[index - 1].key;

  const indexForKey = (key: SectionKey): number =>
    key === SectionKey.Info
      ? 0
      : Math.max(0, sections().findIndex((s) => s.key === key) + 1);
  const [cursor, setCursor] = createSignal(indexForKey(state.selectedSection));
  // Follow selection changes made elsewhere (e.g. the section picker), and
  // re-anchor when the Merge queue row appears or disappears.
  createEffect(() => setCursor(indexForKey(state.selectedSection)));
  const isSelected = createSelector(cursor);
  const headerSelected = createMemo(() => cursor() === 0);

  const isFocused = pane.isFocused;

  const sectionSummary = useSectionSummary();

  function moveCursor(next: number) {
    const clamped = Math.max(0, Math.min(next, navCount() - 1));
    setCursor(clamped);
    // Content follows the cursor immediately.
    selectSection(keyForIndex(clamped));
  }

  useScope(
    "sections",
    {
      [Commands.NAV_DOWN]: () => moveCursor(cursor() + 1),
      [Commands.NAV_UP]: () => moveCursor(cursor() - 1),
      [Commands.NAV_TOP]: () => moveCursor(0),
      [Commands.NAV_BOTTOM]: () => moveCursor(navCount() - 1),
      [Commands.SECTION_SELECT]: () => {
        selectSection(keyForIndex(cursor()));
        setActivePane("content");
      },
      [Commands.OPEN_IN_BROWSER]: () => {
        if (state.pr) {
          openUrl(state.pr.url);
          showToast("Opening in browser");
        }
      },
    },
    { target: pane.target },
  );

  const prTitleColor = createMemo(() =>
    state.pr ? prStatusColor(theme, state.pr.status) : theme.primary,
  );

  const headerBg = createMemo(() => {
    if (!headerSelected()) return undefined;
    return isFocused() ? theme.primary : theme.secondary;
  });
  const headerFg = createMemo(() => {
    if (!headerSelected()) return theme.text;
    return contrastingForeground(
      (isFocused() ? theme.primary : theme.secondary) ?? "#ffffff",
    );
  });

  return (
    <box
      ref={pane.ref}
      flexDirection="column"
      backgroundColor={theme.contentPane}
      flexGrow={0}
      flexShrink={0}
      marginTop={1}
      marginBottom={1}
      marginLeft={1}
      width={42}
      paddingLeft={isFocused() ? 0 : 1}
      {...focusBorder(theme, isFocused())}
    >
      <PaneHeader
        title={state.pr ? `PR #${state.pr.number}` : "No PR"}
        color={prTitleColor()}
      >
        <Show when={state.pr}>
          <box flexDirection="row" gap={1}>
            <Show when={state.pr!.mergeQueue}>
              <text fg={theme.info}>
                [queued
                {state.pr!.mergeQueue!.position != null
                  ? ` #${state.pr!.mergeQueue!.position}`
                  : ""}
                ]
              </text>
            </Show>
            <Show when={state.pr!.status !== PRStatus.Open}>
              <text fg={prTitleColor()}>
                [{prStatusLabel(state.pr!.status)}]
              </text>
            </Show>
          </box>
        </Show>
      </PaneHeader>

      {/* PR title + branch — selectable (opens the PR Info view). */}
      <box
        flexDirection="column"
        paddingLeft={2}
        paddingRight={2}
        backgroundColor={headerBg()}
      >
        <Show
          when={state.pr}
          fallback={
            <text fg={theme.textMuted}>
              {state.error ? truncate(state.error, 36) : "Loading…"}
            </text>
          }
        >
          <text
            fg={headerFg()}
            attributes={headerSelected() ? 1 : 0}
            wrapMode="word"
          >
            {state.pr!.title}
          </text>
          <text fg={headerSelected() ? headerFg() : theme.textMuted}>
            {truncate(`${state.pr!.headRef} → ${state.pr!.baseRef}`, 36)}
          </text>
        </Show>
      </box>

      {/* Section list */}
      <box flexDirection="column" flexGrow={1} paddingTop={1} paddingLeft={1}>
        <For each={sections()}>
          {(section, index) => {
            const selectedRow = createMemo(() => isSelected(index() + 1));
            const summary = createMemo(() => sectionSummary(section.key));
            const bg = createMemo(() => {
              if (!selectedRow()) return undefined;
              return isFocused() ? theme.primary : theme.secondary;
            });
            const fg = createMemo(() => {
              if (selectedRow()) {
                return contrastingForeground(
                  (isFocused() ? theme.primary : theme.secondary) ?? "#ffffff",
                );
              }
              return theme.text;
            });
            return (
              <box
                flexDirection="row"
                justifyContent="space-between"
                paddingLeft={1}
                paddingRight={1}
                backgroundColor={bg()}
              >
                <text fg={fg()} attributes={selectedRow() ? 1 : 0}>
                  {section.label}
                </text>
                <text fg={selectedRow() ? fg() : summary().color}>
                  {summary().text}
                </text>
              </box>
            );
          }}
        </For>
      </box>

      {/* Connection status at bottom of sidebar */}
      <ConnectionStatus narrow={true} />
    </box>
  );
}
