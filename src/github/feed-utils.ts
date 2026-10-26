import { FeedItemKind, type FeedItem } from "./types";

// Lines of the original kept when quoting a top-level comment or review.
const QUOTE_LINES = 8;

// Review-thread comments are answered in their thread. Top-level comments and
// reviews have no reply thread on GitHub, so they get a quote-reply: a new PR
// comment that quotes the original.
export function canReply(item: FeedItem | undefined): boolean {
  if (!item) return false;
  if (item.kind === FeedItemKind.ThreadComment) return !!item.threadId;
  return true;
}

export function canResolve(item: FeedItem | undefined): item is FeedItem {
  return item?.kind === FeedItemKind.ThreadComment && !!item.threadId;
}

export function isThreadReply(item: FeedItem): boolean {
  return item.kind === FeedItemKind.ThreadComment && !!item.threadId;
}

export function quoteReplyBody(item: FeedItem, reply: string): string {
  const lines = item.body.trim().split("\n");
  const quoted = lines.slice(0, QUOTE_LINES).map((l) => `> ${l}`.trimEnd());
  if (lines.length > QUOTE_LINES)
    quoted.push(`> … ([full comment](${item.url}))`);
  const header = `@${item.author.login} wrote:`;
  const quote = item.body.trim() ? [header, ...quoted] : [`Re: ${item.url}`];
  return [...quote, "", reply].join("\n");
}
