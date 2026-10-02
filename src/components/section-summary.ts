// Section definitions and their right-aligned summaries, shared by the sidebar
// (SectionTree) and the space-bar SectionPicker.

import { createMemo, type Accessor } from "solid-js";
import { useGithub } from "../context/github";
import { useTheme } from "@/hooks/useTheme";
import { aggregateStatus, countChecks } from "@/github/status-utils";
import { checkStatusColor, checkStatusIcon } from "@/theme/theme";
import { PRStatus, SectionKey } from "@/github/types";

export interface SectionDef {
  key: SectionKey;
  label: string;
}

const ALL_SECTIONS: SectionDef[] = [
  { key: SectionKey.Feed, label: "Feed" },
  { key: SectionKey.Actions, label: "Actions" },
  { key: SectionKey.MergeQueue, label: "Merge queue" },
  { key: SectionKey.Mergeability, label: "Mergeability" },
];

// The sections available for the current PR; Merge queue only while queued.
export function useSections(): Accessor<SectionDef[]> {
  const { state } = useGithub();
  return createMemo(() =>
    ALL_SECTIONS.filter(
      (s) => s.key !== SectionKey.MergeQueue || !!state.pr?.mergeQueue,
    ),
  );
}

export interface SectionSummary {
  text: string;
  color: string | undefined;
}

// Returns a reactive summary lookup for each section.
export function useSectionSummary(): (key: SectionKey) => SectionSummary {
  const { state } = useGithub();
  const theme = useTheme();

  return (key) => {
    switch (key) {
      case SectionKey.Feed:
        return { text: `${state.feed.length}`, color: theme.textMuted };
      case SectionKey.Actions: {
        const c = countChecks(state.checks);
        if (c.total === 0) return { text: "—", color: theme.textMuted };
        if (c.failure > 0)
          return { text: `✗ ${c.failure}`, color: theme.error };
        if (c.running + c.pending > 0)
          return { text: `◐ ${c.running + c.pending}`, color: theme.info };
        return { text: `✓ ${c.success}`, color: theme.success };
      }
      case SectionKey.MergeQueue: {
        const position = state.pr?.mergeQueue?.position;
        const of = state.mergeQueueItems.length;
        const label =
          position != null ? `#${position}${of ? `/${of}` : ""}` : "queued";
        if (state.mergeQueueChecks.length === 0)
          return { text: label, color: theme.info };
        const status = aggregateStatus(countChecks(state.mergeQueueChecks));
        return {
          text: `${checkStatusIcon(status)} ${label}`,
          color: checkStatusColor(theme, status),
        };
      }
      case SectionKey.Mergeability: {
        const pr = state.pr;
        if (pr?.status === PRStatus.Merged)
          return { text: "merged", color: theme.accent };
        if (pr?.status === PRStatus.Closed)
          return { text: "closed", color: theme.error };
        if (pr?.mergeQueue) return { text: "queued", color: theme.info };
        const unmet = state.mergeBlockers.filter((b) => !b.satisfied).length;
        if (state.mergeBlockers.length === 0)
          return { text: "—", color: theme.textMuted };
        return unmet > 0
          ? { text: `! ${unmet}`, color: theme.warning }
          : { text: "ready", color: theme.success };
      }
      default:
        return { text: "", color: theme.textMuted };
    }
  };
}
