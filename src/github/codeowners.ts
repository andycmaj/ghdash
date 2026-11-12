// CODEOWNERS parsing and path matching, following GitHub's documented rules:
// gitignore-style patterns, last matching rule wins, a rule with no owners
// leaves its paths unowned. Negation (`!`) and `[...]` ranges are unsupported
// by GitHub, so rules using them are skipped.

// GitHub reads the first of these that exists on the PR's base branch.
export const CODEOWNERS_PATHS = [
  ".github/CODEOWNERS",
  "CODEOWNERS",
  "docs/CODEOWNERS",
] as const;

export interface CodeownersRule {
  pattern: string;
  // "@login", "@org/team" (lowercased), or an email address.
  owners: string[];
  regex: RegExp;
}

export function parseCodeowners(text: string): CodeownersRule[] {
  const rules: CodeownersRule[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = stripComment(raw).trim();
    if (!line) continue;
    const [pattern, ...owners] = line.split(/\s+/);
    if (!pattern || pattern.startsWith("!") || /[[\]]/.test(pattern)) continue;
    rules.push({
      pattern,
      owners: owners.map((o) => (o.startsWith("@") ? o.toLowerCase() : o)),
      regex: patternToRegex(pattern),
    });
  }
  return rules;
}

// `#` starts a comment unless escaped (`\#` is a literal hash in a pattern).
function stripComment(line: string): string {
  const match = line.match(/(^|[^\\])#/);
  if (!match || match.index === undefined) return line;
  return line.slice(0, match.index + (match[1] ?? "").length);
}

// The owners of a path under the last matching rule; empty when unowned.
export function ownersForPath(rules: CodeownersRule[], path: string): string[] {
  for (let i = rules.length - 1; i >= 0; i--) {
    if (rules[i].regex.test(path)) return rules[i].owners;
  }
  return [];
}

export function patternToRegex(pattern: string): RegExp {
  let p = pattern.replace(/\\#/g, "#");
  const dirOnly = p.endsWith("/");
  if (dirOnly) p = p.replace(/\/+$/, "");
  // A leading or interior slash anchors the pattern to the repo root;
  // otherwise it matches at any depth.
  const anchored = p.startsWith("/") || p.includes("/");
  p = p.replace(/^\/+/, "");

  const body = globToRegex(p);
  const prefix = anchored ? "^" : "^(?:.*/)?";
  // A directory match owns everything beneath it. GitHub documents `docs/*` as
  // matching only direct children, so a wildcard final segment doesn't extend
  // into subdirectories.
  const lastSegment = p.slice(p.lastIndexOf("/") + 1);
  const suffix = dirOnly
    ? "/.*$"
    : /[*?]/.test(lastSegment) && lastSegment !== "**"
      ? "$"
      : "(?:/.*)?$";
  return new RegExp(prefix + body + suffix);
}

function globToRegex(glob: string): string {
  let out = "";
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    if (ch === "*") {
      if (glob[i + 1] === "*") {
        const atSegmentStart = i === 0 || glob[i - 1] === "/";
        if (atSegmentStart && glob[i + 2] === "/") {
          out += "(?:.*/)?";
          i += 2;
        } else {
          out += ".*";
          i += 1;
        }
      } else {
        out += "[^/]*";
      }
    } else if (ch === "?") {
      out += "[^/]";
    } else {
      out += ch.replace(/[.+^${}()|\\]/g, "\\$&");
    }
  }
  return out;
}
