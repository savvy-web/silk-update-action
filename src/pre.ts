/**
 * Pre-action entry point.
 *
 * Provisions the GitHub App installation token via `GitHubToken.provision` —
 * which reads the `app-client-id` / `app-private-key` inputs, mints the token,
 * verifies it grants the scopes this action needs, resolves the App identity
 * best-effort, and persists the envelope to `ActionState` for the main and post
 * phases. Also records the start time for post-phase duration reporting.
 *
 * @module pre
 */

import { NodeFileSystem } from "@effect/platform-node";
import { Action, ActionState, GitHubAppLive, GitHubToken, OctokitAuthAppLive } from "@savvy-web/github-action-effects";
import { Effect, Layer } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { STATE_KEYS, StartTimeState } from "./state.js";

export const pre = Effect.gen(function* () {
	const state = yield* ActionState;
	yield* Effect.logDebug("Running pre-action script");

	// Record start time for post-phase duration reporting.
	yield* state.save(STATE_KEYS.startTime, new StartTimeState({ startedAt: Date.now() }), StartTimeState);

	// Provision the GitHub App installation token. provision reads the
	// app-client-id + app-private-key inputs, mints the token, verifies the
	// requested scopes, and persists the envelope to ActionState.
	yield* Effect.logInfo("Generating GitHub App installation token...");
	const token = yield* GitHubToken.provision({
		permissions: { contents: "write", pull_requests: "write", checks: "write" },
	});

	yield* Effect.logInfo(
		`Token generated${token.appName !== undefined ? ` for app "${token.appName}"` : ""} (expires: ${token.expiresAt})`,
	);
	yield* Effect.logDebug("Pre-action completed");
});

/**
 * Domain layers for pre-action. `GitHubToken.provision` needs a `GitHubApp`
 * layer — composed from `GitHubAppLive` over `OctokitAuthAppLive`; in 2.0
 * `GitHubAppLive` also requires `HttpClient.HttpClient`, provided via
 * `FetchHttpClient.layer`. `ActionState` / `ActionOutputs` come from
 * `Action.run`'s runtime.
 */
export const PreLive = Layer.mergeAll(
	GitHubAppLive.pipe(Layer.provide(OctokitAuthAppLive), Layer.provide(FetchHttpClient.layer)),
	NodeFileSystem.layer,
);

/* v8 ignore next 3 -- entry-point guard, only runs in GitHub Actions */
if (process.env.GITHUB_ACTIONS) {
	await Action.run(pre, { layer: PreLive });
}
