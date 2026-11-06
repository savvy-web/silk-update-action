/**
 * Pure dependency parsing helpers.
 *
 * Extracted from `src/lib/pnpm/regular.ts`. Config-dependency specs are parsed
 * by `@effected/workspaces`' `ConfigDependencySpec`, not here.
 * These functions have NO Effect service dependencies.
 *
 * @module utils/deps
 */

import { VersionSpecifier } from "@effected/semver";
import { Glob, Result } from "effect";

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
 * Returns null for anything that is not one operator and one complete version:
 * `catalog:` and `workspace:` specifiers, dist-tags, partial versions, and
 * compound ranges. Callers rewrite the specifier as `${prefix}${resolved}`, so a
 * compound range (">=1.2.3 <2.0.0", "1.2.3 || 2.0.0", "1.2.3 - 2.0.0") that parsed
 * here would be collapsed to a single bound; null leaves it exactly as written.
 *
 * An explicit `=` pin is also null: the kit accepts it, but this action has
 * never rewritten one.
 */
export const parseSpecifier = (specifier: string): { prefix: string; version: string } | null => {
	const parsed = VersionSpecifier.parseResult(specifier);
	if (Result.isFailure(parsed) || parsed.success.operator === "=") return null;

	return {
		prefix: parsed.success.operator,
		version: parsed.success.version.toString(),
	};
};
