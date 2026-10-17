import { expect, test } from "bun:test";
import { FeedItemKind, type FeedItem } from "@/github/types";
import {
  buildFeedNodes,
  collapseBody,
  COLLAPSED_LINES,
  FeedFilter,
  nextFeedFilter,
} from "./feed-model";

const human = { login: "octocat", isBot: false };
const bot = { login: "ci-bot", isBot: true };

function item(over: Partial<FeedItem> & { id: string }): FeedItem {
  return {
    kind: FeedItemKind.Comment,
    author: human,
    body: "hi",
    createdAt: "2026-01-01T00:00:00Z",
    url: `https://github.com/o/r/pull/1#${over.id}`,
    ...over,
  };
}

const thread = (id: string, threadId: string, over: Partial<FeedItem> = {}) =>
  item({
    id,
    kind: FeedItemKind.ThreadComment,
    threadId,
    threadPath: "a.ts",
    threadResolved: false,
    ...over,
  });

const none = () => undefined;
const ids = (nodes: { item: FeedItem }[]) => nodes.map((n) => n.item.id);

test("groups thread replies under their root, at the root's position", () => {
  const feed = [
    thread("t1", "th"),
    item({ id: "c1" }),
    thread("t2", "th", { isReply: true }),
  ];
  const nodes = buildFeedNodes(feed, FeedFilter.All, 80, none);
  expect(ids(nodes)).toEqual(["t1", "t2", "c1"]);
  expect(nodes.map((n) => n.depth)).toEqual([0, 1, 0]);
  expect(nodes[0].replyCount).toBe(1);
});

test("resolved threads start collapsed; override expands them", () => {
  const feed = [
    thread("t1", "th", { threadResolved: true }),
    thread("t2", "th", { threadResolved: true, isReply: true }),
  ];
  const folded = buildFeedNodes(feed, FeedFilter.All, 80, none);
  expect(ids(folded)).toEqual(["t1"]);
  expect(folded[0].collapsed).toBe(true);

  const open = buildFeedNodes(feed, FeedFilter.All, 80, (id) =>
    id === "t1" ? false : undefined,
  );
  expect(ids(open)).toEqual(["t1", "t2"]);
});

test("filters by author type and review activity", () => {
  const feed = [
    item({ id: "h" }),
    item({ id: "b", author: bot }),
    item({ id: "r", kind: FeedItemKind.Review, reviewState: "APPROVED" }),
    thread("t", "th"),
  ];
  expect(ids(buildFeedNodes(feed, FeedFilter.Humans, 80, none))).toEqual([
    "h",
    "r",
    "t",
  ]);
  expect(ids(buildFeedNodes(feed, FeedFilter.Bots, 80, none))).toEqual(["b"]);
  expect(ids(buildFeedNodes(feed, FeedFilter.Reviews, 80, none))).toEqual([
    "r",
    "t",
  ]);
});

test("long bodies collapse by default", () => {
  const long = Array.from({ length: 30 }, (_, i) => `line ${i}`).join("\n");
  const [node] = buildFeedNodes(
    [item({ id: "c", body: long })],
    FeedFilter.All,
    80,
    none,
  );
  expect(node.collapsible).toBe(true);
  expect(node.collapsed).toBe(true);
});

test("collapseBody keeps whole lines and closes an open fence", () => {
  const body = ["intro", "```ts", ...Array(20).fill("code();"), "```"].join(
    "\n",
  );
  const { text, hiddenLines } = collapseBody(body, 80);
  const lines = text.split("\n");
  expect(lines.length).toBe(COLLAPSED_LINES + 1);
  expect(lines.at(-1)).toBe("```");
  expect(hiddenLines).toBe(23 - COLLAPSED_LINES);
});

test("filter cycles through every option", () => {
  expect(nextFeedFilter(FeedFilter.All)).toBe(FeedFilter.Humans);
  expect(nextFeedFilter(FeedFilter.Reviews)).toBe(FeedFilter.All);
});
