// Compose text in the user's $VISUAL/$EDITOR, run in the embedded terminal.

import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TerminalRequest } from "@/context/terminal";

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
  // Pre-filled text above the scissors line (e.g. the current PR description).
  initial?: string;
  // Replaces the default reply guidance under the scissors line.
  instructions?: string[];
  // An emptied buffer is saved as "" instead of cancelling, so pre-filled text
  // can be cleared; aborting the editor (e.g. `:cq`) still cancels.
  allowEmpty?: boolean;
}

const REPLY_INSTRUCTIONS = [
  "Write your reply above this line. Save and quit to send;",
  "an empty reply cancels. Everything below is ignored.",
];

export function resolveEditor(): string | null {
  const editor = (process.env.VISUAL || process.env.EDITOR || "").trim();
  return editor || null;
}

// Like git's commit template: everything from the scissors line down is
// guidance, so markdown `#` headings above it survive intact.
export function buildTemplate(
  context: string[],
  initial = "",
  instructions: string[] = REPLY_INSTRUCTIONS,
): string {
  return [
    initial,
    "",
    SCISSORS,
    ...instructions.map((l) => `# ${l}`),
    "#",
    ...context.map((l) => (l ? `# ${l}` : "#")),
    "",
  ].join("\n");
}

export function stripTemplate(contents: string): string {
  const cut = contents.indexOf(SCISSORS);
  return (cut === -1 ? contents : contents.slice(0, cut)).trim();
}

export function shellQuote(s: string): string {
  return `'${s.replaceAll("'", `'\\''`)}'`;
}

// Opens the editor in the embedded terminal (replacing the content pane) and
// resolves once it exits.
export async function editInTerminal(
  open: (request: TerminalRequest) => void,
  options: EditorOptions,
): Promise<EditorResult> {
  const editor = resolveEditor();
  if (!editor) {
    return { kind: "unavailable", reason: "$EDITOR is not set" };
  }

  const path = join(tmpdir(), `ghdash-reply-${process.pid}-${Date.now()}.md`);
  await Bun.write(
    path,
    buildTemplate(options.context, options.initial, options.instructions),
  );

  try {
    const exitCode = await new Promise<number | null>((resolve) =>
      open({
        title: options.title ?? "Edit",
        // $EDITOR may carry arguments (e.g. "code --wait"), so it goes through a shell.
        command: ["sh", "-c", `${editor} ${shellQuote(path)}`],
        onEnd: resolve,
      }),
    );
    // 126/127: the shell couldn't run the editor at all. Any other non-zero
    // exit (or the session being closed) is a deliberate abort, as with git.
    if (exitCode === 126 || exitCode === 127) {
      return { kind: "unavailable", reason: `could not run ${editor}` };
    }
    if (exitCode !== 0) return { kind: "cancelled" };
    const text = stripTemplate(await Bun.file(path).text());
    return text || options.allowEmpty
      ? { kind: "saved", text }
      : { kind: "cancelled" };
  } finally {
    await Bun.file(path)
      .delete()
      .catch(() => {});
  }
}
