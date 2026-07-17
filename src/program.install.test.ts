import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CommandRunner } from "@savvy-web/github-action-effects";
import { Effect, Layer, References } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import { runInstall } from "./program.js";

interface Calls {
	readonly exec: Array<string>;
	readonly capture: Array<string>;
}

/**
 * Records both halves of the CommandRunner surface. `execCapture` is recorded
 * (not just stubbed) so the invariant that runInstall streams its commands —
 * never capturing their output — is actually asserted rather than assumed.
 */
const recordingRunner = (calls: Calls) =>
	Layer.succeed(CommandRunner, {
		exec: (command: string, args: ReadonlyArray<string>) => {
			calls.exec.push([command, ...args].join(" "));
			return Effect.void;
		},
		execCapture: (command: string, args: ReadonlyArray<string>) => {
			calls.capture.push([command, ...args].join(" "));
			return Effect.succeed({ stdout: "", stderr: "", exitCode: 0 });
		},
	} as never);

const run = (pm: "pnpm" | "bun" | "npm") => {
	const calls: Calls = { exec: [], capture: [] };
	return Effect.runPromise(
		runInstall(pm).pipe(
			Effect.provide(recordingRunner(calls)),
			Effect.provideService(References.MinimumLogLevel, "None"),
		),
	).then(() => calls);
};

/** Restored after any test that chdirs into a temp workspace. */
let cwd: string | null = null;

afterEach(() => {
	if (cwd !== null) {
		process.chdir(cwd);
		cwd = null;
	}
});

describe("runInstall", () => {
	it("regenerates the lockfile for pnpm", async () => {
		const calls = await run("pnpm");

		expect(calls.exec).toEqual(["pnpm clean --lockfile", "pnpm install --frozen-lockfile=false"]);
		expect(calls.capture).toEqual([]);
	});

	it("forces a re-resolve for bun", async () => {
		const calls = await run("bun");

		expect(calls.exec).toEqual(["bun install --force"]);
		expect(calls.capture).toEqual([]);
	});

	it("deletes the lockfile and installs for npm", async () => {
		// The removal goes through node:fs, not a shelled-out `rm`, so assert the
		// file is actually gone rather than that a command was issued — `rm` does
		// not exist on a Windows runner, and the pnpm path is deliberately
		// platform-agnostic for the same reason.
		cwd = process.cwd();
		const root = mkdtempSync(join(tmpdir(), "run-install-"));
		process.chdir(root);
		writeFileSync(join(root, "package-lock.json"), "{}");

		const calls = await run("npm");

		expect(existsSync(join(root, "package-lock.json"))).toBe(false);
		expect(calls.exec).toEqual(["npm install"]);
		expect(calls.capture).toEqual([]);

		rmSync(root, { recursive: true, force: true });
	});

	it("does not fail for npm when there is no lockfile to remove", async () => {
		cwd = process.cwd();
		const root = mkdtempSync(join(tmpdir(), "run-install-"));
		process.chdir(root);

		const calls = await run("npm");

		expect(calls.exec).toEqual(["npm install"]);

		rmSync(root, { recursive: true, force: true });
	});
});
