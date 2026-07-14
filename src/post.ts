/**
 * Post-action entry point.
 *
 * Runs after main (even on failure). Reports total action duration and revokes
 * the GitHub App installation token provisioned by `pre` via
 * `GitHubToken.dispose`. Post-action failures never fail the workflow.
 *
 * @module post
 */

import { FetchHttpClient } from "@effect/platform";
import { NodeFileSystem } from "@effect/platform-node";
import { Action, ActionState, GitHubAppLive, GitHubToken, OctokitAuthAppLive } from "@savvy-web/github-action-effects";
import { Effect, Layer, Option } from "effect";
import { STATE_KEYS, StartTimeState } from "./state.js";

export const post = Effect.gen(function* () {
	const state = yield* ActionState;
	yield* Effect.logDebug("Running post-action script");

	// Total duration reporting.
	const startState = yield* state.getOptional(STATE_KEYS.startTime, StartTimeState);
	if (Option.isSome(startState)) {
		const duration = Date.now() - startState.value.startedAt;
		yield* Effect.logInfo(`Dependency update action completed in ${(duration / 1000).toFixed(2)}s`);
	}

	// Token revocation. dispose is a no-op if pre never provisioned a token.
	yield* Effect.logInfo("Revoking GitHub App installation token...");
	yield* GitHubToken.dispose().pipe(
		Effect.catchAll((e) => Effect.logWarning(`Token revocation failed: ${e instanceof Error ? e.message : String(e)}`)),
	);
}).pipe(
	// Defense-in-depth: post-action failures should never fail the workflow.
	Effect.catchAllDefect((defect) =>
		Effect.logWarning(`Post-action warning: ${defect instanceof Error ? defect.message : String(defect)}`),
	),
);

/**
 * Domain layers for post-action. `GitHubToken.dispose` needs a `GitHubApp`
 * layer; in 2.0 `GitHubAppLive` also requires `HttpClient.HttpClient`, provided
 * via `FetchHttpClient.layer`. `ActionState` comes from `Action.run`'s runtime.
 */
export const PostLive = Layer.mergeAll(
	GitHubAppLive.pipe(Layer.provide(OctokitAuthAppLive), Layer.provide(FetchHttpClient.layer)),
	NodeFileSystem.layer,
);

/* v8 ignore next 3 -- entry-point guard, only runs in GitHub Actions */
if (process.env.GITHUB_ACTIONS) {
	await Action.run(post, { layer: PostLive });
}
