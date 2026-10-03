// Actions view: CI checks rendered as a Workflow → Job → Annotation hierarchy.
// Navigation still runs off a flat cursor (see buildActionsNodes), so each row
// carries its flat index for selection and scroll-into-view while nesting
// jobs inside their workflow and annotations inside their job.

import { createMemo, For, Show } from "solid-js";
import { useTheme } from "@/hooks/useTheme";
import {
  checkStatusColor,
  checkStatusIcon,
  formatBuildDuration,
  formatRelativeTime,
} from "@/theme/theme";
import { wrapText } from "@/utils/wrap";
import {
  groupChecksByWorkflow,
  workflowExpandedByDefault,
  type WorkflowGroup,
} from "@/github/status-utils";
import type { Annotation, CheckRun } from "@/github/types";
import { Marker, type SectionProps } from "./common";

// A row in the Actions tree: a workflow header or a job under it.
export type ActionsNode =
  | { kind: "workflow"; group: WorkflowGroup; expanded: boolean }
  | { kind: "job"; check: CheckRun };

// Flatten checks into a tree: workflow rows, each followed by its jobs when open.
export function buildActionsNodes(
  checks: CheckRun[],
  isExpanded: (key: string, defaultOpen: boolean) => boolean,
): ActionsNode[] {
  const out: ActionsNode[] = [];
  for (const group of groupChecksByWorkflow(checks)) {
    const open = isExpanded(group.key, workflowExpandedByDefault(group.status));
    out.push({ kind: "workflow", group, expanded: open });
    if (open)
      for (const job of group.jobs) out.push({ kind: "job", check: job });
  }
  return out;
}

// A job paired with its flat cursor index.
type JobEntry = { check: CheckRun; index: number };

// A workflow paired with its flat cursor index and the jobs nested beneath it.
type WorkflowEntry = {
  group: WorkflowGroup;
  expanded: boolean;
  index: number;
  jobs: JobEntry[];
};

// Rebuild the parent/child structure from the flat nav list, keeping each row's
// flat index so selection and scroll targeting stay aligned with the cursor.
function toWorkflowEntries(nodes: ActionsNode[]): WorkflowEntry[] {
  const out: WorkflowEntry[] = [];
  nodes.forEach((node, index) => {
    if (node.kind === "workflow") {
      out.push({
        group: node.group,
        expanded: node.expanded,
        index,
        jobs: [],
      });
    } else {
      out[out.length - 1]?.jobs.push({ check: node.check, index });
    }
  });
  return out;
}

export function ActionsSection(
  props: SectionProps & {
    nodes: () => ActionsNode[];
    showAnnotations: () => boolean;
    emptyText?: string;
  },
) {
  const theme = useTheme();
  const workflows = createMemo(() => toWorkflowEntries(props.nodes()));

  return (
    <Show
      when={workflows().length > 0}
      fallback={
        <text fg={theme.textMuted}>
          {props.emptyText ?? "No checks reported."}
        </text>
      }
    >
      <For each={workflows()}>
        {(wf) => (
          <WorkflowRow
            group={wf.group}
            expanded={wf.expanded}
            jobs={wf.jobs}
            width={props.width}
            id={props.idFor(wf.index)}
            selected={props.selected() === wf.index}
            selectedIndex={props.selected}
            idFor={props.idFor}
            showAnnotations={props.showAnnotations}
          />
        )}
      </For>
    </Show>
  );
}

function WorkflowRow(props: {
  group: WorkflowGroup;
  expanded: boolean;
  jobs: JobEntry[];
  width: number;
  id: string;
  selected: boolean;
  selectedIndex: () => number;
  idFor: (index: number) => string;
  showAnnotations: () => boolean;
}) {
  const theme = useTheme();
  const g = props.group;

  const summary = () => {
    const c = g.counts;
    const parts: string[] = [];
    if (c.failure) parts.push(`✗${c.failure}`);
    if (c.running + c.pending) parts.push(`◐${c.running + c.pending}`);
    if (c.success) parts.push(`✓${c.success}`);
    if (c.skipped) parts.push(`⊘${c.skipped}`);
    return parts.join(" ");
  };

  // A workflow is finished when nothing is still running or pending; stamp it
  // with a relative time from its latest job completion.
  const finishedAgo = createMemo(() => {
    if (g.counts.running + g.counts.pending > 0) return "";
    let latest = "";
    for (const job of g.jobs) {
      if (job.completedAt && job.completedAt > latest) latest = job.completedAt;
    }
    return latest ? `finished ${formatRelativeTime(latest)}` : "";
  });

  return (
    <box
      id={props.id}
      flexDirection="column"
      marginBottom={1}
      paddingTop={1}
      paddingBottom={1}
      backgroundColor={theme.contentPane}
    >
      <box flexDirection="row" gap={1}>
        <Marker selected={props.selected} />
        <text fg={theme.textMuted}>{props.expanded ? "▼" : "▶"}</text>
        <text fg={checkStatusColor(theme, g.status)}>
          {checkStatusIcon(g.status)}
        </text>
        <text fg={theme.text} attributes={1}>
          {g.name}
        </text>
        <text fg={theme.textMuted}>
          ({g.jobs.length}) {summary()}
        </text>
        <Show when={finishedAgo()}>
          <text fg={theme.textMuted}>· {finishedAgo()}</text>
        </Show>
      </box>

      <For each={props.jobs}>
        {(job) => (
          <JobRow
            check={job.check}
            width={props.width}
            id={props.idFor(job.index)}
            selected={props.selectedIndex() === job.index}
            showAnnotations={props.showAnnotations}
          />
        )}
      </For>
    </box>
  );
}

function JobRow(props: {
  check: CheckRun;
  width: number;
  id: string;
  selected: boolean;
  showAnnotations: () => boolean;
}) {
  const theme = useTheme();
  const check = props.check;

  const duration = createMemo(() =>
    formatBuildDuration(check.startedAt, check.completedAt),
  );

  return (
    <box id={props.id} flexDirection="column" paddingLeft={2}>
      <box flexDirection="row" gap={1}>
        <Marker selected={props.selected} />
        <text fg={checkStatusColor(theme, check.status)}>
          {checkStatusIcon(check.status)}
        </text>
        <text fg={theme.text}>{check.name}</text>
        <Show when={check.conclusion}>
          <text fg={theme.textMuted}>{check.conclusion!.toLowerCase()}</text>
        </Show>
        <Show when={duration()}>
          <text fg={theme.textMuted}>· {duration()}</text>
        </Show>
      </box>
      <Show when={props.showAnnotations()}>
        <For each={check.annotations}>
          {(annotation) => (
            <AnnotationRow annotation={annotation} width={props.width - 2} />
          )}
        </For>
      </Show>
    </box>
  );
}

function AnnotationRow(props: { annotation: Annotation; width: number }) {
  const theme = useTheme();
  const a = props.annotation;
  const color = () =>
    a.level === "failure"
      ? theme.error
      : a.level === "warning"
        ? theme.warning
        : theme.textMuted;
  const label = () =>
    `${a.level === "warning" ? "!" : a.level === "failure" ? "✗" : "•"} `;
  const location = () =>
    a.path ? `${a.path}${a.startLine ? `:${a.startLine}` : ""} — ` : "";
  const lines = createMemo(() =>
    wrapText(
      `${location()}${a.title ? `${a.title}: ` : ""}${a.message}`,
      props.width - 2,
    ),
  );

  return (
    <box flexDirection="column" paddingLeft={2}>
      <For each={lines()}>
        {(line, i) => (
          <text fg={color()}>
            {i() === 0 ? label() : "  "}
            {line}
          </text>
        )}
      </For>
    </box>
  );
}
