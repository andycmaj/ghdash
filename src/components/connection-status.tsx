import { createMemo, Show } from "solid-js";
import { useGithub } from "../context/github";
import {
  connectionStatusIcon,
  connectionStatusColor,
  connectionStatusText,
  formatRelativeTime,
} from "../theme/theme";
import { useTheme } from "@/hooks/useTheme";
import { truncate } from "@/utils/truncate";

interface ConnectionStatusProps {
  narrow?: boolean;
}

export function ConnectionStatus(props: ConnectionStatusProps) {
  const { state } = useGithub();
  const theme = useTheme();

  const isNarrow = () => props.narrow ?? false;

  const connectionIcon = createMemo(() =>
    connectionStatusIcon(state.connectionStatus),
  );
  const connectionColor = createMemo(() =>
    connectionStatusColor(theme, state.connectionStatus),
  );

  // Repo/branch label, or a fetch status when nothing has loaded yet.
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

  if (isNarrow()) {
    return (
      <box
        flexDirection="column"
        padding={1}
        paddingLeft={2}
        paddingRight={2}
        flexShrink={0}
      >
        <box flexDirection="row" justifyContent="space-between">
          <text fg={connectionColor()} attributes={1}>
            {statusLine()}
          </text>
        </box>
        <Show when={state.repo}>
          <text fg={theme.textMuted}>{truncate(state.repo!.branch, 28)}</text>
        </Show>
        <text fg={state.error ? theme.error : theme.textMuted}>
          {rightText()}
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
        <text fg={connectionColor()} attributes={1}>
          {statusLine()}
          <Show when={state.pr}>
            <span style={{ fg: theme.text }}> #{state.pr!.number}</span>
          </Show>
        </text>
        <text fg={state.error ? theme.error : theme.textMuted}>
          {rightText()}
        </text>
      </box>
    </box>
  );
}
