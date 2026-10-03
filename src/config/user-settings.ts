// User Settings - loads config from ~/.config/ghdash/config.json

import { homedir } from "os";
import { join } from "path";
import type { ThemeName } from "@/theme/theme";

const THEME_NAMES: ThemeName[] = ["default", "terminal", "mono", "tokyo-night"];

export function parseThemeName(value: unknown): ThemeName {
  if (typeof value === "string" && THEME_NAMES.includes(value as ThemeName)) {
    return value as ThemeName;
  }
  if (value !== undefined) {
    console.error(
      `Invalid theme "${String(value)}" in config; expected one of ${THEME_NAMES.join(", ")}. Using "default".`,
    );
  }
  return "default";
}

export interface UserSettings {
  /** Color scheme: default | terminal | mono | tokyo-night */
  theme?: ThemeName;
  /** How often to poll GitHub, in milliseconds (default 15000). */
  pollIntervalMs?: number;
  /** Optional GitHub token override (otherwise env / `gh auth token`). */
  githubToken?: string;
}

export interface RuntimeSettings {
  raw: UserSettings;
  theme: ThemeName;
  pollIntervalMs?: number;
  githubToken?: string;
}

const CONFIG_DIR = ".config/ghdash";
const CONFIG_FILE = "config.json";

export function getConfigPath(): string {
  return join(homedir(), CONFIG_DIR, CONFIG_FILE);
}

export async function loadUserSettings(): Promise<RuntimeSettings> {
  const configPath = getConfigPath();

  try {
    const file = Bun.file(configPath);
    const exists = await file.exists();

    if (!exists) {
      return createDefaultSettings();
    }

    const content = await file.text();
    const settings = JSON.parse(content) as UserSettings;
    return compileSettings(settings);
  } catch (error) {
    console.error(`Failed to load config from ${configPath}:`, error);
    return createDefaultSettings();
  }
}

function createDefaultSettings(): RuntimeSettings {
  return { raw: {}, theme: "default" };
}

function compileSettings(settings: UserSettings): RuntimeSettings {
  const pollIntervalMs =
    typeof settings.pollIntervalMs === "number" && settings.pollIntervalMs > 0
      ? settings.pollIntervalMs
      : undefined;

  return {
    raw: settings,
    theme: parseThemeName(settings.theme),
    pollIntervalMs,
    githubToken: settings.githubToken,
  };
}
