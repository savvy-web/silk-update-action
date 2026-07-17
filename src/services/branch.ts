/**
 * BranchManager service for branch management and commit operations.
 *
 * Handles creating, resetting, and switching branches for dependency updates.
 * Uses library services (GitBranch, GitCommit, CommandRunner) from
 * `@savvy-web/github-action-effects`.
 *
 * @module services/branch
 */

import { readFileSync } from "node:fs";
import type {
	CommandRunnerError,
	CommandRunnerShape,
	FileChange,
	GitBranchError,
	GitBranchShape,
	GitCommitError,
	GitCommitShape,
} from "@savvy-web/github-action-effects";
import { ActionInputError, CommandRunner, GitBranch, GitCommit } from "@savvy-web/github-action-effects";
import { Context, Effect, Layer } from "effect";

import type { BranchResult } from "../schemas/domain.js";

// ══════════════════════════════════════════════════════════════════════════════
// Service Interface
// ══════════════════════════════════════════════════════════════════════════════

export class BranchManager extends Context.Service<
	BranchManager,
	{
		readonly manage: (
			branchName: string,
			defaultBranch?: string,
		) => Effect.Effect<BranchResult, GitBranchError | CommandRunnerError>;
		readonly commitChanges: (
			message: string,
			branchName: string,
		) => Effect.Effect<void, GitCommitError | CommandRunnerError>;
		readonly validateBranches: (
			source: string,
			target: string,
		) => Effect.Effect<void, GitBranchError | ActionInputError>;
		/**
		 * Ensure `base` has enough local git history for the changeset diff.
		 *
		 * DepsRegen computes `git merge-base <base> HEAD` and reads the ancestor's
		 * tree, so it needs a local ref named `base` AND a common ancestor present.
		 * A `fetch-depth: 0` checkout of the base ref (the documented setup) already
		 * satisfies both. This is the safety net for shallower checkouts: it probes
		 * first and only fetches/deepens when the merge-base is missing.
		 */
		readonly ensureBaseHistory: (base: string) => Effect.Effect<void, CommandRunnerError>;
	}
>()("BranchManager") {}

// ══════════════════════════════════════════════════════════════════════════════
// Live Layer
// ══════════════════════════════════════════════════════════════════════════════

export const BranchManagerLive = Layer.effect(
	BranchManager,
	Effect.gen(function* () {
		const branch = yield* GitBranch;
		const commit = yield* GitCommit;
		const cmd = yield* CommandRunner;
		return {
			manage: (branchName, defaultBranch = "main") => manageBranchImpl(branch, cmd, branchName, defaultBranch),
			commitChanges: (message, branchName) => commitChangesImpl(commit, cmd, message, branchName),
			validateBranches: (source, target) => validateBranchesImpl(branch, source, target),
			ensureBaseHistory: (base) => ensureBaseHistoryImpl(cmd, base),
		};
	}),
);

// ══════════════════════════════════════════════════════════════════════════════
// Implementation
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Manage the dependency update branch.
 *
 * - If branch doesn't exist: create from default branch
 * - If branch exists: delete and recreate from default branch (fresh start)
 */
const manageBranchImpl = (
	branch: GitBranchShape,
	cmd: CommandRunnerShape,
	branchName: string,
	defaultBranch: string,
): Effect.Effect<BranchResult, GitBranchError | CommandRunnerError> =>
	Effect.gen(function* () {
		yield* Effect.logInfo(`Managing branch: ${branchName}`);

		// Check if branch exists
		const exists = yield* branch.exists(branchName);

		if (!exists) {
			// Create new branch from default branch
			yield* Effect.logInfo(`Branch ${branchName} does not exist, creating from ${defaultBranch}`);

			const baseSha = yield* branch.getSha(defaultBranch);
			yield* Effect.logDebug(`Base SHA for ${defaultBranch}: ${baseSha}`);
			yield* branch.create(branchName, baseSha);

			// Fetch and checkout the new branch, tracking the remote
			yield* cmd.exec("git", ["fetch", "origin"]);
			yield* cmd.exec("git", ["checkout", "-B", branchName, `origin/${branchName}`]);

			yield* Effect.logInfo(`Created and checked out branch ${branchName}`);

			return {
				branch: branchName,
				created: true,
				upToDate: true,
				baseRef: defaultBranch,
			};
		}

		// Branch exists - delete and recreate from default branch
		yield* Effect.logInfo(`Branch ${branchName} exists, resetting to ${defaultBranch}`);

		// Get the SHA of the default branch (via API, no local fetch needed)
		const baseSha = yield* branch.getSha(defaultBranch);
		yield* Effect.logDebug(`Base SHA for ${defaultBranch}: ${baseSha}`);

		// Delete the remote branch and recreate it from the source branch
		yield* branch.delete(branchName).pipe(
			Effect.catch((error) =>
				Effect.gen(function* () {
					yield* Effect.logWarning(`Failed to delete branch: ${error.reason}`);
				}),
			),
		);

		// Create the branch fresh from the source branch
		yield* branch.create(branchName, baseSha);
		yield* cmd.exec("git", ["fetch", "origin"]);
		yield* cmd.exec("git", ["checkout", "-B", branchName, `origin/${branchName}`]);

		yield* Effect.logInfo(`Reset branch ${branchName} to ${defaultBranch}`);

		return {
			branch: branchName,
			created: false,
			upToDate: true,
			baseRef: defaultBranch,
		};
	});

/**
 * Validate that the source and target branches exist before any branch
 * mutation. Fails fast with `ActionInputError` so a bad ref never triggers the
 * destructive delete-and-recreate. When `target === source`, the source check
 * already covers it, so the second existence check is skipped.
 */
const validateBranchesImpl = (
	branch: GitBranchShape,
	source: string,
	target: string,
): Effect.Effect<void, GitBranchError | ActionInputError> =>
	Effect.gen(function* () {
		const sourceExists = yield* branch.exists(source);
		if (!sourceExists) {
			return yield* Effect.fail(
				new ActionInputError({
					inputName: "source-branch",
					reason: `Source branch "${source}" does not exist`,
					rawValue: source,
				}),
			);
		}

		if (target !== source) {
			const targetExists = yield* branch.exists(target);
			if (!targetExists) {
				return yield* Effect.fail(
					new ActionInputError({
						inputName: "target-branch",
						reason: `Target branch "${target}" does not exist`,
						rawValue: target,
					}),
				);
			}
		}
	});

/**
 * Commit all changes via GitHub API for verified commits.
 *
 * Uses the library's GitCommit.commitFiles convenience method which wraps the
 * GitHub Git Data API (createTree + createCommit + updateRef) in a single call.
 * Supports file deletions via `{ path, sha: null }`.
 *
 * Commits are automatically verified/signed by GitHub when using a GitHub App token.
 */
const commitChangesImpl = (
	commit: GitCommitShape,
	cmd: CommandRunnerShape,
	message: string,
	branchName: string,
): Effect.Effect<void, GitCommitError | CommandRunnerError> =>
	Effect.gen(function* () {
		// Check if there are changes to commit.
		//
		// Use core.fileMode=false so a working tree dirtied only by executable-bit
		// flips (e.g. husky chmod-ing .husky hook scripts during a `run` command)
		// is not mistaken for a committable change. We commit file content via the
		// GitHub API at mode 100644, so a mode-only change produces an empty
		// tree-diff — committing it would create an empty commit and a spurious PR.
		const statusResult = yield* cmd.execCapture("git", ["-c", "core.fileMode=false", "status", "--porcelain"]);
		const lines = statusResult.stdout.split("\n").filter((l) => l.trim().length > 0);

		if (lines.length === 0) {
			yield* Effect.logInfo("No changes to commit");
			return;
		}

		yield* Effect.logInfo("Committing changes via GitHub API...");

		// Build FileChange entries from git status
		const fileChanges: FileChange[] = [];
		const cwd = process.cwd();

		for (const line of lines) {
			const status = line.substring(0, 2).trim();
			const filePath = line.substring(3);

			if (status === "D") {
				// Deleted file
				fileChanges.push({ path: filePath, sha: null });
				yield* Effect.logDebug(`Deleting file: ${filePath}`);
			} else {
				// Added or modified file — read content
				const absolutePath = filePath.startsWith("/") ? filePath : `${cwd}/${filePath}`;
				try {
					const content = readFileSync(absolutePath, "utf-8");
					fileChanges.push({ path: filePath, content });
				} catch {
					yield* Effect.logWarning(`Could not read file: ${filePath}, skipping`);
				}
			}
		}

		if (fileChanges.length === 0) {
			yield* Effect.logInfo("No file changes to commit");
			return;
		}

		yield* Effect.logDebug(`File changes: ${fileChanges.length}`);

		// Commit all files in one API call
		const commitSha = yield* commit.commitFiles(branchName, message, fileChanges);
		yield* Effect.logInfo(`Created commit: ${commitSha}`);

		// Sync local working tree with the remote commit.
		// Use reset --hard because checkout refuses to overwrite dirty/untracked files
		// that were just committed via the GitHub API.
		yield* cmd.exec("git", ["fetch", "origin", branchName]);
		yield* cmd.exec("git", ["reset", "--hard", `origin/${branchName}`]);
	});

/** True when `git merge-base <base> HEAD` resolves (ref exists AND a common ancestor is present). */
const hasMergeBase = (cmd: CommandRunnerShape, base: string): Effect.Effect<boolean, never> =>
	cmd.execCapture("git", ["merge-base", base, "HEAD"]).pipe(
		Effect.as(true),
		Effect.catch(() => Effect.succeed(false)),
	);

/** True when the repository is a shallow clone (history truncated). */
const isShallowRepo = (cmd: CommandRunnerShape): Effect.Effect<boolean, never> =>
	cmd.execCapture("git", ["rev-parse", "--is-shallow-repository"]).pipe(
		Effect.map((r) => r.stdout.trim() === "true"),
		Effect.catch(() => Effect.succeed(false)),
	);

/**
 * Ensure `base` has enough local history for `git merge-base <base> HEAD`.
 *
 * Probes first (the documented `fetch-depth: 0` + `ref: <base>` checkout already
 * satisfies this, so the common case does no work). Only when the merge-base is
 * missing does it fetch the base ref, deepen a shallow clone, and materialize a
 * local ref so the bare name resolves. Every git call is best-effort — a fetch
 * failure degrades to a clear, actionable warning rather than aborting the run
 * (DepsRegen will still surface a precise error if the diff genuinely can't be
 * computed).
 */
const ensureBaseHistoryImpl = (cmd: CommandRunnerShape, base: string): Effect.Effect<void, CommandRunnerError> =>
	Effect.gen(function* () {
		if (yield* hasMergeBase(cmd, base)) {
			yield* Effect.logDebug(`Base history for "${base}" already present; no fetch needed`);
			return;
		}

		yield* Effect.logInfo(`Base history for "${base}" not available locally; fetching to enable the changeset diff`);

		// Ensure the remote-tracking ref exists, deepen a shallow clone, then
		// materialize a local ref so `git merge-base <base> HEAD` resolves by name.
		yield* cmd.exec("git", ["fetch", "origin", `+refs/heads/${base}:refs/remotes/origin/${base}`]).pipe(Effect.ignore);
		if (yield* isShallowRepo(cmd)) {
			yield* cmd.exec("git", ["fetch", "--unshallow", "origin"]).pipe(Effect.ignore);
		}
		yield* cmd.exec("git", ["branch", "-f", base, `refs/remotes/origin/${base}`]).pipe(Effect.ignore);

		if (!(yield* hasMergeBase(cmd, base))) {
			yield* Effect.logWarning(
				`Could not establish a merge-base between "${base}" and HEAD. The changeset step diffs against ` +
					`this branch — check out with fetch-depth: 0 (and ensure "${base}" is fetched).`,
			);
		}
	});
