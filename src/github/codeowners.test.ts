import { describe, expect, test } from "bun:test";
import { ownersForPath, parseCodeowners, patternToRegex } from "./codeowners";

function matches(pattern: string, path: string): boolean {
  return patternToRegex(pattern).test(path);
}

describe("patternToRegex", () => {
  test("* matches every file", () => {
    expect(matches("*", "README.md")).toBe(true);
    expect(matches("*", "a/b/c.ts")).toBe(true);
  });

  test("extension glob matches at any depth", () => {
    expect(matches("*.js", "app.js")).toBe(true);
    expect(matches("*.js", "src/deep/app.js")).toBe(true);
    expect(matches("*.js", "src/app.ts")).toBe(false);
  });

  test("bare directory name matches anywhere and owns its contents", () => {
    expect(matches("apps/", "apps/web/index.ts")).toBe(true);
    expect(matches("apps/", "packages/apps/x.ts")).toBe(true);
    expect(matches("apps/", "apps")).toBe(false);
    expect(matches("logs", "build/logs/out.txt")).toBe(true);
  });

  test("leading slash anchors to the root", () => {
    expect(matches("/docs/", "docs/a.md")).toBe(true);
    expect(matches("/docs/", "src/docs/a.md")).toBe(false);
  });

  test("interior slash anchors to the root", () => {
    expect(matches("src/api", "src/api/handler.ts")).toBe(true);
    expect(matches("src/api", "lib/src/api/handler.ts")).toBe(false);
  });

  test("docs/* matches direct children only", () => {
    expect(matches("docs/*", "docs/getting-started.md")).toBe(true);
    expect(matches("docs/*", "docs/build-app/troubleshooting.md")).toBe(false);
  });

  test("** spans directories", () => {
    expect(matches("**/logs", "deeply/nested/logs/x")).toBe(true);
    expect(matches("/src/**/*.test.ts", "src/a/b/c.test.ts")).toBe(true);
    expect(matches("/src/**/*.test.ts", "src/c.test.ts")).toBe(true);
    expect(matches("docs/**", "docs/a/b.md")).toBe(true);
  });

  test("dots are literal", () => {
    expect(matches("a.md", "abmd")).toBe(false);
  });
});

describe("parseCodeowners", () => {
  const rules = parseCodeowners(`
# Default owners
*       @Octo-Org/Everyone
*.ts    @alice   # trailing comment
/src/payments/ @octo-org/payments @bob
/vendor/
!ignored @nobody
docs/*  docs@example.com
`);

  test("skips comments, blanks and unsupported negation", () => {
    expect(rules.map((r) => r.pattern)).toEqual([
      "*",
      "*.ts",
      "/src/payments/",
      "/vendor/",
      "docs/*",
    ]);
  });

  test("lowercases handles but keeps emails", () => {
    expect(rules[0]?.owners).toEqual(["@octo-org/everyone"]);
    expect(rules[4]?.owners).toEqual(["docs@example.com"]);
  });

  test("last matching rule wins", () => {
    expect(ownersForPath(rules, "README.md")).toEqual(["@octo-org/everyone"]);
    expect(ownersForPath(rules, "src/app.ts")).toEqual(["@alice"]);
    expect(ownersForPath(rules, "src/payments/charge.ts")).toEqual([
      "@octo-org/payments",
      "@bob",
    ]);
  });

  test("a rule without owners leaves paths unowned", () => {
    expect(ownersForPath(rules, "vendor/lib.js")).toEqual([]);
  });
});
