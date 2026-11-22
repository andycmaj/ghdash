// Lays out a required team's Mergeability row: a header naming the team and
// its size, then its members as a wrapped list of status-tagged names. Pure,
// so the narrow/wide behaviour is testable without a renderer. Every line fits
// the given width: long words (slugs, logins) are cut with an ellipsis rather
// than hard-broken or allowed to overflow.

import type { TeamBlockerDetail, TeamMemberReview } from "@/github/types";

export type TeamTone =
  | "text"
  | "muted"
  | "approved"
  | "changes-requested"
  | "requested";

export interface TeamSpan {
  text: string;
  tone: TeamTone;
}

export type TeamLine = TeamSpan[];

export interface TeamLayout {
  header: TeamLine[];
  members: TeamLine[];
  // Members left out while collapsed; 0 when everything fits or is expanded.
  hidden: number;
}

export const MEMBER_GLYPH: Record<TeamMemberReview, string> = {
  approved: "✓",
  "changes-requested": "✗",
  requested: "○",
};

// Collapsed rows show this many member lines, the last ending in "+N more".
export const COLLAPSED_MEMBER_LINES = 2;

const SEP = "  ";
const ELLIPSIS = "…";

export function lineText(line: TeamLine): string {
  return line.map((s) => s.text).join("");
}

export function layoutTeam(
  team: TeamBlockerDetail,
  satisfied: boolean,
  width: number,
  expanded: boolean,
): TeamLayout {
  const w = Math.max(1, width);
  const textTone: TeamTone = satisfied ? "muted" : "text";
  const count = team.members === null ? "" : ` (${team.members.length})`;
  // Cut a long slug rather than the count after it.
  const name =
    team.slug.length + count.length <= w
      ? team.slug + count
      : fit(team.slug, w - count.length) + count;
  const words = satisfied
    ? [name, "approved"]
    : ["Needs", "approval", "from", name];
  const header = wrapTokens(
    words.map((word) => [{ text: word, tone: textTone }]),
    w,
    " ",
  );

  if (team.members === null) {
    return {
      header,
      members: [[{ text: fit("members not visible", w), tone: "muted" }]],
      hidden: 0,
    };
  }
  if (team.members.length === 0) {
    return {
      header,
      members: [
        [
          {
            text: fit("no eligible reviewer besides the author", w),
            tone: "muted",
          },
        ],
      ],
      hidden: 0,
    };
  }

  const tokens = team.members.map((m) =>
    memberToken(m.login, m.review, satisfied),
  );
  const all = wrapTokens(tokens, w, SEP);
  if (expanded || all.length <= COLLAPSED_MEMBER_LINES) {
    return { header, members: all, hidden: 0 };
  }

  // Show as many members as fit in the collapsed lines with the "+N more"
  // tag still on the last one.
  for (let shown = tokens.length - 1; shown >= 0; shown--) {
    const hidden = tokens.length - shown;
    const more: TeamLine = [{ text: `+${hidden} more`, tone: "muted" }];
    const lines = wrapTokens([...tokens.slice(0, shown), more], w, SEP);
    if (lines.length <= COLLAPSED_MEMBER_LINES) {
      return { header, members: lines, hidden };
    }
  }
  return { header, members: all.slice(0, COLLAPSED_MEMBER_LINES), hidden: 0 };
}

function memberToken(
  login: string,
  review: TeamMemberReview,
  satisfied: boolean,
): TeamLine {
  // A satisfied team's still-requested members are noise; keep them quiet.
  const nameTone: TeamTone =
    review === "requested" ? (satisfied ? "muted" : "text") : review;
  return [
    { text: MEMBER_GLYPH[review], tone: review },
    { text: ` @${login}`, tone: nameTone },
  ];
}

// Greedy word wrap over styled tokens. A token wider than the line is cut to
// fit with an ellipsis on its own line.
function wrapTokens(
  tokens: TeamLine[],
  width: number,
  sep: string,
): TeamLine[] {
  const lines: TeamLine[] = [];
  let line: TeamLine = [];
  let used = 0;
  for (const raw of tokens) {
    const token = fitLine(raw, width);
    const len = lineText(token).length;
    if (line.length > 0 && used + sep.length + len > width) {
      lines.push(line);
      line = [];
      used = 0;
    }
    if (line.length > 0) {
      line.push({ text: sep, tone: "text" });
      used += sep.length;
    }
    line.push(...token);
    used += len;
  }
  if (line.length > 0) lines.push(line);
  return lines;
}

function fitLine(token: TeamLine, width: number): TeamLine {
  if (lineText(token).length <= width) return token;
  const out: TeamLine = [];
  let left = width - ELLIPSIS.length;
  for (const span of token) {
    if (left <= 0) break;
    const text = span.text.slice(0, left);
    out.push({ text, tone: span.tone });
    left -= text.length;
  }
  const last = out.at(-1);
  if (last) last.text += ELLIPSIS;
  else out.push({ text: ELLIPSIS, tone: token[0]?.tone ?? "text" });
  return out;
}

function fit(text: string, width: number): string {
  return text.length <= width
    ? text
    : text.slice(0, Math.max(0, width - ELLIPSIS.length)) + ELLIPSIS;
}
