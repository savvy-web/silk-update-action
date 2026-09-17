/**
 * Retry vocabulary for a package that is published but not yet resolvable.
 *
 * npm's publish-time malware scan can hold a freshly published version back
 * for several minutes after the publish itself reports success. An update run
 * triggered off that publish lands in the window and the install fails with
 * the package manager's no-matching-version error — a verdict-shaped failure
 * that is actually transient. This module classifies that one failure and
 * carries the delay table the action waits by; the retry itself is composed
 * in `steps/install` with `Effect.retry`, the same shape as the kit's
 * `Retry.transient`, which is not reused because its backoff is sub-second
 * and its pattern list is transport hiccups.
 *
 * @module utils/unmatched-retry
 */

import type { CommandFailedError } from "@effected/commands";
import { Duration, Effect, Schedule } from "effect";

/**
 * Substrings that mark an install failure as "the version is not on the
 * registry yet", one per supported package manager, matched case-insensitively
 * against stderr and stdout (npm writes its errors to stdout under `Run`).
 */
export const UNMATCHED_VERSION_PATTERNS: ReadonlyArray<string> = [
	// pnpm
	"ERR_PNPM_NO_MATCHING_VERSION",
	// npm — the code, and the message in case the code line is elided
	"code ETARGET",
	"No matching version found",
	// bun
	"No version matching",
];

/**
 * Whether an install failure is the registry not yet serving a version that
 * was just published.
 *
 * Only a process that ran and exited non-zero can carry this verdict; a spawn
 * failure or a timeout is never reclassified, however the streams read.
 */
export const isUnmatchedVersion = (error: CommandFailedError): boolean => {
	if (error.kind !== "nonZero") return false;
	const text = `${error.stderr ?? ""}\n${error.stdout ?? ""}`.toLowerCase();
	return UNMATCHED_VERSION_PATTERNS.some((pattern) => text.includes(pattern.toLowerCase()));
};

/**
 * Minutes to wait before the `retry`-th retry (1-based): 3, 6, 10, 15, then
 * ten more per retry.
 *
 * The scan delay is bimodal in practice — usually under three minutes, rarely
 * hours — so the early waits are short enough to catch the common case and
 * the later ones stretch rather than hammer the registry.
 */
export const unmatchedDelayMinutes = (retry: number): number => {
	switch (retry) {
		case 1:
			return 3;
		case 2:
			return 6;
		case 3:
			return 10;
		case 4:
			return 15;
		default:
			return 15 + 10 * (retry - 4);
	}
};

/** Total seconds spent waiting across `retries` retries — the budget `timeout` must cover. */
export const unmatchedWaitSeconds = (retries: number): number => {
	let total = 0;
	for (let retry = 1; retry <= retries; retry++) total += unmatchedDelayMinutes(retry) * 60;
	return total;
};

/**
 * The retry schedule for `Effect.retry`: unbounded here, capped by the caller's
 * `times`, with each delay read from {@link unmatchedDelayMinutes}.
 */
export const unmatchedSchedule: Schedule.Schedule<number> = Schedule.forever.pipe(
	Schedule.modifyDelay(({ attempt }) => Effect.succeed(Duration.minutes(unmatchedDelayMinutes(attempt)))),
);
