/**
 * PackageManagerUpgrade service for package-manager self-upgrade operations.
 *
 * Generalizes the pnpm-only `PnpmUpgrade` service to any package manager this
 * action supports (`SupportedPm`: pnpm, bun, npm). All three are published on
 * npm, so the same registry lookup and range logic apply unchanged; the only
 * behavioral difference is the write format.
 *
 * Reads the package-manager version from the `packageManager` and
 * `devEngines.packageManager` fields (favoring devEngines) and upgrades it
 * according to the `upgrade-package-manager` mode: "false" (skip), "true"/"auto" (latest
 * within the current major), or a semver range (may cross majors, and adds a
 * `packageManager` field when none exists). A `packageManager` or
 * `devEngines.packageManager` entry that names a *different* package manager
 * than the one being upgraded is not a reference for this run and is ignored.
 *
 * **Every manager is written bare, in the format pnpm itself writes**
 * (savvy-web/silk-update-action#494): `packageManager` becomes
 * `<pm>@<version>`, and `devEngines.packageManager.version` becomes the bare
 * version with any range operator the repo wrote kept (`^12.6.0` →
 * `^12.7.0`, as `pnpm self-update` does). No `+<integrity>` suffix is ever
 * written. pnpm does not verify a `devEngines` hash and drops both suffixes on
 * its own next write; corepack, the one tool that verified the `packageManager`
 * hash, is no longer on the runners; and pnpm's canonical checksum store is the
 * lockfile (`packageManagerDependencies`), which the install step refreshes.
 * An existing suffix is stripped whenever this service touches a field —
 * including on the `already-current` path, where nothing else is written — so
 * repos converge on one format instead of churning against a local
 * `pnpm self-update`. That strip is reported as `normalized` on the skipped
 * outcome, never as an upgrade.
 *
 * **The registry integrity is still fetched, for activation only.** Writing the
 * fields does NOT activate the new version: the runtime action put a
 * version-pinned shim directory on `PATH`, so `pnpm` keeps answering as the OLD
 * version until `steps/activate-package-manager` provisions the resolved `pin`
 * and the install runs with its bin directory ahead on `PATH`. For pnpm and
 * npm, whose installer verifies the npm registry tarball, the registry's
 * `dist.integrity` is converted to the corepack form and carried on the applied
 * outcome as `integrity` — in memory, never on disk — so that download is
 * still verified. Relying on pnpm's own `manage-package-manager-versions`
 * self-switch is not enough — in a workspace whose `devEngines.packageManager`
 * carries `onFail: ignore`, a pnpm 11 `install` ran and wrote the lockfile as 11
 * after the pin said 12 (savvy-web/pnpm-module-template#196). bun's installer
 * verifies a per-platform zip from GitHub releases, not the npm tarball, so the
 * registry integrity would describe the wrong artifact: for bun it is never
 * fetched.
 *
 * `upgrade()` always resolves to an outcome (never `null`) so a caller can
 * report *why* nothing happened — "disabled", "no reference", "nothing
 * satisfies the range" and "already current" are distinct outcomes, not one
 * silent no-op. This matters because `upgrade-package-manager` is a range
 * typed for one package manager (frequently copy-pasted from another repo)
 * while the workspace has been detected as a different one: a pnpm range in
 * a bun repo resolves against bun's release list and, correctly, satisfies
 * nothing — that must read as "no bun release satisfies the range", not
 * "bun is already up-to-date".
 *
 * @module services/package-manager-upgrade
 */

import { readFileSync } from "node:fs";
import type { IntegrityHashBrand, NpmRegistryShape } from "@effected/npm";
import { CorepackIntegrityHash, NpmRegistry, PackageManagerPin } from "@effected/npm";
import type { PackageJsonFileShape } from "@effected/package-json";
import { DevEngine, PackageJsonFile, PackageManagerRange } from "@effected/package-json";
import { Context, Effect, Layer, Option, Result } from "effect";

import { FileSystemError } from "../errors/errors.js";
import { resolveLatestSatisfying } from "../utils/semver.js";
import type { SupportedPm } from "./package-manager.js";

// ══════════════════════════════════════════════════════════════════════════════
// Constants
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Managers whose installer verifies the npm registry tarball, so the registry's
 * `dist.integrity` is the right digest to hand activation. bun's installer
 * verifies a platform zip from GitHub releases instead; the npm `bun` package's
 * integrity would describe a different artifact.
 */
const REGISTRY_TARBALL_VERIFIED: ReadonlySet<SupportedPm> = new Set(["pnpm", "npm"]);

/** A manifest field this service reads and writes. */
export type PackageManagerField = "packageManager" | "devEngines";

// ══════════════════════════════════════════════════════════════════════════════
// Types
// ══════════════════════════════════════════════════════════════════════════════

/** Where the reference version (if any) was read from. */
export type PackageManagerReferenceSource = "devEngines" | "packageManager" | null;

/**
 * Why an upgrade produced no write.
 *
 * The discriminant a caller dispatches on to decide how loudly to report the
 * skip. `reason` is prose for humans; `kind` is the machine-readable fact.
 *
 * - `disabled` — `upgrade-package-manager: false`. Benign.
 * - `no-reference` — auto mode with no `packageManager` /
 *   `devEngines.packageManager` entry for this package manager to anchor on.
 * - `unsatisfiable` — the range resolves to nothing in this package manager's
 *   release list. Almost always a range typed for a *different* package
 *   manager (a pnpm `^11.0.0` in a bun repo). NOT benign: the caller warns.
 * - `already-current` — the reference is already the newest version the range
 *   admits. Benign.
 * - `error` — the read/write failed. Reserved for callers that fold a caught
 *   failure into an outcome rather than propagating it.
 */
export type PackageManagerSkipKind = "disabled" | "no-reference" | "unsatisfiable" | "already-current" | "error";

/** The upgrade was applied: the resolved version differs from the reference and was written. */
export interface PackageManagerUpgradeApplied {
	readonly applied: true;
	readonly pm: SupportedPm;
	readonly reference: string | null;
	readonly referenceSource: PackageManagerReferenceSource;
	readonly targetRange: string;
	readonly from: string | null;
	readonly to: string;
	/**
	 * The bare spec `<pm>@<version>` — what `packageManager` now carries (when it
	 * was written) and what `steps/activate-package-manager` hands the installer.
	 */
	readonly pin: string;
	/**
	 * The resolved version's registry integrity in corepack form
	 * (`sha512.<hex>`), for activation to verify the download against. Held in
	 * memory only — it is never written to the manifest. `null` for bun (whose
	 * installer verifies a different artifact) and whenever the registry
	 * integrity is absent, unreadable or not convertible; activation then
	 * installs unverified and the installer warns.
	 */
	readonly integrity: IntegrityHashBrand | null;
	readonly packageManagerUpdated: boolean;
	readonly devEnginesUpdated: boolean;
	readonly added: boolean;
}

/** The upgrade did not run, or ran and had nothing to write — `kind`/`reason` say why. */
export interface PackageManagerUpgradeSkipped {
	readonly applied: false;
	readonly pm: SupportedPm;
	readonly reference: string | null;
	readonly referenceSource: PackageManagerReferenceSource;
	readonly targetRange: string | null;
	/** Machine-readable cause. Callers dispatch on this, never on `reason`. */
	readonly kind: PackageManagerSkipKind;
	readonly reason: string;
	/**
	 * The fields whose inline `+<integrity>` suffix was stripped even though no
	 * version moved — a format normalization, not an upgrade. Only the
	 * `already-current` path writes one; every other skip reports `[]`.
	 */
	readonly normalized: ReadonlyArray<PackageManagerField>;
}

export type PackageManagerUpgradeOutcome = PackageManagerUpgradeApplied | PackageManagerUpgradeSkipped;

// ══════════════════════════════════════════════════════════════════════════════
// Service Interface
// ══════════════════════════════════════════════════════════════════════════════

export class PackageManagerUpgrade extends Context.Service<
	PackageManagerUpgrade,
	{
		readonly upgrade: (
			mode: string,
			pm: SupportedPm,
			workspaceRoot: string,
		) => Effect.Effect<PackageManagerUpgradeOutcome, FileSystemError>;
	}
>()("PackageManagerUpgrade") {
	/**
	 * Live layer.
	 *
	 * Declared IN the class body, which is load-bearing rather than stylistic: a
	 * member attached by post-class assignment is tree-shaken out of the bundled
	 * `dist`, and that fails only in production because vitest runs the source.
	 */
	static readonly layer = Layer.effect(
		this,
		Effect.gen(function* () {
			const registry = yield* NpmRegistry;
			// Resolved in the layer so `upgrade`'s requirement channel stays `never`.
			const packageJsonFile = yield* PackageJsonFile;
			return {
				upgrade: (mode, pm, workspaceRoot) =>
					upgradePackageManagerImpl(registry, mode, pm, workspaceRoot, packageJsonFile),
			};
		}),
	);
}

// ══════════════════════════════════════════════════════════════════════════════
// Internal Helpers
// ══════════════════════════════════════════════════════════════════════════════

const fsReadError = (path: string, e: unknown) => new FileSystemError({ operation: "read", path, reason: String(e) });

const fsWriteError = (path: string, e: unknown) => new FileSystemError({ operation: "write", path, reason: String(e) });

const skip = (
	pm: SupportedPm,
	reference: string | null,
	referenceSource: PackageManagerReferenceSource,
	targetRange: string | null,
	kind: PackageManagerSkipKind,
	reason: string,
	normalized: ReadonlyArray<PackageManagerField> = [],
): PackageManagerUpgradeSkipped => ({
	applied: false,
	pm,
	reference,
	referenceSource,
	targetRange,
	kind,
	reason,
	normalized,
});

/** A `packageManager` field read for `pm`: its version and whether it carries a suffix. */
interface PackageManagerFieldRead {
	readonly version: string;
	readonly hasIntegrity: boolean;
}

/** A `devEngines.packageManager` entry read for `pm`: its leading operator, version and suffix. */
interface DevEnginesFieldRead extends PackageManagerFieldRead {
	/** The leading range operator the repo wrote (`^`, `~`), or `""` for an exact version. */
	readonly operator: string;
}

/**
 * Read `packageManager` as `@effected/npm`'s `PackageManagerPin`, or `null` when
 * absent, not an exact pin, or naming a *different* manager than `pm` — all of
 * which mean the same thing here: no reference for this run.
 *
 * The strict pin grammar, not the range-tolerant one: this field is written
 * exact, and a range here has never been a reference. The predecessor of the
 * pin grammar was a prefix regex that made `pnpm@11.12.0garbage` a reference;
 * the grammar rejects it.
 */
const readPackageManagerField = (raw: string, pm: SupportedPm): PackageManagerFieldRead | null => {
	const parsed = PackageManagerPin.parseResult(raw.trim());
	if (Result.isFailure(parsed)) return null;
	// The pin grammar admits all four kit-supported names, so the check is here
	// rather than implied by parsing.
	if (parsed.success.name !== pm) return null;
	return { version: parsed.success.version.toString(), hasIntegrity: parsed.success.integrity !== undefined };
};

/**
 * Read `devEngines.packageManager` through `@effected/package-json`'s
 * `PackageManagerRange.fromDevEngineResult`, which owns the
 * `<range>[+<integrity>]` grammar and hands back `range` — the value with its
 * operator kept and any integrity dropped.
 *
 * The one thing the kit model does not answer is "which single version does
 * this range anchor on, under which operator" — it carries the range
 * verbatim. So the reference is taken only from a range that is a lone `^` or
 * `~` over an exact version (or an exact version alone): that version anchors
 * the synthesized `^<reference>` target, and the operator is re-emitted over
 * the resolved version on write, as `pnpm self-update` does. Any other range
 * (`>=11 <12`) names no single version, is not a reference, and is left alone.
 */
const readDevEnginesField = (
	entry: { readonly name?: unknown; readonly version?: unknown; readonly onFail?: unknown },
	pm: SupportedPm,
): DevEnginesFieldRead | null => {
	if (entry.name !== pm || typeof entry.version !== "string") return null;
	const parsed = PackageManagerRange.fromDevEngineResult(new DevEngine({ name: pm, version: entry.version.trim() }));
	if (Result.isFailure(parsed)) return null;

	const range = parsed.success.range;
	const operator = range.startsWith("^") || range.startsWith("~") ? range[0] : "";
	const version = PackageManagerPin.parseResult(`${pm}@${range.slice(operator.length)}`);
	if (Result.isFailure(version)) return null;

	return { version: version.success.version.toString(), hasIntegrity: parsed.success.hasIntegrity, operator };
};

/**
 * The registry integrity for `pm@version` in corepack form, or `null` when there
 * is none to carry — bun (a different artifact), a failed or empty registry
 * read, or an SRI string `CorepackIntegrityHash.fromSri` refuses (wrong length,
 * weaker than sha512). `fromSri` is stricter than the converter this module
 * once hand-rolled, which minted a well-formed-looking digest from a
 * wrong-length one; handing that to the installer would fail verification
 * against the real tarball.
 */
const activationIntegrity = (
	registry: NpmRegistryShape,
	pm: SupportedPm,
	version: string,
): Effect.Effect<IntegrityHashBrand | null> =>
	Effect.gen(function* () {
		if (!REGISTRY_TARBALL_VERIFIED.has(pm)) return null;
		const sri = yield* registry.version(pm, version).pipe(
			Effect.map((info) => (Option.isSome(info) ? (info.value.integrity ?? "") : "")),
			Effect.catch(() => Effect.succeed("")),
		);
		const hash = yield* CorepackIntegrityHash.fromSri(sri).pipe(Effect.catch(() => Effect.succeed(null)));
		if (hash === null) {
			yield* Effect.logWarning(
				`Could not derive an integrity for ${pm}@${version}; activation will install it without verification`,
			);
		}
		return hash;
	});

// ══════════════════════════════════════════════════════════════════════════════
// Implementation
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Core upgrade implementation that accepts a runner directly.
 *
 * `mode` is the parsed `upgrade-package-manager` value: "false" (skip), "true"/"auto"
 * (latest within the current major, favoring the devEngines version), or a
 * semver range string (may cross majors; adds a packageManager field when no
 * field for `pm` exists).
 *
 * The resolved version is written bare into `packageManager` and
 * `devEngines.packageManager.version` (operator kept on the latter). Nothing
 * here activates it — `steps/activate-package-manager` does, from the outcome's
 * `pin` and `integrity`.
 */
const upgradePackageManagerImpl = (
	registry: NpmRegistryShape,
	mode: string,
	pm: SupportedPm,
	workspaceRoot: string,
	packageJsonFile: PackageJsonFileShape,
): Effect.Effect<PackageManagerUpgradeOutcome, FileSystemError> =>
	Effect.gen(function* () {
		if (mode === "false") {
			return skip(
				pm,
				null,
				null,
				null,
				"disabled",
				"package manager upgrade disabled (upgrade-package-manager: false)",
			);
		}

		const packageJsonPath = `${workspaceRoot}/package.json`;

		const packageJsonRaw = yield* Effect.try({
			try: () => readFileSync(packageJsonPath, "utf-8"),
			catch: (e) => fsReadError(packageJsonPath, e),
		});
		const packageJson = yield* Effect.try({
			try: () => JSON.parse(packageJsonRaw) as Record<string, unknown>,
			catch: (e) => fsReadError(packageJsonPath, `Invalid JSON: ${e}`),
		});

		// Detect package-manager version fields, ignoring any that name a
		// different package manager than `pm`.
		const pmField =
			typeof packageJson.packageManager === "string" ? readPackageManagerField(packageJson.packageManager, pm) : null;
		const pmVersion = pmField?.version ?? null;

		const devEnginesPm = (packageJson.devEngines as { packageManager?: unknown } | undefined)?.packageManager;
		const deField =
			devEnginesPm !== null && typeof devEnginesPm === "object" && !Array.isArray(devEnginesPm)
				? readDevEnginesField(devEnginesPm as { name?: unknown; version?: unknown }, pm)
				: null;
		const deVersion = deField?.version ?? null;

		// Surgical field edits applied through `PackageJsonFile.modify`, which
		// rewrites only the edited spans and leaves key order, indentation and
		// line endings exactly as the consumer had them. This manifest is committed
		// to someone else's repository, so a whole-file re-serialize would make the
		// diff unreviewable.
		const writeFields = (edits: ReadonlyArray<{ readonly path: ReadonlyArray<string>; readonly value: string }>) =>
			packageJsonFile
				.modify(
					packageJsonPath,
					edits.map((e) => ({ path: [...e.path], value: e.value })),
				)
				.pipe(Effect.mapError((e) => fsWriteError(packageJsonPath, e)));

		// Reference version favors devEngines, then packageManager.
		const reference = deVersion ?? pmVersion ?? null;
		const referenceSource: PackageManagerReferenceSource = deVersion
			? "devEngines"
			: pmVersion
				? "packageManager"
				: null;
		const isAuto = mode === "true" || mode === "auto";

		let targetRange: string;
		if (isAuto) {
			if (reference === null) {
				const reason = `no ${pm} reference found (packageManager or devEngines.packageManager)`;
				yield* Effect.logWarning(`upgrade-package-manager: true/auto requested but ${reason}, skipping`);
				return skip(pm, null, null, null, "no-reference", reason);
			}
			targetRange = `^${reference}`;
		} else {
			targetRange = mode;
		}

		// Query available versions via NpmRegistry, which redirects npm's cache to
		// a runner-writable directory — a raw `npm view` here hits the partially
		// root-owned ~/.npm on GitHub's macOS runners and dies EACCES.
		const allVersions = yield* registry
			.versions(pm)
			.pipe(Effect.mapError((e) => fsReadError("npm registry", `Failed to query ${pm} versions: ${e.message}`)));

		const resolved = yield* resolveLatestSatisfying(allVersions, targetRange);
		if (!resolved) {
			// `unsatisfiable` is the acceptance signal, not a benign no-op: the
			// overwhelmingly common cause is an upgrade-package-manager range typed
			// for a *different* package manager than the workspace actually uses
			// (e.g. a pnpm "^11.0.0" range in a bun repo, copy-pasted from another
			// repo's workflow). Nothing satisfies it. Reporting is the caller's job
			// — `program.ts` promotes this kind to a warning so it cannot read like
			// "disabled" or "already up-to-date" — so no log is emitted here.
			return skip(
				pm,
				reference,
				referenceSource,
				targetRange,
				"unsatisfiable",
				`no ${pm} release satisfies "${targetRange}"`,
			);
		}
		if (reference !== null && resolved === reference) {
			const reason = `${pm} ${reference} already satisfies "${targetRange}"`;
			yield* Effect.logInfo(`${pm} ${reference} is already the latest for "${targetRange}"`);

			// Normalize without upgrading: strip an inline integrity from each field
			// against that field's OWN version — a lagging `packageManager` is not
			// moved here, only reformatted. No suffix anywhere means no write at all.
			const normalized: PackageManagerField[] = [];
			const edits: Array<{ readonly path: ReadonlyArray<string>; readonly value: string }> = [];
			if (pmField?.hasIntegrity) {
				normalized.push("packageManager");
				edits.push({ path: ["packageManager"], value: `${pm}@${pmField.version}` });
			}
			if (deField?.hasIntegrity) {
				normalized.push("devEngines");
				edits.push({
					path: ["devEngines", "packageManager", "version"],
					value: `${deField.operator}${deField.version}`,
				});
			}
			if (edits.length > 0) yield* writeFields(edits);

			return skip(pm, reference, referenceSource, targetRange, "already-current", reason, normalized);
		}

		// Fetched for activation only; never written.
		const integrity = yield* activationIntegrity(registry, pm, resolved);
		const packageManagerSpec = `${pm}@${resolved}`;

		// Write packageManager when one exists for `pm`, or (range mode only —
		// auto returns early on a null reference) when NO field for `pm` exists at
		// all, creating it.
		const hasPackageManager = pmVersion !== null;
		const hasDevEngines = deField !== null;
		const shouldWritePackageManager = hasPackageManager || (!hasPackageManager && !hasDevEngines);

		const edits: Array<{ readonly path: ReadonlyArray<string>; readonly value: string }> = [];

		let packageManagerUpdated = false;
		let added = false;
		if (shouldWritePackageManager) {
			edits.push({ path: ["packageManager"], value: packageManagerSpec });
			packageManagerUpdated = true;
			added = !hasPackageManager;
		}

		let devEnginesUpdated = false;
		if (deField !== null) {
			edits.push({ path: ["devEngines", "packageManager", "version"], value: `${deField.operator}${resolved}` });
			devEnginesUpdated = true;
		}

		yield* writeFields(edits);

		yield* Effect.logInfo(`Updated ${pm}: ${reference ?? "added"} -> ${resolved}`);
		return {
			applied: true,
			pm,
			reference,
			referenceSource,
			targetRange,
			from: reference,
			to: resolved,
			pin: packageManagerSpec,
			integrity,
			packageManagerUpdated,
			devEnginesUpdated,
			added,
		};
	});
