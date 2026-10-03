import { describe, test, expect } from "bun:test";
import { parsePrSpec } from "./pr-spec";

describe("parsePrSpec", () => {
  test("full https url", () => {
    expect(
      parsePrSpec("https://github.com/octocat/hello-world/pull/14354"),
    ).toEqual({ owner: "octocat", repo: "hello-world", number: 14354 });
  });

  test("url with trailing path/fragment", () => {
    expect(
      parsePrSpec(
        "https://github.com/octocat/hello-world/pull/14354/files#foo",
      ),
    ).toEqual({ owner: "octocat", repo: "hello-world", number: 14354 });
  });

  test("host without scheme", () => {
    expect(parsePrSpec("github.com/octocat/hello-world/pull/7")).toEqual({
      owner: "octocat",
      repo: "hello-world",
      number: 7,
    });
  });

  test("owner/repo#number", () => {
    expect(parsePrSpec("octocat/hello-world#14354")).toEqual({
      owner: "octocat",
      repo: "hello-world",
      number: 14354,
    });
  });

  test("bare number", () => {
    expect(parsePrSpec("14354")).toEqual({ number: 14354 });
  });

  test("hash number", () => {
    expect(parsePrSpec("#14354")).toEqual({ number: 14354 });
  });

  test("whitespace tolerated", () => {
    expect(parsePrSpec("  #12  ")).toEqual({ number: 12 });
  });

  test("returns null for junk", () => {
    expect(parsePrSpec("not-a-pr")).toBeNull();
    expect(parsePrSpec("")).toBeNull();
    expect(parsePrSpec("octocat/hello-world")).toBeNull();
  });
});
