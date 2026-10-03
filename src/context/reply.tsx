// Reply-to-review-thread flow. Composes in $EDITOR when possible and falls back
// to the in-app ReplyModal. The target is captured when the reply starts so a
// poll reshuffling the feed can't retarget an in-progress reply.

import {
  createContext,
  createSignal,
  useContext,
  type Accessor,
  type ParentProps,
} from "solid-js";
import { useRenderer } from "@opentui/solid";
import { useGithub } from "./github";
import { useFocus } from "./focus";
import { useToast } from "./toast";
import { editInExternalEditor } from "@/utils/external-editor";
import { FeedItemKind, type FeedItem } from "@/github/types";

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

export function canReply(item: FeedItem | undefined): boolean {
  return item?.kind === FeedItemKind.ThreadComment && !!item.threadId;
}

function editorContext(item: FeedItem): string[] {
  const where = item.threadPath
    ? ` on ${item.threadPath}${item.threadLine != null ? `:${item.threadLine}` : ""}`
    : "";
  return [
    `Replying to @${item.author.login}${where}`,
    "",
    ...item.body.split("\n").map((l) => `> ${l}`),
  ];
}

export function ReplyProvider(props: ParentProps) {
  const renderer = useRenderer();
  const { replyToThread } = useGithub();
  const { openModal, closeModal } = useFocus();
  const { showToast } = useToast();

  const [target, setTarget] = createSignal<FeedItem | null>(null);
  const [draft, setDraft] = createSignal("");
  let editing = false;

  async function send(body: string) {
    const item = target();
    if (!item) return;
    await replyToThread(item, body);
    showToast("Reply posted");
  }

  async function startReply(item: FeedItem) {
    if (!canReply(item) || editing) return;
    setTarget(item);
    editing = true;
    try {
      const result = await editInExternalEditor(renderer, {
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
