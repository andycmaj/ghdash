// Feed view: a card per comment / review event in the PR conversation, with
// review-thread replies indented under their root. Rows come pre-built from
// feed-model so navigation and rendering agree on what is visible.

import { For, Show } from "solid-js";
import { useGithub } from "@/context/github";
import { useTheme } from "@/hooks/useTheme";
import { formatRelativeTime } from "@/theme/theme";
import { Card } from "@/components/card";
import { Markdown } from "@/components/markdown/markdown";
import { FeedItemKind, type FeedItem } from "@/github/types";
import type { SectionProps } from "./common";
import { collapseBody, FeedFilter, type FeedNode } from "./feed-model";

export function FeedSection(
  props: SectionProps & { nodes: () => FeedNode[]; filter: () => FeedFilter },
) {
  const { state } = useGithub();
  const theme = useTheme();

  const emptyText = () =>
    state.feed.length === 0
      ? "No comments or reviews yet."
      : `Nothing matches the "${props.filter()}" filter (f to change).`;

  return (
    <Show
      when={props.nodes().length > 0}
      fallback={<text fg={theme.textMuted}>{emptyText()}</text>}
    >
      <For each={props.nodes()}>
        {(node, index) => (
          <FeedRow
            node={node}
            width={props.width}
            id={props.idFor(index())}
            selected={props.selected() === index()}
          />
        )}
      </For>
    </Show>
  );
}

export function feedFilterLabel(filter: FeedFilter): string | null {
  return filter === FeedFilter.All ? null : filter;
}

function reviewStateLabel(item: FeedItem): { text: string; color: string } {
  const theme = useTheme();
  switch (item.reviewState) {
    case "APPROVED":
      return { text: "approved", color: theme.success ?? "" };
    case "CHANGES_REQUESTED":
      return { text: "requested changes", color: theme.error ?? "" };
    case "DISMISSED":
      return { text: "dismissed", color: theme.textMuted ?? "" };
    default:
      return { text: "commented", color: theme.info ?? "" };
  }
}

function FeedRow(props: {
  node: FeedNode;
  width: number;
  id: string;
  selected: boolean;
}) {
  const theme = useTheme();
  const item = props.node.item;
  const isReply = props.node.depth > 0;

  const kindGlyph = () => {
    if (item.kind === FeedItemKind.Review) return "★";
    if (item.kind === FeedItemKind.ThreadComment)
      return item.isReply ? "↳" : "◆";
    return item.author.isBot ? "⚙" : "▪";
  };

  const isThread = item.kind === FeedItemKind.ThreadComment;

  // Card border tint: review state (approved green / changes red), or an
  // unresolved review thread (warning) so open threads stand out.
  const accent = () => {
    if (item.kind === FeedItemKind.Review) {
      if (item.reviewState === "APPROVED") return theme.success;
      if (item.reviewState === "CHANGES_REQUESTED") return theme.error;
      return undefined;
    }
    if (isThread && !item.threadResolved) return theme.warning;
    return undefined;
  };

  // Resolved/unresolved status for a review-thread comment.
  const threadStatus = () =>
    item.threadResolved
      ? { text: "✓ resolved", color: theme.success ?? "" }
      : { text: "○ unresolved", color: theme.warning ?? "" };

  const header = (
    <>
      <text fg={theme.accent}>{kindGlyph()} </text>
      <text fg={theme.primary} attributes={1}>
        {item.author.login}
      </text>
      <Show when={item.kind === FeedItemKind.Review}>
        <text fg={reviewStateLabel(item).color}>
          {" "}
          {reviewStateLabel(item).text}
        </text>
      </Show>
      <Show when={isThread && !isReply && item.threadPath}>
        <text fg={theme.textMuted}> {item.threadPath}</text>
      </Show>
      <Show when={isThread && !isReply}>
        <text fg={threadStatus().color}> {threadStatus().text}</text>
      </Show>
      <text fg={theme.textMuted}> · {formatRelativeTime(item.createdAt)}</text>
    </>
  );

  // Card border + padding (~4 columns) plus the reply indent.
  const indent = () => props.node.depth * 4;
  const bodyWidth = () => Math.max(10, props.width - 4 - indent());

  const collapsed = () =>
    props.node.collapsed ? collapseBody(item.body, bodyWidth()) : null;
  const visibleBody = () => collapsed()?.text ?? item.body;

  // What a collapsed card is hiding, e.g. "▸ 3 replies · 20 more lines".
  const foldHint = () => {
    if (!props.node.collapsed) return null;
    const parts: string[] = [];
    const replies = props.node.replyCount;
    if (replies > 0)
      parts.push(`${replies} ${replies === 1 ? "reply" : "replies"}`);
    const hidden = collapsed()?.hiddenLines ?? 0;
    if (hidden > 0) parts.push(`${hidden} more lines`);
    return parts.length ? `▸ ${parts.join(" · ")}` : null;
  };

  return (
    <box paddingLeft={indent()}>
      <Card
        id={props.id}
        selected={props.selected}
        accent={accent()}
        header={header}
      >
        <Show
          when={item.body.trim()}
          fallback={<text fg={theme.textMuted}>(no description)</text>}
        >
          <Markdown text={visibleBody()} width={bodyWidth()} />
        </Show>
        <Show when={foldHint()}>
          <text fg={theme.textMuted}>
            {foldHint()}
            {props.selected ? " (enter to expand)" : ""}
          </text>
        </Show>
      </Card>
    </box>
  );
}
