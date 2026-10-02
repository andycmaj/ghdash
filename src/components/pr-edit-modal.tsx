// Edit modal for a PR's title (single-line input) or description (multi-line
// textarea). Save commits via the GitHub context (updatePrTitle/updatePrBody)
// and refreshes; esc cancels without writing.

import type { InputRenderable, TextareaRenderable } from "@opentui/core";
import { createEffect, createSignal, Show } from "solid-js";
import { useTheme } from "@/hooks/useTheme";
import { useGithub } from "../context/github";
import { useToast } from "../context/toast";
import { Modal } from "./modal/modal";
import { ModalHeader } from "./modal/modal-header";
import { ModalCommands } from "@andycmaj/opentui-app";

interface PrEditModalProps {
  field: "title" | "body";
  onClose: () => void;
}

export function PrEditModal(props: PrEditModalProps) {
  const theme = useTheme();
  const { state, updatePrTitle, updatePrBody } = useGithub();
  const { showToast } = useToast();

  const [error, setError] = createSignal<string | null>(null);
  const [saving, setSaving] = createSignal(false);

  const isTitle = props.field === "title";
  const initial = isTitle ? (state.pr?.title ?? "") : (state.pr?.body ?? "");

  let inputRef: InputRenderable | undefined;
  let textareaRef: TextareaRenderable | undefined;

  // Auto-focus the editor on mount (same workaround as ModalFilterInput).
  createEffect(() => {
    setTimeout(() => (isTitle ? inputRef : textareaRef)?.focus(), 10);
  });

  async function save() {
    if (saving()) return;
    setSaving(true);
    setError(null);
    try {
      if (isTitle) {
        const next = (inputRef?.value ?? initial).trim();
        if (!next) {
          setError("Title cannot be empty");
          return;
        }
        await updatePrTitle(next);
        showToast("Title updated");
      } else {
        const next = textareaRef?.plainText ?? initial;
        await updatePrBody(next);
        showToast("Description updated");
      }
      props.onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      size={isTitle ? "md" : "lg"}
      onClose={props.onClose}
      bindings={[
        // Title: enter saves. Description: enter is a newline, ctrl+s saves.
        {
          key: isTitle ? "return" : "ctrl+s",
          cmd: ModalCommands.MODAL_SELECT,
          desc: "save",
        },
      ]}
      commands={{ [ModalCommands.MODAL_SELECT]: () => void save() }}
    >
      <ModalHeader
        title={isTitle ? "Edit title" : "Edit description"}
        hint={isTitle ? "enter save · esc cancel" : "ctrl+s save · esc cancel"}
      />

      <box
        paddingLeft={2}
        paddingRight={2}
        paddingTop={1}
        paddingBottom={1}
        flexDirection="column"
      >
        <Show
          when={isTitle}
          fallback={
            <textarea
              ref={(r: TextareaRenderable) => (textareaRef = r)}
              initialValue={initial}
              height={14}
              focusedBackgroundColor={theme.background}
              cursorColor={theme.primary}
              focusedTextColor={theme.text}
            />
          }
        >
          <input
            ref={(r: InputRenderable) => (inputRef = r)}
            value={initial}
            onSubmit={() => save()}
            focusedBackgroundColor={theme.background}
            cursorColor={theme.primary}
            focusedTextColor={theme.text}
          />
        </Show>

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
