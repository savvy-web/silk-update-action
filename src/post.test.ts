/**
 * Fixture tests for the post-action Effect program.
 *
 * Drives `post` against the in-memory test layers. The provisioned-token
 * scenarios run `GitHubToken.provision` first against a shared `ActionState`
 * to populate the token envelope `dispose` reads back.
 */

import { GitHubToken } from "@savvy-web/github-action-effects";
import type {
	ActionOutputs,
	ActionState,
	ActionStateTestState,
	GitHubApp,
	GitHubAppTestState,
} from "@savvy-web/github-action-effects/testing";
import { ActionOutputsTest, ActionStateTest, GitHubAppTest } from "@savvy-web/github-action-effects/testing";
import { ConfigProvider, Effect, Layer, Redacted } from "effect";
import { describe, expect, it } from "vitest";
import { post } from "./post.js";

interface Fixtures {
	stateState: ActionStateTestState;
	appState: GitHubAppTestState;
	layer: Layer.Layer<ActionState | GitHubApp | ActionOutputs>;
}

const makeFixtures = (): Fixtures => {
	const stateState = ActionStateTest.empty();
	const appState = GitHubAppTest.empty();
	// provision masks the minted token via ActionOutputs.setSecret, so the
	// shared layer must satisfy ActionOutputs as well.
	const layer = Layer.mergeAll(
		ActionStateTest.layer(stateState),
		GitHubAppTest.layer(appState),
		ActionOutputsTest.layer(ActionOutputsTest.empty()),
	);
	return { stateState, appState, layer };
};

/** Provision a token into the shared ActionState, simulating the pre phase. */
const provisionToken = (fixtures: Fixtures): Promise<void> =>
	GitHubToken.provision({ clientId: "test-client-id", privateKey: "test-private-key" }).pipe(
		Effect.provide(fixtures.layer),
		Effect.asVoid,
		Effect.runPromise,
	);

const runPost = (fixtures: Fixtures, skipTokenRevoke = false): Promise<void> => {
	const config = ConfigProvider.fromMap(new Map([["skip-token-revoke", String(skipTokenRevoke)]]));
	return post.pipe(Effect.provide(fixtures.layer), Effect.withConfigProvider(config), Effect.runPromise);
};

describe("post", () => {
	it("revokes the installation token provisioned by pre", async () => {
		const fixtures = makeFixtures();
		await provisionToken(fixtures);
		await runPost(fixtures);
		expect(fixtures.appState.revokeCalls.map(Redacted.value)).toContain("ghs_test_token_123");
	});

	it("skips revocation when skip-token-revoke is true", async () => {
		const fixtures = makeFixtures();
		await provisionToken(fixtures);
		await runPost(fixtures, true);
		expect(fixtures.appState.revokeCalls).toHaveLength(0);
	});

	it("completes cleanly when no token was provisioned", async () => {
		const fixtures = makeFixtures();
		await runPost(fixtures);
		expect(fixtures.appState.revokeCalls).toHaveLength(0);
	});

	it("reports duration when pre recorded a start time", async () => {
		const fixtures = makeFixtures();
		fixtures.stateState.entries.set("startTime", JSON.stringify({ startedAt: Date.now() - 1000 }));
		await provisionToken(fixtures);
		// The duration-log path runs without throwing; revocation still happens.
		await runPost(fixtures);
		expect(fixtures.appState.revokeCalls.map(Redacted.value)).toContain("ghs_test_token_123");
	});
});
