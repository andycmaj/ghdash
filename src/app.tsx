// Main App component

import { createEffect, Show } from "solid-js";
import type { Renderable } from "@opentui/core";
import { useRenderer } from "@opentui/solid";
import { KeymapProvider, useKeymap } from "@andycmaj/opentui-app";
import { GithubProvider, useGithub } from "./context/github";
import { FocusProvider, useFocus } from "./context/focus";
import { ToastProvider, useToast } from "./context/toast";
import { HelpContextProvider } from "./context/help-context";
import { ReplyProvider } from "./context/reply";
import { ThemeProvider } from "./context/theme";
import type { ThemeName } from "./theme/theme";
import { Toast } from "./components/toast";
import { keymap } from "./keymap";
import { ConnectionStatus } from "./components/connection-status";
import { SectionTree } from "./components/section-tree";
import { SectionView } from "./components/section-view";
import { SectionPicker } from "./components/section-picker";
import {
  CommandPalette,
  type PaletteOption,
} from "./components/command-palette";
import { KeyboardHelp } from "./components/keyboard-help";
import { useTheme } from "./hooks/useTheme";
import { useScope } from "./keyboard/keymap-utils";
import { Commands } from "./commands";
import { MergeConfirmModal } from "./components/merge-confirm-modal";
import { PrEditModal } from "./components/pr-edit-modal";
import { PrLabelsModal } from "./components/pr-labels-modal";
import { PrOpenModal } from "./components/pr-open-modal";
import { ReplyModal } from "./components/reply-modal";
import { canMerge } from "./github/status-utils";
import { openUrl } from "./utils/open-url";
import { copyToClipboard } from "./utils/copy-to-clipboard";
import { lokiLogsUrl } from "./utils/loki";
import type { PRSpec } from "./github/pr-spec";

function AppContent() {
  const renderer = useRenderer();

  const {
    cyclePane,
    sidebarVisible,
    toggleSidebar,
    activeModal,
    openModal,
    closeModal,
    activePaneTarget,
  } = useFocus();
  const keymap = useKeymap();
  const { state, refresh, togglePrDraft } = useGithub();
  const { showToast } = useToast();
  const theme = useTheme();

  // Surface background fetch/API failures (e.g. GitHub rate-limit throttling) as
  // an error toast. state.error is otherwise only visible as a red status dot and
  // a truncated footer line, which is easy to miss. Fire once per distinct
  // message so a persisting error during retry backoff doesn't re-toast on every
  // poll; a recovery (error -> null) re-arms it.
  let lastErrorToast: string | null = null;
  createEffect(() => {
    const err = state.error;
    if (err && err !== lastErrorToast) {
      showToast(err, 6000, "error");
    }
    lastErrorToast = err;
  });

  function copyPrLink() {
    if (!state.pr) {
      showToast("No PR loaded");
      return;
    }
    void copyToClipboard(state.pr.url).then((ok) =>
      showToast(
        ok ? "PR link copied" : "Could not copy link",
        2000,
        ok ? undefined : "error",
      ),
    );
  }

  function openLokiLogs() {
    if (!state.pr) {
      showToast("No PR loaded");
      return;
    }
    const url = lokiLogsUrl(state.pr.number);
    if (!url) {
      showToast("Set GHDASH_LOKI_URL to enable logs");
      return;
    }
    openUrl(url);
    showToast(`Opening logs for dev-${state.pr.number}`);
  }

  function mergePr() {
    if (canMerge(state.pr, state.mergeBlockers)) {
      openModal("mergeConfirm");
    } else {
      showToast("PR is not ready to merge");
    }
  }

  function toggleDraft() {
    if (!state.pr) {
      showToast("No PR loaded");
      return;
    }
    togglePrDraft().then(
      (isDraft) => {
        if (isDraft === undefined) return;
        showToast(isDraft ? "Converted to draft" : "Marked ready for review");
      },
      (err: unknown) =>
        showToast(
          err instanceof Error ? err.message : String(err),
          6000,
          "error",
        ),
    );
  }

  // App-level bindings, active while focus is anywhere in the pane layout (so
  // not while a modal holds focus).
  let layout: Renderable | undefined;
  useScope(
    "app",
    {
      [Commands.APP_QUIT]: () => {
        renderer.destroy();
        process.exit(0);
      },
      [Commands.SIDEBAR_TOGGLE]: toggleSidebar,
      [Commands.FOCUS_NEXT]: cyclePane,
      [Commands.FOCUS_PREV]: cyclePane,
      [Commands.PALETTE_OPEN]: () => openModal("palette"),
      [Commands.HELP_OPEN]: () => openModal("help"),
      [Commands.SECTION_PICKER_OPEN]: () => openModal("sectionPicker"),
      [Commands.OPEN_PR_LIST]: () => openModal("openPr"),
      [Commands.COPY_PR_LINK]: copyPrLink,
      [Commands.PR_REFRESH]: () => {
        refresh();
        showToast("Refreshing…", 1500);
      },
      [Commands.MERGE_PR]: mergePr,
      [Commands.TOGGLE_DRAFT]: toggleDraft,
      [Commands.OPEN_LOKI_LOGS]: openLokiLogs,
    },
    { target: () => layout },
  );

  // Run a palette pick through the keymap against the pane the palette was
  // opened from, so pane commands (open, edit, reply, ...) work too.
  function handlePaletteSelect(option: PaletteOption) {
    keymap.dispatchCommand(option.command, { focused: activePaneTarget() });
  }

  return (
    <box
      flexDirection="column"
      width="100%"
      height="100%"
      backgroundColor={theme.background}
    >
      {/* Main content: SectionTree (sidebar) + SectionView */}
      <box
        ref={(r: Renderable) => (layout = r)}
        flexDirection="row"
        flexGrow={1}
      >
        <Show when={sidebarVisible()}>
          <SectionTree />
        </Show>
        <SectionView />
      </box>

      {/* Command Palette overlay */}
      <Show when={activeModal() === "palette"}>
        <CommandPalette
          onClose={() => closeModal()}
          onSelect={handlePaletteSelect}
        />
      </Show>

      {/* Section Picker overlay */}
      <Show when={activeModal() === "sectionPicker"}>
        <SectionPicker onClose={() => closeModal()} />
      </Show>

      {/* Keyboard Help overlay */}
      <Show when={activeModal() === "help"}>
        <KeyboardHelp onClose={() => closeModal()} />
      </Show>

      {/* Merge confirmation overlay */}
      <Show when={activeModal() === "mergeConfirm"}>
        <MergeConfirmModal onClose={() => closeModal()} />
      </Show>

      {/* PR editing overlays */}
      <Show when={activeModal() === "editTitle"}>
        <PrEditModal field="title" onClose={() => closeModal()} />
      </Show>
      <Show when={activeModal() === "editBody"}>
        <PrEditModal field="body" onClose={() => closeModal()} />
      </Show>
      <Show when={activeModal() === "editLabels"}>
        <PrLabelsModal onClose={() => closeModal()} />
      </Show>

      {/* Open one of my PRs */}
      <Show when={activeModal() === "openPr"}>
        <PrOpenModal onClose={() => closeModal()} />
      </Show>

      {/* Review-thread reply fallback (when $EDITOR is unavailable) */}
      <Show when={activeModal() === "reply"}>
        <ReplyModal />
      </Show>

      {/* PR title + branch footer - only shown when sidebar is hidden */}
      <Show when={!sidebarVisible()}>
        <box flexShrink={0}>
          <ConnectionStatus />
        </box>
      </Show>
    </box>
  );
}

export interface AppProps {
  theme?: ThemeName;
  pollMs?: number;
  tokenOverride?: string;
  prSpec?: PRSpec;
}

export function App(props: AppProps) {
  return (
    <ThemeProvider name={props.theme}>
      <GithubProvider
        pollMs={props.pollMs}
        tokenOverride={props.tokenOverride}
        prSpec={props.prSpec}
      >
        <FocusProvider panes={["sections", "content"]}>
          <ToastProvider>
            <KeymapProvider keymap={keymap}>
              <HelpContextProvider>
                <ReplyProvider>
                  <AppContent />
                  <Toast />
                </ReplyProvider>
              </HelpContextProvider>
            </KeymapProvider>
          </ToastProvider>
        </FocusProvider>
      </GithubProvider>
    </ThemeProvider>
  );
}
