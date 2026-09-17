/**
 * The "package not yet resolvable" classifier and its retry schedule.
 *
 * npm's publish-time malware scan can hold a freshly published version back
 * for minutes after the publish reports success. An install that runs in that
 * window fails with the package manager's no-matching-version error — a
 * verdict-shaped failure that is actually transient. These tests pin which
 * failures count, and the delay table the action waits by.
 *
 * @module utilities/unmatched-retry.test
 */

import { CommandFailedError, CommandOutput } from "@effected/commands";
import { PlatformError } from "effect";
import { ChildProcess } from "effect/unstable/process";
import { describe, expect, it } from "vitest";
import { isUnmatchedVersion, unmatchedDelayMinutes, unmatchedWaitSeconds } from "../../../src/utils/unmatched-retry.js";

const command = ChildProcess.make("pnpm", ["install"]);

const nonZero = (streams: { stderr?: string; stdout?: string }) =>
	CommandFailedError.nonZero(
		command,
		new CommandOutput({ exitCode: 1, stdout: streams.stdout ?? "", stderr: streams.stderr ?? "" }),
	);

describe("isUnmatchedVersion", () => {
	it("recognises pnpm's ERR_PNPM_NO_MATCHING_VERSION", () => {
		const error = nonZero({
			stderr:
				" ERR_PNPM_NO_MATCHING_VERSION  No matching version found for @effected/github-actions@^0.13.1 while fetching it from https://registry.npmjs.org/",
		});

		expect(isUnmatchedVersion(error)).toBe(true);
	});

	it("recognises npm's ETARGET, which npm writes to stdout", () => {
		const error = nonZero({
			stdout:
				"npm error code ETARGET\nnpm error notarget No matching version found for @effected/github-actions@^0.13.1.",
		});

		expect(isUnmatchedVersion(error)).toBe(true);
	});

	it("recognises bun's no-version-matching error", () => {
		const error = nonZero({
			stderr:
				'error: No version matching "^0.13.1" found for specifier "@effected/github-actions" (but package exists)',
		});

		expect(isUnmatchedVersion(error)).toBe(true);
	});

	it("does not classify a peer-resolution or lockfile failure as unmatched", () => {
		// The discriminating negative: an install that legitimately failed must
		// keep the fail-the-job posture, or a broken manifest would burn every
		// retry delay before reporting.
		const error = nonZero({
			stderr:
				' ERR_PNPM_OUTDATED_LOCKFILE  Cannot install with "frozen-lockfile" because pnpm-lock.yaml is not up to date',
		});

		expect(isUnmatchedVersion(error)).toBe(false);
	});

	it("does not classify a network hiccup as unmatched", () => {
		// Transport failures are the kit's Retry.transient territory, with its own
		// (much shorter) backoff; this classifier must not swallow them.
		expect(isUnmatchedVersion(nonZero({ stderr: "FetchError: request failed, reason: ECONNRESET" }))).toBe(false);
	});

	it("never classifies a spawn failure or a timeout as unmatched", () => {
		const spawn = CommandFailedError.spawn(
			command,
			PlatformError.badArgument({ module: "ChildProcess", method: "spawn", description: "ENOENT" }),
		);
		const timedOut = CommandFailedError.timedOut(command);

		expect(isUnmatchedVersion(spawn)).toBe(false);
		expect(isUnmatchedVersion(timedOut)).toBe(false);
	});
});

describe("unmatchedDelayMinutes", () => {
	it("waits 3, 6, 10, 15 minutes, then ten more per retry", () => {
		expect([1, 2, 3, 4, 5, 6, 7].map(unmatchedDelayMinutes)).toEqual([3, 6, 10, 15, 25, 35, 45]);
	});
});

describe("unmatchedWaitSeconds", () => {
	it("is zero when retries are disabled", () => {
		expect(unmatchedWaitSeconds(0)).toBe(0);
	});

	it("sums the delays for the retries requested", () => {
		expect(unmatchedWaitSeconds(1)).toBe(180);
		expect(unmatchedWaitSeconds(2)).toBe(540);
		expect(unmatchedWaitSeconds(4)).toBe(34 * 60);
		expect(unmatchedWaitSeconds(5)).toBe(59 * 60);
	});
});
