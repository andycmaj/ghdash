import { defineCommand, runMain } from "citty";
import { APP_VERSION } from "./version";
import { parsePrSpec, type PRSpec } from "./github/pr-spec";

export interface CLIConfig {
  /** Poll interval override in ms (from --poll), or undefined to use config/default. */
  pollMs?: number;
  /** Explicit PR target (from the positional arg), or undefined for the current branch. */
  prSpec?: PRSpec;
}

let config: CLIConfig | undefined = undefined;

const main = defineCommand({
  meta: {
    name: "ghdash",
    version: APP_VERSION,
    description: "A terminal UI dashboard for a GitHub PR",
  },
  args: {
    pr: {
      type: "positional",
      required: false,
      description:
        "PR to show: a number, OWNER/REPO#NUMBER, or a PR URL (defaults to the current branch's open PR)",
    },
    poll: {
      type: "string",
      description: "Poll interval in milliseconds",
    },
  },
  run({ args }) {
    const parsedPoll = parseInt(String(args.poll ?? ""), 10);
    const prArg = String(args.pr ?? "").trim();
    const prSpec = prArg ? parsePrSpec(prArg) : null;

    if (prArg && !prSpec) {
      console.error(
        `Could not parse PR "${prArg}". Use a number, OWNER/REPO#NUMBER, or a PR URL.`,
      );
      process.exit(1);
    }

    config = {
      pollMs: Number.isNaN(parsedPoll) ? undefined : parsedPoll,
      prSpec: prSpec ?? undefined,
    };
  },
});

export async function parseCLI(): Promise<CLIConfig> {
  await runMain(main);
  // citty handles --version/--help by printing and returning without invoking
  // run(), leaving config unset. Nothing to do in that case, so exit cleanly.
  if (!config) {
    process.exit(0);
  }
  return config;
}
