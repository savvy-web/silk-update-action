/**
 * Lockfile capture and comparison.
 *
 * Package-manager agnostic: reads `pnpm-lock.yaml`, `bun.lock` or
 * `package-lock.json` and parses it through `@effected/lockfiles`'
 * `Lockfile.parse(content, { format })`, which normalizes all three into one
 * `Lockfile` model. `Lockfile.parse` is a pure parser (no memoized reader
 * service), so a "before" and an "after" snapshot can be parsed in the same
 * process.
 *
 * **Standalone functions, not a service.** There was a `Lockfile` tag and a
 * `static readonly layer` here; both were deleted because nothing in `src/`
 * ever resolved the tag — `program.ts` and `steps/lockfile-snapshot.ts` call
 * only {@link captureLockfileState} / {@link compareLockfiles} directly. The
 * only code that ever resolved the tag was this module's own test suite, so
 * those tests passed precisely because they were the sole callers. Same
 * reasoning as the `WorkspaceYaml` tag/layer deletion in
 * `services/workspace-yaml.ts` — a construct whose only consumer is its own
 * test is indistinguishable from dead code.
 *
 * The suite now drives {@link captureLockfileState} / {@link compareLockfiles}
 * directly, which is what `program.ts` and `steps/lockfile-snapshot.ts`
 * actually call — so it exercises the production path rather than a parallel
 * one.
 *
 * @module services/lockfile
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { CatalogChange, ImporterChange, ImporterDependency } from "@effected/lockfiles";
import { LockfileDiff, Lockfile as LockfileModel } from "@effected/lockfiles";
import { WorkspaceDiscovery } from "@effected/workspaces";
import { Effect } from "effect";
import { LockfileError } from "../errors/errors.js";
import type { LockfileChange } from "../schema/domain.js";
import type { SupportedPm } from "./package-manager.js";

// ══════════════════════════════════════════════════════════════════════════════
// Standalone Function Exports
// ══════════════════════════════════════════════════════════════════════════════

/**
 * The lockfile each supported package manager writes.
 */
export const LOCKFILE_NAMES: Record<SupportedPm, string> = {
	pnpm: "pnpm-lock.yaml",
	bun: "bun.lock",
	npm: "package-lock.json",
};

/**
 * Capture current lockfile state for the detected package manager.
 *
 * Returns `null` when the package manager's lockfile does not exist — a repo
 * that has never installed still runs, it just has nothing to diff against.
 */
export const captureLockfileState = (
	pm: SupportedPm,
	workspaceRoot: string,
): Effect.Effect<LockfileModel | null, LockfileError> =>
	Effect.gen(function* () {
		const lockfilePath = join(workspaceRoot, LOCKFILE_NAMES[pm]);

		const content = yield* Effect.try({
			try: () => (existsSync(lockfilePath) ? readFileSync(lockfilePath, "utf8") : null),
			catch: (e) => new LockfileError({ operation: "read", reason: String(e) }),
		});

		if (content === null) {
			yield* Effect.logDebug(`No lockfile found at ${lockfilePath}`);
			return null;
		}

		// A parse failure (malformed content, or content the upstream parser's
		// strict raw schema does not recognize) degrades to a warning and `null`,
		// same as the old `readWantedLockfile(root, { ignoreIncompatible: true })`
		// baseline — change detection still has `git status --porcelain` to fall
		// back on, so a lockfile the parser cannot handle must not abort the run.
		// This is deliberately narrower than the "read" failure above: a read/IO
		// error (e.g. EACCES, a directory where the lockfile should be) signals a
		// real environment problem unrelated to lockfile content and must still
		// fail the effect rather than being silently swallowed.
		return yield* LockfileModel.parse(content, { format: pm }).pipe(
			Effect.catch((e) =>
				Effect.logWarning(
					`Failed to parse ${lockfilePath}: ${e.message}. Lockfile-derived change detection is being skipped for this run (git status still drives change detection).`,
				).pipe(Effect.as(null)),
			),
		);
	});

/**
 * Compare two lockfile states to detect dependency changes.
 */
export const compareLockfiles = (
	before: LockfileModel | null,
	after: LockfileModel | null,
	workspaceRoot: string,
): Effect.Effect<ReadonlyArray<LockfileChange>, LockfileError, WorkspaceDiscovery> =>
	Effect.gen(function* () {
		if (!before || !after) {
			yield* Effect.logWarning("Cannot compare lockfiles: one or both are null");
			return [];
		}

		yield* Effect.logDebug(
			`Comparing ${after.format} lockfiles: ${before.importers.length} -> ${after.importers.length} importer(s)`,
		);

		// Needed by both the catalog and the importer comparison.
		const importerToPackage = yield* buildImporterToPackageMap(workspaceRoot);
		yield* Effect.logDebug(`Importer to package map: ${JSON.stringify(Object.fromEntries(importerToPackage))}`);

		// The kit owns the diff, including where each format records a resolved
		// version (pnpm on the entry, bun and npm on package entries) and which
		// importers consume a catalog entry. What stays here is which of its
		// records this action reports, and how.
		const diff = LockfileDiff.compare(before, after);
		yield* Effect.logDebug(
			`Lockfile diff: ${diff.catalogs.length} catalog change(s), ${diff.importers.length} importer change(s)`,
		);

		// Catalogs are shared version definitions (catalog:silk, etc). They are NOT
		// the same as pnpm's configDependencies.
		const changes: LockfileChange[] = [
			...catalogChanges(diff.catalogs, importerToPackage),
			...importerChanges(diff.importers, before, after, importerToPackage),
		];

		yield* Effect.logInfo(`Detected ${changes.length} dependency change(s)`);

		return changes;
	});

/**
 * Group lockfile changes by affected package.
 */
export const groupChangesByPackage = (changes: ReadonlyArray<LockfileChange>): Map<string, LockfileChange[]> => {
	const grouped = new Map<string, LockfileChange[]>();

	for (const change of changes) {
		if (change.type === "config") {
			// Config changes go under a special "root" key
			const existing = grouped.get("(root)") ?? [];
			existing.push(change);
			grouped.set("(root)", existing);
		} else {
			for (const pkg of change.affectedPackages) {
				const existing = grouped.get(pkg) ?? [];
				existing.push(change);
				grouped.set(pkg, existing);
			}
		}
	}

	return grouped;
};

// ══════════════════════════════════════════════════════════════════════════════
// Implementation Functions
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Map a lockfile dep section onto the LockfileChange type discriminator.
 */
const DEP_TYPE: Record<ImporterDependency["depType"], LockfileChange["type"]> = {
	dependencies: "dependency",
	devDependencies: "devDependency",
	optionalDependencies: "optionalDependency",
	peerDependencies: "peerDependency",
};

/**
 * Build a map from importer path (relative to workspace root, "." for root)
 * to package name, via WorkspaceDiscovery.
 *
 * Importer "." resolves to the root's actual name rather than falling
 * through to the bare importer id.
 */
const buildImporterToPackageMap = (
	_workspaceRoot: string,
): Effect.Effect<Map<string, string>, LockfileError, WorkspaceDiscovery> =>
	Effect.gen(function* () {
		const discovery = yield* WorkspaceDiscovery;
		const importerMap = yield* discovery.importerMap().pipe(
			Effect.catch((e) =>
				Effect.gen(function* () {
					yield* Effect.logWarning(`Failed to read workspace importer map: ${String(e)}`);
					return new Map();
				}),
			),
		);

		const out = new Map<string, string>();
		for (const [relativePath, pkg] of importerMap) {
			out.set(relativePath, pkg.name);
		}
		return out;
	});

/**
 * Report catalog changes: one LockfileChange per (change, consuming importer,
 * dep section), each carrying that consumer's dep-section type, so downstream
 * consumers can use type alone as the trigger signal. Catalog refs in
 * devDependencies come out as "devDependency"; changesets gating treats those
 * as informational only.
 *
 * - A specifier move is reported as the specifier move; otherwise the change is
 *   the resolved version moving under an unchanged specifier.
 * - The kit reads a removed entry's consumers from the BEFORE lockfile (nobody
 *   references it afterwards), so a removal is attributed exactly like a bump.
 *   Only a removed entry with no consumer at all gets the single unassigned
 *   record.
 * - An added or changed entry that no importer consumes produces no record:
 *   nothing in the workspace moved because of it.
 */
const catalogChanges = (
	changes: ReadonlyArray<CatalogChange>,
	importerToPackage: Map<string, string>,
): ReadonlyArray<LockfileChange> =>
	changes.flatMap((change): ReadonlyArray<LockfileChange> => {
		const specifierMoved = change.specifier.before !== change.specifier.after;
		const from =
			change.kind === "added"
				? null
				: specifierMoved
					? (change.specifier.before ?? null)
					: (change.version.before ?? null);
		const to =
			change.kind === "removed"
				? "(removed)"
				: specifierMoved
					? (change.specifier.after ?? "(removed)")
					: (change.version.after ?? "(removed)");

		if (change.kind === "removed" && change.consumers.length === 0) {
			return [{ type: "dependency", dependency: change.name, from, to, affectedPackages: [] }];
		}

		return change.consumers.map((consumer) => ({
			type: DEP_TYPE[consumer.depType],
			dependency: change.name,
			from,
			to,
			affectedPackages: [importerToPackage.get(consumer.importer) ?? consumer.importer],
		}));
	});

/**
 * Report importer dependency changes this action owns.
 *
 * Narrower than the kit's diff, on purpose:
 * - **Specifiers only.** The action regenerates the lockfile from a clean
 *   slate, so resolved versions drift under unchanged ranges on every run; a
 *   version-only move is not a change this action made.
 * - **Catalog references are reported by {@link catalogChanges}.** A dependency
 *   whose after specifier is `catalog:` is skipped here; one removed outright is
 *   still reported, since no catalog record speaks for it.
 * - **Importers on both sides only.** An importer that appears or disappears
 *   whole is a workspace change, not a dependency change.
 */
const importerChanges = (
	changes: ReadonlyArray<ImporterChange>,
	before: LockfileModel,
	after: LockfileModel,
	importerToPackage: Map<string, string>,
): ReadonlyArray<LockfileChange> => {
	const beforePaths = new Set(before.importers.map((importer) => importer.path));
	const afterPaths = new Set(after.importers.map((importer) => importer.path));

	return changes.flatMap((change): ReadonlyArray<LockfileChange> => {
		if (!beforePaths.has(change.importer) || !afterPaths.has(change.importer)) return [];

		const fromSpecifier = change.specifier.before?.raw ?? null;
		const toSpecifier = change.specifier.after?.raw;
		if (toSpecifier?.startsWith("catalog:")) return [];
		if (toSpecifier !== undefined && fromSpecifier === toSpecifier) return [];

		return [
			{
				type: DEP_TYPE[change.depType],
				dependency: change.name,
				from: fromSpecifier,
				to: toSpecifier ?? "(removed)",
				affectedPackages: [importerToPackage.get(change.importer) ?? change.importer],
			},
		];
	});
};
