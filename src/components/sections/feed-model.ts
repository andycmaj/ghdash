// Feed view-model: turns the flat, time-sorted feed into the navigable rows the
// Feed section renders. Review threads are grouped (root, then indented
// replies) at the root's position in the timeline, the active filter is
// applied per top-level entry, and each row carries its collapse state.

import { wrapText } from "@/utils/wrap";
import { FeedItemKind, type FeedItem } from "@/github/types";

export const FeedFilter = {
  All: "all",
  Humans: "humans",
  Bots: "bots",
  Reviews: "reviews",
} as const;
export type FeedFilter = (typeof FeedFilter)[keyof typeof FeedFilter];

export const FEED_FILTERS: FeedFilter[] = [
  FeedFilter.All,
  FeedFilter.Humans,
  FeedFilter.Bots,
  FeedFilter.Reviews,
];

export function nextFeedFilter(current: FeedFilter): FeedFilter {
  return FEED_FILTERS[
    (FEED_FILTERS.indexOf(current) + 1) % FEED_FILTERS.length
  ];
}

// Rendered lines a body may take before it collapses by default.
export const COLLAPSED_LINES = 12;

export interface FeedNode {
  item: FeedItem;
  depth: number;
  // Thread roots only: replies beneath it (shown or hidden).
  replyCount: number;
  collapsible: boolean;
  collapsed: boolean;
}

// One top-level timeline entry: a standalone item, or a whole review thread.
interface FeedEntry {
  root: FeedItem;
  replies: FeedItem[];
}

function groupEntries(feed: FeedItem[]): FeedEntry[] {
  const entries: FeedEntry[] = [];
  const threads = new Map<string, FeedEntry>();
  for (const item of feed) {
    if (item.kind === FeedItemKind.ThreadComment && item.threadId) {
      const thread = threads.get(item.threadId);
      if (thread) {
        thread.replies.push(item);
        continue;
      }
      const entry = { root: item, replies: [] };
      threads.set(item.threadId, entry);
      entries.push(entry);
      continue;
    }
    entries.push({ root: item, replies: [] });
  }
  return entries;
}

function matchesFilter(entry: FeedEntry, filter: FeedFilter): boolean {
  switch (filter) {
    case FeedFilter.Humans:
      return !entry.root.author.isBot;
    case FeedFilter.Bots:
      return entry.root.author.isBot;
    case FeedFilter.Reviews:
      return entry.root.kind !== FeedItemKind.Comment;
    default:
      return true;
  }
}

export function isLongBody(body: string, width: number): boolean {
  return wrapText(body.trim(), width).length > COLLAPSED_LINES;
}

// The leading slice of a markdown body that fits in COLLAPSED_LINES rendered
// lines. Cuts on source-line boundaries and closes a code fence left open so
// the rest of the card doesn't render as code.
export function collapseBody(
  body: string,
  width: number,
): { text: string; hiddenLines: number } {
  const source = body.trim().split("\n");
  const kept: string[] = [];
  let used = 0;
  for (const line of source) {
    const rows = wrapText(line, width).length;
    if (used + rows > COLLAPSED_LINES) break;
    kept.push(line);
    used += rows;
  }
  const total = wrapText(body.trim(), width).length;
  const fences = kept.filter((l) => l.trimStart().startsWith("```")).length;
  if (fences % 2 === 1) kept.push("```");
  return { text: kept.join("\n"), hiddenLines: Math.max(0, total - used) };
}

export function buildFeedNodes(
  feed: FeedItem[],
  filter: FeedFilter,
  bodyWidth: number,
  // Explicit expand/collapse override for an item id, if the user toggled it.
  override: (id: string) => boolean | undefined,
): FeedNode[] {
  const nodes: FeedNode[] = [];
  for (const entry of groupEntries(feed)) {
    if (!matchesFilter(entry, filter)) continue;
    const { root, replies } = entry;
    const rootLong = isLongBody(root.body, bodyWidth);
    // A thread root also hides its replies when collapsed; resolved threads
    // start folded away, open ones stay visible.
    const isThread = root.kind === FeedItemKind.ThreadComment;
    const defaultCollapsed = isThread
      ? !!root.threadResolved && (replies.length > 0 || rootLong)
      : rootLong;
    const collapsible = rootLong || replies.length > 0;
    const collapsed = collapsible && (override(root.id) ?? defaultCollapsed);
    nodes.push({
      item: root,
      depth: 0,
      replyCount: replies.length,
      collapsible,
      collapsed,
    });
    if (collapsed) continue;
    for (const reply of replies) {
      const long = isLongBody(reply.body, bodyWidth - 4);
      nodes.push({
        item: reply,
        depth: 1,
        replyCount: 0,
        collapsible: long,
        collapsed: long && (override(reply.id) ?? true),
      });
    }
  }
  return nodes;
}
