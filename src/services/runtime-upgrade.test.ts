import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Layer, LogLevel, Logger } from "effect";
import { BunResolver, DenoResolver, NodeResolver, VersionNotFoundError } from "runtime-resolver";
import { describe, expect, it } from "vitest";
import type { RuntimeUpgradeConfig } from "./runtime-upgrade.js";
import { RuntimeUpgrade, RuntimeUpgradeLive } from "./runtime-upgrade.js";

const makeTempDir = () => mkdtempSync(join(tmpdir(), "runtime-test-"));
const writePackageJson = (dir: string, content: Record<string, unknown>) =>
	writeFileSync(join(dir, "package.json"), `${JSON.stringify(content, null, "\t")}\n`, "utf-8");
const readPackageJson = (dir: string) => JSON.parse(readFileSync(join(dir, "package.json"), "utf-8"));

// Mock resolver whose .latest is fixed per runtime; fails when range matches nothing.
const makeResolver = (latest: string | null) => ({
	resolve: (_options?: { semverRange?: string }) =>
		latest === null
			? Effect.fail(new VersionNotFoundError({} as never))
			: Effect.succeed({ source: "cache" as const, versions: [latest], latest }),
});

const FALSE_CFG: RuntimeUpgradeConfig = { node: "false", deno: "false", bun: "false" };

const run = (
	dir: string,
	config: RuntimeUpgradeConfig,
	latest: { node?: string | null; deno?: string | null; bun?: string | null } = {},
) => {
	const resolvers = Layer.mergeAll(
		Layer.succeed(NodeResolver, makeResolver(latest.node !== undefined ? latest.node : "24.16.0") as never),
		Layer.succeed(DenoResolver, makeResolver(latest.deno !== undefined ? latest.deno : "2.1.0") as never),
		Layer.succeed(BunResolver, makeResolver(latest.bun !== undefined ? latest.bun : "1.2.0") as never),
	);
	const layer = RuntimeUpgradeLive.pipe(Layer.provide(resolvers));
	return Effect.runPromise(
		Effect.gen(function* () {
			const service = yield* RuntimeUpgrade;
			return yield* service.upgrade(config, dir);
		}).pipe(Effect.provide(layer), Logger.withMinimumLogLevel(LogLevel.None)),
	);
};

describe("RuntimeUpgrade service", () => {
	it("auto + caret range: bumps and preserves the operator", async () => {
		const dir = makeTempDir();
		writePackageJson(dir, { devEngines: { runtime: [{ name: "node", version: "^24.0.0", onFail: "ignore" }] } });

		const results = await run(dir, { ...FALSE_CFG, node: "auto" }, { node: "24.16.0" });

		expect(results).toEqual([{ runtime: "node", from: "^24.0.0", to: "^24.16.0", added: false }]);
		expect(readPackageJson(dir).devEngines.runtime[0].version).toBe("^24.16.0");
	});

	it("auto + static pin: no-op", async () => {
		const dir = makeTempDir();
		writePackageJson(dir, { devEngines: { runtime: [{ name: "node", version: "24.11.0" }] } });

		const results = await run(dir, { ...FALSE_CFG, node: "auto" }, { node: "24.16.0" });

		expect(results).toEqual([]);
		expect(readPackageJson(dir).devEngines.runtime[0].version).toBe("24.11.0");
	});

	it("auto + missing entry: no-op (no add)", async () => {
		const dir = makeTempDir();
		writePackageJson(dir, { devEngines: { runtime: [{ name: "node", version: "^24.0.0" }] } });

		const results = await run(dir, { ...FALSE_CFG, deno: "auto" });

		expect(results).toEqual([]);
		expect(readPackageJson(dir).devEngines.runtime).toEqual([{ name: "node", version: "^24.0.0" }]);
	});

	it("explicit range: resolves within the range but preserves the existing entry's operator", async () => {
		const dir = makeTempDir();
		writePackageJson(dir, { devEngines: { runtime: [{ name: "node", version: "^24.0.0" }] } });

		// Input ~22.5 selects the target line; the existing caret is preserved on write.
		const results = await run(dir, { ...FALSE_CFG, node: "~22.5" }, { node: "22.5.9" });

		expect(results).toEqual([{ runtime: "node", from: "^24.0.0", to: "^22.5.9", added: false }]);
	});

	it("explicit range on an exact pin: resolves but stays exact", async () => {
		const dir = makeTempDir();
		writePackageJson(dir, { devEngines: { runtime: [{ name: "node", version: "24.11.0", onFail: "ignore" }] } });

		// The pre-existing value is an exact pin; an explicit ^26.0.0 range moves the
		// line to 26.2.0 but keeps the exact pattern (no caret on write).
		const results = await run(dir, { ...FALSE_CFG, node: "^26.0.0" }, { node: "26.2.0" });

		expect(results).toEqual([{ runtime: "node", from: "24.11.0", to: "26.2.0", added: false }]);
		expect(readPackageJson(dir).devEngines.runtime[0].version).toBe("26.2.0");
	});

	it("explicit range + missing entry: adds (single object promoted to array)", async () => {
		const dir = makeTempDir();
		writePackageJson(dir, { devEngines: { runtime: { name: "node", version: "^24.0.0", onFail: "ignore" } } });

		const results = await run(dir, { ...FALSE_CFG, deno: "^2" }, { deno: "2.1.0" });

		expect(results).toEqual([{ runtime: "deno", from: null, to: "^2.1.0", added: true }]);
		expect(readPackageJson(dir).devEngines.runtime).toEqual([
			{ name: "node", version: "^24.0.0", onFail: "ignore" },
			{ name: "deno", version: "^2.1.0", onFail: "ignore" },
		]);
	});

	it("explicit range + absent devEngines.runtime: creates an array entry", async () => {
		const dir = makeTempDir();
		writePackageJson(dir, { name: "x" });

		const results = await run(dir, { ...FALSE_CFG, bun: "^1" }, { bun: "1.2.0" });

		expect(results).toEqual([{ runtime: "bun", from: null, to: "^1.2.0", added: true }]);
		expect(readPackageJson(dir).devEngines.runtime).toEqual([{ name: "bun", version: "^1.2.0", onFail: "ignore" }]);
	});

	it("already current: no-op", async () => {
		const dir = makeTempDir();
		writePackageJson(dir, { devEngines: { runtime: [{ name: "node", version: "^24.16.0" }] } });

		const results = await run(dir, { ...FALSE_CFG, node: "auto" }, { node: "24.16.0" });

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
			{ runtime: "node", from: "^24.0.0", to: "^24.16.0", added: false },
			{ runtime: "bun", from: "^1.0.0", to: "^1.2.0", added: false },
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

		expect(results).toEqual([{ runtime: "deno", from: "^2.0.0", to: "^2.1.0", added: false }]);
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
});
