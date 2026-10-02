// Entry point for ghdash TUI. The framework's runApp harness owns the render
// config, the top-level ErrorBoundary -> ErrorFallback crash screen, process
// error handlers, renderer registration, and the debug-console toggle.

import { runApp } from "@andycmaj/opentui-app";
import { App } from "./app";
import { parseCLI } from "./cli";
import { loadUserSettings } from "./config/user-settings";

const config = await parseCLI();
const userSettings = await loadUserSettings();
const pollMs = config.pollMs ?? userSettings.pollIntervalMs;

await runApp(() => (
  <App
    theme={userSettings.theme}
    pollMs={pollMs}
    tokenOverride={userSettings.githubToken}
    prSpec={config.prSpec}
  />
));
