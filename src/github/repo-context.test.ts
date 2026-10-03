import { describe, test, expect } from "bun:test";
import { parseRemoteUrl } from "./repo-context";

describe("parseRemoteUrl", () => {
  test("parses scp-style git@ url", () => {
    expect(parseRemoteUrl("git@github.com:octocat/hello-world.git")).toEqual({
      owner: "octocat",
      repo: "hello-world",
    });
  });

  test("parses scp-style url without .git suffix", () => {
    expect(parseRemoteUrl("git@github.com:octocat/hello-world")).toEqual({
      owner: "octocat",
      repo: "hello-world",
    });
  });

  test("parses https url", () => {
    expect(
      parseRemoteUrl("https://github.com/octocat/hello-world.git"),
    ).toEqual({
      owner: "octocat",
      repo: "hello-world",
    });
  });

  test("parses https url without .git", () => {
    expect(parseRemoteUrl("https://github.com/octocat/hello-world")).toEqual({
      owner: "octocat",
      repo: "hello-world",
    });
  });

  test("parses ssh:// url", () => {
    expect(
      parseRemoteUrl("ssh://git@github.com/octocat/hello-world.git"),
    ).toEqual({
      owner: "octocat",
      repo: "hello-world",
    });
  });

  test("handles repo names containing dots", () => {
    expect(parseRemoteUrl("git@github.com:acme/my.cool.repo.git")).toEqual({
      owner: "acme",
      repo: "my.cool.repo",
    });
  });

  test("returns null for unparseable input", () => {
    expect(parseRemoteUrl("not-a-url")).toBeNull();
  });
});
