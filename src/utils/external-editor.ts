// Compose text in the user's $VISUAL/$EDITOR. Inside tmux the editor opens in
// a popup floating over the dashboard (which keeps rendering underneath);
// otherwise the renderer is suspended so the editor can own the terminal.

import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CliRenderer } from "@opentui/core";

const SCISSORS = "# ------------------------ >8 ------------------------";

export type EditorResult =
  | { kind: "saved"; text: string }
  | { kind: "cancelled" }
  // No editor configured, or it failed to launch; the caller falls back to an
  // in-app textarea.
  | { kind: "unavailable"; reason: string };

export interface EditorOptions {
  // Shown below the scissors line; stripped from the result.
  context: string[];
  title?: string;
}

export function resolveEditor(): string | null {
  const editor = (process.env.VISUAL || process.env.EDITOR || "").trim();
  return editor || null;
}

// Like git's commit template: everything from the scissors line down is
// guidance, so markdown `#` headings above it survive intact.
export function buildTemplate(context: string[]): string {
  return [
    "",
    "",
    SCISSORS,
    "# Write your reply above this line. Save and quit to send;",
    "# an empty reply cancels. Everything below is ignored.",
    "#",
    ...context.map((l) => (l ? `# ${l}` : "#")),
    "",
  ].join("\n");
}

export function stripTemplate(contents: string): string {
  const cut = contents.indexOf(SCISSORS);
  return (cut === -1 ? contents : contents.slice(0, cut)).trim();
}

function shellQuote(s: string): string {
  return `'${s.replaceAll("'", `'\\''`)}'`;
}

export async function editInExternalEditor(
  renderer: CliRenderer,
  options: EditorOptions,
): Promise<EditorResult> {
  const editor = resolveEditor();
  if (!editor) {
    return { kind: "unavailable", reason: "$EDITOR is not set" };
  }

  const path = join(tmpdir(), `ghdash-reply-${process.pid}-${Date.now()}.md`);
  await Bun.write(path, buildTemplate(options.context));

  // $EDITOR may carry arguments (e.g. "code --wait"), so it goes through a shell.
  const command = `${editor} ${shellQuote(path)}`;

  try {
    const popupExit = process.env.TMUX
      ? await runInTmuxPopup(command, options.title)
      : null;
    const exitCode = popupExit ?? (await runSuspended(renderer, command));
    // 126/127: the shell couldn't run the editor at all. Any other non-zero
    // exit is a deliberate abort (e.g. vim's :cq), as with git.
    if (exitCode === 126 || exitCode === 127) {
      return { kind: "unavailable", reason: `could not run ${editor}` };
    }
    if (exitCode !== 0) return { kind: "cancelled" };
    const text = stripTemplate(await Bun.file(path).text());
    return text ? { kind: "saved", text } : { kind: "cancelled" };
  } finally {
    await Bun.file(path)
      .delete()
      .catch(() => {});
  }
}

// display-popup blocks until the popup closes and returns the editor's exit
// code; -E closes it when the editor exits. The editor's output goes to the
// popup, so anything on stderr is tmux itself failing (e.g. no attached
// client) — null tells the caller to fall back to suspending.
async function runInTmuxPopup(
  command: string,
  title?: string,
): Promise<number | null> {
  const args = ["display-popup", "-E", "-w", "90%", "-h", "80%"];
  if (title) args.push("-T", ` ${title} `);
  const proc = Bun.spawn(["tmux", ...args, command], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stderr).text(),
  ]);
  return exitCode !== 0 && stderr.trim() ? null : exitCode;
}

async function runSuspended(
  renderer: CliRenderer,
  command: string,
): Promise<number> {
  renderer.suspend();
  try {
    const proc = Bun.spawn(["sh", "-c", command], {
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });
    return await proc.exited;
  } finally {
    renderer.resume();
  }
}
