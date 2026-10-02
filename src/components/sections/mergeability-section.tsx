// Mergeability view: terminal merge/close states, merge-queue status, and the
// requirements checklist with a ready-to-merge hint.

import { createMemo, For, Match, Show, Switch } from "solid-js";
import { useGithub } from "@/context/github";
import { useTheme } from "@/hooks/useTheme";
import { formatRelativeTime } from "@/theme/theme";
import { wrapText } from "@/utils/wrap";
import { canMerge } from "@/github/status-utils";
import { PRStatus, type MergeBlocker } from "@/github/types";
import { Marker, type SectionProps } from "./common";
import { mergeQueueStateLabel } from "./merge-queue-section";

export function MergeabilitySection(props: SectionProps) {
  const { state } = useGithub();
  const theme = useTheme();

  const pr = () => state.pr;

  return (
    <Switch fallback={<text fg={theme.textMuted}>No PR loaded.</text>}>
      {/* Terminal states: the requirements checklist no longer applies. */}
      <Match when={pr()?.status === PRStatus.Merged}>
        <text fg={theme.accent} attributes={1}>
          ✓ Merged into {pr()!.baseRef}
        </text>
        <text fg={theme.textMuted}>{formatRelativeTime(pr()!.updatedAt)}</text>
      </Match>
      <Match when={pr()?.status === PRStatus.Closed}>
        <text fg={theme.error} attributes={1}>
          ✗ Closed without merging
        </text>
        <text fg={theme.textMuted}>{formatRelativeTime(pr()!.updatedAt)}</text>
      </Match>

      {/* Open (or draft): requirements, plus merge-queue status when queued. */}
      <Match when={pr()}>
        <Show when={pr()!.mergeQueue}>
          <box flexDirection="row" gap={1} marginBottom={1}>
            <text fg={theme.info} attributes={1}>
              ⏳ In merge queue
            </text>
            <text fg={theme.textMuted}>
              {mergeQueueStateLabel(pr()!.mergeQueue!.state)}
              {pr()!.mergeQueue!.position != null
                ? ` · position ${pr()!.mergeQueue!.position}`
                : ""}
            </text>
          </box>
        </Show>

        <Show
          when={state.mergeBlockers.length > 0}
          fallback={
            <text fg={theme.textMuted}>No merge requirements found.</text>
          }
        >
          <For each={state.mergeBlockers}>
            {(blocker, index) => (
              <BlockerRow
                blocker={blocker}
                width={props.width}
                id={props.idFor(index())}
                selected={props.selected() === index()}
              />
            )}
          </For>
        </Show>

        <Show when={canMerge(state.pr, state.mergeBlockers)}>
          <box paddingTop={1}>
            <text fg={theme.success} wrapMode="word">
              Ready to merge — press ":" and pick "Merge PR" to add to the merge
              queue.
            </text>
          </box>
        </Show>
      </Match>
    </Switch>
  );
}

function BlockerRow(props: {
  blocker: MergeBlocker;
  width: number;
  id: string;
  selected: boolean;
}) {
  const theme = useTheme();
  const blocker = props.blocker;
  const glyph = () => (blocker.satisfied ? "✓" : "✗");
  const color = () => (blocker.satisfied ? theme.success : theme.error);
  const lines = createMemo(() =>
    wrapText(blocker.description, props.width - 2),
  );

  return (
    <box id={props.id} flexDirection="row" gap={1}>
      <Marker selected={props.selected} />
      <text fg={color()}>{glyph()}</text>
      <box flexDirection="column">
        <For each={lines()}>
          {(line) => (
            <text fg={blocker.satisfied ? theme.textMuted : theme.text}>
              {line}
            </text>
          )}
        </For>
      </box>
    </box>
  );
}
