// Edit modal for a PR's labels: a filterable, multi-select list of the repo's
// labels with the PR's current labels pre-checked. Enter toggles the row under
// the cursor, ctrl+s saves the whole set (a full replace), esc cancels.

import type { ScrollBoxRenderable } from "@opentui/core";
import { createMemo, createSignal, For, onMount, Show } from "solid-js";
import { createStore } from "solid-js/store";
import { useTheme } from "@/hooks/useTheme";
import { contrastingForeground } from "@/theme/color";
import { useListNavigation } from "@/hooks/useListNavigation";
import { useGithub } from "../context/github";
import { useToast } from "../context/toast";
import type { Label } from "@/github/types";
import { Modal } from "./modal/modal";
import { ModalHeader } from "./modal/modal-header";
import { ModalFilterInput } from "./modal/modal-filter-input";
import { ModalCommands, modalNavBindings } from "@andycmaj/opentui-app";

interface PrLabelsModalProps {
  onClose: () => void;
}

export function PrLabelsModal(props: PrLabelsModalProps) {
  const theme = useTheme();
  const { state, getRepoLabels, setPrLabels } = useGithub();
  const { showToast } = useToast();

  const [labels, setLabels] = createSignal<Label[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);
  const [saving, setSaving] = createSignal(false);
  // name → checked
  const [checked, setChecked] = createStore<Record<string, boolean>>({});

  let scrollRef: ScrollBoxRenderable | undefined;

  const nav = useListNavigation({
    itemCount: () => filtered().length,
    scrollRef: () => scrollRef,
  });

  onMount(async () => {
    try {
      const all = await getRepoLabels();
      setLabels(all);
      const init: Record<string, boolean> = {};
      for (const l of state.pr?.labels ?? []) init[l.name] = true;
      setChecked(init);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  });

  const filtered = createMemo(() => {
    const needle = nav.filter().toLowerCase();
    if (!needle) return labels();
    return labels().filter((l) => l.name.toLowerCase().includes(needle));
  });

  function toggle(name: string) {
    setChecked(name, (v) => !v);
  }

  async function save() {
    if (saving()) return;
    setSaving(true);
    setError(null);
    try {
      const chosen = labels().filter((l) => checked[l.name]);
      await setPrLabels(chosen);
      showToast("Labels updated");
      props.onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  const dotColor = (label: Label) =>
    /^[0-9a-fA-F]{6}$/.test(label.color)
      ? `#${label.color}`
      : (theme.accent ?? undefined);

  return (
    <Modal
      size="md"
      onClose={props.onClose}
      bindings={[
        ...modalNavBindings,
        { key: "ctrl+s", cmd: "labels.save", desc: "save" },
      ]}
      commands={{
        [ModalCommands.MODAL_UP]: () => nav.move(-1),
        [ModalCommands.MODAL_DOWN]: () => nav.move(1),
        [ModalCommands.MODAL_SELECT]: () => {
          const label = filtered()[nav.selected()];
          if (label) toggle(label.name);
        },
        "labels.save": () => void save(),
      }}
    >
      <ModalHeader
        title="Edit labels"
        hint="↑↓ move · enter toggle · ctrl+s save · esc"
      />

      <ModalFilterInput
        onInput={(v) => nav.setFilter(v)}
        placeholder="Filter labels..."
      />

      <Show
        when={!loading()}
        fallback={
          <box paddingLeft={2} paddingRight={2} paddingBottom={1}>
            <text fg={theme.textMuted}>Loading labels…</text>
          </box>
        }
      >
        <Show
          when={filtered().length > 0}
          fallback={
            <box paddingLeft={2} paddingRight={2} paddingBottom={1}>
              <text fg={theme.textMuted}>No labels found</text>
            </box>
          }
        >
          <scrollbox
            ref={(r: ScrollBoxRenderable) => (scrollRef = r)}
            maxHeight={16}
            paddingLeft={1}
            paddingRight={1}
            paddingBottom={1}
          >
            <For each={filtered()}>
              {(label, index) => {
                const isCursor = () => index() === nav.selected();
                const isChecked = () => !!checked[label.name];
                const fg = () =>
                  isCursor()
                    ? contrastingForeground(theme.primary)
                    : theme.text;
                return (
                  <box
                    flexDirection="row"
                    gap={1}
                    paddingLeft={1}
                    paddingRight={1}
                    backgroundColor={isCursor() ? theme.primary : undefined}
                  >
                    <text fg={fg()}>{isChecked() ? "[x]" : "[ ]"}</text>
                    <text fg={isCursor() ? fg() : dotColor(label)}>●</text>
                    <text fg={fg()}>{label.name}</text>
                  </box>
                );
              }}
            </For>
          </scrollbox>
        </Show>
      </Show>

      <Show when={error()}>
        <box paddingLeft={2} paddingRight={2} paddingBottom={1}>
          <text fg={theme.error} wrapMode="word">
            {error()}
          </text>
        </box>
      </Show>
    </Modal>
  );
}
