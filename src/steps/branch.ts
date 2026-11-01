/**
 * Step: validate the source and target refs, then create-or-reset the update
 * branch.
 *
 * Validation runs **first**, before any destructive operation: a typo'd
 * `source-branch` must abort before `GitBranch.upsert` force-resets anything.
 * Then commits a human pushed onto the update branch are looked for, and the
 * reset is skipped when there are any (#296): the run ends neutral and the
 * branch and its pull request are left as they are.
 *
 * **Failure posture: fail-the-job.** Both failure modes are fatal by design —
 * `InvalidInputError` for a missing ref (the run cannot proceed against a
 * branch that does not exist) and `GitHubError` for an API rejection (a branch
 * that could not be reset means the run would push onto stale state).
 *
 * @module steps/branch
 */

import type { GitCommandError, NotARepositoryError, UnknownRefError } from "@effected/git";
import type { CommitSummary, GitHubError, Repo } from "@effected/github";
import { BotIdentity } from "@effected/github";
import type { ActionState } from "@effected/github-actions";
import { GitHubToken } from "@effected/github-actions";
import { Effect, Option } from "effect";
import type { InvalidInputError } from "../errors/errors.js";
import type { BranchResult } from "../schema/domain.js";
import { BranchManager } from "../services/branch.js";

/**
 * `BranchManager`'s local git operations fail with `@effected/git`'s typed
 * errors; the API half and the ref preflight raise the other two.
 */
export type BranchStepError = GitHubError | InvalidInputError | GitCommandError | NotARepositoryError | UnknownRefError;

/**
 * What the step did: brought the branch to the source SHA, or left it alone
 * because someone other than the action had pushed to it (#296).
 */
export type BranchOutcome =
	| { readonly _tag: "Managed"; readonly result: BranchResult }
	| { readonly _tag: "ForeignCommits"; readonly commits: ReadonlyArray<CommitSummary> };

/**
 * The git author this action's commits carry, or none when it cannot be known.
 *
 * None when no token was persisted, and when the token carries no App identity
 * (the `github-actions[bot]` fallback): this action never commits as that bot,
 * so comparing against it would flag every one of its own commits and stop
 * updates for good.
 */
const ownAuthor: Effect.Effect<Option.Option<string>, never, ActionState> = GitHubToken.botIdentity().pipe(
	Effect.map((identity) =>
		identity.name === BotIdentity.githubActions.name ? Option.none() : Option.some(identity.name),
	),
	Effect.catch(() => Effect.succeed(Option.none<string>())),
);

/**
 * Validate both refs, check the update branch for commits the action did not
 * make, and bring it to the source SHA when there are none.
 */
export const branchStep = (
	branchName: string,
	sourceBranch: string,
	targetBranch: string,
	workspaceRoot: string,
): Effect.Effect<BranchOutcome, BranchStepError, BranchManager | Repo | ActionState> =>
	Effect.gen(function* () {
		const branchManager = yield* BranchManager;

		// Validate refs before any destructive branch operation.
		yield* branchManager.validateBranches(sourceBranch, targetBranch);

		// The reset below discards whatever is on the branch, so look first.
		const author = yield* ownAuthor;
		if (Option.isNone(author)) {
			yield* Effect.logWarning(
				`Step: branch — cannot verify who authored the commits on ${branchName} (no App identity in the token); resetting without the foreign-commit check`,
			);
		} else {
			const foreign = yield* branchManager.foreignCommits(branchName, sourceBranch, author.value);
			if (foreign.length > 0) {
				yield* Effect.logWarning(
					`Step: branch — SKIPPED: ${branchName} has ${foreign.length} commit(s) not made by ${author.value} (${foreign
						.map((c) => `${c.sha.slice(0, 7)} by ${c.authorLogin ?? c.author}`)
						.join(", ")}); the branch and its pull request are left as they are`,
				);
				return { _tag: "ForeignCommits", commits: foreign } as const;
			}
		}

		const branchResult = yield* branchManager.manage(branchName, workspaceRoot, sourceBranch);

		yield* Effect.logInfo(
			`Step: branch — ${branchResult.branch} ${
				branchResult.created ? "created" : "exists, reset"
			} from ${branchResult.baseRef}`,
		);

		return { _tag: "Managed", result: branchResult } as const;
	});
