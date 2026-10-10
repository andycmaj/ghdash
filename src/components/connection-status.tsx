import { createMemo, Show } from "solid-js";
import { useTerminalDimensions } from "@opentui/solid";
import { useGithub } from "../context/github";
import {
  connectionStatusIcon,
  connectionStatusColor,
  connectionStatusText,
  prStatusColor,
} from "../theme/theme";
import { useTheme } from "@/hooks/useTheme";
import { truncate } from "@/utils/truncate";

interface ConnectionStatusProps {
  narrow?: boolean;
}

export function ConnectionStatus(props: ConnectionStatusProps) {
  const { state } = useGithub();
  const theme = useTheme();
  const dimensions = useTerminalDimensions();

  const isNarrow = () => props.narrow ?? false;

  const connectionIcon = createMemo(() =>
    connectionStatusIcon(state.connectionStatus),
  );
  const connectionColor = createMemo(() =>
    connectionStatusColor(theme, state.connectionStatus),
  );

  // Repo label, or a fetch status when nothing has loaded yet.
  const statusLine = createMemo(() => {
    const icon = connectionIcon();
    if (state.repo) {
      return `${icon} ${state.repo.owner}/${state.repo.repo}`;
    }
    return `${icon} ${connectionStatusText(state.connectionStatus)}`;
  });

  const rightText = createMemo(() => {
    if (state.error) return "error";

    return "";
  });

  const branchLine = () =>
    state.pr ? `${state.pr.headRef} → ${state.pr.baseRef}` : "";

  // Leave room for margins/padding (6), "PR #N " and the right-hand text.
  const titleWidth = createMemo(() => {
    const prLabel = state.pr ? `PR #${state.pr.number} `.length : 0;
    const right = (rightText() || branchLine()).length;
    return Math.max(10, dimensions().width - 6 - prLabel - right - 2);
  });

  if (isNarrow()) {
    return (
      <box
        flexDirection="column"
        paddingTop={1}
        paddingLeft={2}
        paddingRight={2}
        flexShrink={0}
        marginBottom={1}
      >
        <Show when={state.error}>
          <text fg={theme.error}>{rightText()}</text>
        </Show>
        <text fg={connectionColor()} attributes={1}>
          {statusLine()}
        </text>
      </box>
    );
  }

  return (
    <box
      backgroundColor={theme.contentPane}
      marginLeft={1}
      marginRight={1}
      marginBottom={1}
      padding={1}
      paddingLeft={2}
      paddingRight={2}
      flexShrink={0}
    >
      <box flexDirection="row" justifyContent="space-between" width="100%">
        <Show
          when={state.pr}
          fallback={
            <text fg={connectionColor()} attributes={1}>
              {statusLine()}
            </text>
          }
        >
          <text fg={prStatusColor(theme, state.pr!.status)} attributes={1}>
            PR #{state.pr!.number}{" "}
            <span style={{ fg: theme.text }}>
              {truncate(state.pr!.title, titleWidth())}
            </span>
          </text>
        </Show>
        <text fg={state.error ? theme.error : theme.textMuted}>
          {rightText() || branchLine()}
        </text>
      </box>
    </box>
  );
}
