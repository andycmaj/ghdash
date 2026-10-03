// Picker for the current user's open PRs. Fetches `author:@me` PRs across the
// repos they can see, filters by number/title/repo, and on enter re-points the
// dashboard at the chosen PR (via openPr). Esc cancels.

import type { ScrollBoxRenderable } from "@opentui/core";
import { createMemo, createSignal, For, onMount, Show } from "solid-js";
import { useTheme } from "@/hooks/useTheme";
import { contrastingForeground } from "@/theme/color";
import { formatRelativeTime } from "@/theme/theme";
import { useListNavigation } from "@/hooks/useListNavigation";
import { useGithub } from "../context/github";
import { useToast } from "../context/toast";
import type { PrListItem } from "@/github/types";
import { truncate } from "../utils/truncate";
import { Modal } from "./modal/modal";
import { ModalHeader } from "./modal/modal-header";
import { ModalFilterInput } from "./modal/modal-filter-input";
import { ModalCommands, modalNavBindings } from "@andycmaj/opentui-app";

interface PrOpenModalProps {
  onClose: () => void;
}

export function PrOpenModal(props: PrOpenModalProps) {
  const theme = useTheme();
  const { state, listMyOpenPrs, openPr } = useGithub();
  const { showToast } = useToast();

  const [prs, setPrs] = createSignal<PrListItem[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);

  let scrollRef: ScrollBoxRenderable | undefined;

  const nav = useListNavigation({
    itemCount: () => filtered().length,
    scrollRef: () => scrollRef,
  });

  onMount(async () => {
    try {
      setPrs(await listMyOpenPrs());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  });

  const filtered = createMemo(() => {
    const needle = nav.filter().toLowerCase();
    if (!needle) return prs();
    return prs().filter(
      (p) =>
        p.title.toLowerCase().includes(needle) ||
        `${p.owner}/${p.repo}`.toLowerCase().includes(needle) ||
        String(p.number).includes(needle),
    );
  });

  // True when this row points at the PR the dashboard already shows.
  const isCurrent = (p: PrListItem) =>
    state.repo?.owner === p.owner &&
    state.repo?.repo === p.repo &&
    state.pr?.number === p.number;

  function open(item: PrListItem) {
    if (isCurrent(item)) {
      props.onClose();
      return;
    }
    openPr(item);
    showToast(`Opening ${item.owner}/${item.repo} #${item.number}`);
    props.onClose();
  }

  return (
    <Modal
      size="lg"
      onClose={props.onClose}
      bindings={modalNavBindings}
      commands={{
        [ModalCommands.MODAL_UP]: () => nav.move(-1),
        [ModalCommands.MODAL_DOWN]: () => nav.move(1),
        [ModalCommands.MODAL_SELECT]: () => {
          const pr = filtered()[nav.selected()];
          if (pr) open(pr);
        },
      }}
    >
      <ModalHeader title="My open PRs" hint="↑↓ move · enter open · esc" />

      <ModalFilterInput
        onInput={(v) => nav.setFilter(v)}
        placeholder="Filter by number, title, or repo…"
      />

      <Show
        when={!loading()}
        fallback={
          <box paddingLeft={2} paddingRight={2} paddingBottom={1}>
            <text fg={theme.textMuted}>Loading your PRs…</text>
          </box>
        }
      >
        <Show
          when={filtered().length > 0}
          fallback={
            <box paddingLeft={2} paddingRight={2} paddingBottom={1}>
              <text fg={theme.textMuted}>
                {prs().length === 0 ? "No open PRs found" : "No matches"}
              </text>
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
              {(pr, index) => {
                const isCursor = () => index() === nav.selected();
                const fg = () =>
                  isCursor()
                    ? contrastingForeground(theme.primary)
                    : theme.text;
                const mutedFg = () =>
                  isCursor()
                    ? contrastingForeground(theme.primary)
                    : theme.textMuted;
                return (
                  <box
                    flexDirection="row"
                    gap={1}
                    paddingLeft={1}
                    paddingRight={1}
                    justifyContent="space-between"
                    backgroundColor={isCursor() ? theme.primary : undefined}
                  >
                    <box flexDirection="row" gap={1} flexShrink={1}>
                      <text fg={mutedFg()}>#{pr.number}</text>
                      <Show when={pr.isDraft}>
                        <text fg={mutedFg()}>[draft]</text>
                      </Show>
                      <text fg={fg()}>{truncate(pr.title, 60)}</text>
                      <Show when={isCurrent(pr)}>
                        <text fg={mutedFg()}>(current)</text>
                      </Show>
                    </box>
                    <box flexDirection="row" gap={1} flexShrink={0}>
                      <text fg={mutedFg()}>
                        {pr.owner}/{pr.repo}
                      </text>
                      <Show when={pr.updatedAt}>
                        <text fg={mutedFg()}>
                          · {formatRelativeTime(pr.updatedAt)}
                        </text>
                      </Show>
                    </box>
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
