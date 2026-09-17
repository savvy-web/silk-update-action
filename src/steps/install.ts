/**
 * Step: regenerate the lockfile and install, dispatched on the package manager.
 *
 * Gated by the caller on whether anything actually changed — an install with
 * nothing to install is logged as a skip with that reason, never silence.
 *
 * **Failure posture: fail-the-job.** `runInstall` uses `Run.text`, which fails
 * typed on a non-zero exit, so an install failure aborts the run rather than
 * committing a lockfile that does not match the manifests. The one exception is
 * a version the registry has not started serving yet (npm's publish-time scan
 * holds new versions back for minutes): that failure is retried on the
 * `retry-unmatched` schedule before the posture above applies.
 *
 * @module steps/install
 */

import { rmSync } from "node:fs";
import { join } from "node:path";
import type { CommandFailedError, CommandOutputError } from "@effected/commands";
import { Run } from "@effected/commands";
import { ChildEnv } from "@effected/github-actions";
import { Effect, Option, Schedule } from "effect";
import type { ChildProcessSpawner } from "effect/unstable/process";
import { ChildProcess } from "effect/unstable/process";
import { INSTALL_LABEL } from "../format.js";
import type { SupportedPm } from "../services/package-manager.js";
import { isUnmatchedVersion, unmatchedDelayMinutes, unmatchedSchedule } from "../utils/unmatched-retry.js";

/**
 * Regenerate the lockfile and install, dispatched on the detected package manager.
 *
 * The action mutates all three inputs to dependency resolution — the package
 * manager version, the package manager's own config (config dependencies and
 * their hooks), and the declared ranges — so the lockfile is regenerated from a
 * clean slate rather than repaired in place. A repair-only install (pnpm's
 * `--fix-lockfile`) never re-runs resolution under the changed inputs, so it can
 * commit an inconsistent lockfile: an upstream peer range moving leaves a
 * required peer unfilled and the consumer gets ERR_MODULE_NOT_FOUND at runtime.
 * Advancing transitives is the expected consequence, not noise.
 *
 * - **pnpm:** `pnpm clean --lockfile` removes the lockfile and node_modules via
 *   Node, unlinking cleanly across platforms (including Windows junctions).
 *   Requires pnpm 11+, and runs a consumer's own `clean`/`purge` script over the
 *   built-in when one exists. `--frozen-lockfile=false` opts out of the CI
 *   default that refuses to write lockfile changes.
 * - **bun:** `--force` re-resolves every dependency against the registry rather
 *   than replaying the lockfile.
 * - **npm:** npm has no clean-and-resolve mode — `npm ci` requires a lockfile to
 *   already be correct — so the lockfile is removed and a plain install re-resolves.
 *   The removal goes through `node:fs` rather than shelling out to `rm`, matching
 *   the platform-agnostic unlink `pnpm clean --lockfile` performs: `rm` does not
 *   exist on a Windows runner.
 *
 * Every command — and the npm lockfile removal — is anchored at `workspaceRoot`
 * (the root the package manager was detected at), not at the process cwd: the
 * action can legitimately be invoked from a subdirectory of the workspace.
 *
 * `retries` is the `retry-unmatched` input: how many times a no-matching-version
 * failure (see `utils/unmatched-retry`) is retried, waiting 3, 6, 10, 15, … minutes
 * between attempts. The whole sequence re-runs per attempt — `pnpm clean` has
 * already removed the lockfile, so re-running only the install would skip the
 * clean-slate guarantee. Any other failure is not retried.
 *
 * `binDir` is where `steps/activate-package-manager` put the manager the
 * manifest NOW pins, when the run changed it. It goes ahead of the inherited
 * `PATH` for every command here, because the `PATH` this process inherited still
 * leads with the manager the job started on — and the lockfile must be written
 * by the pinned version, not that one.
 */
export const runInstall = (
	pm: SupportedPm,
	workspaceRoot: string,
	retries = 0,
	binDir: Option.Option<string> = Option.none(),
): Effect.Effect<void, CommandFailedError | CommandOutputError, ChildProcessSpawner.ChildProcessSpawner> =>
	runInstallOnce(pm, workspaceRoot, binDir).pipe(Effect.retry(unmatchedPolicy(retries)));

/**
 * The spawn options that put `binDir` ahead on the child's `PATH`, or nothing.
 *
 * `ChildEnv.prependPath` owns the two traps a hand-rolled version walks into —
 * the `Path`-vs-`PATH` key spelling on Windows and the `extendEnv: true` without
 * which `env` REPLACES the child's environment rather than extending it.
 */
export const spawnOptions = (binDir: Option.Option<string>) =>
	Option.match(binDir, {
		onNone: () => ({}),
		onSome: (dir) => ChildEnv.prependPath([dir], { base: process.env, platform: process.platform }),
	});

/**
 * The retry policy for {@link runInstall}: continue only while the failure is
 * an unmatched version and the budget remains, announcing each wait so the job
 * log explains the pause. The `tap` sits after the `while` deliberately — a
 * halted schedule never reaches it, so nothing is announced on the attempt
 * that gives up.
 */
const unmatchedPolicy = (retries: number): Schedule.Schedule<number, CommandFailedError | CommandOutputError> =>
	unmatchedSchedule.pipe(
		Schedule.while(
			({ input, attempt }: Schedule.Metadata<number, CommandFailedError | CommandOutputError>) =>
				attempt <= retries && input._tag === "CommandFailedError" && isUnmatchedVersion(input),
		),
		Schedule.tap(({ input, attempt }) =>
			Effect.logWarning(
				`Install failed because a requested version is not on the registry yet (npm may still be scanning it): ${input.message}. ` +
					`Retrying in ${unmatchedDelayMinutes(attempt)} minute(s) (retry ${attempt} of ${retries})`,
			),
		),
	);

/** One clean-and-install pass, no retry. */
const runInstallOnce = (
	pm: SupportedPm,
	workspaceRoot: string,
	binDir: Option.Option<string>,
): Effect.Effect<void, CommandFailedError | CommandOutputError, ChildProcessSpawner.ChildProcessSpawner> =>
	Effect.gen(function* () {
		// Run.text fails typed on a non-zero exit, preserving the old `exec`
		// contract that an install failure aborts the run.
		const options = spawnOptions(binDir);
		const run = (executable: string, args: ReadonlyArray<string>) =>
			Run.text(ChildProcess.make(executable, [...args], options).pipe(ChildProcess.setCwd(workspaceRoot)));

		switch (pm) {
			case "pnpm":
				yield* run("pnpm", ["clean", "--lockfile"]);
				yield* run("pnpm", ["install", "--frozen-lockfile=false"]);
				return;
			case "bun":
				yield* run("bun", ["install", "--force"]);
				return;
			case "npm":
				yield* Effect.sync(() => {
					rmSync(join(workspaceRoot, "package-lock.json"), { force: true });
				});
				yield* run("npm", ["install"]);
				return;
		}
	});

/**
 * Run the install when anything changed, or log why it was skipped.
 *
 * `shouldInstall` is decided by the caller because it folds four steps' results
 * together — package-manager, config, regular and peer updates — and a step
 * should not reach across to its siblings' outputs to decide whether it runs.
 */
export const installStep = (
	shouldInstall: boolean,
	pm: SupportedPm,
	workspaceRoot: string,
	retries: number,
	binDir: Option.Option<string> = Option.none(),
): Effect.Effect<void, CommandFailedError | CommandOutputError, ChildProcessSpawner.ChildProcessSpawner> =>
	Effect.gen(function* () {
		if (!shouldInstall) {
			yield* Effect.logInfo(
				"Step: install — SKIPPED: nothing to install (no dependency, config or package-manager updates)",
			);
			return;
		}

		yield* Effect.logInfo(`Step: install — ${INSTALL_LABEL[pm]}  (config + regular updates pending)`);
		yield* runInstall(pm, workspaceRoot, retries, binDir);
	});
