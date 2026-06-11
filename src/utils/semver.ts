/**
 * Semver resolution utilities.
 *
 * Extracted from `src/lib/pnpm/upgrade.ts`. Uses `SemverResolver` from
 * `@savvy-web/github-action-effects` (a namespace of static functions,
 * not an Effect service).
 *
 * @module utils/semver
 */

import { SemverResolver } from "@savvy-web/github-action-effects";
import { Effect } from "effect";

/**
 * Resolve the latest stable version satisfying an arbitrary semver range.
 *
 * @param versions - Available versions to choose from
 * @param range - A semver range string (e.g. "^10.28.0", "^11", ">=11")
 * @returns The highest stable version satisfying the range, or null if none found
 */
export const resolveLatestSatisfying = (
	versions: ReadonlyArray<string>,
	range: string,
): Effect.Effect<string | null, never, never> =>
	Effect.gen(function* () {
		// Filter out pre-release versions
		const stableVersions: string[] = [];
		for (const v of versions) {
			const parsed = yield* SemverResolver.parse(v).pipe(Effect.option);
			if (parsed._tag === "Some" && !parsed.value.prerelease) {
				stableVersions.push(v);
			}
		}

		if (stableVersions.length === 0) return null;

		const result = yield* SemverResolver.latestInRange(stableVersions, range).pipe(
			Effect.catchAll(() => Effect.succeed(null as string | null)),
		);
		return result;
	});

/**
 * Resolve the latest version within a `^` range from available versions.
 *
 * @param versions - Available versions to choose from
 * @param current - The current version (used to construct `^current` range)
 * @returns The highest version satisfying `^current`, or null if none found
 */
export const resolveLatestInRange = (
	versions: ReadonlyArray<string>,
	current: string,
): Effect.Effect<string | null, never, never> => resolveLatestSatisfying(versions, `^${current}`);

/**
 * Derive the upgrade range for a config dependency from its current version.
 *
 * Config dependencies in `pnpm-workspace.yaml` are hash-pinned exact versions
 * with no declared range, so we synthesize a conservative one from the current
 * version's major:
 *
 * - `>= 1.0.0`: stay within the current major — `>=current <(major+1).0.0`.
 *   A `1.14.5` dep tracks the `1.x` line but never reaches `2.0.0`.
 * - `< 1.0.0`: a pre-stable dep may advance across `0.x` releases and adopt the
 *   first stable major (`1.x`), but never crosses two majors in one step —
 *   `>=current <2.0.0`. So `0.14.5` resolves to the latest `1.x` when one
 *   exists, otherwise the latest `0.x`.
 *
 * @param version - The current bare version (no operator, no integrity hash).
 * @returns A semver range string, or `null` when `version` has no numeric major.
 */
export const configDepUpgradeRange = (version: string): string | null => {
	const match = /^(\d+)\./.exec(version);
	if (!match) return null;
	const major = Number(match[1]);
	const ceiling = major === 0 ? 2 : major + 1;
	return `>=${version} <${ceiling}.0.0`;
};
