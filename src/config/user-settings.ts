// User Settings - loads config from ~/.config/ghdash/config.json

import { homedir } from "os";
import { join } from "path";
import { z } from "zod";
import type { ThemeName } from "@/theme/theme";

const THEME_NAMES = [
  "default",
  "terminal",
  "mono",
  "tokyo-night",
] as const satisfies readonly ThemeName[];

// Each field falls back on its own so one bad value doesn't discard the rest
// of the config.
const UserSettingsSchema = z.object({
  /** Color scheme: default | terminal | mono | tokyo-night */
  theme: z
    .enum(THEME_NAMES)
    .optional()
    .catch(({ value }) => {
      console.error(
        `Invalid theme ${JSON.stringify(value)} in config; expected one of ${THEME_NAMES.join(", ")}. Using "default".`,
      );
      return undefined;
    }),
  /** How often to poll GitHub, in milliseconds (default 15000). */
  pollIntervalMs: z.number().positive().optional().catch(undefined),
  /** Optional GitHub token override (otherwise env / `gh auth token`). */
  githubToken: z.string().optional().catch(undefined),
});

export type UserSettings = z.infer<typeof UserSettingsSchema>;

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
    return compileSettings(UserSettingsSchema.parse(JSON.parse(content)));
  } catch (error) {
    console.error(`Failed to load config from ${configPath}:`, error);
    return createDefaultSettings();
  }
}

function createDefaultSettings(): RuntimeSettings {
  return { raw: {}, theme: "default" };
}

function compileSettings(settings: UserSettings): RuntimeSettings {
  return {
    raw: settings,
    theme: settings.theme ?? "default",
    pollIntervalMs: settings.pollIntervalMs,
    githubToken: settings.githubToken,
  };
}
