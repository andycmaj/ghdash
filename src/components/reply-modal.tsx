// Fallback reply composer for when $EDITOR is unavailable: a textarea modal.
// ctrl+s sends the reply to the review thread; esc cancels.

import type { TextareaRenderable } from "@opentui/core";
import { createEffect, createSignal, Show } from "solid-js";
import { useTheme } from "@/hooks/useTheme";
import { useReply } from "../context/reply";
import { Modal } from "./modal/modal";
import { ModalHeader } from "./modal/modal-header";
import { truncate } from "../utils/truncate";
import { ModalCommands } from "@andycmaj/opentui-app";

export function ReplyModal() {
  const theme = useTheme();
  const { target, draft, send, close } = useReply();

  const [error, setError] = createSignal<string | null>(null);
  const [saving, setSaving] = createSignal(false);

  let textareaRef: TextareaRenderable | undefined;

  // Auto-focus the editor on mount (same workaround as ModalFilterInput).
  createEffect(() => {
    setTimeout(() => textareaRef?.focus(), 10);
  });

  async function save() {
    if (saving()) return;
    const body = (textareaRef?.plainText ?? "").trim();
    if (!body) {
      setError("Reply cannot be empty");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await send(body);
      close();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  const quoted = () => {
    const item = target();
    if (!item) return "";
    return truncate(item.body.replace(/\s+/g, " ").trim(), 200);
  };

  return (
    <Modal
      size="lg"
      onClose={close}
      bindings={[
        { key: "ctrl+s", cmd: ModalCommands.MODAL_SELECT, desc: "send" },
      ]}
      commands={{ [ModalCommands.MODAL_SELECT]: () => void save() }}
    >
      <ModalHeader
        title={`Reply to @${target()?.author.login ?? ""}`}
        hint={saving() ? "sending…" : "ctrl+s send · esc cancel"}
      />

      <box
        paddingLeft={2}
        paddingRight={2}
        paddingTop={1}
        paddingBottom={1}
        flexDirection="column"
      >
        <Show when={target()?.threadPath}>
          <text fg={theme.textMuted}>{target()?.threadPath}</text>
        </Show>
        <box paddingBottom={1}>
          <text fg={theme.textMuted} wrapMode="word">
            {`> ${quoted()}`}
          </text>
        </box>

        <textarea
          ref={(r: TextareaRenderable) => (textareaRef = r)}
          initialValue={draft()}
          height={12}
          focusedBackgroundColor={theme.background}
          cursorColor={theme.primary}
          focusedTextColor={theme.text}
        />

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
