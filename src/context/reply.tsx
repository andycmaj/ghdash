// Reply flow for feed items: review-thread comments are answered in-thread,
// top-level comments and reviews get a quote-reply PR comment. Composes in
// $EDITOR in the embedded terminal when possible and falls back to the in-app
// ReplyModal. The target is captured when the reply starts so a
// poll reshuffling the feed can't retarget an in-progress reply.

import {
  createContext,
  createSignal,
  useContext,
  type Accessor,
  type ParentProps,
} from "solid-js";
import { useGithub } from "./github";
import { useFocus } from "./focus";
import { useToast } from "./toast";
import { useTerminal } from "./terminal";
import { editInTerminal } from "@/utils/external-editor";
import type { FeedItem } from "@/github/types";
import { canReply, isThreadReply, quoteReplyBody } from "@/github/feed-utils";

export { canReply };

interface ReplyContextValue {
  target: Accessor<FeedItem | null>;
  // Initial textarea contents for the fallback modal.
  draft: Accessor<string>;
  startReply: (item: FeedItem) => Promise<void>;
  // Posts the reply; throws so the caller can show the error in place.
  send: (body: string) => Promise<void>;
  close: () => void;
}

const ReplyContext = createContext<ReplyContextValue>();

function editorContext(item: FeedItem): string[] {
  const where = item.threadPath
    ? ` on ${item.threadPath}${item.threadLine != null ? `:${item.threadLine}` : ""}`
    : "";
  const how = isThreadReply(item)
    ? "in the review thread"
    : "as a new PR comment quoting the original";
  return [
    `Replying to @${item.author.login}${where} ${how}`,
    "",
    ...item.body.split("\n").map((l) => `> ${l}`),
  ];
}

export function ReplyProvider(props: ParentProps) {
  const terminal = useTerminal();
  const { replyToThread, addPrComment } = useGithub();
  const { openModal, closeModal } = useFocus();
  const { showToast } = useToast();

  const [target, setTarget] = createSignal<FeedItem | null>(null);
  const [draft, setDraft] = createSignal("");
  let editing = false;

  async function send(body: string) {
    const item = target();
    if (!item) return;
    if (isThreadReply(item)) await replyToThread(item, body);
    else await addPrComment(quoteReplyBody(item, body));
    showToast("Reply posted");
  }

  async function startReply(item: FeedItem) {
    if (!canReply(item) || editing) return;
    setTarget(item);
    editing = true;
    try {
      const result = await editInTerminal(terminal.open, {
        context: editorContext(item),
        title: `Reply to @${item.author.login}`,
      });
      if (result.kind === "cancelled") {
        showToast("Reply cancelled", 1500);
        setTarget(null);
      } else if (result.kind === "unavailable") {
        setDraft("");
        openModal("reply");
      } else {
        try {
          await send(result.text);
          setTarget(null);
        } catch (err) {
          // Keep the composed text: reopen it in the modal so it can be retried.
          showToast(errorMessage(err), 6000, "error");
          setDraft(result.text);
          openModal("reply");
        }
      }
    } catch (err) {
      showToast(errorMessage(err), 6000, "error");
      setDraft("");
      openModal("reply");
    } finally {
      editing = false;
    }
  }

  function close() {
    setTarget(null);
    closeModal();
  }

  return (
    <ReplyContext.Provider value={{ target, draft, startReply, send, close }}>
      {props.children}
    </ReplyContext.Provider>
  );
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function useReply(): ReplyContextValue {
  const value = useContext(ReplyContext);
  if (!value) throw new Error("useReply must be used within a ReplyProvider");
  return value;
}
