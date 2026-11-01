/**
 * Tests for the branch step's foreign-commit guard (#296).
 *
 * `manage` force-resets the update branch, so the step must look for commits a
 * human pushed onto it BEFORE calling it, and leave the branch alone when it
 * finds any. The `BranchManager` double records whether `manage` ran, because
 * "did the destructive reset happen" is the whole question.
 */

import type { CommitSummary } from "@effected/github";
import { CommitSummary as CommitSummaryClass, InstallationToken, RepoRef, Repo as RepoTag } from "@effected/github";
import { ActionState, ActionStateError } from "@effected/github-actions";
import { DateTime, Effect, Layer, Redacted, References } from "effect";
import { describe, expect, it } from "vitest";
import { BranchManager } from "../../../src/services/branch.js";
import { branchStep } from "../../../src/steps/branch.js";

const repoLayer = RepoTag.layer(RepoRef.make({ owner: "test", repo: "repo" }));

const human = CommitSummaryClass.make({
	sha: "h1",
	message: "fix: pin a peer",
	author: "A Maintainer",
	authorLogin: "maintainer",
	url: "https://github.com/test/repo/commit/h1",
	parents: [],
});

const tokenWith = (identity: Partial<{ appSlug: string; appUserId: number }>): InstallationToken =>
	InstallationToken.make({
		token: Redacted.make("ghs_test_token_123"),
		expiresAt: DateTime.makeUnsafe("2030-01-01T01:00:00Z"),
		installationId: 4242,
		permissions: {},
		...identity,
	});

const stateWith = (token: InstallationToken): Layer.Layer<ActionState> =>
	ActionState.layerTest({ get: (() => Effect.succeed(token)) as ActionState["Service"]["get"] });

const stateMissing: Layer.Layer<ActionState> = ActionState.layerTest({
	get: ((key: string) =>
		Effect.fail(new ActionStateError({ reason: "missing", key }))) as ActionState["Service"]["get"],
});

const run = (state: Layer.Layer<ActionState>, foreign: ReadonlyArray<CommitSummary>) => {
	const calls = { manage: 0, foreignAuthors: [] as Array<string> };
	const manager = Layer.succeed(BranchManager, {
		validateBranches: () => Effect.void,
		manage: (branch: string, _root: string, base = "main") =>
			Effect.sync(() => {
				calls.manage++;
				return { branch, created: false, upToDate: true, baseRef: base };
			}),
		commitChanges: () => Effect.die("not used"),
		ensureBaseHistory: () => Effect.die("not used"),
		foreignCommits: (_branch: string, _source: string, ownAuthor: string) =>
			Effect.sync(() => {
				calls.foreignAuthors.push(ownAuthor);
				return foreign;
			}),
	});
	const result = Effect.runPromise(
		branchStep("pnpm/config-deps", "main", "main", "/ws").pipe(
			Effect.provide(Layer.mergeAll(manager, repoLayer, state)),
			Effect.provideService(References.MinimumLogLevel, "None"),
		),
	);
	return { calls, result };
};

describe("branchStep — foreign commits", () => {
	it("checks ownership against the App's bot and resets when every commit is the bot's", async () => {
		const { calls, result } = run(stateWith(tokenWith({ appSlug: "silk-bot", appUserId: 7 })), []);
		const outcome = await result;
		expect(calls.foreignAuthors).toEqual(["silk-bot[bot]"]);
		expect(calls.manage).toBe(1);
		expect(outcome._tag).toBe("Managed");
	});

	it("leaves the branch alone when someone else pushed to it", async () => {
		const { calls, result } = run(stateWith(tokenWith({ appSlug: "silk-bot", appUserId: 7 })), [human]);
		const outcome = await result;
		expect(calls.manage).toBe(0);
		expect(outcome._tag).toBe("ForeignCommits");
		if (outcome._tag === "ForeignCommits") expect(outcome.commits.map((c) => c.sha)).toEqual(["h1"]);
	});

	// Without the App's identity the action cannot tell its own commits from
	// anyone's, and treating every commit as foreign would stop updates forever.
	it("skips the check and resets when no token is persisted", async () => {
		const { calls, result } = run(stateMissing, [human]);
		const outcome = await result;
		expect(calls.foreignAuthors).toEqual([]);
		expect(calls.manage).toBe(1);
		expect(outcome._tag).toBe("Managed");
	});

	it("skips the check when the token carries no App identity (github-actions fallback)", async () => {
		const { calls, result } = run(stateWith(tokenWith({})), [human]);
		const outcome = await result;
		expect(calls.foreignAuthors).toEqual([]);
		expect(calls.manage).toBe(1);
		expect(outcome._tag).toBe("Managed");
	});
});
