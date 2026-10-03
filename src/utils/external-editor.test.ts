import { describe, expect, test } from "bun:test";
import { buildTemplate, stripTemplate } from "./external-editor";

describe("editor template", () => {
  test("an untouched template is empty", () => {
    expect(stripTemplate(buildTemplate(["Replying to @hubot", "> hi"]))).toBe(
      "",
    );
  });

  test("keeps markdown headings above the scissors and drops the guidance", () => {
    const edited = "# Heading\n\nLooks good.\n" + buildTemplate(["> hi"]);
    expect(stripTemplate(edited)).toBe("# Heading\n\nLooks good.");
  });

  test("a deleted scissors line keeps the whole file", () => {
    expect(stripTemplate("  just text \n")).toBe("just text");
  });
});
