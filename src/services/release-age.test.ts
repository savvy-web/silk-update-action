/**
 * Tests for release-age gate discovery and publish-time helpers.
 *
 * `replayHookReleaseAge` runs a real `node` subprocess via `CommandRunnerLive`
 * against temp-dir fixtures, so the pnpmfile replay path is exercised for real
 * rather than mocked.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CommandRunner, CommandRunnerLive } from "@savvy-web/github-action-effects";
import { Effect, Layer, References } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getPublishTimes, readInlineReleaseAge, replayHookReleaseAge } from "./release-age.js";

const runWith = <A, E>(effect: Effect.Effect<A, E, CommandRunner>, layer: Layer.Layer<CommandRunner>) =>
	Effect.runPromise(
		effect.pipe(Effect.provide(layer), Effect.provideService(References.MinimumLogLevel, "None")) as Effect.Effect<
			A,
			E,
			never
		>,
	);

describe("release-age", () => {
	let root: string;

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "release-age-test-"));
	});

	afterEach(() => {
		rmSync(root, { recursive: true, force: true });
	});

	const writeWorkspaceYaml = (content: string) => {
		writeFileSync(join(root, "pnpm-workspace.yaml"), content, "utf-8");
	};

	const writeConfigDepPnpmfile = (name: string, filename: string, source: string) => {
		const dir = join(root, "node_modules", ".pnpm-config", name);
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, filename), source, "utf-8");
	};

	describe("readInlineReleaseAge", () => {
		it("reads minimumReleaseAge and minimumReleaseAgeExclude from pnpm-workspace.yaml", async () => {
			writeWorkspaceYaml(
				[
					"packages:",
					"  - .",
					"minimumReleaseAge: 1440",
					"minimumReleaseAgeExclude:",
					'  - "@effected/*"',
					"  - prettier",
					"",
				].join("\n"),
			);

			const gate = await Effect.runPromise(readInlineReleaseAge(root));

			expect(gate).toEqual({ ageMinutes: 1440, exclude: ["@effected/*", "prettier"] });
		});

		it("reads a gate with only minimumReleaseAge declared", async () => {
			writeWorkspaceYaml(["packages:", "  - .", "minimumReleaseAge: 720", ""].join("\n"));

			const gate = await Effect.runPromise(readInlineReleaseAge(root));

			expect(gate).toEqual({ ageMinutes: 720 });
		});

		it("returns null when neither release-age key is present", async () => {
			writeWorkspaceYaml(["packages:", "  - .", ""].join("\n"));

			const gate = await Effect.runPromise(readInlineReleaseAge(root));

			expect(gate).toBeNull();
		});

		it("returns null when pnpm-workspace.yaml is missing", async () => {
			const gate = await Effect.runPromise(readInlineReleaseAge(root));

			expect(gate).toBeNull();
		});
	});

	describe("replayHookReleaseAge", () => {
		it("replays a config dependency updateConfig hook that injects release-age settings", async () => {
			writeWorkspaceYaml(
				["packages:", "  - .", "configDependencies:", '  fake-plugin: "1.0.0+sha512-abc"', ""].join("\n"),
			);
			writeConfigDepPnpmfile(
				"fake-plugin",
				"pnpmfile.cjs",
				[
					"module.exports = {",
					"  hooks: {",
					"    updateConfig(config) {",
					"      config.minimumReleaseAge = 1440;",
					'      config.minimumReleaseAgeExclude = ["@effected/*", "prettier"];',
					"      return config;",
					"    },",
					"  },",
					"};",
					"",
				].join("\n"),
			);

			const gate = await runWith(replayHookReleaseAge(root), CommandRunnerLive);

			expect(gate).toEqual({ ageMinutes: 1440, exclude: ["@effected/*", "prettier"] });
		});

		it("replays an ESM-only pnpmfile.mjs", async () => {
			writeWorkspaceYaml(
				["packages:", "  - .", "configDependencies:", '  esm-plugin: "1.0.0+sha512-abc"', ""].join("\n"),
			);
			writeConfigDepPnpmfile(
				"esm-plugin",
				"pnpmfile.mjs",
				[
					"export const hooks = {",
					"  updateConfig(config) {",
					'    return { ...config, minimumReleaseAge: 720, minimumReleaseAgeExclude: ["@scope/*"] };',
					"  },",
					"};",
					"",
				].join("\n"),
			);

			const gate = await runWith(replayHookReleaseAge(root), CommandRunnerLive);

			expect(gate).toEqual({ ageMinutes: 720, exclude: ["@scope/*"] });
		});

		it("returns null when the workspace declares no configDependencies", async () => {
			writeWorkspaceYaml(["packages:", "  - .", ""].join("\n"));

			const gate = await runWith(replayHookReleaseAge(root), CommandRunnerLive);

			expect(gate).toBeNull();
		});

		it("returns null when config dependencies ship no pnpmfile", async () => {
			writeWorkspaceYaml(
				["packages:", "  - .", "configDependencies:", '  no-hooks-plugin: "1.0.0+sha512-abc"', ""].join("\n"),
			);
			mkdirSync(join(root, "node_modules", ".pnpm-config", "no-hooks-plugin"), { recursive: true });

			const gate = await runWith(replayHookReleaseAge(root), CommandRunnerLive);

			expect(gate).toBeNull();
		});

		it("returns null (not a failure) when a pnpmfile throws", async () => {
			writeWorkspaceYaml(
				["packages:", "  - .", "configDependencies:", '  broken-plugin: "1.0.0+sha512-abc"', ""].join("\n"),
			);
			writeConfigDepPnpmfile("broken-plugin", "pnpmfile.cjs", 'throw new Error("boom");\n');

			const gate = await runWith(replayHookReleaseAge(root), CommandRunnerLive);

			expect(gate).toBeNull();
		});
	});

	describe("getPublishTimes", () => {
		const recordingRunner = (calls: string[][], stdout: string, fail = false) =>
			Layer.succeed(CommandRunner, {
				execCapture: (command: string, args: ReadonlyArray<string> = []) => {
					calls.push([command, ...args]);
					if (fail) {
						return Effect.fail(new Error("npm view failed"));
					}
					return Effect.succeed({ stdout, stderr: "", exitCode: 0 });
				},
			} as never);

		it("parses npm view time --json output into a version → timestamp record", async () => {
			const calls: string[][] = [];
			const stdout = JSON.stringify({
				created: "2020-01-01T00:00:00.000Z",
				modified: "2026-07-21T05:51:53.987Z",
				"3.9.5": "2026-06-01T00:00:00.000Z",
				"3.9.6": "2026-07-21T05:51:53.987Z",
			});

			const times = await runWith(getPublishTimes("prettier"), recordingRunner(calls, stdout));

			expect(times).toEqual({
				"3.9.5": "2026-06-01T00:00:00.000Z",
				"3.9.6": "2026-07-21T05:51:53.987Z",
			});
			expect(calls).toHaveLength(1);
			const [command, ...args] = calls[0] as [string, ...string[]];
			expect(command).toBe("npm");
			expect(args).toEqual(expect.arrayContaining(["view", "prettier", "time", "--json"]));
			expect(args).toContain("--cache");
		});

		it("returns an empty record when the npm query fails", async () => {
			const calls: string[][] = [];

			const times = await runWith(getPublishTimes("prettier"), recordingRunner(calls, "", true));

			expect(times).toEqual({});
		});

		it("returns an empty record when stdout is not valid JSON", async () => {
			const calls: string[][] = [];

			const times = await runWith(getPublishTimes("prettier"), recordingRunner(calls, "not json"));

			expect(times).toEqual({});
		});
	});
});
