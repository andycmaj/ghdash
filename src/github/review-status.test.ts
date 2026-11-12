import { describe, expect, test } from "bun:test";
import {
  inferReviewStatus,
  requestedTeams,
  type ReviewInputs,
} from "./review-status";
import type { ReviewRequest } from "./types";

const PLATFORM: ReviewRequest = {
  name: "octo-org/platform",
  isTeam: true,
  asCodeOwner: true,
};
const PAYMENTS: ReviewRequest = {
  name: "octo-org/payments",
  isTeam: true,
  asCodeOwner: true,
};

function inputs(over: Partial<ReviewInputs> = {}): ReviewInputs {
  return {
    author: "me",
    githubDecision: "REVIEW_REQUIRED",
    reviewRequests: [PLATFORM, PAYMENTS],
    latestReviews: [],
    protection: { requiredApprovals: 1 },
    teamMembers: new Map([
      ["octo-org/platform", ["alice", "me"]],
      ["octo-org/payments", ["bob", "carol"]],
    ]),
    ...over,
  };
}

describe("requestedTeams", () => {
  test("lists every requested team, lowercased", () => {
    expect(
      requestedTeams([
        { name: "Octo-Org/X", isTeam: true, asCodeOwner: false },
        { name: "@dave", isTeam: false, asCodeOwner: true },
      ]),
    ).toEqual(["octo-org/x"]);
  });
});

describe("inferReviewStatus", () => {
  test("a member's approval satisfies a team GitHub still lists as pending", () => {
    const status = inferReviewStatus(
      inputs({
        latestReviews: [{ login: "Alice", state: "APPROVED", onBehalfOf: [] }],
      }),
    );
    const [platform, payments] = status.requirements;
    expect(platform?.satisfied).toBe(true);
    expect(platform?.approvedBy).toEqual(["Alice"]);
    expect(payments?.satisfied).toBe(false);
    expect(payments?.candidates).toEqual(["bob", "carol"]);
    expect(status.satisfied).toBe(false);
  });

  test("satisfied once every required team has a member approval", () => {
    const status = inferReviewStatus(
      inputs({
        latestReviews: [
          { login: "alice", state: "APPROVED", onBehalfOf: [] },
          { login: "bob", state: "APPROVED", onBehalfOf: [] },
        ],
      }),
    );
    expect(status.satisfied).toBe(true);
  });

  test("a non-member's approval doesn't satisfy the team", () => {
    const status = inferReviewStatus(
      inputs({
        reviewRequests: [PAYMENTS],
        latestReviews: [{ login: "alice", state: "APPROVED", onBehalfOf: [] }],
      }),
    );
    expect(status.requirements[0]?.satisfied).toBe(false);
    expect(status.satisfied).toBe(false);
  });

  test("the author is never a candidate or an approver", () => {
    const status = inferReviewStatus(
      inputs({
        reviewRequests: [PLATFORM],
        latestReviews: [{ login: "me", state: "APPROVED", onBehalfOf: [] }],
      }),
    );
    expect(status.approvedBy).toEqual([]);
    expect(status.requirements[0]?.candidates).toEqual(["alice"]);
  });

  test("onBehalfOf counts when membership isn't visible", () => {
    const status = inferReviewStatus(
      inputs({
        reviewRequests: [PLATFORM],
        teamMembers: new Map([["octo-org/platform", null]]),
        latestReviews: [
          {
            login: "zed",
            state: "APPROVED",
            onBehalfOf: ["octo-org/platform"],
          },
        ],
      }),
    );
    expect(status.requirements[0]?.satisfied).toBe(true);
    expect(status.requirements[0]?.candidates).toBeNull();
  });

  test("a writer's change request blocks even with approvals", () => {
    const status = inferReviewStatus(
      inputs({
        latestReviews: [
          { login: "alice", state: "APPROVED", onBehalfOf: [] },
          { login: "bob", state: "APPROVED", onBehalfOf: [] },
          { login: "carol", state: "CHANGES_REQUESTED", onBehalfOf: [] },
        ],
      }),
    );
    expect(status.changesRequestedBy).toEqual(["carol"]);
    expect(status.satisfied).toBe(false);
  });

  test("the approval count comes from branch protection", () => {
    const status = inferReviewStatus(
      inputs({
        reviewRequests: [],
        protection: { requiredApprovals: 2 },
        latestReviews: [{ login: "alice", state: "APPROVED", onBehalfOf: [] }],
      }),
    );
    expect(status.requiredApprovals).toBe(2);
    expect(status.satisfied).toBe(false);
  });

  test("without visible protection, GitHub's decision implies one approval", () => {
    const status = inferReviewStatus(
      inputs({ reviewRequests: [], protection: null }),
    );
    expect(status.requiredApprovals).toBe(1);
  });

  test("nothing is required with no protection, decision or code-owner request", () => {
    const status = inferReviewStatus(
      inputs({ reviewRequests: [], protection: null, githubDecision: null }),
    );
    expect(status.required).toBe(false);
  });

  test("optional requests don't block, and drop out once a member approves", () => {
    const optionalTeam: ReviewRequest = { ...PAYMENTS, asCodeOwner: false };
    const dave: ReviewRequest = {
      name: "@dave",
      isTeam: false,
      asCodeOwner: false,
    };
    const status = inferReviewStatus(
      inputs({
        reviewRequests: [optionalTeam, dave],
        latestReviews: [{ login: "bob", state: "APPROVED", onBehalfOf: [] }],
      }),
    );
    expect(status.requirements).toEqual([]);
    expect(status.otherRequests).toEqual([dave]);
    expect(status.satisfied).toBe(true);
  });

  test("an individual code owner is satisfied only by their own approval", () => {
    const status = inferReviewStatus(
      inputs({
        reviewRequests: [{ name: "@Carol", isTeam: false, asCodeOwner: true }],
        latestReviews: [{ login: "bob", state: "APPROVED", onBehalfOf: [] }],
      }),
    );
    expect(status.requirements[0]?.satisfied).toBe(false);
    expect(status.requirements[0]?.candidates).toEqual(["carol"]);
  });
});
