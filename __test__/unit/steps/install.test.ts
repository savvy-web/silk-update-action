import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ScriptResult } from "@effected/commands";
import { ScriptedSpawner } from "@effected/commands";
import type { Duration } from "effect";
import { Effect, Exit, Fiber, References } from "effect";
import { TestClock } from "effect/testing";
import { describe, expect, it } from "vitest";
import { runInstall } from "../../../src/steps/install.js";
import { fromMap } from "../../utils/spawner.js";

/**
 * Records the command lines runInstall spawns.
 *
 * The predecessor's runner split streaming (`exec`) from capturing
 * (`execCapture`) and this suite asserted runInstall used the streaming half.
 * `@effected/commands` has no such split — every `Run` combinator collects — so
 * that invariant no longer exists and the surviving assertion is which commands
 * run, in what order.
 */
const run = (pm: "pnpm" | "bun" | "npm", workspaceRoot = "/ws") => {
	const spawner = fromMap();
	return Effect.runPromise(
		runInstall(pm, workspaceRoot).pipe(
			Effect.provide(spawner.layer),
			Effect.provideService(References.MinimumLogLevel, "None"),
		),
	).then(() => ({
		exec: spawner.spawns.map((call) => [call.command, ...call.args].join(" ")),
		cwds: spawner.spawns.map((call) => call.cwd),
	}));
};

describe("runInstall", () => {
	it("regenerates the lockfile for pnpm", async () => {
		const calls = await run("pnpm");

		expect(calls.exec).toEqual(["pnpm clean --lockfile", "pnpm install --frozen-lockfile=false"]);
	});

	it("forces a re-resolve for bun", async () => {
		const calls = await run("bun");

		expect(calls.exec).toEqual(["bun install --force"]);
	});

	it("runs every command at the workspace root", async () => {
		// `runInstall` used to default this parameter to `process.cwd()`. That is
		// the shape of four separate defects on this branch, so the root being
		// honoured is asserted rather than assumed — and `/ws` is not a directory
		// the test process could reach by accident.
		const calls = await run("pnpm", "/ws");

		expect(calls.cwds).toEqual(["/ws", "/ws"]);
	});

	it("deletes the lockfile and installs for npm", async () => {
		// The removal goes through node:fs, not a shelled-out `rm`, so assert the
		// file is actually gone rather than that a command was issued — `rm` does
		// not exist on a Windows runner, and the pnpm path is deliberately
		// platform-agnostic for the same reason.
		//
		// No `process.chdir` here. These two tests used to chdir into the temp
		// directory purely to reach the `process.cwd()` default; with the root
		// required they pass it, which is both what production does and a stronger
		// assertion — the unlink has to resolve against the ARGUMENT, since the
		// test process is never inside this directory.
		const root = mkdtempSync(join(tmpdir(), "run-install-"));
		try {
			writeFileSync(join(root, "package-lock.json"), "{}");

			const calls = await run("npm", root);

			expect(existsSync(join(root, "package-lock.json"))).toBe(false);
			expect(calls.exec).toEqual(["npm install"]);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("does not fail for npm when there is no lockfile to remove", async () => {
		const root = mkdtempSync(join(tmpdir(), "run-install-"));
		try {
			const calls = await run("npm", root);

			expect(calls.exec).toEqual(["npm install"]);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});

/**
 * A spawner whose `pnpm install` fails with `outcomes[n]` on the n-th call and
 * answers a silent success once the script runs out — the shape of a package
 * held by npm's publish-time scan and then released.
 */
const failThenSucceed = (outcomes: ReadonlyArray<ScriptResult>) => {
	let installs = 0;
	const spawner = ScriptedSpawner.make((command, args) => {
		if (command === "pnpm" && args[0] === "install") {
			const outcome = outcomes[installs] ?? {};
			installs++;
			return outcome;
		}
		return {};
	});
	return spawner;
};

const UNMATCHED: ScriptResult = {
	exit: 1,
	stderr: " ERR_PNPM_NO_MATCHING_VERSION  No matching version found for @effected/github-actions@^0.13.1",
};
const OUTDATED: ScriptResult = { exit: 1, stderr: " ERR_PNPM_OUTDATED_LOCKFILE  lockfile is not up to date" };

/**
 * Run `runInstall` under the virtual clock, advancing it by `advance` while the
 * install is parked in a retry delay, and return the exit plus the install
 * command lines that were attempted.
 */
const runWithRetries = (spawner: ScriptedSpawner, retries: number, advance: Duration.Input) =>
	Effect.runPromise(
		Effect.gen(function* () {
			const fiber = yield* Effect.forkChild(runInstall("pnpm", "/ws", retries));
			yield* TestClock.adjust(advance);
			const exit = yield* Fiber.await(fiber);
			return {
				exit,
				installs: spawner.spawns.filter((call) => call.args[0] === "install").length,
			};
		}).pipe(
			Effect.provide(spawner.layer),
			Effect.provide(TestClock.layer()),
			Effect.provideService(References.MinimumLogLevel, "None"),
		),
	);

describe("runInstall — retry-unmatched", () => {
	it("retries after the scan-delay wait when the version is not yet on the registry", async () => {
		const spawner = failThenSucceed([UNMATCHED]);

		const { exit, installs } = await runWithRetries(spawner, 1, "3 minutes");

		expect(Exit.isSuccess(exit)).toBe(true);
		expect(installs).toBe(2);
	});

	it("re-runs the whole clean-and-install sequence on each attempt", async () => {
		// pnpm clean removed the lockfile before the failed install; a retry that
		// only re-ran `install` would leave the clean step's guarantees behind.
		const spawner = failThenSucceed([UNMATCHED]);

		await runWithRetries(spawner, 1, "3 minutes");

		expect(spawner.spawns.map((call) => [call.command, ...call.args].join(" "))).toEqual([
			"pnpm clean --lockfile",
			"pnpm install --frozen-lockfile=false",
			"pnpm clean --lockfile",
			"pnpm install --frozen-lockfile=false",
		]);
	});

	it("does not retry before the first delay has elapsed", async () => {
		const spawner = failThenSucceed([UNMATCHED]);

		const fiber = await Effect.runPromise(
			Effect.gen(function* () {
				const fiber = yield* Effect.forkChild(runInstall("pnpm", "/ws", 1));
				yield* TestClock.adjust("2 minutes");
				const attempted = spawner.spawns.filter((call) => call.args[0] === "install").length;
				yield* Fiber.interrupt(fiber);
				return { attempted };
			}).pipe(
				Effect.provide(spawner.layer),
				Effect.provide(TestClock.layer()),
				Effect.provideService(References.MinimumLogLevel, "None"),
			),
		);

		expect(fiber.attempted).toBe(1);
	});

	it("fails once the retries are exhausted, with the unmatched error", async () => {
		const spawner = failThenSucceed([UNMATCHED, UNMATCHED, UNMATCHED]);

		const { exit, installs } = await runWithRetries(spawner, 2, "9 minutes");

		expect(Exit.isFailure(exit)).toBe(true);
		expect(installs).toBe(3);
	});

	it("does not retry an install failure that is not an unmatched version", async () => {
		// The discriminating negative: a genuinely broken install keeps the
		// fail-the-job posture rather than burning the retry budget.
		const spawner = failThenSucceed([OUTDATED]);

		const { exit, installs } = await runWithRetries(spawner, 2, "9 minutes");

		expect(Exit.isFailure(exit)).toBe(true);
		expect(installs).toBe(1);
	});

	it("does not retry at all when retries are zero", async () => {
		const spawner = failThenSucceed([UNMATCHED]);

		const { exit, installs } = await runWithRetries(spawner, 0, "9 minutes");

		expect(Exit.isFailure(exit)).toBe(true);
		expect(installs).toBe(1);
	});
});
