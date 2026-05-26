/**
 * Pure helpers for reading and rewriting devEngines.runtime entries.
 *
 * No Effect service dependencies — mirrors src/utils/pnpm.ts.
 *
 * @module utils/runtime
 */

/** A JavaScript runtime managed by this action. */
export type RuntimeName = "node" | "deno" | "bun";

/** A single devEngines.runtime entry (extra keys preserved on write). */
export interface RuntimeEntry {
	name?: string;
	version?: string;
	onFail?: string;
	[key: string]: unknown;
}

const RANGE_OPERATOR_RE = /^(>=|<=|\^|~|>|<|=)/;

/**
 * Extract the leading range operator/prefix from a version string.
 * Returns `""` for a bare version with no operator.
 */
export const parseRuntimeOperator = (raw: string): string => {
	const match = raw.trim().match(RANGE_OPERATOR_RE);
	return match ? match[1] : "";
};

/**
 * True when `raw` is a static exact version (bare `X.Y.Z`, optionally with
 * prerelease/build) — i.e. it carries no range operator, wildcard, OR-set, or
 * partial form. Used to make `auto` a no-op on pinned versions.
 */
export const isStaticVersion = (raw: string): boolean => {
	const value = raw.trim();
	if (RANGE_OPERATOR_RE.test(value)) return false;
	if (/[x*]/i.test(value)) return false;
	if (/\s|\|\|/.test(value)) return false;
	return /^\d+\.\d+\.\d+(?:[-+].*)?$/.test(value);
};

/** Re-attach an operator to a resolved exact version (`"^" + "24.16.0"`). */
export const redecorateVersion = (resolved: string, operator: string): string => `${operator}${resolved}`;

const toEntryList = (runtimeField: unknown): RuntimeEntry[] => {
	if (runtimeField === undefined || runtimeField === null) return [];
	return Array.isArray(runtimeField) ? (runtimeField as RuntimeEntry[]) : [runtimeField as RuntimeEntry];
};

/** Find the devEngines.runtime entry for `runtime`, or null. Accepts object or array shape. */
export const findRuntimeEntry = (devEngines: unknown, runtime: RuntimeName): RuntimeEntry | null => {
	const runtimeField = (devEngines as { runtime?: unknown } | undefined)?.runtime;
	for (const entry of toEntryList(runtimeField)) {
		if (entry && typeof entry === "object" && entry.name === runtime) return entry;
	}
	return null;
};

/**
 * Set the version for `runtime` inside `pkgJson.devEngines.runtime`, mutating
 * `pkgJson` in place. Modifies an existing entry (shape preserved) or adds a
 * new one: a single object is promoted to an array when a sibling is added,
 * and an absent `runtime` field is created as an array. Added entries mirror a
 * sibling's `onFail` value, defaulting to `"ignore"`.
 *
 * @returns `{ added }` — whether a new entry was created vs an existing one modified.
 */
export const upsertRuntimeEntry = (
	pkgJson: Record<string, unknown>,
	runtime: RuntimeName,
	version: string,
): { added: boolean } => {
	if (pkgJson.devEngines === undefined) {
		pkgJson.devEngines = {};
	}
	const devEngines = pkgJson.devEngines as { runtime?: unknown };
	const runtimeField = devEngines.runtime;
	const list = toEntryList(runtimeField);

	const existing = list.find((entry) => entry && typeof entry === "object" && entry.name === runtime);
	if (existing) {
		existing.version = version;
		return { added: false };
	}

	const sibling = list.find((entry) => entry && typeof entry === "object" && typeof entry.onFail === "string");
	const newEntry: RuntimeEntry = { name: runtime, version, onFail: sibling?.onFail ?? "ignore" };

	if (runtimeField === undefined || runtimeField === null) {
		devEngines.runtime = [newEntry];
	} else if (Array.isArray(runtimeField)) {
		runtimeField.push(newEntry);
	} else {
		devEngines.runtime = [runtimeField as RuntimeEntry, newEntry];
	}
	return { added: true };
};
