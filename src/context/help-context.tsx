// Help context: what the footer and keyboard-help need to decide which
// bindings are relevant right now. The active section comes from the GitHub
// store; the selected item is published by SectionView, which owns the cursor.

import {
  createContext,
  createMemo,
  createSignal,
  useContext,
  type Accessor,
  type ParentProps,
} from "solid-js";
import { useGithub } from "./github";
import type { WorkflowGroup } from "@/github/status-utils";
import type {
  CheckRun,
  FeedItem,
  MergeBlocker,
  MergeQueueItem,
  SectionKey,
} from "@/github/types";

export type InfoCard = "title" | "body" | "labels";

// The item under the content-pane cursor.
export type SelectedItem =
  | { kind: "infoCard"; card: InfoCard }
  | { kind: "feedItem"; item: FeedItem }
  | { kind: "workflow"; group: WorkflowGroup; expanded: boolean }
  | { kind: "job"; check: CheckRun }
  | { kind: "blocker"; blocker: MergeBlocker }
  | { kind: "queueEntry"; item: MergeQueueItem };

export interface HelpContext {
  activeSection: SectionKey;
  selectedItem: SelectedItem | null;
}

interface HelpContextValue {
  context: Accessor<HelpContext>;
  setSelectedItem: (item: SelectedItem | null) => void;
}

const HelpContextContext = createContext<HelpContextValue>();

export function HelpContextProvider(props: ParentProps) {
  const { state } = useGithub();
  const [selectedItem, setSelectedItem] = createSignal<SelectedItem | null>(
    null,
  );

  const context = createMemo<HelpContext>(() => ({
    activeSection: state.selectedSection,
    selectedItem: selectedItem(),
  }));

  return (
    <HelpContextContext.Provider value={{ context, setSelectedItem }}>
      {props.children}
    </HelpContextContext.Provider>
  );
}

export function useHelpContext(): HelpContextValue {
  const value = useContext(HelpContextContext);
  if (!value) {
    throw new Error("useHelpContext must be used within a HelpContextProvider");
  }
  return value;
}
