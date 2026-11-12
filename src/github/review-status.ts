// Infers which reviews actually block a PR by intersecting CODEOWNERS (on the
// changed files) with team membership and the latest writer reviews.

import { ownersForPath, type CodeownersRule } from "./codeowners";
import type {
  CodeOwnerGroup,
  ReviewDecision,
  ReviewRequest,
  ReviewState,
  ReviewStatus,
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
  // The base branch's protection, when visible; null when there is none we
  // can see (rulesets, or no access).
  protection: {
    requiredApprovals: number;
    requiresCodeOwnerReviews: boolean;
  } | null;
  // null when the repo has no CODEOWNERS file or it couldn't be read.
  codeowners: CodeownersRule[] | null;
  changedFiles: string[];
  changedFilesComplete: boolean;
  // Members by "org/team-slug" (lowercased); null when membership isn't visible.
  teamMembers: ReadonlyMap<string, string[] | null>;
}

// Owners as written in CODEOWNERS ("@org/team", "@user") to the names used
// everywhere else: "org/team" for teams, "@user" for people.
function ownerName(owner: string): string {
  return owner.startsWith("@") && owner.includes("/") ? owner.slice(1) : owner;
}

function isTeamOwner(owner: string): boolean {
  return owner.startsWith("@") && owner.includes("/");
}

// The teams named in the CODEOWNERS rules for these files, so the client knows
// whose membership to fetch.
export function codeOwnerTeams(
  codeowners: CodeownersRule[] | null,
  changedFiles: string[],
): string[] {
  if (!codeowners) return [];
  const teams = new Set<string>();
  for (const path of changedFiles) {
    for (const owner of ownersForPath(codeowners, path)) {
      if (isTeamOwner(owner)) teams.add(ownerName(owner));
    }
  }
  return [...teams];
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
  const githubRequires = input.githubDecision !== null;
  const requiredApprovals = Math.max(
    input.protection?.requiredApprovals ?? 0,
    githubRequires ? 1 : 0,
  );
  const codeOwnersRequired =
    input.protection?.requiresCodeOwnerReviews === true ||
    (githubRequires &&
      (input.reviewRequests.some((r) => r.asCodeOwner) ||
        (input.protection === null && input.codeowners !== null)));

  const groups = codeOwnersRequired ? codeOwnerGroups(input, approvedBy) : [];
  const ownerNames = new Set(
    groups.flatMap((g) => g.owners.map((o) => o.toLowerCase())),
  );
  const otherRequests = input.reviewRequests.filter(
    (r) => !r.asCodeOwner && !ownerNames.has(r.name.toLowerCase()),
  );

  const required = requiredApprovals > 0 || codeOwnersRequired;
  const satisfied =
    changesRequestedBy.length === 0 &&
    approvedBy.length >= requiredApprovals &&
    groups.every((g) => g.satisfied);

  return {
    required,
    requiredApprovals,
    approvedBy,
    changesRequestedBy,
    codeOwnerGroups: groups,
    otherRequests,
    complete:
      !codeOwnersRequired ||
      (input.codeowners !== null && input.changedFilesComplete),
    satisfied,
    githubDecision: input.githubDecision,
  };
}

function codeOwnerGroups(
  input: ReviewInputs,
  approvedBy: string[],
): CodeOwnerGroup[] {
  if (!input.codeowners) return fallbackGroups(input);

  // Files with the same owner set need the same approval, so group them.
  const byOwners = new Map<string, { owners: string[]; paths: string[] }>();
  for (const path of input.changedFiles) {
    const owners = ownersForPath(input.codeowners, path).map(ownerName);
    if (owners.length === 0) continue;
    const key = [...owners].sort().join(" ");
    const group = byOwners.get(key);
    if (group) group.paths.push(path);
    else byOwners.set(key, { owners, paths: [path] });
  }

  return [...byOwners.values()].map(({ owners, paths }) =>
    resolveGroup(input, owners, paths, approvedBy),
  );
}

// Without a readable CODEOWNERS, the pending code-owner requests are the only
// owners we know of; once one is fulfilled GitHub drops it, so this can miss
// groups (reported via `complete: false`).
function fallbackGroups(input: ReviewInputs): CodeOwnerGroup[] {
  return input.reviewRequests
    .filter((r) => r.asCodeOwner)
    .map((r) => resolveGroup(input, [r.name], [], []));
}

function resolveGroup(
  input: ReviewInputs,
  owners: string[],
  paths: string[],
  approvedBy: string[],
): CodeOwnerGroup {
  const author = input.author.toLowerCase();
  const users = new Set<string>();
  const teams: string[] = [];
  let membershipKnown = true;
  for (const owner of owners) {
    if (owner.startsWith("@")) {
      users.add(owner.slice(1).toLowerCase());
    } else if (owner.includes("/")) {
      const slug = owner.toLowerCase();
      teams.push(slug);
      const members = input.teamMembers.get(slug);
      if (members) for (const m of members) users.add(m.toLowerCase());
      else membershipKnown = false;
    } else {
      // An email owner: GitHub maps it to an account we can't see.
      membershipKnown = false;
    }
  }

  const approvers = approvedBy.filter((login) => {
    if (users.has(login.toLowerCase())) return true;
    const review = input.latestReviews.find((r) => r.login === login);
    return !!review?.onBehalfOf.some((t) => teams.includes(t.toLowerCase()));
  });

  users.delete(author);
  return {
    owners,
    paths,
    approvedBy: approvers,
    candidates: membershipKnown ? [...users].sort() : null,
    satisfied: approvers.length > 0,
  };
}
