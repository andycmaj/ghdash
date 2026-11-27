// How long the poll loop waits between dashboard fetches, by PR state.

import type { PullRequest } from "./types";

export const DEFAULT_POLL_MS = 15_000;
// A queued PR's state moves on the scale of CI runs, and each fetch also pulls
// the whole queue and its merge-group checks, so a fast poll mostly burns quota.
export const DEFAULT_QUEUED_POLL_MS = 60_000;

export interface PollIntervals {
  pollMs?: number;
  queuedPollMs?: number;
}

export function pollIntervalFor(
  pr: Pick<PullRequest, "mergeQueue"> | null,
  intervals: PollIntervals,
): number {
  const normal = intervals.pollMs ?? DEFAULT_POLL_MS;
  const entry = pr?.mergeQueue;
  // UNMERGEABLE means GitHub is about to drop the PR from the queue: the owner
  // needs to see that promptly, so keep the normal rate.
  if (!entry || entry.state === "UNMERGEABLE") return normal;
  // A slow interval configured below the normal one shouldn't speed polling up.
  return Math.max(normal, intervals.queuedPollMs ?? DEFAULT_QUEUED_POLL_MS);
}
