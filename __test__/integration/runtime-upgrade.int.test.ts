import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Layer, LogLevel, Logger } from "effect";
import {
	BunResolverLive,
	DenoResolverLive,
	NodeResolverLive,
	OfflineBunCacheLive,
	OfflineDenoCacheLive,
	OfflineNodeCacheLive,
} from "runtime-resolver";
import { Range, SemVer, satisfies } from "semver-effect";
import { describe, expect, it } from "vitest";
import { RuntimeUpgrade, RuntimeUpgradeLive } from "../../src/services/runtime-upgrade.js";

// NOTE: The plan originally used Node 20 here, but the bundled offline cache in
// runtime-resolver@0.3.10 only contains active-LTS/current entries (24.x and 26.x).
// Node 20 reached EOL and left the cache. We use ^24.0.0 (lowest major present)
// as the drift-canary fixture instead, and assert /^\^24\./ accordingly.

const offlineResolvers = Layer.mergeAll(
	NodeResolverLive.pipe(Layer.provide(OfflineNodeCacheLive)),
	DenoResolverLive.pipe(Layer.provide(OfflineDenoCacheLive)),
	BunResolverLive.pipe(Layer.provide(OfflineBunCacheLive)),
);
const layer = RuntimeUpgradeLive.pipe(Layer.provide(offlineResolvers));

describe("RuntimeUpgrade integration (offline cache)", () => {
	it("auto resolves a real Node 24.x from the bundled cache", async () => {
		const dir = mkdtempSync(join(tmpdir(), "runtime-int-"));
		writeFileSync(
			join(dir, "package.json"),
			`${JSON.stringify({ devEngines: { runtime: [{ name: "node", version: "^24.0.0", onFail: "ignore" }] } }, null, "\t")}\n`,
		);

		const results = await Effect.runPromise(
			Effect.gen(function* () {
				const service = yield* RuntimeUpgrade;
				return yield* service.upgrade({ node: "auto", deno: "false", bun: "false" }, dir);
			}).pipe(Effect.provide(layer), Logger.withMinimumLogLevel(LogLevel.None)),
		);

		expect(results).toHaveLength(1);
		const update = results[0];
		expect(update.runtime).toBe("node");
		expect(update.added).toBe(false);
		expect(update.to).toMatch(/^\^24\.\d+\.\d+$/);

		// The resolved version actually satisfies the original range.
		const ok = await Effect.runPromise(
			Effect.gen(function* () {
				const range = yield* Range.parse("^24.0.0");
				const version = yield* SemVer.parse(update.to.replace(/^\^/, ""));
				return satisfies(version, range);
			}),
		);
		expect(ok).toBe(true);

		// And it was written to disk.
		const written = JSON.parse(readFileSync(join(dir, "package.json"), "utf-8"));
		expect(written.devEngines.runtime[0].version).toBe(update.to);
	});
});
