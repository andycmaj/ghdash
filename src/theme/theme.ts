// Agent theme module: re-exports the framework's theme surface and adds
// ghdash's own domain color/glyph mappers (check status, PR status). The
// framework owns the palette + mechanism; the app owns how its domain state
// maps onto theme colors.

export type {
  Theme,
  ThemeColor,
  ThemeName,
  TerminalSurface,
  ConnectionStatus,
} from "@andycmaj/opentui-app";
export {
  defaultTheme,
  getTheme,
  getModalTheme,
  resolveForeground,
  focusBorder,
  connectionStatusIcon,
  connectionStatusColor,
  connectionStatusText,
  formatRelativeTime,
  formatDuration,
  formatBuildDuration,
} from "@andycmaj/opentui-app";

import type { Theme, ThemeColor } from "@andycmaj/opentui-app";
import { CheckStatus, PRStatus } from "@/github/types";

// Color for a normalized check/workflow status.
export function checkStatusColor(
  theme: Theme,
  status: CheckStatus,
): ThemeColor {
  switch (status) {
    case CheckStatus.Success:
      return theme.success;
    case CheckStatus.Failure:
      return theme.error;
    case CheckStatus.Running:
      return theme.info;
    case CheckStatus.Pending:
      return theme.warning;
    case CheckStatus.Neutral:
    case CheckStatus.Skipped:
    default:
      return theme.textMuted;
  }
}

// Glyph for a normalized check/workflow status.
export function checkStatusIcon(status: CheckStatus): string {
  switch (status) {
    case CheckStatus.Success:
      return "✓";
    case CheckStatus.Failure:
      return "✗";
    case CheckStatus.Running:
      return "◐";
    case CheckStatus.Pending:
      return "●";
    case CheckStatus.Skipped:
      return "⊘";
    case CheckStatus.Neutral:
    default:
      return "•";
  }
}

// Color for the overall PR state (used for the pane title).
export function prStatusColor(theme: Theme, status: PRStatus): ThemeColor {
  switch (status) {
    case PRStatus.Open:
      return theme.success;
    case PRStatus.Draft:
      return theme.textMuted;
    case PRStatus.Merged:
      return theme.accent;
    case PRStatus.Closed:
      return theme.error;
    default:
      return theme.primary;
  }
}
