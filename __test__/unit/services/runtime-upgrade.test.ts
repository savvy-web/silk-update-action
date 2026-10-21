import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeServices } from "@effect/platform-node";
import { PackageJsonFile } from "@effected/package-json";
import { BunResolver, DenoResolver, NoMatchingVersionError, NodeResolver } from "@effected/runtimes";
import { Effect, Layer, Logger, References } from "effect";
import { describe, expect, it } from "vitest";
import type { RuntimeUpgradeConfig } from "../../../src/services/runtime-upgrade.js";
import { RuntimeUpgrade } from "../../../src/services/runtime-upgrade.js";

const makeTempDir = () => mkdtempSync(join(tmpdir(), "runtime-test-"));
const writePackageJson = (dir: string, content: Record<string, unknown>) =>
	writeFileSync(join(dir, "package.json"), `${JSON.stringify(content, null, "\t")}\n`, "utf-8");
const readPackageJson = (dir: string) => JSON.parse(readFileSync(join(dir, "package.json"), "utf-8"));

// Mock resolver whose .latest is fixed per runtime; fails when range matches nothing.
const makeResolver = (latest: string | null) => ({
	resolve: (_options?: { range?: string }) =>
		latest === null
			? Effect.fail(new NoMatchingVersionError({ runtime: "node", constraint: "mock" }))
			: Effect.succeed({ source: "cache" as const, versions: [latest], latest }),
});

const FALSE_CFG: RuntimeUpgradeConfig = { node: "false", deno: "false", bun: "false" };

/** Collect log lines so warnings are asserted, not assumed. */
const capturingLogger = (sink: string[]) => {
	const logger = Logger.make<unknown, void>(({ logLevel, message }) => {
		sink.push(`${logLevel} ${String(message)}`);
	});
	return Layer.succeed(References.CurrentLoggers, new Set([logger]));
};

const runWithLogs = (
	dir: string,
	config: RuntimeUpgradeConfig,
	latest: { node?: string | null; deno?: string | null; bun?: string | null } = {},
) => {
	const logs: string[] = [];
	const resolvers = Layer.mergeAll(
		Layer.succeed(NodeResolver, makeResolver(latest.node !== undefined ? latest.node : "24.16.0") as never),
		Layer.succeed(DenoResolver, makeResolver(latest.deno !== undefined ? latest.deno : "2.1.0") as never),
		Layer.succeed(BunResolver, makeResolver(latest.bun !== undefined ? latest.bun : "1.2.0") as never),
	);
	// Real PackageJsonFile over the real platform: these suites write actual
	// temp manifests, and the property under test is that the write preserves the
	// file, which a stub could not exercise.
	const layer = RuntimeUpgrade.layer.pipe(
		Layer.provide(Layer.merge(resolvers, PackageJsonFile.layer.pipe(Layer.provide(NodeServices.layer)))),
	);
	return Effect.runPromise(
		Effect.gen(function* () {
			const service = yield* RuntimeUpgrade;
			const results = yield* service.upgrade(config, dir);
			return { results, logs };
		}).pipe(Effect.provide(layer), Effect.provide(capturingLogger(logs))),
	);
};

const run = async (
	dir: string,
	config: RuntimeUpgradeConfig,
	latest: { node?: string | null; deno?: string | null; bun?: string | null } = {},
) => (await runWithLogs(dir, config, latest)).results;

const warnedAbout = (logs: ReadonlyArray<string>, runtime: string) =>
	logs.some(
		(l) =>
			l.startsWith("Warn") && l.includes(`upgrade-runtime-${runtime}`) && l.includes("no devEngines.runtime entry"),
	);

describe("RuntimeUpgrade service", () => {
	it("auto + caret range: resolves within the range and writes an exact version", async () => {
		const dir = makeTempDir();
		writePackageJson(dir, { devEngines: { runtime: [{ name: "node", version: "^24.0.0", onFail: "ignore" }] } });

		const results = await run(dir, { ...FALSE_CFG, node: "auto" }, { node: "24.16.0" });

		// The caret ranges the RESOLUTION, but the written value is exact: downstream
		// consumers of devEngines.runtime do not support range operators.
		expect(results).toEqual([{ runtime: "node", from: "^24.0.0", to: "24.16.0" }]);
		expect(readPackageJson(dir).devEngines.runtime).toEqual([{ name: "node", version: "24.16.0", onFail: "ignore" }]);
	});

	it("auto + static pin: no-op", async () => {
		const dir = makeTempDir();
		writePackageJson(dir, { devEngines: { runtime: [{ name: "node", version: "24.11.0" }] } });

		const results = await run(dir, { ...FALSE_CFG, node: "auto" }, { node: "24.16.0" });

		expect(results).toEqual([]);
		expect(readPackageJson(dir).devEngines.runtime[0].version).toBe("24.11.0");
	});

	it("auto + missing entry: no-op, adds nothing, and warns", async () => {
		const dir = makeTempDir();
		writePackageJson(dir, { devEngines: { runtime: [{ name: "node", version: "^24.0.0" }] } });

		const { results, logs } = await runWithLogs(dir, { ...FALSE_CFG, deno: "auto" });

		expect(results).toEqual([]);
		expect(readPackageJson(dir).devEngines.runtime).toEqual([{ name: "node", version: "^24.0.0" }]);
		expect(warnedAbout(logs, "deno")).toBe(true);
	});

	it("explicit range + missing entry: adds nothing and warns (bun-only repo, upgrade-runtime-node set)", async () => {
		// The live dogfood failure: a bun-only manifest given upgrade-runtime-node
		// "^26.0.0" must be left completely untouched — no node entry is introduced.
		const dir = makeTempDir();
		const manifest = {
			devEngines: {
				runtime: [{ name: "bun", version: "1.3.14", onFail: "ignore" }],
				packageManager: { name: "bun", version: "1.3.14", onFail: "ignore" },
			},
		};
		writePackageJson(dir, manifest);

		const { results, logs } = await runWithLogs(dir, { ...FALSE_CFG, node: "^26.0.0" }, { node: "26.5.0" });

		expect(results).toEqual([]);
		expect(readPackageJson(dir)).toEqual(manifest);
		expect(warnedAbout(logs, "node")).toBe(true);
	});

	it("explicit range + absent devEngines: never creates the field", async () => {
		const dir = makeTempDir();
		writePackageJson(dir, { name: "x" });

		const { results, logs } = await runWithLogs(dir, { ...FALSE_CFG, bun: "^1" }, { bun: "1.2.0" });

		expect(results).toEqual([]);
		expect(readPackageJson(dir)).toEqual({ name: "x" });
		expect(warnedAbout(logs, "bun")).toBe(true);
	});

	it("explicit range on a caret entry: resolves within the input range and writes exact", async () => {
		const dir = makeTempDir();
		writePackageJson(dir, { devEngines: { runtime: [{ name: "node", version: "^24.0.0" }] } });

		// Input ~22.5 selects the line to resolve; the write carries no operator.
		const results = await run(dir, { ...FALSE_CFG, node: "~22.5" }, { node: "22.5.9" });

		expect(results).toEqual([{ runtime: "node", from: "^24.0.0", to: "22.5.9" }]);
		expect(readPackageJson(dir).devEngines.runtime[0].version).toBe("22.5.9");
	});

	it("explicit range on an exact pin: resolves and stays exact", async () => {
		const dir = makeTempDir();
		writePackageJson(dir, { devEngines: { runtime: [{ name: "node", version: "24.11.0", onFail: "ignore" }] } });

		const results = await run(dir, { ...FALSE_CFG, node: "^26.0.0" }, { node: "26.2.0" });

		expect(results).toEqual([{ runtime: "node", from: "24.11.0", to: "26.2.0" }]);
		expect(readPackageJson(dir).devEngines.runtime[0].version).toBe("26.2.0");
	});

	it("single-object shape: updated in place, shape preserved", async () => {
		const dir = makeTempDir();
		writePackageJson(dir, { devEngines: { runtime: { name: "node", version: "^24.0.0", onFail: "warn" } } });

		const results = await run(dir, { ...FALSE_CFG, node: "auto" }, { node: "24.16.0" });

		expect(results).toEqual([{ runtime: "node", from: "^24.0.0", to: "24.16.0" }]);
		expect(readPackageJson(dir).devEngines.runtime).toEqual({ name: "node", version: "24.16.0", onFail: "warn" });
	});

	it("already current: no-op", async () => {
		const dir = makeTempDir();
		writePackageJson(dir, { devEngines: { runtime: [{ name: "node", version: "24.16.0" }] } });

		const results = await run(dir, { ...FALSE_CFG, node: "^24.0.0" }, { node: "24.16.0" });

		expect(results).toEqual([]);
	});

	it("false: skips all", async () => {
		const dir = makeTempDir();
		writePackageJson(dir, { devEngines: { runtime: [{ name: "node", version: "^24.0.0" }] } });

		const results = await run(dir, FALSE_CFG);

		expect(results).toEqual([]);
	});

	it("multi-runtime in one call", async () => {
		const dir = makeTempDir();
		writePackageJson(dir, {
			devEngines: {
				runtime: [
					{ name: "node", version: "^24.0.0" },
					{ name: "bun", version: "^1.0.0" },
				],
			},
		});

		const results = await run(dir, { node: "auto", deno: "false", bun: "auto" }, { node: "24.16.0", bun: "1.2.0" });

		expect(results).toEqual([
			{ runtime: "node", from: "^24.0.0", to: "24.16.0" },
			{ runtime: "bun", from: "^1.0.0", to: "1.2.0" },
		]);
	});

	it("resolver VersionNotFoundError: per-runtime skip, others still processed", async () => {
		const dir = makeTempDir();
		writePackageJson(dir, {
			devEngines: {
				runtime: [
					{ name: "node", version: "^24.0.0" },
					{ name: "deno", version: "^2.0.0" },
				],
			},
		});

		const results = await run(dir, { node: "auto", deno: "auto", bun: "false" }, { node: null, deno: "2.1.0" });

		expect(results).toEqual([{ runtime: "deno", from: "^2.0.0", to: "2.1.0" }]);
	});

	it("preserves tab indentation", async () => {
		const dir = makeTempDir();
		writeFileSync(
			join(dir, "package.json"),
			`${JSON.stringify({ devEngines: { runtime: [{ name: "node", version: "^24.0.0" }] } }, null, "\t")}\n`,
		);

		await run(dir, { ...FALSE_CFG, node: "auto" }, { node: "24.16.0" });

		expect(readFileSync(join(dir, "package.json"), "utf-8")).toMatch(/^\t"/m);
	});

	it("asks the node resolver to accept maintenance-LTS lines, and passes no phases to deno or bun", async () => {
		// The resolver's default phase window (current + active-lts) drops a major
		// the day it enters maintenance, so a repo on ^24.0.0 would silently stop
		// receiving 24.x patches. The declared range already selects the line.
		const dir = makeTempDir();
		writePackageJson(dir, {
			devEngines: {
				runtime: [
					{ name: "node", version: "^24.0.0" },
					{ name: "deno", version: "^2.0.0" },
				],
			},
		});
		const seen: Record<string, unknown> = {};
		const recording = (name: string, latest: string) => ({
			resolve: (options?: unknown) => {
				seen[name] = options;
				return Effect.succeed({ source: "cache" as const, versions: [latest], latest });
			},
		});
		const layer = RuntimeUpgrade.layer.pipe(
			Layer.provide(
				Layer.mergeAll(
					Layer.succeed(NodeResolver, recording("node", "24.16.0") as never),
					Layer.succeed(DenoResolver, recording("deno", "2.1.0") as never),
					Layer.succeed(BunResolver, recording("bun", "1.2.0") as never),
					PackageJsonFile.layer.pipe(Layer.provide(NodeServices.layer)),
				),
			),
		);

		await Effect.runPromise(
			Effect.gen(function* () {
				const service = yield* RuntimeUpgrade;
				return yield* service.upgrade({ node: "auto", deno: "auto", bun: "false" }, dir);
			}).pipe(Effect.provide(layer), Effect.provideService(References.MinimumLogLevel, "None")),
		);

		expect(seen.node).toEqual({ range: "^24.0.0", phases: ["current", "active-lts", "maintenance-lts"] });
		expect(seen.deno).toEqual({ range: "^2.0.0" });
	});

	it("preserves key order, indentation and every unrelated byte in an UNSORTED manifest", async () => {
		// Only meaningful against a deliberately unsorted fixture: this repo's own
		// package.json is sorted by lint-staged, so a reorder would be a no-op there.
		// A writer that re-serializes the parsed object or sorts keys canonically
		// rewrites regions the action never intended to touch, in a file it then
		// commits to someone else's repository.
		const dir = makeTempDir();
		const original = [
			"{",
			'\t"dependencies": {',
			'\t\t"zod": "^3.0.0"',
			"\t},",
			'\t"name": "unsorted-fixture",',
			'\t"devEngines": {',
			'\t\t"runtime": [',
			"\t\t\t{",
			'\t\t\t\t"name": "node",',
			'\t\t\t\t"version": "^24.0.0",',
			'\t\t\t\t"onFail": "ignore"',
			"\t\t\t}",
			"\t\t]",
			"\t},",
			'\t"version": "0.0.0",',
			'\t"scripts": {',
			'\t\t"build": "tsc"',
			"\t}",
			"}",
			"",
		].join("\n");
		writeFileSync(join(dir, "package.json"), original);

		const results = await run(dir, { ...FALSE_CFG, node: "auto" }, { node: "24.16.0" });
		expect(results).toEqual([{ runtime: "node", from: "^24.0.0", to: "24.16.0" }]);

		const after = readFileSync(join(dir, "package.json"), "utf-8");
		// Asserted on the raw text: a JSON.parse comparison is order-blind.
		expect(Object.keys(JSON.parse(after))).toEqual(["dependencies", "name", "devEngines", "version", "scripts"]);
		// Byte-identical once the one version string is substituted back.
		expect(after.replace("24.16.0", "^24.0.0")).toBe(original);
	});
});
