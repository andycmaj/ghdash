import { describe, expect, test } from "bun:test";
import { parseCodeowners } from "./codeowners";
import {
  codeOwnerTeams,
  inferReviewStatus,
  type ReviewInputs,
} from "./review-status";

const CODEOWNERS = parseCodeowners(`
*                @octo-org/platform
/src/payments/   @octo-org/payments @carol
/docs/
`);

function inputs(over: Partial<ReviewInputs> = {}): ReviewInputs {
  return {
    author: "me",
    githubDecision: "REVIEW_REQUIRED",
    reviewRequests: [],
    latestReviews: [],
    protection: { requiredApprovals: 1, requiresCodeOwnerReviews: true },
    codeowners: CODEOWNERS,
    changedFiles: ["src/app.ts", "src/payments/charge.ts", "docs/readme.md"],
    changedFilesComplete: true,
    teamMembers: new Map([
      ["octo-org/platform", ["alice", "me"]],
      ["octo-org/payments", ["bob"]],
    ]),
    ...over,
  };
}

describe("codeOwnerTeams", () => {
  test("lists teams owning the changed files", () => {
    expect(
      codeOwnerTeams(CODEOWNERS, ["src/app.ts", "src/payments/x.ts"]).sort(),
    ).toEqual(["octo-org/payments", "octo-org/platform"]);
  });
});

describe("inferReviewStatus", () => {
  test("groups changed files by their owners and skips unowned ones", () => {
    const status = inferReviewStatus(inputs());
    expect(status.codeOwnerGroups.map((g) => g.owners)).toEqual([
      ["octo-org/platform"],
      ["octo-org/payments", "@carol"],
    ]);
    expect(status.codeOwnerGroups[1]?.paths).toEqual([
      "src/payments/charge.ts",
    ]);
  });

  test("a team member's approval satisfies the team even after GitHub drops the request", () => {
    const status = inferReviewStatus(
      inputs({
        reviewRequests: [],
        latestReviews: [{ login: "Alice", state: "APPROVED", onBehalfOf: [] }],
      }),
    );
    const [platform, payments] = status.codeOwnerGroups;
    expect(platform?.satisfied).toBe(true);
    expect(platform?.approvedBy).toEqual(["Alice"]);
    expect(payments?.satisfied).toBe(false);
    expect(payments?.candidates).toEqual(["bob", "carol"]);
    expect(status.satisfied).toBe(false);
  });

  test("the author is never a candidate or an approver", () => {
    const status = inferReviewStatus(
      inputs({
        latestReviews: [{ login: "me", state: "APPROVED", onBehalfOf: [] }],
      }),
    );
    expect(status.approvedBy).toEqual([]);
    expect(status.codeOwnerGroups[0]?.candidates).toEqual(["alice"]);
  });

  test("onBehalfOf counts when membership isn't visible", () => {
    const status = inferReviewStatus(
      inputs({
        teamMembers: new Map(),
        latestReviews: [
          {
            login: "zed",
            state: "APPROVED",
            onBehalfOf: ["octo-org/platform"],
          },
        ],
      }),
    );
    const platform = status.codeOwnerGroups[0];
    expect(platform?.satisfied).toBe(true);
    expect(platform?.candidates).toBeNull();
  });

  test("satisfied when every group and the approval count are met", () => {
    const status = inferReviewStatus(
      inputs({
        latestReviews: [
          { login: "alice", state: "APPROVED", onBehalfOf: [] },
          { login: "carol", state: "APPROVED", onBehalfOf: [] },
        ],
      }),
    );
    expect(status.satisfied).toBe(true);
  });

  test("a writer's change request blocks even with approvals", () => {
    const status = inferReviewStatus(
      inputs({
        latestReviews: [
          { login: "alice", state: "APPROVED", onBehalfOf: [] },
          { login: "carol", state: "APPROVED", onBehalfOf: [] },
          { login: "bob", state: "CHANGES_REQUESTED", onBehalfOf: [] },
        ],
      }),
    );
    expect(status.changesRequestedBy).toEqual(["bob"]);
    expect(status.satisfied).toBe(false);
  });

  test("code owner groups are skipped when the branch doesn't require them", () => {
    const status = inferReviewStatus(
      inputs({
        protection: { requiredApprovals: 2, requiresCodeOwnerReviews: false },
      }),
    );
    expect(status.codeOwnerGroups).toEqual([]);
    expect(status.requiredApprovals).toBe(2);
  });

  test("without visible protection, GitHub's decision implies one approval and code owners", () => {
    const status = inferReviewStatus(inputs({ protection: null }));
    expect(status.requiredApprovals).toBe(1);
    expect(status.codeOwnerGroups.length).toBe(2);
  });

  test("nothing is required with no protection and no decision", () => {
    const status = inferReviewStatus(
      inputs({ protection: null, githubDecision: null }),
    );
    expect(status.required).toBe(false);
  });

  test("falls back to pending code-owner requests when CODEOWNERS is unreadable", () => {
    const status = inferReviewStatus(
      inputs({
        codeowners: null,
        reviewRequests: [
          { name: "octo-org/payments", isTeam: true, asCodeOwner: true },
          { name: "@dave", isTeam: false, asCodeOwner: false },
        ],
      }),
    );
    expect(status.complete).toBe(false);
    expect(status.codeOwnerGroups.map((g) => g.owners)).toEqual([
      ["octo-org/payments"],
    ]);
    expect(status.otherRequests.map((r) => r.name)).toEqual(["@dave"]);
  });
});
