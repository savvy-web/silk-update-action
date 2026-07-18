/**
 * Fixture tests for the pre-action Effect program.
 *
 * Drives `pre` against the in-memory `@savvy-web/github-action-effects` test
 * layers. `pre` calls `GitHubToken.provision` with required scopes, so the
 * minted test token's `permissions` must grant them or `provision` fails with
 * `TokenPermissionError`.
 */

import type {
	ActionOutputs,
	ActionState,
	ActionStateTestState,
	GitHubApp,
	GitHubAppTestState,
} from "@savvy-web/github-action-effects/testing";
import { ActionOutputsTest, ActionStateTest, GitHubAppTest } from "@savvy-web/github-action-effects/testing";
import { ConfigProvider, Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { pre } from "./pre.js";

interface Fixtures {
	stateState: ActionStateTestState;
	appState: GitHubAppTestState;
	layer: Layer.Layer<ActionOutputs | ActionState | GitHubApp>;
}

const makeFixtures = (): Fixtures => {
	const stateState = ActionStateTest.empty();
	const base = GitHubAppTest.empty();
	// The default test token grants no permissions; override so provision's
	// scope verification (contents/pull_requests/checks: write) passes.
	const appState: GitHubAppTestState = {
		...base,
		tokenToReturn: {
			...base.tokenToReturn,
			permissions: { contents: "write", pull_requests: "write", checks: "write" },
		},
	};
	const layer = Layer.mergeAll(
		ActionOutputsTest.layer(ActionOutputsTest.empty()),
		ActionStateTest.layer(stateState),
		GitHubAppTest.layer(appState),
	);
	return { stateState, appState, layer };
};

const runPre = (fixtures: Fixtures): Promise<void> => {
	const config = ConfigProvider.fromUnknown({
		"app-client-id": "test-client-id",
		"app-private-key": "test-private-key",
	});
	return pre.pipe(Effect.provide(fixtures.layer), Effect.provide(ConfigProvider.layer(config)), Effect.runPromise);
};

describe("pre", () => {
	it("provisions an installation token", async () => {
		const fixtures = makeFixtures();
		await runPre(fixtures);
		expect(fixtures.appState.generateCalls).toHaveLength(1);
	});

	it("persists the start time and the token envelope to ActionState", async () => {
		const fixtures = makeFixtures();
		await runPre(fixtures);
		expect(fixtures.stateState.entries.has("startTime")).toBe(true);
		const startTime = JSON.parse(fixtures.stateState.entries.get("startTime") ?? "{}");
		expect(typeof startTime.startedAt).toBe("number");
		// startTime + the internal token envelope provision writes.
		expect(fixtures.stateState.entries.size).toBeGreaterThanOrEqual(2);
		// The app-client-id input flowed through to provision's token mint.
		expect(fixtures.appState.generateCalls[0]?.appId).toBe("test-client-id");
	});
});
