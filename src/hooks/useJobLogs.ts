// Open an Actions job's raw log in $EDITOR (falling back to less) inside the
// embedded terminal. The log is written to a temp file that is removed once
// the editor session ends.

import { tmpdir } from "node:os";
import { join } from "node:path";
import { stripAnsi } from "@andycmaj/opentui-app";
import { useGithub } from "@/context/github";
import { useTerminal } from "@/context/terminal";
import { useToast } from "@/context/toast";
import { resolveEditor, shellQuote } from "@/utils/external-editor";
import type { CheckRun } from "@/github/types";

export function useJobLogs(): (check: CheckRun) => Promise<void> {
  const { getJobLog } = useGithub();
  const terminal = useTerminal();
  const { showToast } = useToast();
  let loading = false;

  return async (check) => {
    if (loading) return;
    loading = true;
    showToast(`Fetching logs for ${check.name}…`, 1500);
    try {
      const log = stripAnsi(await getJobLog(check));
      const slug = check.name.replace(/[^\w.-]+/g, "-").slice(0, 40);
      const path = join(
        tmpdir(),
        `ghdash-${slug}-${process.pid}-${Date.now()}.log`,
      );
      await Bun.write(path, log);
      const editor = resolveEditor() ?? "less";
      terminal.open({
        title: `Logs · ${check.name}`,
        tag: check.workflowName,
        // $EDITOR may carry arguments (e.g. "code --wait"), so it goes through a shell.
        command: ["sh", "-c", `${editor} ${shellQuote(path)}`],
        onEnd: () => {
          void Bun.file(path)
            .delete()
            .catch(() => {});
        },
      });
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : String(err),
        6000,
        "error",
      );
    } finally {
      loading = false;
    }
  };
}
