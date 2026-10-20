// Content pane: renders the selected section (Feed / Actions / Mergeability)
// with a per-item cursor so `o` can open the focused item's URL. The section
// bodies live in ./sections/*; this file owns navigation, scrolling, and keys.

import {
  createMemo,
  createEffect,
  createSignal,
  on,
  onCleanup,
  Match,
  Switch,
} from "solid-js";
import { createStore } from "solid-js/store";
import type { ScrollBoxRenderable } from "@opentui/core";
import { useTerminalDimensions } from "@opentui/solid";
import { useGithub } from "../context/github";
import { useKeymap, usePane } from "@andycmaj/opentui-app";
import { useFocus } from "../context/focus";
import { useToast } from "../context/toast";
import { canReply, useReply } from "../context/reply";
import { useDescriptionEdit } from "../context/description-edit";
import {
  useHelpContext,
  type InfoCard,
  type SelectedItem,
} from "../context/help-context";
import { useScope } from "../keyboard/keymap-utils";
import { Commands } from "../commands";
import { focusBorder } from "../theme/theme";
import { useTheme } from "@/hooks/useTheme";
import { PaneHeader } from "./pane-header";
import { MainFooter } from "./main-footer";
import { openUrl } from "@/utils/open-url";
import { SectionKey } from "@/github/types";
import { PrInfo } from "./pr-info";
import { FeedSection, feedFilterLabel } from "./sections/feed-section";
import {
  buildFeedNodes,
  FeedFilter,
  nextFeedFilter,
  type FeedNode,
} from "./sections/feed-model";
import { copyToClipboard } from "@/utils/copy-to-clipboard";
import { useJobLogs } from "@/hooks/useJobLogs";
import {
  ActionsSection,
  buildActionsNodes,
  type ActionsNode,
} from "./sections/actions-section";
import { MergeabilitySection } from "./sections/mergeability-section";
import { MergeQueueSection } from "./sections/merge-queue-section";

const SIDEBAR_WIDTH = 44;

const nodeUrl = (n: ActionsNode): string | undefined =>
  n.kind === "workflow" ? n.group.url : n.check.url;

const INFO_CARDS: InfoCard[] = ["title", "branch", "body", "labels", "status"];

export function SectionView() {
  const { state } = useGithub();
  const keymap = useKeymap();
  const { openModal } = useFocus();
  const pane = usePane("content");
  const { showToast } = useToast();
  const { setSelectedItem } = useHelpContext();
  const { startReply } = useReply();
  const { startEdit: editDescription } = useDescriptionEdit();
  const openJobLogs = useJobLogs();
  const theme = useTheme();
  const dimensions = useTerminalDimensions();

  let scrollRef: ScrollBoxRenderable | undefined;

  const isFocused = pane.isFocused;

  const [cursor, setCursor] = createSignal(0);

  // Per-workflow expand/collapse overrides for the Actions tree. Absent an
  // explicit toggle, a workflow follows its status-derived default: expanded
  // while failing or in progress, collapsed once complete and successful.
  const [expanded, setExpanded] = createStore<Record<string, boolean>>({});
  const isExpanded = (key: string, defaultOpen: boolean) =>
    expanded[key] ?? defaultOpen;

  // Feed filter (cycled by `f`) and per-card expand/collapse overrides; absent
  // an override a card follows its default (see buildFeedNodes).
  const [feedFilter, setFeedFilter] = createSignal<FeedFilter>(FeedFilter.All);
  const [feedExpanded, setFeedExpanded] = createStore<Record<string, boolean>>(
    {},
  );

  // Whether job annotations are rendered under the Actions tree (toggled by `a`).
  const [showAnnotations, setShowAnnotations] = createSignal(true);

  // Usable text width inside the content pane (minus sidebar, borders, padding).
  const bodyWidth = createMemo(() => {
    const w = dimensions().width - SIDEBAR_WIDTH - 8;
    return Math.max(20, w);
  });

  const viewportHeight = createMemo(() => scrollRef?.viewport.height ?? 20);

  // Visible feed rows: threads grouped, filter applied, folded cards honoured.
  // Overrides are stored as "collapsed?" so a missing key means "default".
  const feedNodes = createMemo<FeedNode[]>(() =>
    buildFeedNodes(state.feed, feedFilter(), bodyWidth() - 4, (id) => {
      const v = feedExpanded[id];
      return v === undefined ? undefined : !v;
    }),
  );

  // Flattened Actions tree: workflow rows, each followed by its jobs when open.
  const actionsNodes = createMemo<ActionsNode[]>(() =>
    buildActionsNodes(state.checks, isExpanded),
  );

  // The merge-group run reuses the Actions tree. Its workflow names collide
  // with the PR's own run, so expand overrides live under a separate prefix.
  const mqKey = (key: string) => `mq:${key}`;
  const mergeQueueNodes = createMemo<ActionsNode[]>(() =>
    buildActionsNodes(state.mergeQueueChecks, (key, defaultOpen) =>
      isExpanded(mqKey(key), defaultOpen),
    ),
  );

  // The tree nodes navigable in the current section, after any leading rows.
  const treeNodes = (): ActionsNode[] => {
    switch (state.selectedSection) {
      case SectionKey.Actions:
        return actionsNodes();
      case SectionKey.MergeQueue:
        return mergeQueueNodes();
      default:
        return [];
    }
  };
  const treeOffset = () =>
    state.selectedSection === SectionKey.MergeQueue
      ? state.mergeQueueItems.length
      : 0;
  const expandKey = (key: string) =>
    state.selectedSection === SectionKey.MergeQueue ? mqKey(key) : key;

  // URL for each navigable item in the active section (undefined → PR url).
  const itemUrls = createMemo<(string | undefined)[]>(() => {
    switch (state.selectedSection) {
      case SectionKey.Info:
        // One entry per card; `o` opens the PR itself.
        return state.pr ? INFO_CARDS.map(() => undefined) : [];
      case SectionKey.Feed:
        return feedNodes().map((n) => n.item.url);
      case SectionKey.Actions:
        return actionsNodes().map(nodeUrl);
      case SectionKey.MergeQueue:
        return [
          ...state.mergeQueueItems.map((i) => i.url),
          ...mergeQueueNodes().map(nodeUrl),
        ];
      case SectionKey.Mergeability:
        return state.mergeBlockers.map(() => undefined);
      default:
        return [];
    }
  });

  const itemCount = createMemo(() => itemUrls().length);

  // Reset the cursor to the top whenever the section changes.
  createEffect(
    on(
      () => state.selectedSection,
      () => setCursor(0),
    ),
  );

  // Keep the cursor within bounds as the underlying list changes (polling).
  createEffect(
    on(itemCount, (count) => {
      if (cursor() > count - 1) setCursor(Math.max(0, count - 1));
    }),
  );

  // The item under the cursor, published so the footer/help can show only the
  // bindings that apply to it.
  const selectedItem = createMemo<SelectedItem | null>(() => {
    const index = cursor();
    switch (state.selectedSection) {
      case SectionKey.Info: {
        const card = INFO_CARDS[index];
        return state.pr && card ? { kind: "infoCard", card } : null;
      }
      case SectionKey.Feed: {
        const node = feedNodes()[index];
        return node
          ? { kind: "feedItem", item: node.item, collapsible: node.collapsible }
          : null;
      }
      case SectionKey.MergeQueue:
      case SectionKey.Actions: {
        const queued = state.mergeQueueItems[index];
        if (state.selectedSection === SectionKey.MergeQueue && queued)
          return { kind: "queueEntry", item: queued };
        const node = treeNodes()[index - treeOffset()];
        if (!node) return null;
        return node.kind === "workflow"
          ? { kind: "workflow", group: node.group, expanded: node.expanded }
          : { kind: "job", check: node.check };
      }
      case SectionKey.Mergeability: {
        const blocker = state.mergeBlockers[index];
        return blocker ? { kind: "blocker", blocker } : null;
      }
      default:
        return null;
    }
  });
  createEffect(() => setSelectedItem(selectedItem()));
  onCleanup(() => setSelectedItem(null));

  function childId(index: number): string {
    return `sv-${state.selectedSection}-${index}`;
  }

  function moveCursor(next: number) {
    const count = itemCount();
    if (count === 0) return;
    const clamped = Math.max(0, Math.min(next, count - 1));
    setCursor(clamped);
    scrollRef?.scrollChildIntoView(childId(clamped));
  }

  function openSelected() {
    const url = itemUrls()[cursor()] ?? state.pr?.url;
    if (url) {
      openUrl(url);
      showToast("Opening in browser");
    }
  }

  useScope(
    "content",
    {
      [Commands.NAV_DOWN]: () => moveCursor(cursor() + 1),
      [Commands.NAV_UP]: () => moveCursor(cursor() - 1),
      [Commands.NAV_TOP]: () => moveCursor(0),
      [Commands.NAV_BOTTOM]: () => moveCursor(itemCount() - 1),
      [Commands.SCROLL_PAGEUP]: () => moveCursor(cursor() - pageStep()),
      [Commands.SCROLL_PAGEDOWN]: () => moveCursor(cursor() + pageStep()),
      [Commands.OPEN_IN_BROWSER]: openSelected,
      [Commands.TOGGLE_EXPAND]: () => activate(),
      [Commands.CARD_EDIT]: () => editCurrentCard(),
      [Commands.FEED_REPLY]: () => replyToSelected(),
      [Commands.TOGGLE_ANNOTATIONS]: () => setShowAnnotations((v) => !v),
      [Commands.FEED_FILTER]: () => cycleFeedFilter(),
      [Commands.COPY_LINK]: () => copySelectedLink(),
      [Commands.OPEN_JOB_LOGS]: () => openSelectedJobLogs(),
    },
    { target: pane.target },
  );

  // Enter expands a workflow in the Actions tree, or edits the active card in
  // the PR Info view.
  function activate() {
    if (state.selectedSection === SectionKey.Info) {
      editCurrentCard();
      return;
    }
    if (state.selectedSection === SectionKey.Feed) {
      const node = feedNodes()[cursor()];
      if (node?.collapsible) {
        setFeedExpanded(node.item.id, node.collapsed);
        // Wait for the re-render so the scroll sees the card's new height.
        const id = childId(cursor());
        setTimeout(() => scrollRef?.scrollChildIntoView(id), 0);
      }
      return;
    }
    const node = treeNodes()[cursor() - treeOffset()];
    if (node?.kind === "workflow") {
      // node.expanded already resolves override-or-default, so flip that.
      setExpanded(expandKey(node.group.key), !node.expanded);
      scrollRef?.scrollChildIntoView(childId(cursor()));
    }
  }

  // Open the edit modal for the active PR Info card (0 title / 2 body / 3 labels),
  // or flip draft/ready on the status card (4). The branch card (1) is read-only.
  function editCurrentCard() {
    if (state.selectedSection !== SectionKey.Info || !state.pr) return;
    switch (cursor()) {
      case 0:
        openModal("editTitle");
        break;
      case 2:
        void editDescription();
        break;
      case 3:
        openModal("editLabels");
        break;
      case 4:
        // Same path as the app-level `d` binding, which owns the feedback toast.
        keymap.dispatchCommand(Commands.TOGGLE_DRAFT, {
          focused: pane.target(),
        });
        break;
    }
  }

  function replyToSelected() {
    if (state.selectedSection !== SectionKey.Feed) return;
    const item = feedNodes()[cursor()]?.item;
    if (item && canReply(item)) void startReply(item);
  }

  function cycleFeedFilter() {
    if (state.selectedSection !== SectionKey.Feed) return;
    const next = nextFeedFilter(feedFilter());
    setFeedFilter(next);
    setCursor(0);
    scrollRef?.scrollTo(0);
    showToast(`Feed: ${next}`, 1200);
  }

  // The most specific link for the item under the cursor, falling back to the
  // PR itself (e.g. PR Info cards, merge blockers).
  function copySelectedLink() {
    const item = selectedItem();
    const url = itemUrls()[cursor()] ?? state.pr?.url;
    if (!url) {
      showToast("No PR loaded");
      return;
    }
    const what = !itemUrls()[cursor()]
      ? "PR"
      : item?.kind === "feedItem"
        ? "Comment"
        : item?.kind === "job"
          ? "Job"
          : item?.kind === "workflow"
            ? "Workflow run"
            : item?.kind === "queueEntry"
              ? "PR"
              : "Item";
    void copyToClipboard(url).then((ok) =>
      showToast(
        ok ? `${what} link copied` : "Could not copy link",
        2000,
        ok ? undefined : "error",
      ),
    );
  }

  function openSelectedJobLogs() {
    const item = selectedItem();
    if (item?.kind !== "job") {
      showToast("Select a job to open its logs");
      return;
    }
    void openJobLogs(item.check);
  }

  function pageStep(): number {
    return Math.max(1, Math.floor(viewportHeight() / 4));
  }

  const title = createMemo(() => {
    switch (state.selectedSection) {
      case SectionKey.Info:
        return "PR Info";
      case SectionKey.Feed: {
        const label = feedFilterLabel(feedFilter());
        return label ? `Feed · ${label}` : "Feed";
      }
      case SectionKey.Actions:
        return "Actions";
      case SectionKey.MergeQueue:
        return "Merge queue";
      case SectionKey.Mergeability:
        return "Mergeability";
      default:
        return "";
    }
  });

  // Only show the selection marker when this pane holds focus.
  const activeCursor = createMemo(() => (isFocused() ? cursor() : -1));

  return (
    <box
      ref={pane.ref}
      flexDirection="column"
      flexGrow={1}
      marginTop={1}
      marginBottom={1}
      marginRight={1}
      paddingLeft={isFocused() ? 0 : 1}
      {...focusBorder(theme, isFocused())}
    >
      <PaneHeader title={title()} />

      <scrollbox
        ref={(r: ScrollBoxRenderable) => (scrollRef = r)}
        flexGrow={1}
        paddingLeft={2}
        paddingRight={1}
        stickyScroll={false}
      >
        <Switch>
          <Match when={state.selectedSection === SectionKey.Info}>
            <PrInfo
              width={bodyWidth()}
              selected={activeCursor}
              idFor={childId}
            />
          </Match>
          <Match when={state.selectedSection === SectionKey.Feed}>
            <FeedSection
              width={bodyWidth()}
              selected={activeCursor}
              idFor={childId}
              nodes={feedNodes}
              filter={feedFilter}
            />
          </Match>
          <Match when={state.selectedSection === SectionKey.Actions}>
            <ActionsSection
              width={bodyWidth()}
              selected={activeCursor}
              idFor={childId}
              nodes={actionsNodes}
              showAnnotations={showAnnotations}
            />
          </Match>
          <Match when={state.selectedSection === SectionKey.MergeQueue}>
            <MergeQueueSection
              width={bodyWidth()}
              selected={activeCursor}
              idFor={childId}
              nodes={mergeQueueNodes}
              showAnnotations={showAnnotations}
            />
          </Match>
          <Match when={state.selectedSection === SectionKey.Mergeability}>
            <MergeabilitySection
              width={bodyWidth()}
              selected={activeCursor}
              idFor={childId}
            />
          </Match>
        </Switch>
      </scrollbox>

      <MainFooter />
    </box>
  );
}
