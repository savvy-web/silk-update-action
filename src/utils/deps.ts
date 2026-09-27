/**
 * Pure dependency parsing helpers.
 *
 * Extracted from `src/lib/pnpm/regular.ts`. Config-dependency specs are parsed
 * by `@effected/workspaces`' `ConfigDependencySpec`, not here.
 * These functions have NO Effect service dependencies.
 *
 * @module utils/deps
 */

import { matchesGlob } from "node:path";

/**
 * Check if a dependency name matches a glob pattern.
 *
 * Uses Node's native `path.matchesGlob` for safe pattern matching
 * without regex metacharacter injection issues.
 *
 * - Exact match: `effect` matches `effect`
 * - Scoped wildcard: `@savvy-web/*` matches `@savvy-web/changesets`
 * - Bare wildcard: `*` matches anything
 */
export const matchesPattern = (depName: string, pattern: string): boolean => {
	return matchesGlob(depName, pattern);
};

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

	return {
		prefix: match[1] ?? "",
		version: match[2],
	};
};
