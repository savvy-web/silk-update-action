/**
 * Pure dependency parsing helpers.
 *
 * Extracted from `src/lib/pnpm/regular.ts`. Config-dependency specs are parsed
 * by `@effected/workspaces`' `ConfigDependencySpec`, not here.
 * These functions have NO Effect service dependencies.
 *
 * @module utils/deps
 */

import { SemVer } from "@effected/semver";
import { Glob } from "effect";

/**
 * Check if a dependency name matches a glob pattern.
 *
 * Uses core's `Glob`, which compiles the pattern rather than building a regex
 * from it (no metacharacter injection) and matches the same way on every
 * platform, where `node:path`'s `matchesGlob` follows win32 rules on Windows.
 *
 * - Exact match: `effect` matches `effect`
 * - Scoped wildcard: `@savvy-web/*` matches `@savvy-web/changesets`
 * - Bare wildcard: `*` matches every unscoped name; a scoped name has a `/`
 *   that `*` does not cross, so it needs `@scope/*` or `**`
 */
export const matchesPattern = (depName: string, pattern: string): boolean => Glob.match(Glob.make(pattern), depName);

/**
 * Parse a version specifier into prefix and version.
 *
 * Returns null for catalog: and workspace: specifiers (should be skipped).
 */
export const parseSpecifier = (specifier: string): { prefix: string; version: string } | null => {
	if (specifier.startsWith("catalog:")) return null;
	if (specifier.startsWith("workspace:")) return null;

	// Match optional prefix (>=, <=, >, <, ^, ~) followed by a semver-like version
	const match = specifier.match(/^(>=|<=|>|<|\^|~)?(\d+\.\d+\.\d+.*)$/);
	if (!match) return null;
	// The tail must be ONE version. Callers rewrite the specifier as
	// `${prefix}${resolved}`, so a compound range (">=1.2.3 <2.0.0",
	// "1.2.3 || 2.0.0", "1.2.3 - 2.0.0") that parsed here would be collapsed to a
	// single bound. Returning null leaves it exactly as written.
	if (!SemVer.isValid(match[2])) return null;

	return {
		prefix: match[1] ?? "",
		version: match[2],
	};
};
