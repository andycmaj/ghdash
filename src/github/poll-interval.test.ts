import { describe, expect, test } from "bun:test";
import {
  DEFAULT_POLL_MS,
  DEFAULT_QUEUED_POLL_MS,
  pollIntervalFor,
} from "./poll-interval";
import type { MergeQueueEntry } from "./types";

function queued(state: string): { mergeQueue: MergeQueueEntry } {
  return { mergeQueue: { state, position: 2 } };
}

describe("pollIntervalFor", () => {
  test("uses the normal rate before the first fetch", () => {
    expect(pollIntervalFor(null, {})).toBe(DEFAULT_POLL_MS);
  });

  test("uses the normal rate for a PR outside the merge queue", () => {
    expect(pollIntervalFor({ mergeQueue: null }, {})).toBe(DEFAULT_POLL_MS);
  });

  test("slows down while the PR waits in the merge queue", () => {
    for (const state of ["QUEUED", "AWAITING_CHECKS", "MERGEABLE", "LOCKED"]) {
      expect(pollIntervalFor(queued(state), {})).toBe(DEFAULT_QUEUED_POLL_MS);
    }
    expect(DEFAULT_QUEUED_POLL_MS).toBeGreaterThan(DEFAULT_POLL_MS);
  });

  test("keeps the normal rate when the queue entry needs attention", () => {
    expect(pollIntervalFor(queued("UNMERGEABLE"), {})).toBe(DEFAULT_POLL_MS);
  });

  test("returns to the normal rate once the PR leaves the queue", () => {
    const opts = { pollMs: 10_000, queuedPollMs: 90_000 };
    expect(pollIntervalFor(queued("QUEUED"), opts)).toBe(90_000);
    expect(pollIntervalFor({ mergeQueue: null }, opts)).toBe(10_000);
  });

  test("honours configured intervals", () => {
    expect(pollIntervalFor({ mergeQueue: null }, { pollMs: 5000 })).toBe(5000);
    expect(pollIntervalFor(queued("QUEUED"), { queuedPollMs: 120_000 })).toBe(
      120_000,
    );
  });

  test("never polls a queued PR faster than the normal rate", () => {
    expect(
      pollIntervalFor(queued("QUEUED"), {
        pollMs: 300_000,
        queuedPollMs: 60_000,
      }),
    ).toBe(300_000);
  });
});
