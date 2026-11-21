import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BunExtension } from "@effected/bun";
import type { ImporterDependency, LockfileImporter, ResolvedPackage } from "@effected/lockfiles";
import { Lockfile as LockfileModel } from "@effected/lockfiles";
import { DependencySpecifier } from "@effected/npm";
import type { PnpmExtension } from "@effected/pnpm";
import type { WorkspacePackage } from "@effected/workspaces";
import { WorkspaceDiscovery } from "@effected/workspaces";
import { Effect, Layer, Logger, References, Result, Schema } from "effect";
import { describe, expect, it } from "vitest";
import type { LockfileChange } from "../../../src/schema/domain.js";
import {
	LOCKFILE_NAMES,
	captureLockfileState,
	compareLockfiles,
	groupChangesByPackage,
} from "../../../src/services/lockfile.js";

/**
 * Mock WorkspaceDiscovery layer that returns a fixed package map for /workspace root.
 *
 * Cast to WorkspacePackage since tests only need name/path on mock objects.
 */
const MockWorkspacesLive = Layer.succeed(WorkspaceDiscovery, {
	listPackages: () =>
		Effect.succeed([
			{ name: "@savvy-web/core", path: "/workspace/pkgs/core" },
			{ name: "@savvy-web/utils", path: "/workspace/pkgs/utils" },
		] as unknown as ReadonlyArray<WorkspacePackage>),
	getPackage: () => Effect.die("getPackage not used in lockfile tests"),
	infoIn: () => Effect.die("infoIn not used in lockfile tests"),
	listPackagesIn: () => Effect.die("listPackagesIn not used in lockfile tests"),
	refreshIn: () => Effect.die("refreshIn not used in lockfile tests"),
	refresh: () => Effect.void,
	info: () => Effect.die("info not used in lockfile tests"),
	resolveFile: () => Effect.die("resolveFile not used in lockfile tests"),
	resolveFiles: () => Effect.die("resolveFiles not used in lockfile tests"),
	importerMap: () =>
		Effect.succeed(
			new Map<string, WorkspacePackage>([
				[".", { name: "test-root", path: "/workspace" } as unknown as WorkspacePackage],
				["pkgs/core", { name: "@savvy-web/core", path: "/workspace/pkgs/core" } as unknown as WorkspacePackage],
				["pkgs/utils", { name: "@savvy-web/utils", path: "/workspace/pkgs/utils" } as unknown as WorkspacePackage],
			]),
		),
});

/** A WorkspaceDiscovery whose importerMap fails, exercising the warn-and-continue path. */
const FailingWorkspacesLive = Layer.succeed(WorkspaceDiscovery, {
	listPackages: () => Effect.die("listPackages not used"),
	getPackage: () => Effect.die("getPackage not used"),
	infoIn: () => Effect.die("infoIn not used"),
	listPackagesIn: () => Effect.die("listPackagesIn not used"),
	refreshIn: () => Effect.die("refreshIn not used"),
	refresh: () => Effect.void,
	info: () => Effect.die("info not used"),
	resolveFile: () => Effect.die("resolveFile not used"),
	resolveFiles: () => Effect.die("resolveFiles not used"),
	importerMap: () => Effect.fail(new Error("boom") as never),
});

type DepType = ImporterDependency["depType"];

// The compare code only reads `.specifier.raw` (an `@effected/npm`
// ClassifiedSpecifier), `.path`, `.name`, `.depType`, `.format`, `.packages`,
// `.importers`, `.extension`. These helpers build plain objects cast to the
// model types rather than validating `Lockfile.parse` instances — construction
// is not under test here, the comparison is.

/** Build a LockfileImporter from a compact `[name, specifier, depType]` list. */
/**
 * Classify a specifier string exactly as `Lockfile.parse` does.
 *
 * A bare `{ raw }` stand-in is poorer than production: the kit's diff matches
 * catalog consumers on the classified `_tag`, so a fixture without one would
 * read every catalog reference as a plain range and report no consumers.
 */
const classify = Schema.decodeUnknownSync(DependencySpecifier.FromString);

const importer = (path: string, deps: ReadonlyArray<[string, string, DepType?]>): LockfileImporter =>
	({
		path,
		dependencies: deps.map(([name, specifier, depType]) => ({
			name,
			specifier: classify(specifier),
			depType: depType ?? "dependencies",
		})),
	}) as unknown as LockfileImporter;

interface LockfileOverrides {
	readonly format?: LockfileModel["format"];
	readonly packages?: ReadonlyArray<ResolvedPackage>;
	readonly importers?: ReadonlyArray<LockfileImporter>;
	readonly extension?: LockfileModel["extension"];
}

/** Construct a minimal Lockfile for testing. */
const makeLockfile = (overrides: LockfileOverrides = {}): LockfileModel =>
	({
		format: overrides.format ?? "pnpm",
		packages: overrides.packages ?? [],
		importers: overrides.importers ?? [],
		...(overrides.extension !== undefined ? { extension: overrides.extension } : {}),
	}) as unknown as LockfileModel;

/** A pnpm lockfile with `catalogs` recorded as `{ specifier, version }` pairs. */
const pnpmCatalogs = (
	catalogs: Record<string, Record<string, { specifier: string; version: string }>>,
): PnpmExtension => ({ _tag: "pnpm", catalogs }) as unknown as PnpmExtension;

/** Run compareLockfiles via the standalone export with logging suppressed. */
const runCompare = (
	before: LockfileModel | null,
	after: LockfileModel | null,
	discovery: Layer.Layer<WorkspaceDiscovery> = MockWorkspacesLive,
) =>
	Effect.runPromise(
		compareLockfiles(before, after, "/workspace").pipe(
			Effect.provide(discovery),
			Effect.provideService(References.MinimumLogLevel, "None"),
		),
	);

const runEffect = <A, E>(effect: Effect.Effect<A, E>) =>
	Effect.runPromise(Effect.result(effect).pipe(Effect.provideService(References.MinimumLogLevel, "None")));

const runCapture = (pm: "pnpm" | "bun" | "npm", root: string) => runEffect(captureLockfileState(pm, root));

const tempRoot = () => mkdtempSync(join(tmpdir(), "lockfile-test-"));

const PNPM_LOCK = `lockfileVersion: '9.0'

catalogs:
  default:
    turbo:
      specifier: ^2.8.4
      version: 2.8.6

importers:

  .:
    devDependencies:
      turbo:
        specifier: 'catalog:'
        version: 2.8.6
`;

const BUN_LOCK = `{
  "lockfileVersion": 1,
  "workspaces": {
    "": { "name": "test-root", "devDependencies": { "turbo": "catalog:" } }
  },
  "catalog": { "turbo": "^2.8.4" },
  "packages": {
    "turbo": ["turbo@2.8.6", {}, "sha512-abc"]
  }
}
`;

const NPM_LOCK = `{
  "name": "test-root",
  "lockfileVersion": 3,
  "packages": {
    "": { "name": "test-root", "dependencies": { "lodash": "^4.17.0" } },
    "node_modules/lodash": { "version": "4.17.21" }
  }
}
`;

describe("LOCKFILE_NAMES", () => {
	it("maps each supported package manager to its lockfile", () => {
		expect(LOCKFILE_NAMES).toEqual({
			pnpm: "pnpm-lock.yaml",
			bun: "bun.lock",
			npm: "package-lock.json",
		});
	});
});

describe("captureLockfileState", () => {
	it("parses a pnpm lockfile", async () => {
		const root = tempRoot();
		writeFileSync(join(root, "pnpm-lock.yaml"), PNPM_LOCK);

		const result = await runCapture("pnpm", root);

		expect(Result.isSuccess(result)).toBe(true);
		if (Result.isSuccess(result) && result.success) {
			expect(result.success.format).toBe("pnpm");
			expect(result.success.importers.map((i) => i.path)).toContain(".");
		}
	});

	it("parses a bun lockfile", async () => {
		const root = tempRoot();
		writeFileSync(join(root, "bun.lock"), BUN_LOCK);

		const result = await runCapture("bun", root);

		expect(Result.isSuccess(result)).toBe(true);
		if (Result.isSuccess(result) && result.success) {
			expect(result.success.format).toBe("bun");
			expect(result.success.extension?._tag).toBe("bun");
		}
	});

	it("parses an npm lockfile", async () => {
		const root = tempRoot();
		writeFileSync(join(root, "package-lock.json"), NPM_LOCK);

		const result = await runCapture("npm", root);

		expect(Result.isSuccess(result)).toBe(true);
		if (Result.isSuccess(result) && result.success) {
			expect(result.success.format).toBe("npm");
			// npm has no catalog protocol, so no PM-specific extension.
			expect(result.success.extension).toBeUndefined();
		}
	});

	it("returns null when the lockfile does not exist", async () => {
		const result = await runCapture("pnpm", tempRoot());

		expect(Result.isSuccess(result)).toBe(true);
		if (Result.isSuccess(result)) {
			expect(result.success).toBeNull();
		}
	});

	it("returns LockfileError when the lockfile cannot be read", async () => {
		const root = tempRoot();
		// A directory where the lockfile should be: exists, but reading it throws.
		mkdirSync(join(root, "pnpm-lock.yaml"));

		const result = await runCapture("pnpm", root);

		expect(Result.isFailure(result)).toBe(true);
		if (Result.isFailure(result)) {
			expect(result.failure._tag).toBe("LockfileError");
			expect(result.failure.operation).toBe("read");
		}
	});

	it("degrades an unparseable lockfile to null instead of failing the run", async () => {
		const root = tempRoot();
		writeFileSync(join(root, "bun.lock"), "this is not JSONC {{{");

		const result = await runCapture("bun", root);

		// A parse failure must not abort the run: capture happens after the
		// destructive branch delete-and-recreate, and git status --porcelain
		// still drives change detection, so the old ignoreIncompatible-style
		// resilience is the baseline to preserve.
		expect(Result.isSuccess(result)).toBe(true);
		if (Result.isSuccess(result)) {
			expect(result.success).toBeNull();
		}
	});

	it("warns (naming the lockfile path and reason) when degrading a parse failure to null", async () => {
		const root = tempRoot();
		const lockfilePath = join(root, "bun.lock");
		writeFileSync(lockfilePath, "this is not JSONC {{{");

		const messages: string[] = [];
		const captureLogger = Logger.make(({ logLevel, message }) => {
			if (logLevel === "Warn") {
				messages.push(String(message));
			}
		});

		const result = await Effect.runPromise(
			captureLockfileState("bun", root).pipe(
				Effect.provide(Layer.succeed(References.CurrentLoggers, new Set([captureLogger]))),
			),
		);

		expect(result).toBeNull();
		expect(messages).toHaveLength(1);
		expect(messages[0]).toContain(lockfilePath);
		expect(messages[0]).toMatch(/skip/i);
	});
});

describe("compareLockfiles - null handling", () => {
	it("returns empty array when before is null", async () => {
		expect(await runCompare(null, makeLockfile())).toEqual([]);
	});

	it("returns empty array when after is null", async () => {
		expect(await runCompare(makeLockfile(), null)).toEqual([]);
	});

	it("returns empty array when both are null", async () => {
		expect(await runCompare(null, null)).toEqual([]);
	});
});

describe("compareLockfiles - workspace discovery failure", () => {
	it("falls back to the bare importer id when the importer map cannot be read", async () => {
		const before = makeLockfile({ importers: [importer("pkgs/core", [["lodash", "^4.17.0"]])] });
		const after = makeLockfile({ importers: [importer("pkgs/core", [["lodash", "^4.18.0"]])] });

		const changes = await runCompare(before, after, FailingWorkspacesLive);

		expect(changes).toHaveLength(1);
		expect(changes[0].affectedPackages).toEqual(["pkgs/core"]);
	});
});

describe("compareLockfiles - pnpm catalogs", () => {
	it("reports the specifier move and the consuming importer", async () => {
		const before = makeLockfile({
			extension: pnpmCatalogs({ silk: { effect: { specifier: "^3.0.0", version: "3.0.5" } } }),
			importers: [importer("pkgs/core", [["effect", "catalog:silk"]])],
		});
		const after = makeLockfile({
			extension: pnpmCatalogs({ silk: { effect: { specifier: "^3.1.0", version: "3.1.2" } } }),
			importers: [importer("pkgs/core", [["effect", "catalog:silk"]])],
		});

		const changes = await runCompare(before, after);

		expect(changes).toHaveLength(1);
		expect(changes[0]).toMatchObject({
			dependency: "effect",
			type: "dependency",
			from: "^3.0.0",
			to: "^3.1.0",
			affectedPackages: ["@savvy-web/core"],
		});
	});

	it("reports resolved-version movement under an unchanged specifier", async () => {
		const before = makeLockfile({
			extension: pnpmCatalogs({ default: { turbo: { specifier: "^2.8.4", version: "2.8.6" } } }),
			importers: [importer(".", [["turbo", "catalog:", "devDependencies"]])],
		});
		const after = makeLockfile({
			extension: pnpmCatalogs({ default: { turbo: { specifier: "^2.8.4", version: "2.8.7" } } }),
			importers: [importer(".", [["turbo", "catalog:", "devDependencies"]])],
		});

		const changes = await runCompare(before, after);

		expect(changes).toHaveLength(1);
		expect(changes[0]).toMatchObject({
			dependency: "turbo",
			type: "devDependency",
			from: "2.8.6",
			to: "2.8.7",
			affectedPackages: ["test-root"],
		});
	});

	it("emits one record per dep section when a catalog ref is consumed twice", async () => {
		const importers = [
			importer("pkgs/core", [
				["effect", "catalog:silk", "dependencies"],
				["effect", "catalog:silk", "peerDependencies"],
			]),
		];
		const before = makeLockfile({
			extension: pnpmCatalogs({ silk: { effect: { specifier: "^3.0.0", version: "3.0.5" } } }),
			importers,
		});
		const after = makeLockfile({
			extension: pnpmCatalogs({ silk: { effect: { specifier: "^3.1.0", version: "3.1.2" } } }),
			importers,
		});

		const changes = await runCompare(before, after);

		expect(changes).toHaveLength(2);
		expect(changes.map((c) => c.type).sort()).toEqual(["dependency", "peerDependency"]);
	});

	it("reports no change when specifier and version are both unchanged", async () => {
		const catalogs = pnpmCatalogs({ default: { turbo: { specifier: "^2.8.4", version: "2.8.6" } } });
		const changes = await runCompare(makeLockfile({ extension: catalogs }), makeLockfile({ extension: catalogs }));

		expect(changes).toHaveLength(0);
	});

	it("reports a removed catalog entry", async () => {
		const before = makeLockfile({
			extension: pnpmCatalogs({
				default: {
					turbo: { specifier: "^2.8.4", version: "2.8.6" },
					vitest: { specifier: "^1.0.0", version: "1.0.4" },
				},
			}),
		});
		const after = makeLockfile({
			extension: pnpmCatalogs({ default: { turbo: { specifier: "^2.8.4", version: "2.8.6" } } }),
		});

		const changes = await runCompare(before, after);

		expect(changes).toHaveLength(1);
		expect(changes[0]).toMatchObject({ dependency: "vitest", from: "^1.0.0", to: "(removed)" });
	});

	it("attributes a removed catalog entry to every consumer, one record per (importer, section)", async () => {
		// The consumers are read from the BEFORE importers — after the removal the
		// catalog is gone, so an after-side lookup would find nobody and drop them.
		// The importers still reference the catalog in both states, so this exercises
		// the catalog removal alone (compareImporters skips catalog: specifiers).
		const importers = [
			importer("pkgs/core", [["vitest", "catalog:silk", "devDependencies"]]),
			importer("pkgs/utils", [["vitest", "catalog:silk"]]),
		];
		const before = makeLockfile({
			extension: pnpmCatalogs({ silk: { vitest: { specifier: "^1.0.0", version: "1.0.4" } } }),
			importers,
		});
		const after = makeLockfile({ extension: pnpmCatalogs({ silk: {} }), importers });

		const changes = await runCompare(before, after);

		expect(changes).toHaveLength(2);
		expect(changes).toContainEqual({
			type: "devDependency",
			dependency: "vitest",
			from: "^1.0.0",
			to: "(removed)",
			affectedPackages: ["@savvy-web/core"],
		});
		expect(changes).toContainEqual({
			type: "dependency",
			dependency: "vitest",
			from: "^1.0.0",
			to: "(removed)",
			affectedPackages: ["@savvy-web/utils"],
		});
	});

	it("reports a removed catalog entry with no consumers as a single unassigned change", async () => {
		const before = makeLockfile({
			extension: pnpmCatalogs({ silk: { vitest: { specifier: "^1.0.0", version: "1.0.4" } } }),
		});
		const after = makeLockfile({ extension: pnpmCatalogs({ silk: {} }) });

		const changes = await runCompare(before, after);

		expect(changes).toEqual([
			{ type: "dependency", dependency: "vitest", from: "^1.0.0", to: "(removed)", affectedPackages: [] },
		]);
	});

	it("reports an entire removed catalog group", async () => {
		const before = makeLockfile({
			extension: pnpmCatalogs({ silk: { effect: { specifier: "^3.0.0", version: "3.0.5" } } }),
		});
		const after = makeLockfile({ extension: pnpmCatalogs({}) });

		const changes = await runCompare(before, after);

		expect(changes).toHaveLength(1);
		expect(changes[0]).toMatchObject({ dependency: "effect", to: "(removed)" });
	});

	it("treats a pnpm lockfile with no catalogs as having none", async () => {
		const ext = { _tag: "pnpm" } as unknown as PnpmExtension;
		const changes = await runCompare(makeLockfile({ extension: ext }), makeLockfile({ extension: ext }));
		expect(changes).toHaveLength(0);
	});
});

describe("compareLockfiles - bun catalogs", () => {
	/**
	 * bun records the bare specifier in its catalog and the resolved version on
	 * package entries, so the fixture is real `bun.lock` text through
	 * `Lockfile.parse`: the kit's diff reads each consumer's resolved edge, which
	 * a hand-built object cannot carry. The rule for an ambiguous or duplicated
	 * resolution belongs to `LockfileDiff.compare` and is tested there.
	 */
	const bunLockfile = (specifier: string, reactVersion: string, named = false): LockfileModel =>
		Effect.runSync(
			LockfileModel.parse(
				JSON.stringify(
					{
						lockfileVersion: 1,
						workspaces: {
							"": { name: "test-root", devDependencies: { react: named ? "catalog:ui" : "catalog:default" } },
							"pkgs/core": { name: "@savvy-web/core", dependencies: { react: named ? "catalog:ui" : "catalog:" } },
						},
						...(named ? { catalogs: { ui: { react: specifier } } } : { catalog: { react: specifier } }),
						packages: { react: [`react@${reactVersion}`, "", {}, "sha512-fixture"] },
					},
					null,
					2,
				),
				{ format: "bun" },
			),
		);

	it("reports a default-catalog specifier bump for every consuming importer and section", async () => {
		const before = bunLockfile("^19.0.0", "19.0.1");
		const after = bunLockfile("^19.1.0", "19.1.0");

		const changes = await runCompare(before, after);

		expect(changes).toHaveLength(2);
		expect(changes).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					dependency: "react",
					type: "dependency",
					from: "^19.0.0",
					to: "^19.1.0",
					affectedPackages: ["@savvy-web/core"],
				}),
				expect.objectContaining({
					dependency: "react",
					type: "devDependency",
					affectedPackages: ["test-root"],
				}),
			]),
		);
	});

	it("reports a named-catalog specifier bump", async () => {
		const before = bunLockfile("^19.0.0", "19.0.1", true);
		const after = bunLockfile("^19.1.0", "19.1.0", true);

		const changes = await runCompare(before, after);

		expect(changes).toHaveLength(2);
		expect(changes[0]).toMatchObject({ dependency: "react", from: "^19.0.0", to: "^19.1.0" });
	});

	it("reports resolved-version movement under an unchanged specifier", async () => {
		const before = bunLockfile("^19.0.0", "19.0.1");
		const after = bunLockfile("^19.0.0", "19.0.2");

		const changes = await runCompare(before, after);

		expect(changes).toHaveLength(2);
		expect(changes[0]).toMatchObject({ dependency: "react", from: "19.0.1", to: "19.0.2" });
	});

	it("reports nothing when neither the specifier nor the resolved version moved", async () => {
		const changes = await runCompare(bunLockfile("^19.0.0", "19.0.1"), bunLockfile("^19.0.0", "19.0.1"));

		expect(changes).toHaveLength(0);
	});

	it("reports nothing for a bun lockfile with no catalogs at all", async () => {
		const ext = { _tag: "bun" } as unknown as BunExtension;
		const changes = await runCompare(
			makeLockfile({ format: "bun", extension: ext }),
			makeLockfile({ format: "bun", extension: ext }),
		);
		expect(changes).toHaveLength(0);
	});

	it("skips catalog entries whose shape is neither a string nor a {specifier} object", async () => {
		// BunExtension.catalog/.catalogs are typed Record<string, unknown> upstream,
		// so any of these can appear in real lockfile content: not an object, null,
		// an object with no `specifier`, and an object whose `specifier` is not a
		// string. None is a catalog entry, so none may surface as a change.
		const malformed: Record<string, unknown> = {
			notAnObject: 42,
			nullEntry: null,
			missingSpecifier: { version: "1.0.0" },
			nonStringSpecifier: { specifier: 123 },
		};

		const before = makeLockfile({
			format: "bun",
			extension: { _tag: "bun", catalog: malformed } as unknown as BunExtension,
		});
		const after = makeLockfile({
			format: "bun",
			extension: { _tag: "bun", catalog: malformed } as unknown as BunExtension,
		});

		const changes = await runCompare(before, after);

		expect(changes).toHaveLength(0);
	});
});

describe("compareLockfiles - importer specifier changes", () => {
	it("detects a non-catalog specifier change", async () => {
		const before = makeLockfile({ importers: [importer("pkgs/core", [["lodash", "^4.17.0"]])] });
		const after = makeLockfile({ importers: [importer("pkgs/core", [["lodash", "^4.18.0"]])] });

		const changes = await runCompare(before, after);

		expect(changes).toHaveLength(1);
		expect(changes[0]).toMatchObject({
			dependency: "lodash",
			type: "dependency",
			from: "^4.17.0",
			to: "^4.18.0",
			affectedPackages: ["@savvy-web/core"],
		});
	});

	it("carries the devDependency type", async () => {
		const before = makeLockfile({ importers: [importer("pkgs/core", [["vitest", "^1.0.0", "devDependencies"]])] });
		const after = makeLockfile({ importers: [importer("pkgs/core", [["vitest", "^1.1.0", "devDependencies"]])] });

		const changes = await runCompare(before, after);

		expect(changes).toHaveLength(1);
		expect(changes[0].type).toBe("devDependency");
	});

	it("carries the optionalDependency type", async () => {
		const before = makeLockfile({
			importers: [importer("pkgs/core", [["fsevents", "^2.3.0", "optionalDependencies"]])],
		});
		const after = makeLockfile({
			importers: [importer("pkgs/core", [["fsevents", "^2.4.0", "optionalDependencies"]])],
		});

		const changes = await runCompare(before, after);

		expect(changes).toHaveLength(1);
		expect(changes[0].type).toBe("optionalDependency");
	});

	it("emits one record per section when the same dep changes in two sections", async () => {
		const before = makeLockfile({
			importers: [
				importer("pkgs/core", [
					["effect", "^3.0.0", "dependencies"],
					["effect", "^3.0.0", "peerDependencies"],
				]),
			],
		});
		const after = makeLockfile({
			importers: [
				importer("pkgs/core", [
					["effect", "^3.1.0", "dependencies"],
					["effect", "^3.1.0", "peerDependencies"],
				]),
			],
		});

		const changes = await runCompare(before, after);

		expect(changes).toHaveLength(2);
		expect(changes.map((c) => c.type).sort()).toEqual(["dependency", "peerDependency"]);
	});

	it("reports an added dependency with a null from", async () => {
		const before = makeLockfile({ importers: [importer("pkgs/core", [])] });
		const after = makeLockfile({ importers: [importer("pkgs/core", [["lodash", "^4.18.0"]])] });

		const changes = await runCompare(before, after);

		expect(changes).toHaveLength(1);
		expect(changes[0]).toMatchObject({ dependency: "lodash", from: null, to: "^4.18.0" });
	});

	it("skips catalog specifiers, which compareCatalogs owns", async () => {
		const before = makeLockfile({ importers: [importer("pkgs/core", [["effect", "catalog:silk"]])] });
		const after = makeLockfile({ importers: [importer("pkgs/core", [["effect", "catalog:silk"]])] });

		expect(await runCompare(before, after)).toHaveLength(0);
	});

	it("reports a removed dependency", async () => {
		const before = makeLockfile({
			importers: [
				importer("pkgs/core", [
					["lodash", "^4.17.0"],
					["underscore", "^1.13.0", "devDependencies"],
				]),
			],
		});
		const after = makeLockfile({ importers: [importer("pkgs/core", [["lodash", "^4.17.0"]])] });

		const changes = await runCompare(before, after);

		expect(changes).toHaveLength(1);
		expect(changes[0]).toMatchObject({
			dependency: "underscore",
			type: "devDependency",
			from: "^1.13.0",
			to: "(removed)",
		});
	});

	it("skips importers that did not exist before", async () => {
		const before = makeLockfile({ importers: [] });
		const after = makeLockfile({ importers: [importer("pkgs/core", [["lodash", "^4.18.0"]])] });

		expect(await runCompare(before, after)).toHaveLength(0);
	});

	it("skips importers that no longer exist", async () => {
		const before = makeLockfile({ importers: [importer("pkgs/core", [["lodash", "^4.18.0"]])] });
		const after = makeLockfile({ importers: [] });

		expect(await runCompare(before, after)).toHaveLength(0);
	});

	it("skips a resolved-version move under an unchanged specifier", async () => {
		// The lockfile is regenerated from a clean slate on every run, so resolved
		// versions drift under unchanged ranges; that drift is not a change this
		// action made. The kit's diff does report it, so this pins the filter.
		const withVersion = (version: string) =>
			makeLockfile({
				importers: [
					{
						path: "pkgs/core",
						dependencies: [{ name: "lodash", specifier: classify("^4.17.0"), depType: "dependencies", version }],
					} as unknown as LockfileImporter,
				],
			});

		expect(await runCompare(withVersion("4.17.20"), withVersion("4.17.21"))).toHaveLength(0);
	});

	it("uses the importer path when it is not in the workspace map", async () => {
		const before = makeLockfile({ importers: [importer("pkgs/unknown", [["lodash", "^4.17.0"]])] });
		const after = makeLockfile({ importers: [importer("pkgs/unknown", [["lodash", "^4.18.0"]])] });

		const changes = await runCompare(before, after);

		expect(changes[0].affectedPackages).toEqual(["pkgs/unknown"]);
	});
});

describe("groupChangesByPackage", () => {
	it("groups config changes under (root) key", () => {
		const changes: LockfileChange[] = [
			{ type: "config", dependency: "typescript", from: "5.3.3", to: "5.4.0", affectedPackages: [] },
			{ type: "config", dependency: "biome", from: "1.5.0", to: "1.6.1", affectedPackages: [] },
		];

		const result = groupChangesByPackage(changes);

		expect(result.size).toBe(1);
		expect(result.get("(root)")).toHaveLength(2);
	});

	it("groups regular changes by affected package names", () => {
		const changes: LockfileChange[] = [
			{ type: "dependency", dependency: "effect", from: "3.0.0", to: "3.1.0", affectedPackages: ["@savvy-web/core"] },
			{ type: "dependency", dependency: "zod", from: "3.22.0", to: "3.23.0", affectedPackages: ["@savvy-web/utils"] },
		];

		const result = groupChangesByPackage(changes);

		expect(result.size).toBe(2);
		expect(result.get("@savvy-web/core")?.[0].dependency).toBe("effect");
		expect(result.get("@savvy-web/utils")?.[0].dependency).toBe("zod");
	});

	it("handles changes affecting multiple packages", () => {
		const changes: LockfileChange[] = [
			{
				type: "dependency",
				dependency: "effect",
				from: "3.0.0",
				to: "3.1.0",
				affectedPackages: ["@savvy-web/core", "@savvy-web/utils"],
			},
		];

		const result = groupChangesByPackage(changes);

		expect(result.size).toBe(2);
		expect(result.get("@savvy-web/core")).toHaveLength(1);
		expect(result.get("@savvy-web/utils")).toHaveLength(1);
	});

	it("handles empty changes array", () => {
		expect(groupChangesByPackage([]).size).toBe(0);
	});

	it("handles mix of config and regular changes", () => {
		const changes: LockfileChange[] = [
			{ type: "config", dependency: "typescript", from: "5.3.3", to: "5.4.0", affectedPackages: [] },
			{ type: "dependency", dependency: "effect", from: "3.0.0", to: "3.1.0", affectedPackages: ["@savvy-web/core"] },
		];

		const result = groupChangesByPackage(changes);

		expect(result.size).toBe(2);
		expect(result.has("(root)")).toBe(true);
		expect(result.has("@savvy-web/core")).toBe(true);
	});

	it("accumulates multiple changes for the same package", () => {
		const changes: LockfileChange[] = [
			{ type: "dependency", dependency: "effect", from: "3.0.0", to: "3.1.0", affectedPackages: ["@savvy-web/core"] },
			{
				type: "dependency",
				dependency: "@effect/schema",
				from: "0.60.0",
				to: "0.61.0",
				affectedPackages: ["@savvy-web/core"],
			},
		];

		expect(groupChangesByPackage(changes).get("@savvy-web/core")).toHaveLength(2);
	});
});
