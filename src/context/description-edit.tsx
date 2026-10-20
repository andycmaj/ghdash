// Edits the PR description in $EDITOR in the embedded terminal, pre-filled with
// the current body. Falls back to the in-app PrEditModal when no editor is
// available, or when saving fails (so the composed text isn't lost).

import {
  createContext,
  createSignal,
  useContext,
  type Accessor,
  type ParentProps,
} from "solid-js";
import { useGithub } from "./github";
import { useFocus } from "./focus";
import { useToast } from "./toast";
import { useTerminal } from "./terminal";
import { editInTerminal } from "@/utils/external-editor";

interface DescriptionEditContextValue {
  // Initial textarea contents for the fallback modal.
  draft: Accessor<string>;
  startEdit: () => Promise<void>;
}

const DescriptionEditContext = createContext<DescriptionEditContextValue>();

const INSTRUCTIONS = [
  "Edit the PR description above this line. Save and quit to update;",
  "quit with an error (e.g. :cq) to cancel. Everything below is ignored.",
];

export function DescriptionEditProvider(props: ParentProps) {
  const terminal = useTerminal();
  const { state, updatePrBody } = useGithub();
  const { openModal } = useFocus();
  const { showToast } = useToast();

  const [draft, setDraft] = createSignal("");
  let editing = false;

  function fallback(text: string) {
    setDraft(text);
    openModal("editBody");
  }

  async function startEdit() {
    const pr = state.pr;
    if (!pr || editing) return;
    editing = true;
    const current = pr.body.trim();
    try {
      const result = await editInTerminal(terminal.open, {
        context: [`#${pr.number} ${pr.title}`],
        title: `Edit description #${pr.number}`,
        initial: current,
        instructions: INSTRUCTIONS,
        allowEmpty: true,
      });
      if (result.kind === "cancelled") {
        showToast("Edit cancelled", 1500);
      } else if (result.kind === "unavailable") {
        fallback(pr.body);
      } else if (result.text === current) {
        showToast("Description unchanged", 1500);
      } else {
        try {
          await updatePrBody(result.text);
          showToast("Description updated");
        } catch (err) {
          showToast(errorMessage(err), 6000, "error");
          fallback(result.text);
        }
      }
    } catch (err) {
      showToast(errorMessage(err), 6000, "error");
      fallback(pr.body);
    } finally {
      editing = false;
    }
  }

  return (
    <DescriptionEditContext.Provider value={{ draft, startEdit }}>
      {props.children}
    </DescriptionEditContext.Provider>
  );
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function useDescriptionEdit(): DescriptionEditContextValue {
  const value = useContext(DescriptionEditContext);
  if (!value)
    throw new Error(
      "useDescriptionEdit must be used within a DescriptionEditProvider",
    );
  return value;
}
