/**
 * Pure helpers for reading and rewriting devEngines.runtime entries.
 *
 * No Effect service dependencies — mirrors src/utils/pnpm.ts.
 *
 * The `upgrade-runtime-*` inputs only ever *upgrade* a runtime the manifest
 * already declares — they never introduce one — so there is no "upsert": an
 * entry is located with {@link findRuntimeEntry} and its `version` is assigned
 * in place, preserving the surrounding object/array shape and every other key.
 * Resolved versions are written bare (exact, no range operator), so no operator
 * parsing or re-decoration is needed either.
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

const toEntryList = (runtimeField: unknown): RuntimeEntry[] => {
	if (runtimeField === undefined || runtimeField === null) return [];
	return Array.isArray(runtimeField) ? (runtimeField as RuntimeEntry[]) : [runtimeField as RuntimeEntry];
};

/**
 * Find the devEngines.runtime entry for `runtime`, or null. Accepts object or
 * array shape. The entry returned is the live object inside `devEngines`, so
 * assigning to its `version` rewrites the manifest in place.
 */
export const findRuntimeEntry = (devEngines: unknown, runtime: RuntimeName): RuntimeEntry | null => {
	const runtimeField = (devEngines as { runtime?: unknown } | undefined)?.runtime;
	for (const entry of toEntryList(runtimeField)) {
		if (entry && typeof entry === "object" && entry.name === runtime) return entry;
	}
	return null;
};
