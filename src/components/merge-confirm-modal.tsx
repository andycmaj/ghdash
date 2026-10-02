// Confirmation overlay for adding the current PR to the merge queue. Enqueuing
// kicks off a merge to the base branch, so it always requires an explicit
// confirm.

import { createSignal, Show } from "solid-js";
import { TextAttributes } from "@opentui/core";
import { useTheme } from "@/hooks/useTheme";
import { useGithub } from "../context/github";
import { useToast } from "../context/toast";
import { Modal } from "./modal/modal";
import { ModalHeader } from "./modal/modal-header";
import { ModalCommands } from "@andycmaj/opentui-app";

interface MergeConfirmModalProps {
  onClose: () => void;
}

export function MergeConfirmModal(props: MergeConfirmModalProps) {
  const theme = useTheme();
  const { state, merging, enqueuePr } = useGithub();
  const { showToast } = useToast();

  const [error, setError] = createSignal<string | null>(null);

  async function confirm() {
    if (merging()) return;
    setError(null);
    try {
      await enqueuePr();
      showToast("Added to merge queue");
      props.onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <Modal
      size="md"
      onClose={props.onClose}
      bindings={[
        { key: "return", cmd: ModalCommands.MODAL_SELECT, desc: "confirm" },
        { key: "y", cmd: ModalCommands.MODAL_SELECT, desc: "confirm" },
      ]}
      commands={{ [ModalCommands.MODAL_SELECT]: () => void confirm() }}
    >
      <ModalHeader
        title="Add to merge queue"
        hint="enter/y confirm · esc cancel"
      />

      <box
        flexDirection="column"
        paddingLeft={2}
        paddingRight={2}
        paddingBottom={1}
      >
        <Show when={state.pr}>
          <text fg={theme.text}>
            #{state.pr!.number} {state.pr!.title}
          </text>
          <text fg={theme.textMuted}>
            {state.pr!.headRef} → {state.pr!.baseRef}
          </text>
        </Show>

        <box paddingTop={1}>
          <Show
            when={!merging()}
            fallback={<text fg={theme.warning}>Adding to merge queue…</text>}
          >
            <text fg={theme.success} attributes={TextAttributes.BOLD}>
              Add to merge queue? (enter/y)
            </text>
          </Show>
        </box>

        <Show when={error()}>
          <box paddingTop={1}>
            <text fg={theme.error} wrapMode="word">
              {error()}
            </text>
          </box>
        </Show>
      </box>
    </Modal>
  );
}
