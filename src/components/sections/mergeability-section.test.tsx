import { afterEach, describe, expect, test } from "bun:test";
import { For } from "solid-js";
import { testRender } from "@opentui/solid";
import {
  MergeBlockerKind,
  type MergeBlocker,
  type TeamMember,
} from "@/github/types";
import { BlockerRow } from "./mergeability-section";

function members(n: number, approved = 0, changes = 0): TeamMember[] {
  return Array.from({ length: n }, (_, i) => ({
    login: `dev${i + 1}`,
    review:
      i < approved
        ? "approved"
        : i < approved + changes
          ? "changes-requested"
          : "requested",
  }));
}

function team(
  slug: string,
  list: TeamMember[] | null,
  satisfied = false,
): MergeBlocker {
  return {
    kind: MergeBlockerKind.RequiredReview,
    description: "(team rows render from `team`, not this)",
    satisfied,
    team: { slug, members: list },
  };
}

const BLOCKERS: MergeBlocker[] = [
  {
    kind: MergeBlockerKind.RequiredReview,
    description: "1 of 2 required approvals by @dev1 — waiting on @someone",
    satisfied: false,
  },
  team("acme/web", members(3, 1), true),
  team("acme/platform-infrastructure-reviewers", members(24, 1, 1)),
  team("acme/payments", members(9)),
  team("acme/secret-team", null),
];

let teardown: (() => void) | undefined;
afterEach(() => {
  teardown?.();
  teardown = undefined;
});

async function render(
  width: number,
  expanded: ReadonlySet<string> = new Set(),
): Promise<string> {
  const setup = await testRender(
    () => (
      <box flexDirection="column">
        <For each={BLOCKERS}>
          {(blocker, i) => (
            <BlockerRow
              blocker={blocker}
              width={width}
              id={`row-${i()}`}
              selected={i() === 2}
              expanded={!!blocker.team && expanded.has(blocker.team.slug)}
            />
          )}
        </For>
      </box>
    ),
    { width, height: 40 },
  );
  teardown = () => setup.renderer.destroy();
  await setup.renderOnce();
  return setup
    .captureCharFrame()
    .split("\n")
    .map((l) => l.trimEnd())
    .join("\n")
    .trimEnd();
}

describe("Mergeability team rows", () => {
  test("wide terminal", async () => {
    expect(await render(100)).toMatchSnapshot();
  });

  test("narrow terminal", async () => {
    const frame = await render(36);
    expect(frame).toMatchSnapshot();
    // Nothing is clipped at the edge: every row ends inside the column.
    for (const line of frame.split("\n")) {
      expect(line.length).toBeLessThanOrEqual(36);
    }
  });

  test("an expanded team lists every member", async () => {
    const frame = await render(
      60,
      new Set(["acme/platform-infrastructure-reviewers"]),
    );
    expect(frame).toMatchSnapshot();
    expect(frame).toContain("@dev24");
    expect(frame).not.toContain("more");
  });
});
