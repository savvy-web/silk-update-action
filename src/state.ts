/**
 * Cross-phase state schemas.
 *
 * `pre`, `main`, and `post` run as separate Node processes; GitHub Actions
 * persists state between them as `STATE_*` env vars. `ActionState.save/get`
 * encode/decode each value through its Schema.
 *
 * @module state
 */

import { Schema } from "effect";

/** Wall-clock timestamp captured by `pre` for post-phase duration reporting. */
export class StartTimeState extends Schema.Class<StartTimeState>("StartTimeState")({
	startedAt: Schema.Number,
}) {}

/**
 * Keys used with `ActionState.save/get`. The GitHub App token envelope is not
 * modelled here — `GitHubToken.provision` persists it under its own internal key.
 */
export const STATE_KEYS = {
	startTime: "startTime",
} as const;
