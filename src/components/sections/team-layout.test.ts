import { describe, expect, test } from "bun:test";
import type { TeamBlockerDetail, TeamMember } from "@/github/types";
import {
  COLLAPSED_MEMBER_LINES,
  layoutTeam,
  lineText,
  type TeamLayout,
} from "./team-layout";

function members(n: number, approved = 0, changes = 0): TeamMember[] {
  return Array.from({ length: n }, (_, i) => ({
    login: `member-${String(i + 1).padStart(2, "0")}`,
    review:
      i < approved
        ? "approved"
        : i < approved + changes
          ? "changes-requested"
          : "requested",
  }));
}

function text(layout: TeamLayout): string[] {
  return [...layout.header, ...layout.members].map(lineText);
}

const BIG: TeamBlockerDetail = {
  slug: "octo-org/platform-reviewers",
  members: members(14, 1, 1),
};

describe("layoutTeam", () => {
  test("wide: header with count, members wrapped, the rest behind +N more", () => {
    expect(text(layoutTeam(BIG, false, 76, false))).toEqual([
      "Needs approval from octo-org/platform-reviewers (14)",
      "✓ @member-01  ✗ @member-02  ○ @member-03  ○ @member-04  ○ @member-05",
      "○ @member-06  ○ @member-07  ○ @member-08  ○ @member-09  +5 more",
    ]);
  });

  test("expanded shows every member", () => {
    const layout = layoutTeam(BIG, false, 76, true);
    expect(layout.hidden).toBe(0);
    expect(text(layout).slice(1)).toEqual([
      "✓ @member-01  ✗ @member-02  ○ @member-03  ○ @member-04  ○ @member-05",
      "○ @member-06  ○ @member-07  ○ @member-08  ○ @member-09  ○ @member-10",
      "○ @member-11  ○ @member-12  ○ @member-13  ○ @member-14",
    ]);
  });

  test("narrow: never wider than the column, slug cut with an ellipsis", () => {
    const layout = layoutTeam(BIG, false, 20, false);
    expect(text(layout)).toEqual([
      "Needs approval from",
      "octo-org/platf… (14)",
      "✓ @member-01",
      "+13 more",
    ]);
    for (const width of [1, 5, 12, 20, 33]) {
      for (const expanded of [false, true]) {
        for (const line of text(layoutTeam(BIG, false, width, expanded))) {
          expect(line.length).toBeLessThanOrEqual(width);
        }
      }
    }
  });

  test("collapsed rows keep to the line budget and count what they hide", () => {
    for (const width of [24, 40, 60, 100]) {
      const layout = layoutTeam(BIG, false, width, false);
      expect(layout.members.length).toBeLessThanOrEqual(COLLAPSED_MEMBER_LINES);
      const shown = layout.members
        .flatMap((l) => l)
        .filter((s) => s.text.startsWith(" @")).length;
      expect(shown + layout.hidden).toBe(BIG.members?.length ?? 0);
    }
  });

  test("tones members by review state", () => {
    const [first] = layoutTeam(BIG, false, 200, false).members;
    expect(first?.slice(0, 7).map((s) => s.tone)).toEqual([
      "approved",
      "approved",
      "text",
      "changes-requested",
      "changes-requested",
      "text",
      "requested",
    ]);
  });

  test("satisfied team reads as approved", () => {
    const layout = layoutTeam(
      { slug: "octo-org/web", members: members(2, 1) },
      true,
      60,
      false,
    );
    expect(text(layout)).toEqual([
      "octo-org/web (2) approved",
      "✓ @member-01  ○ @member-02",
    ]);
    expect(layout.header[0]?.[0]?.tone).toBe("muted");
  });

  test("hidden or empty membership", () => {
    expect(
      text(layoutTeam({ slug: "o/secret", members: null }, false, 60, false)),
    ).toEqual(["Needs approval from o/secret", "members not visible"]);
    expect(
      text(layoutTeam({ slug: "o/solo", members: [] }, false, 60, false)),
    ).toEqual([
      "Needs approval from o/solo (0)",
      "no eligible reviewer besides the author",
    ]);
  });
});
