// Merge queue view: two stacked blocks. The queue itself, one row per entry
// with its merge-group run status, then the full Actions-style run card for
// this PR's merge-group commit. Rows share one flat cursor: queue entries
// first, then the run tree (offset by the entry count).

import { createMemo, For, Show } from "solid-js";
import { useGithub } from "@/context/github";
import { useTheme } from "@/hooks/useTheme";
import {
  checkStatusColor,
  checkStatusIcon,
  formatDuration,
  formatRelativeTime,
} from "@/theme/theme";
import { truncate } from "@/utils/truncate";
import { CheckStatus, type MergeQueueItem } from "@/github/types";
import { ActionsSection, type ActionsNode } from "./actions-section";
import { Marker, type SectionProps } from "./common";

export function mergeQueueStateLabel(state: string): string {
  return state.toLowerCase().replace(/_/g, " ");
}

export function MergeQueueSection(
  props: SectionProps & {
    nodes: () => ActionsNode[];
    showAnnotations: () => boolean;
  },
) {
  const { state } = useGithub();
  const theme = useTheme();

  const entry = () => state.pr?.mergeQueue;
  const offset = () => state.mergeQueueItems.length;

  const eta = createMemo(() => {
    const secs = entry()?.estimatedTimeToMerge;
    if (secs == null) return "";
    // Minute precision is all an estimate warrants.
    return `ETA ~${secs < 3600 ? `${Math.max(1, Math.round(secs / 60))}m` : formatDuration(secs * 1000)}`;
  });

  return (
    <Show
      when={entry()}
      fallback={<text fg={theme.textMuted}>Not in the merge queue.</text>}
    >
      <box flexDirection="row" gap={1} marginBottom={1}>
        <text fg={theme.info} attributes={1}>
          Queue → {state.pr!.baseRef}
        </text>
        <text fg={theme.textMuted}>
          {mergeQueueStateLabel(entry()!.state)}
          {entry()!.position != null ? ` · position ${entry()!.position}` : ""}
          {eta() ? ` · ${eta()}` : ""}
        </text>
      </box>

      <For each={state.mergeQueueItems}>
        {(item, index) => (
          <QueueRow
            item={item}
            width={props.width}
            id={props.idFor(index())}
            selected={props.selected() === index()}
          />
        )}
      </For>

      <box marginTop={1}>
        <text fg={theme.text} attributes={1}>
          This PR's merge-group run
        </text>
      </box>
      <ActionsSection
        width={props.width}
        selected={() => props.selected() - offset()}
        idFor={(i) => props.idFor(i + offset())}
        nodes={props.nodes}
        showAnnotations={props.showAnnotations}
        emptyText="Merge-group run hasn't started yet."
      />
    </Show>
  );
}

function QueueRow(props: {
  item: MergeQueueItem;
  width: number;
  id: string;
  selected: boolean;
}) {
  const theme = useTheme();
  const item = () => props.item;

  // Entries whose merge-group commit has no checks yet are waiting their turn.
  const status = () => item().checkStatus ?? CheckStatus.Pending;
  const meta = createMemo(() => {
    const parts = [mergeQueueStateLabel(item().state), item().author.login];
    if (item().enqueuedAt) parts.push(formatRelativeTime(item().enqueuedAt!));
    return parts.join(" · ");
  });
  // Leave room for marker, position, glyph, number, meta, and the "this PR" tag.
  const titleWidth = () =>
    Math.max(
      10,
      props.width -
        meta().length -
        `${item().number}`.length -
        (item().isCurrent ? 24 : 14),
    );

  return (
    <box id={props.id} flexDirection="row" justifyContent="space-between">
      <box flexDirection="row" gap={1}>
        <Marker selected={props.selected} />
        <text fg={theme.textMuted}>
          {item().position != null ? `${item().position}`.padStart(2) : " -"}
        </text>
        <text fg={checkStatusColor(theme, status())}>
          {item().checkStatus ? checkStatusIcon(status()) : "○"}
        </text>
        <text
          fg={item().isCurrent ? theme.primary : theme.text}
          attributes={item().isCurrent ? 1 : 0}
        >
          #{item().number} {truncate(item().title, titleWidth())}
        </text>
        <Show when={item().isCurrent}>
          <text fg={theme.primary}>← this PR</text>
        </Show>
      </box>
      <text fg={theme.textMuted}>{meta()}</text>
    </box>
  );
}
