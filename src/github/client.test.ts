import { describe, test, expect } from "bun:test";
import { GithubClient } from "./client";

const OK_SEARCH = { data: { search: { nodes: [] } } };

function json(
  status: number,
  body: object,
  headers: Record<string, string> = {},
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function secondaryLimit(retryAfterSec: number): Response {
  return json(
    403,
    { message: "You have exceeded a secondary rate limit." },
    { "retry-after": String(retryAfterSec) },
  );
}

function primaryLimit(resetInSec: number): Response {
  return json(
    403,
    { message: "API rate limit exceeded" },
    {
      "x-ratelimit-remaining": "0",
      "x-ratelimit-reset": String(Math.ceil(Date.now() / 1000) + resetInSec),
    },
  );
}

// Serves the queued responses in order, recording how many were requested.
function fakeFetch(responses: Response[]) {
  const calls = { count: 0 };
  const impl = async (): Promise<Response> => {
    const next = responses[calls.count++];
    if (!next) throw new Error("unexpected request");
    return next;
  };
  return { calls, fetch: impl as unknown as typeof fetch };
}

describe("GithubClient throttling", () => {
  test("long secondary limit fails fast and reports when to resume", async () => {
    const changes: (Date | null)[] = [];
    const { calls, fetch } = fakeFetch([secondaryLimit(120)]);
    const client = new GithubClient({
      tokenOverride: "t",
      fetch,
      onThrottleChange: (until) => changes.push(until),
    });

    const before = Date.now();
    await expect(client.listMyOpenPrs()).rejects.toThrow();

    expect(calls.count).toBe(1);
    expect(changes).toHaveLength(1);
    const until = client.throttledUntil!.getTime();
    expect(until).toBeGreaterThanOrEqual(before + 120_000);
    expect(until).toBeLessThan(Date.now() + 121_000);
  });

  test("primary limit waits for the quota reset", async () => {
    const { fetch } = fakeFetch([primaryLimit(600)]);
    const client = new GithubClient({ tokenOverride: "t", fetch });

    await expect(client.listMyOpenPrs()).rejects.toThrow();

    const remaining = client.throttledUntil!.getTime() - Date.now();
    expect(remaining).toBeGreaterThan(590_000);
  });

  test("short limit retries inline and clears once a request succeeds", async () => {
    const changes: (Date | null)[] = [];
    const { calls, fetch } = fakeFetch([
      secondaryLimit(1),
      json(200, OK_SEARCH),
    ]);
    const client = new GithubClient({
      tokenOverride: "t",
      fetch,
      onThrottleChange: (until) => changes.push(until),
    });

    expect(await client.listMyOpenPrs()).toEqual([]);

    expect(calls.count).toBe(2);
    expect(changes).toHaveLength(2);
    expect(changes[0]).toBeInstanceOf(Date);
    expect(changes[1]).toBeNull();
    expect(client.throttledUntil).toBeNull();
  });
});
