import { describe, test, expect } from "bun:test";
import { GithubClient } from "./client";
import { checksVerdict, groupChecksByWorkflow } from "./status-utils";
import { CheckStatus } from "./types";

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
    reviewRequests: {
      nodes: [
        {
          asCodeOwner: true,
          requestedReviewer: { __typename: "Team", combinedSlug: "o/core" },
        },
        {
          asCodeOwner: true,
          requestedReviewer: { __typename: "Team", combinedSlug: "o/pay" },
        },
      ],
    },
    latestOpinionatedReviews: {
      nodes: [{ state: "APPROVED", author: { login: "alice" } }],
    },
    baseRef: { refUpdateRule: { requiredApprovingReviewCount: 1 } },
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
  const teams = {
    data: {
      t0: { team: { members: { nodes: [{ login: "alice" }] } } },
      t1: { team: null },
    },
  };

  test("credits a requested team with its member's approval, then serves membership from cache", async () => {
    const { queries, fetch } = recordingFetch([prResponse, teams, prResponse]);
    const client = new GithubClient({ tokenOverride: "t", fetch });

    const first = await client.getDashboardByNumber("o", "r", 7);
    expect(queries).toHaveLength(2);
    expect(queries[1]).toContain("query Teams");

    const reviews = first.mergeBlockers.filter(
      (b) => b.kind === "required-review",
    );
    expect(reviews.map((b) => [b.satisfied, b.description])).toEqual([
      [true, "Approved by @alice (1 required)"],
      [true, "o/core approved by @alice"],
      [false, "Needs approval from o/pay — team members not visible"],
    ]);

    await client.getDashboardByNumber("o", "r", 7);
    expect(queries).toHaveLength(3);
  });

  test("skips the membership query when no team is requested", async () => {
    const { queries, fetch } = recordingFetch([
      {
        data: {
          repository: {
            pullRequest: prNode({ reviewRequests: { nodes: [] } }),
          },
        },
      },
    ]);
    const client = new GithubClient({ tokenOverride: "t", fetch });
    const dash = await client.getDashboardByNumber("o", "r", 7);
    expect(queries).toHaveLength(1);
    const review = dash.mergeBlockers.find((b) => b.kind === "required-review");
    expect(review?.description).toBe(
      "Approved by @alice (1 required) · GitHub still reports review required",
    );
  });
});

// valstro/omskit#16091 (ghdash#7): every workflow ran twice on one SHA, 168
// contexts in all, and the only failing and pending jobs sit past the first
// page of 100.
const OLD_RUN = { number: 9263, createdAt: "2026-11-12T18:04:00Z" };
const NEW_RUN = { number: 9308, createdAt: "2026-11-12T20:45:00Z" };
const WORKFLOWS: [name: string, jobs: number][] = [
  ["CI", 50],
  ["project-checks", 12],
  ["tooling-checks", 10],
  ["migration-checks", 10],
  ["Lint PR", 1],
  ["Gitleaks", 1],
];

function checkContext(
  workflow: string,
  workflowIndex: number,
  run: typeof OLD_RUN,
  name: string,
  status: string,
  conclusion: string | null,
) {
  const id = run.number * 100 + workflowIndex;
  return {
    __typename: "CheckRun",
    name,
    status,
    conclusion,
    detailsUrl: `https://github.com/o/r/actions/runs/${id}/job/${id}${name.length}`,
    checkSuite: {
      workflowRun: {
        databaseId: id,
        runNumber: run.number,
        runAttempt: 1,
        event: "pull_request",
        createdAt: run.createdAt,
        workflow: { name: workflow },
      },
    },
    annotations: { nodes: [] },
  };
}

function duplicateRunContexts() {
  const passing: object[] = [];
  WORKFLOWS.forEach(([workflow, jobs], i) => {
    for (const run of [OLD_RUN, NEW_RUN]) {
      for (let j = 0; j < jobs; j++) {
        // The last CI job of each run is the interesting one, appended below.
        if (workflow === "CI" && j === jobs - 1) continue;
        passing.push(
          checkContext(
            workflow,
            i,
            run,
            `job-${j}`,
            "COMPLETED",
            j % 7 === 0 ? "SKIPPED" : "SUCCESS",
          ),
        );
      }
    }
  });
  return [
    ...passing,
    checkContext("CI", 0, OLD_RUN, "results", "COMPLETED", "FAILURE"),
    checkContext(
      "CI",
      0,
      NEW_RUN,
      "smoke-tests / enable-ondemand-scheduling",
      "QUEUED",
      null,
    ),
  ];
}

describe("GithubClient check contexts (ghdash#7)", () => {
  const contexts = duplicateRunContexts();
  const firstPage = {
    data: {
      repository: {
        pullRequest: prNode({
          reviewRequests: { nodes: [] },
          commits: {
            nodes: [
              {
                commit: {
                  id: "C_head",
                  statusCheckRollup: {
                    state: "FAILURE",
                    contexts: {
                      pageInfo: { hasNextPage: true, endCursor: "c100" },
                      nodes: contexts.slice(0, 100),
                    },
                  },
                },
              },
            ],
          },
        }),
      },
    },
  };
  const secondPage = {
    data: {
      node: {
        statusCheckRollup: {
          contexts: {
            pageInfo: { hasNextPage: false, endCursor: "c168" },
            nodes: contexts.slice(100),
          },
        },
      },
    },
  };

  test("pages past 100 contexts, groups by run, and keeps GitHub's verdict", async () => {
    expect(contexts).toHaveLength(168);
    const { queries, fetch } = recordingFetch([firstPage, secondPage]);
    const client = new GithubClient({ tokenOverride: "t", fetch });

    const dash = await client.getDashboardByNumber("o", "r", 7);

    expect(queries).toHaveLength(2);
    expect(queries[1]).toContain("query MoreContexts");
    expect(dash.checks).toHaveLength(168);
    expect(dash.checksRollup).toBe(CheckStatus.Failure);

    const groups = groupChecksByWorkflow(dash.checks);
    expect(groups).toHaveLength(12);
    expect(
      groups
        .slice(0, 2)
        .map((g) => [g.name, g.runLabel, g.superseded, g.status]),
    ).toEqual([
      ["CI", "#9308", false, CheckStatus.Pending],
      ["CI", "#9263", true, CheckStatus.Failure],
    ]);
    for (const g of groups) {
      expect(new Set(g.jobs.map((j) => j.name)).size).toBe(g.jobs.length);
    }

    const verdict = checksVerdict(dash.checks, dash.checksRollup);
    expect(verdict.status).toBe(CheckStatus.Pending);
    expect(verdict.counts.total).toBe(84);
    expect(verdict.rollupMismatch).toBe(CheckStatus.Failure);
    expect(verdict.explainedBySuperseded).toBe(true);

    const checksBlocker = dash.mergeBlockers.find(
      (b) => b.kind === "failing-check",
    );
    expect(checksBlocker).toEqual({
      kind: "failing-check",
      description:
        "1 check still running · 84 in superseded runs ignored · GitHub reports failure",
      satisfied: false,
    });
  });

  test("stops paging at the cap instead of looping forever", async () => {
    const endless = {
      data: {
        node: {
          statusCheckRollup: {
            contexts: {
              pageInfo: { hasNextPage: true, endCursor: "again" },
              nodes: [],
            },
          },
        },
      },
    };
    const { queries, fetch } = recordingFetch([
      firstPage,
      ...Array.from({ length: 20 }, () => endless),
    ]);
    const client = new GithubClient({ tokenOverride: "t", fetch });
    await client.getDashboardByNumber("o", "r", 7);
    expect(queries).toHaveLength(10);
    // octokit's throttler spaces GraphQL requests a second apart.
  }, 15_000);
});
