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
  return {
    calls,
    fetch: Object.assign(impl, { preconnect: fetch.preconnect }),
  };
}

// bun-types declares `.rejects.toThrow()` as void, so awaiting it trips
// await-thenable; settle the promise ourselves instead.
function rejection(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => undefined,
    (err: unknown) => err,
  );
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
    expect(await rejection(client.listMyOpenPrs())).toBeInstanceOf(Error);

    expect(calls.count).toBe(1);
    expect(changes).toHaveLength(1);
    const until = client.throttledUntil!.getTime();
    expect(until).toBeGreaterThanOrEqual(before + 120_000);
    expect(until).toBeLessThan(Date.now() + 121_000);
  });

  test("primary limit waits for the quota reset", async () => {
    const { fetch } = fakeFetch([primaryLimit(600)]);
    const client = new GithubClient({ tokenOverride: "t", fetch });

    expect(await rejection(client.listMyOpenPrs())).toBeInstanceOf(Error);

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

function prNode(over: Record<string, unknown> = {}) {
  return {
    id: "PR_1",
    number: 7,
    title: "t",
    url: "https://github.com/o/r/pull/7",
    state: "OPEN",
    isDraft: false,
    createdAt: "",
    updatedAt: "",
    headRefName: "feature",
    baseRefName: "main",
    author: { login: "me", __typename: "User" },
    reviewDecision: "REVIEW_REQUIRED",
    reviewRequests: { nodes: [] },
    latestOpinionatedReviews: {
      nodes: [{ state: "APPROVED", author: { login: "alice" } }],
    },
    files: { totalCount: 2, nodes: [{ path: "a.ts" }, { path: "pay/b.ts" }] },
    baseRepository: { name: "r", owner: { login: "o" } },
    baseRef: {
      refUpdateRule: {
        requiredApprovingReviewCount: 1,
        requiresCodeOwnerReviews: true,
      },
      target: { oid: "abc" },
    },
    ...over,
  };
}

function recordingFetch(responses: object[]) {
  const queries: string[] = [];
  const impl = async (_url: unknown, init?: RequestInit) => {
    const body: unknown = JSON.parse(
      typeof init?.body === "string" ? init.body : "{}",
    );
    queries.push(
      typeof body === "object" && body && "query" in body
        ? String(body.query)
        : "",
    );
    const next = responses[queries.length - 1];
    if (!next) throw new Error("unexpected request");
    return json(200, next);
  };
  return {
    queries,
    fetch: Object.assign(impl, { preconnect: fetch.preconnect }),
  };
}

describe("GithubClient review inference", () => {
  const prResponse = {
    data: { repository: { pullRequest: prNode() } },
  };
  const codeowners = {
    data: {
      repository: {
        a: { text: "* @o/core\n/pay/ @o/pay\n" },
        b: null,
        c: null,
      },
    },
  };
  const teams = {
    data: {
      t0: { team: { members: { nodes: [{ login: "alice" }] } } },
      t1: { team: null },
    },
  };

  test("intersects CODEOWNERS teams with approvals, then serves both from cache", async () => {
    const { queries, fetch } = recordingFetch([
      prResponse,
      codeowners,
      teams,
      prResponse,
    ]);
    const client = new GithubClient({ tokenOverride: "t", fetch });

    const first = await client.getDashboardByNumber("o", "r", 7);
    expect(queries).toHaveLength(3);
    expect(queries[1]).toContain("query Codeowners");
    expect(queries[2]).toContain("query Teams");

    const reviews = first.mergeBlockers.filter(
      (b) => b.kind === "required-review",
    );
    expect(reviews.map((b) => [b.satisfied, b.description])).toEqual([
      [true, "Approved by @alice (1 required)"],
      [true, "o/core approved by @alice (a.ts)"],
      [
        false,
        "Needs approval from o/pay (pay/b.ts) — team members not visible",
      ],
    ]);

    await client.getDashboardByNumber("o", "r", 7);
    expect(queries).toHaveLength(4);
  });

  test("falls back to GitHub's decision when inference fails", async () => {
    const { fetch } = recordingFetch([
      prResponse,
      { errors: [{ message: "boom" }] },
    ]);
    const client = new GithubClient({ tokenOverride: "t", fetch });
    const warn = console.warn;
    console.warn = () => {};
    try {
      const dash = await client.getDashboardByNumber("o", "r", 7);
      const review = dash.mergeBlockers.find(
        (b) => b.kind === "required-review",
      );
      expect(review?.description).toBe("Required review not yet approved");
    } finally {
      console.warn = warn;
    }
  });
});
