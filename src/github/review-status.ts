// Works out which reviews actually block a PR. GitHub keeps listing a required
// team as pending even after one of its members approves, so a team request is
// treated as satisfied once any member's latest review approves.

import type {
  ReviewDecision,
  ReviewRequest,
  ReviewState,
  ReviewStatus,
  ReviewerRequirement,
} from "./types";

export interface LatestReview {
  login: string;
  state: ReviewState;
  // Teams ("org/team-slug") GitHub credited this review to.
  onBehalfOf: string[];
}

export interface ReviewInputs {
  author: string;
  githubDecision: ReviewDecision;
  reviewRequests: ReviewRequest[];
  // Latest opinionated review per user, from users with write access.
  latestReviews: LatestReview[];
  // The base branch's protection, when visible; null under rulesets or
  // without access.
  protection: { requiredApprovals: number } | null;
  // Members by "org/team-slug" (lowercased); null when membership isn't visible.
  teamMembers: ReadonlyMap<string, string[] | null>;
}

export function requestedTeams(requests: ReviewRequest[]): string[] {
  return requests.filter((r) => r.isTeam).map((r) => r.name.toLowerCase());
}

export function inferReviewStatus(input: ReviewInputs): ReviewStatus {
  const author = input.author.toLowerCase();
  const approvedBy = input.latestReviews
    .filter((r) => r.state === "APPROVED" && r.login.toLowerCase() !== author)
    .map((r) => r.login);
  const changesRequestedBy = input.latestReviews
    .filter((r) => r.state === "CHANGES_REQUESTED")
    .map((r) => r.login);

  // A non-null decision means GitHub enforces some review rule even when the
  // branch protection that says so isn't visible to us (e.g. rulesets).
  const requiredApprovals = Math.max(
    input.protection?.requiredApprovals ?? 0,
    input.githubDecision !== null ? 1 : 0,
  );

  // GitHub only blocks on requests it made because the reviewer owns changed
  // files.
  const requirements = input.reviewRequests
    .filter((r) => r.asCodeOwner)
    .map((r) => resolveRequirement(input, r, approvedBy));

  // Optional requests don't block, but a team whose member already approved
  // isn't really still waiting.
  const otherRequests = input.reviewRequests.filter(
    (r) =>
      !r.asCodeOwner && !resolveRequirement(input, r, approvedBy).satisfied,
  );

  const satisfied =
    changesRequestedBy.length === 0 &&
    approvedBy.length >= requiredApprovals &&
    requirements.every((g) => g.satisfied);

  return {
    required: requiredApprovals > 0 || requirements.length > 0,
    requiredApprovals,
    approvedBy,
    changesRequestedBy,
    requirements,
    otherRequests,
    satisfied,
    githubDecision: input.githubDecision,
  };
}

function resolveRequirement(
  input: ReviewInputs,
  request: ReviewRequest,
  approvedBy: string[],
): ReviewerRequirement {
  const author = input.author.toLowerCase();

  if (!request.isTeam) {
    const login = request.name.replace(/^@/, "").toLowerCase();
    const approvers = approvedBy.filter((l) => l.toLowerCase() === login);
    return {
      reviewer: request.name,
      isTeam: false,
      approvedBy: approvers,
      candidates: login === author ? [] : [login],
      satisfied: approvers.length > 0,
    };
  }

  const slug = request.name.toLowerCase();
  const members = input.teamMembers.get(slug) ?? null;
  const memberSet = new Set(members?.map((m) => m.toLowerCase()));
  const approvers = approvedBy.filter((login) => {
    if (memberSet.has(login.toLowerCase())) return true;
    const review = input.latestReviews.find((r) => r.login === login);
    return !!review?.onBehalfOf.some((t) => t.toLowerCase() === slug);
  });
  memberSet.delete(author);

  return {
    reviewer: request.name,
    isTeam: true,
    approvedBy: approvers,
    candidates: members ? [...memberSet].sort() : null,
    satisfied: approvers.length > 0,
  };
}
