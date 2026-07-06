/**
 * PnpmUpgrade service for pnpm self-upgrade operations.
 *
 * Reads the pnpm version from the `packageManager` and
 * `devEngines.packageManager` fields (favoring devEngines) and upgrades it
 * according to the `upgrade-package-manager` mode: "false" (skip), "true"/"auto" (latest
 * within the current major), or a semver range (may cross majors, and adds a
 * `packageManager` field when none exists). The resolved version is written
 * directly into both fields as a pinned `version+sha512.<hex>` string (derived
 * from the npm registry integrity) — no `corepack use` is invoked. The
 * subsequent `runInstall` (`pnpm install`) activates the new version via
 * corepack reading the updated fields. No range operator is written because a
 * hash-pinned value is inherently exact.
 *
 * @module services/pnpm-upgrade
 */

import { readFileSync, writeFileSync } from "node:fs";
import { NpmRegistry } from "@savvy-web/github-action-effects";
import { Context, Effect, Layer } from "effect";

import { FileSystemError } from "../errors/errors.js";
import { corepackHashFromIntegrity, detectIndent, parsePnpmVersion } from "../utils/pnpm.js";
import { resolveLatestSatisfying } from "../utils/semver.js";

type NpmRegistryShape = Context.Tag.Service<typeof NpmRegistry>;

// ══════════════════════════════════════════════════════════════════════════════
// Types
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Result of a pnpm upgrade operation.
 */
export interface PnpmUpgradeResult {
	readonly from: string | null;
	readonly to: string;
	readonly packageManagerUpdated: boolean;
	readonly devEnginesUpdated: boolean;
	readonly added: boolean;
}

// ══════════════════════════════════════════════════════════════════════════════
// Service Interface
// ══════════════════════════════════════════════════════════════════════════════

export class PnpmUpgrade extends Context.Tag("PnpmUpgrade")<
	PnpmUpgrade,
	{
		readonly upgrade: (
			mode: string,
			workspaceRoot?: string,
		) => Effect.Effect<PnpmUpgradeResult | null, FileSystemError>;
	}
>() {}

export const PnpmUpgradeLive = Layer.effect(
	PnpmUpgrade,
	Effect.gen(function* () {
		const registry = yield* NpmRegistry;
		return {
			upgrade: (mode, workspaceRoot = process.cwd()) => upgradePnpmImpl(registry, mode, workspaceRoot),
		};
	}),
);

// ══════════════════════════════════════════════════════════════════════════════
// Internal Helpers
// ══════════════════════════════════════════════════════════════════════════════

const fsReadError = (path: string, e: unknown) => new FileSystemError({ operation: "read", path, reason: String(e) });

const fsWriteError = (path: string, e: unknown) => new FileSystemError({ operation: "write", path, reason: String(e) });

// ══════════════════════════════════════════════════════════════════════════════
// Implementation
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Core upgrade implementation that accepts a runner directly.
 *
 * `mode` is the parsed `upgrade-package-manager` value: "false" (skip), "true"/"auto"
 * (latest within the current major, favoring the devEngines version), or a
 * semver range string (may cross majors; adds a packageManager field when no
 * pnpm field exists).
 *
 * The resolved version is written directly into `packageManager` and
 * `devEngines.packageManager.version` as a pinned `version+sha512.<hex>`
 * string. `corepack use` is NOT invoked — the subsequent `pnpm install`
 * activates the new version via corepack reading the updated fields.
 */
const upgradePnpmImpl = (
	registry: NpmRegistryShape,
	mode: string,
	workspaceRoot: string,
): Effect.Effect<PnpmUpgradeResult | null, FileSystemError> =>
	Effect.gen(function* () {
		if (mode === "false") return null;

		const packageJsonPath = `${workspaceRoot}/package.json`;

		const packageJsonRaw = yield* Effect.try({
			try: () => readFileSync(packageJsonPath, "utf-8"),
			catch: (e) => fsReadError(packageJsonPath, e),
		});
		const packageJson = yield* Effect.try({
			try: () => JSON.parse(packageJsonRaw) as Record<string, unknown>,
			catch: (e) => fsReadError(packageJsonPath, `Invalid JSON: ${e}`),
		});
		const indent = detectIndent(packageJsonRaw);

		// Detect pnpm version fields.
		const packageManagerRaw = typeof packageJson.packageManager === "string" ? packageJson.packageManager : null;
		const pmParsed = packageManagerRaw ? parsePnpmVersion(packageManagerRaw, true) : null;

		const devEngines = packageJson.devEngines as { packageManager?: { name?: string; version?: string } } | undefined;
		const devEnginesPm = devEngines?.packageManager;
		const devEnginesVersionRaw =
			devEnginesPm?.name === "pnpm" && typeof devEnginesPm.version === "string" ? devEnginesPm.version : null;
		const deParsed = devEnginesVersionRaw ? parsePnpmVersion(devEnginesVersionRaw) : null;

		// Reference version favors devEngines, then packageManager.
		const reference = deParsed?.version ?? pmParsed?.version ?? null;
		const isAuto = mode === "true" || mode === "auto";

		let targetRange: string;
		if (isAuto) {
			if (reference === null) {
				yield* Effect.logWarning(
					"upgrade-package-manager: true/auto requested but no pnpm version field found, skipping",
				);
				return null;
			}
			targetRange = `^${reference}`;
		} else {
			targetRange = mode;
		}

		// Query available pnpm versions via NpmRegistry, which redirects npm's
		// cache to a runner-writable directory — a raw `npm view` here hits the
		// partially root-owned ~/.npm on GitHub's macOS runners and dies EACCES.
		const allVersions = yield* registry
			.getVersions("pnpm")
			.pipe(Effect.mapError((e) => fsReadError("npm registry", `Failed to query pnpm versions: ${e.reason}`)));

		const resolved = yield* resolveLatestSatisfying(allVersions, targetRange);
		if (!resolved) {
			yield* Effect.logInfo(`No pnpm version found satisfying "${targetRange}"`);
			return null;
		}
		if (reference !== null && resolved === reference) {
			yield* Effect.logInfo(`pnpm ${reference} is already the latest for "${targetRange}"`);
			return null;
		}

		// Derive the corepack-canonical packageManager hash from the npm registry
		// integrity for the resolved version. corepack is NOT invoked — pnpm
		// install activates the new version via corepack reading these fields.
		const integrity = yield* registry.getPackageInfo("pnpm", resolved).pipe(
			Effect.map((info) => info.integrity ?? ""),
			Effect.catchAll(() => Effect.succeed("")),
		);
		const hash = corepackHashFromIntegrity(integrity);
		if (hash === null) {
			yield* Effect.logWarning(`Could not derive integrity hash for pnpm@${resolved}; writing version without hash`);
		}
		const pinnedSuffix = hash === null ? "" : `+${hash}`;
		const packageManagerSpec = `pnpm@${resolved}${pinnedSuffix}`;
		const devEnginesSpec = `${resolved}${pinnedSuffix}`;

		// Write fields directly. Write packageManager when one exists, or (range
		// mode only — auto returns early on a null reference) when NO pnpm field
		// exists at all, creating it.
		const hasPackageManager = pmParsed !== null;
		const hasDevEngines = deParsed !== null;
		const shouldWritePackageManager = hasPackageManager || (!hasPackageManager && !hasDevEngines);

		let packageManagerUpdated = false;
		let added = false;
		if (shouldWritePackageManager) {
			packageJson.packageManager = packageManagerSpec;
			packageManagerUpdated = true;
			added = !hasPackageManager;
		}

		let devEnginesUpdated = false;
		if (hasDevEngines) {
			(packageJson.devEngines as { packageManager: { version?: string } }).packageManager.version = devEnginesSpec;
			devEnginesUpdated = true;
		}

		yield* Effect.try({
			try: () => writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, indent)}\n`, "utf-8"),
			catch: (e) => fsWriteError(packageJsonPath, e),
		});

		yield* Effect.logInfo(`Updated pnpm: ${reference ?? "added"} -> ${resolved}`);
		return { from: reference, to: resolved, packageManagerUpdated, devEnginesUpdated, added };
	});
