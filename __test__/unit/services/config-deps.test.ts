import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NpmRegistry, ReleaseAgeGate } from "@effected/npm";
import { Yaml } from "@effected/yaml";
import { Effect, Layer, References } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ConfigDeps } from "../../../src/services/config-deps.js";
import { ReleaseAge } from "../../../src/services/release-age.js";
import { seededRegistry } from "../../utils/fixtures.js";

// ══════════════════════════════════════════════════════════════════════════════
// Test Helpers
// ══════════════════════════════════════════════════════════════════════════════

const runWithService = <A, E>(
	fn: (service: Effect.Success<typeof ConfigDeps>) => Effect.Effect<A, E>,
	packages?: Record<string, { version: string; integrity?: string; versions?: string[] }>,
	releaseAge: Layer.Layer<ReleaseAge> = ReleaseAge.layerNoop,
) => {
	const registryLayer = packages ? seededRegistry(packages) : seededRegistry({});
	const layer = ConfigDeps.layer.pipe(Layer.provide(Layer.merge(registryLayer, releaseAge)));
	return Effect.runPromise(
		Effect.gen(function* () {
			const service = yield* ConfigDeps;
			return yield* fn(service);
		}).pipe(Effect.provide(layer), Effect.provideService(References.MinimumLogLevel, "None")),
	);
};

// ══════════════════════════════════════════════════════════════════════════════
// ConfigDeps service (Effect integration tests)
// ══════════════════════════════════════════════════════════════════════════════

describe("ConfigDeps.updateConfigDeps", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = mkdtempSync(join(tmpdir(), "config-test-"));
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	const writeWorkspaceYaml = (content: string) => {
		writeFileSync(join(tempDir, "pnpm-workspace.yaml"), content, "utf-8");
	};

	const readWorkspaceYaml = () => {
		return Effect.runSync(Yaml.parse(readFileSync(join(tempDir, "pnpm-workspace.yaml"), "utf-8"))) as {
			configDependencies: Record<string, string>;
			[key: string]: unknown;
		};
	};

	it("returns empty array when no deps provided", async () => {
		const result = await runWithService((s) => s.updateConfigDeps([], tempDir));
		expect(result).toEqual([]);
	});

	it("returns empty array when no workspace yaml exists", async () => {
		const result = await runWithService((s) => s.updateConfigDeps(["typescript"], tempDir));
		expect(result).toEqual([]);
	});

	it("returns empty array when no configDependencies section", async () => {
		writeWorkspaceYaml(`packages:\n  - "pkgs/*"\n`);

		const result = await runWithService((s) => s.updateConfigDeps(["typescript"], tempDir));
		expect(result).toEqual([]);
	});

	it("skips dep not in configDependencies", async () => {
		writeWorkspaceYaml(`configDependencies:\n  typescript: "5.3.3"\n`);

		const result = await runWithService((s) => s.updateConfigDeps(["nonexistent"], tempDir));
		expect(result).toEqual([]);
	});

	it("updates single dep when newer version available", async () => {
		writeWorkspaceYaml(`configDependencies:\n  "@savvy-web/silk": "0.6.3+sha512-oldHash=="\n`);

		const result = await runWithService((s) => s.updateConfigDeps(["@savvy-web/silk"], tempDir), {
			"@savvy-web/silk": { version: "0.7.0", integrity: "sha512-newHash==" },
		});

		expect(result).toHaveLength(1);
		expect(result[0]).toMatchObject({
			dependency: "@savvy-web/silk",
			from: "0.6.3",
			to: "0.7.0",
			type: "config",
			package: null,
		});

		// Verify YAML was updated
		const yaml = readWorkspaceYaml();
		expect(yaml.configDependencies["@savvy-web/silk"]).toBe("0.7.0");
	});

	it("holds back a resolution the release-age gate filters out", async () => {
		writeWorkspaceYaml(`configDependencies:\n  typescript: "1.0.0+sha512-oldHash=="\n`);

		const holdBack = Layer.succeed(ReleaseAge, {
			gate: () => Effect.succeed(ReleaseAgeGate.combine({ ageMinutes: 1440 })),
			filterVersions: (_pkg: string, versions: ReadonlyArray<string>) =>
				Effect.succeed(versions.filter((v) => v !== "1.1.0")),
		});

		const result = await runWithService(
			(s) => s.updateConfigDeps(["typescript"], tempDir),
			{ typescript: { version: "1.1.0", versions: ["1.0.0", "1.1.0"], integrity: "sha512-newHash==" } },
			holdBack,
		);

		expect(result).toHaveLength(0);
		// Held back at 1.0.0 — which is then the up-to-date version, so the old
		// inline integrity is stripped (a normalization, not an update).
		expect(readWorkspaceYaml().configDependencies.typescript).toBe("1.0.0");
	});

	it("strips the inline integrity from an up-to-date dep without reporting an update", async () => {
		writeWorkspaceYaml(`configDependencies:\n  typescript: "5.4.0+sha512-existingHash=="\n`);

		const result = await runWithService((s) => s.updateConfigDeps(["typescript"], tempDir), {
			typescript: { version: "5.4.0", integrity: "sha512-existingHash==" },
		});

		// Not an update — the version did not move — but the file converges on
		// the bare form pnpm 11+ itself writes.
		expect(result).toHaveLength(0);
		expect(readWorkspaceYaml().configDependencies.typescript).toBe("5.4.0");
	});

	it("leaves an up-to-date, already-bare file byte-identical", async () => {
		// The control for the normalization above: nothing to strip, no write —
		// not even the re-sort/re-stringify a write would bring.
		const raw = `configDependencies:\n  zeta: "1.0.0"\n  typescript: "5.4.0"\npackages:\n  - "pkgs/*"\n`;
		writeWorkspaceYaml(raw);

		const result = await runWithService((s) => s.updateConfigDeps(["typescript"], tempDir), {
			typescript: { version: "5.4.0" },
		});

		expect(result).toHaveLength(0);
		expect(readFileSync(join(tempDir, "pnpm-workspace.yaml"), "utf-8")).toBe(raw);
	});

	it("warns and skips an entry that is not a <version>[+<integrity>] spec", async () => {
		// A range is not a config-dependency spec; the posture is warn-and-skip,
		// never a failed run and never a rewrite.
		writeWorkspaceYaml(`configDependencies:\n  typescript: "^5.3.3"\n`);

		const result = await runWithService((s) => s.updateConfigDeps(["typescript"], tempDir), {
			typescript: { version: "5.4.0" },
		});

		expect(result).toHaveLength(0);
		expect(readWorkspaceYaml().configDependencies.typescript).toBe("^5.3.3");
	});

	it("never queries a version's integrity — only the version list", async () => {
		writeWorkspaceYaml(`configDependencies:\n  typescript: "5.3.3+sha512-oldHash=="\n`);

		let versionQueries = 0;
		const counting = Layer.effect(
			NpmRegistry,
			Effect.gen(function* () {
				const base = yield* NpmRegistry;
				return {
					...base,
					version: (pkg: string, version: string, target?: Parameters<typeof base.version>[2]) => {
						versionQueries++;
						return base.version(pkg, version, target);
					},
				};
			}),
		).pipe(Layer.provide(seededRegistry({ typescript: { version: "5.4.0", versions: ["5.3.3", "5.4.0"] } })));

		const layer = ConfigDeps.layer.pipe(Layer.provide(Layer.merge(counting, ReleaseAge.layerNoop)));
		const result = await Effect.runPromise(
			Effect.gen(function* () {
				return yield* (yield* ConfigDeps).updateConfigDeps(["typescript"], tempDir);
			}).pipe(Effect.provide(layer), Effect.provideService(References.MinimumLogLevel, "None")),
		);

		expect(result).toHaveLength(1);
		expect(versionQueries).toBe(0);
		expect(readWorkspaceYaml().configDependencies.typescript).toBe("5.4.0");
	});

	it("updates multiple deps", async () => {
		writeWorkspaceYaml(`configDependencies:\n  typescript: "5.3.3"\n  "@biomejs/biome": "1.5.0+sha512-oldHash=="\n`);

		const result = await runWithService((s) => s.updateConfigDeps(["typescript", "@biomejs/biome"], tempDir), {
			typescript: { version: "5.4.0", integrity: "sha512-tsHash==" },
			"@biomejs/biome": { version: "1.6.1", integrity: "sha512-biomeHash==" },
		});

		expect(result).toHaveLength(2);
		expect(result.find((r) => r.dependency === "typescript")?.to).toBe("5.4.0");
		expect(result.find((r) => r.dependency === "@biomejs/biome")?.to).toBe("1.6.1");
	});

	it("continues when npm query fails for one dep", async () => {
		writeWorkspaceYaml(`configDependencies:\n  "bad-pkg": "1.0.0"\n  "good-pkg": "1.0.0"\n`);

		// Only provide "good-pkg" in registry; "bad-pkg" will fail automatically.
		// 1.5.0 stays within good-pkg's major (>=1.0.0 <2.0.0).
		const result = await runWithService((s) => s.updateConfigDeps(["bad-pkg", "good-pkg"], tempDir), {
			"good-pkg": { version: "1.5.0", integrity: "sha512-goodHash==" },
		});

		expect(result).toHaveLength(1);
		expect(result[0].dependency).toBe("good-pkg");
	});

	it("preserves other yaml keys", async () => {
		writeWorkspaceYaml(
			[
				`packages:`,
				`  - "pkgs/*"`,
				`  - "apps/*"`,
				`onlyBuiltDependencies:`,
				`  - sharp`,
				`configDependencies:`,
				`  typescript: "5.3.3"`,
				``,
			].join("\n"),
		);

		await runWithService((s) => s.updateConfigDeps(["typescript"], tempDir), {
			typescript: { version: "5.4.0", integrity: "sha512-tsHash==" },
		});

		const yaml = readWorkspaceYaml();
		expect(yaml.packages).toBeDefined();
		expect(yaml.onlyBuiltDependencies).toBeDefined();
		expect(yaml.configDependencies.typescript).toBe("5.4.0");
	});

	it("reports clean versions in from/to (strips hash)", async () => {
		writeWorkspaceYaml(`configDependencies:\n  "@savvy-web/silk": "0.6.3+sha512-P2oTH3CRDxvEqVtavf5adiX2B4=="\n`);

		const result = await runWithService((s) => s.updateConfigDeps(["@savvy-web/silk"], tempDir), {
			"@savvy-web/silk": { version: "0.7.0", integrity: "sha512-newHashValue==" },
		});

		expect(result).toHaveLength(1);
		// from should be clean version (no hash)
		expect(result[0].from).toBe("0.6.3");
		// to should be clean version (no hash)
		expect(result[0].to).toBe("0.7.0");
	});

	it("updates even when the registry publishes no integrity — none is written", async () => {
		writeWorkspaceYaml(`configDependencies:\n  typescript: "5.3.3"\n`);

		const result = await runWithService((s) => s.updateConfigDeps(["typescript"], tempDir), {
			typescript: { version: "5.4.0" }, // no integrity
		});

		// The lockfile refresh records integrity; this write never needed it.
		expect(result).toHaveLength(1);
		expect(readWorkspaceYaml().configDependencies.typescript).toBe("5.4.0");
	});

	it("skips dep when the entry is empty", async () => {
		writeWorkspaceYaml(`configDependencies:\n  typescript: ""\n`);

		const result = await runWithService((s) => s.updateConfigDeps(["typescript"], tempDir));
		expect(result).toHaveLength(0);
	});

	it("caps a >=1.0.0 config dep within its current major", async () => {
		writeWorkspaceYaml(`configDependencies:\n  "@savvy-web/silk": "1.14.5+sha512-oldHash=="\n`);

		// Latest is 2.3.0 but a post-1.0 dep must stay within major 1 — the
		// highest in-range version is 1.20.0.
		const result = await runWithService((s) => s.updateConfigDeps(["@savvy-web/silk"], tempDir), {
			"@savvy-web/silk": {
				version: "2.3.0",
				integrity: "sha512-resolvedHash==",
				versions: ["1.14.5", "1.20.0", "2.0.0", "2.3.0"],
			},
		});

		expect(result).toHaveLength(1);
		expect(result[0]).toMatchObject({ from: "1.14.5", to: "1.20.0", type: "config" });

		const yaml = readWorkspaceYaml();
		expect(yaml.configDependencies["@savvy-web/silk"]).toBe("1.20.0");
	});

	it("advances a sub-1.0.0 config dep across 0.x minors when no stable major exists", async () => {
		writeWorkspaceYaml(`configDependencies:\n  "@savvy-web/pnpm-plugin-silk": "0.14.5+sha512-oldHash=="\n`);

		const result = await runWithService((s) => s.updateConfigDeps(["@savvy-web/pnpm-plugin-silk"], tempDir), {
			"@savvy-web/pnpm-plugin-silk": {
				version: "0.20.0",
				integrity: "sha512-resolvedHash==",
				versions: ["0.14.5", "0.18.0", "0.20.0"],
			},
		});

		expect(result).toHaveLength(1);
		expect(result[0]).toMatchObject({ from: "0.14.5", to: "0.20.0", type: "config" });

		const yaml = readWorkspaceYaml();
		expect(yaml.configDependencies["@savvy-web/pnpm-plugin-silk"]).toBe("0.20.0");
	});

	it("adopts the latest 1.x for a sub-1.0.0 config dep but never crosses into 2.x", async () => {
		writeWorkspaceYaml(`configDependencies:\n  "@savvy-web/pnpm-plugin-silk": "0.14.5+sha512-oldHash=="\n`);

		// 0.14.5 may jump to the first stable major (1.x → latest 1.5.0), but a
		// single run must not reach 2.0.0.
		const result = await runWithService((s) => s.updateConfigDeps(["@savvy-web/pnpm-plugin-silk"], tempDir), {
			"@savvy-web/pnpm-plugin-silk": {
				version: "2.0.0",
				integrity: "sha512-resolvedHash==",
				versions: ["0.14.5", "0.20.0", "1.2.0", "1.5.0", "2.0.0"],
			},
		});

		expect(result).toHaveLength(1);
		expect(result[0]).toMatchObject({ from: "0.14.5", to: "1.5.0", type: "config" });

		const yaml = readWorkspaceYaml();
		expect(yaml.configDependencies["@savvy-web/pnpm-plugin-silk"]).toBe("1.5.0");
	});

	it("handles config dep without hash suffix", async () => {
		writeWorkspaceYaml(`configDependencies:\n  typescript: "5.3.3"\n`);

		const result = await runWithService((s) => s.updateConfigDeps(["typescript"], tempDir), {
			typescript: { version: "5.4.0", integrity: "sha512-tsHash==" },
		});

		expect(result).toHaveLength(1);
		expect(result[0].from).toBe("5.3.3");
		expect(result[0].to).toBe("5.4.0");

		// Bare, as pnpm 11+ writes it — never a version+integrity pair.
		const yaml = readWorkspaceYaml();
		expect(yaml.configDependencies.typescript).toBe("5.4.0");
	});
});
