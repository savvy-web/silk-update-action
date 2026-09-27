/**
 * ConfigDeps service for updating pnpm config dependencies.
 *
 * Instead of using `pnpm add --config` (which promotes all workspace
 * dependencies to the default catalog when `catalogMode: strict` is enabled),
 * this service queries npm directly for latest versions and edits
 * `pnpm-workspace.yaml` in place.
 *
 * Entries are written **bare** (`0.11.1`), the form `pnpm add --config` writes
 * on pnpm 11+ (savvy-web/silk-update-action#494). The inline
 * `<version>+<integrity>` form is deprecated upstream (pnpm/pnpm#11644,
 * pnpm/pnpm#12293) and pnpm drops it on its own next write; config-dependency
 * integrity lives in the lockfile, which the install step refreshes. So no
 * registry integrity is fetched here, and an entry that still carries the
 * inline form is rewritten bare whenever it is touched — including when it is
 * already up to date, which is a normalization and is not reported as an
 * update. Entries are parsed with `@effected/workspaces`' `ConfigDependencySpec`;
 * one that does not parse is warned about and skipped, never rewritten.
 *
 * @module services/config-deps
 */

import { existsSync, writeFileSync } from "node:fs";
import type { NpmRegistryShape } from "@effected/npm";
import { NpmRegistry } from "@effected/npm";
import { ConfigDependencySpec } from "@effected/workspaces";
import { Yaml } from "@effected/yaml";
import { Context, Effect, Layer, Result } from "effect";

import { FileSystemError } from "../errors/errors.js";
import type { DependencyUpdateResult } from "../schema/domain.js";
import { configDepUpgradeRange, resolveLatestSatisfying } from "../utils/semver.js";
import { ReleaseAge } from "./release-age.js";
import { STRINGIFY_OPTIONS, readWorkspaceYaml, sortContent } from "./workspace-yaml.js";

// ══════════════════════════════════════════════════════════════════════════════
// Service Interface
// ══════════════════════════════════════════════════════════════════════════════

export class ConfigDeps extends Context.Service<
	ConfigDeps,
	{
		readonly updateConfigDeps: (
			deps: ReadonlyArray<string>,
			workspaceRoot: string,
		) => Effect.Effect<ReadonlyArray<DependencyUpdateResult>>;
	}
>()("ConfigDeps") {
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
			const releaseAge = yield* ReleaseAge;
			return {
				updateConfigDeps: (deps, workspaceRoot) => updateConfigDepsImpl(deps, registry, releaseAge, workspaceRoot),
			};
		}),
	);
}

// ══════════════════════════════════════════════════════════════════════════════
// Internal Helpers
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Query npm for every published version of a package. Returns an empty array
 * (rather than failing) when the registry query errors.
 */
const queryVersions = (packageName: string, registry: NpmRegistryShape): Effect.Effect<ReadonlyArray<string>> =>
	registry.versions(packageName).pipe(Effect.catch(() => Effect.succeed([] as ReadonlyArray<string>)));

// ══════════════════════════════════════════════════════════════════════════════
// Implementation
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Update config dependencies by querying npm for latest versions and
 * editing pnpm-workspace.yaml directly.
 */
const updateConfigDepsImpl = (
	deps: ReadonlyArray<string>,
	registry: NpmRegistryShape,
	releaseAge: Effect.Success<typeof ReleaseAge>,
	workspaceRoot: string,
): Effect.Effect<ReadonlyArray<DependencyUpdateResult>> =>
	Effect.gen(function* () {
		if (deps.length === 0) return [];

		const filepath = `${workspaceRoot}/pnpm-workspace.yaml`;

		// Read workspace yaml
		if (!existsSync(filepath)) {
			yield* Effect.logWarning(`pnpm-workspace.yaml not found at ${filepath}`);
			return [];
		}

		const content = yield* readWorkspaceYaml(workspaceRoot).pipe(
			Effect.catch((error) =>
				Effect.gen(function* () {
					yield* Effect.logWarning(`Failed to read pnpm-workspace.yaml: ${error.reason}`);
					return null;
				}),
			),
		);

		if (!content?.configDependencies) {
			yield* Effect.logInfo("No configDependencies section in pnpm-workspace.yaml");
			return [];
		}

		const results: DependencyUpdateResult[] = [];
		let changed = false;

		yield* Effect.logDebug(`configDependencies keys: ${JSON.stringify(Object.keys(content.configDependencies))}`);

		for (const dep of deps) {
			const currentEntry = content.configDependencies[dep];
			if (currentEntry === undefined) {
				yield* Effect.logWarning(`Config dependency ${dep} not found in pnpm-workspace.yaml, skipping`);
				continue;
			}

			// Parse current entry to extract version
			yield* Effect.logDebug(`Parsing config entry for ${dep}: ${String(currentEntry).slice(0, 80)}`);
			const spec = ConfigDependencySpec.parseResult(String(currentEntry));
			if (Result.isFailure(spec)) {
				yield* Effect.logWarning(
					`Could not parse config dependency entry for ${dep}: ${currentEntry} (${spec.failure.message})`,
				);
				continue;
			}
			const parsed = { version: spec.success.version.toString(), hasIntegrity: spec.success.hasIntegrity };
			yield* Effect.logDebug(`Parsed ${dep}: version=${parsed.version}, hasIntegrity=${parsed.hasIntegrity}`);

			// Derive a conservative upgrade range from the current version's
			// major: stay within the major for >=1.0.0, allow advancing across
			// 0.x and into the first stable major (never two majors) for <1.0.0.
			const range = configDepUpgradeRange(parsed.version);
			if (!range) {
				yield* Effect.logWarning(`Could not derive an upgrade range for ${dep} from version ${parsed.version}`);
				continue;
			}

			// Query npm for all versions and resolve the highest one in range.
			yield* Effect.logInfo(`Querying npm versions for ${dep} (range ${range})`);
			const versions = yield* queryVersions(dep, registry);
			if (versions.length === 0) {
				yield* Effect.logWarning(`Could not query versions for ${dep}`);
				continue;
			}

			// Mirror pnpm's minimumReleaseAge gate at resolution time so we never
			// write a version pnpm would refuse to install.
			const eligible = yield* releaseAge.filterVersions(dep, versions);

			const resolved = yield* resolveLatestSatisfying(eligible, range);
			if (!resolved) {
				yield* Effect.logInfo(`No version of ${dep} satisfies ${range}`);
				continue;
			}

			// Compare versions
			if (parsed.version === resolved) {
				yield* Effect.logInfo(`${dep} is already up-to-date at ${parsed.version}`);
				// Converge on the bare form even with no version movement. Not an
				// update: nothing is pushed to `results`.
				if (parsed.hasIntegrity) {
					content.configDependencies[dep] = spec.success.bare;
					changed = true;
					yield* Effect.logInfo(`  normalized ${dep}: stripped the inline integrity (the lockfile records it)`);
				}
				continue;
			}

			// Bare, as pnpm 11+ writes it — the lockfile refresh records integrity.
			content.configDependencies[dep] = resolved;
			changed = true;

			results.push({
				dependency: dep,
				from: parsed.version,
				to: resolved,
				type: "config",
				package: null,
			});

			yield* Effect.logInfo(`Updated ${dep}: ${parsed.version} -> ${resolved}`);
		}

		// Write back if changed
		if (changed) {
			const sorted = sortContent(content);
			const formatted = yield* Yaml.stringify(sorted, STRINGIFY_OPTIONS).pipe(
				Effect.catch((e) => Effect.as(Effect.logWarning(`Failed to stringify pnpm-workspace.yaml: ${e}`), null)),
			);

			if (formatted !== null) {
				yield* Effect.try({
					try: () => writeFileSync(filepath, formatted, "utf-8"),
					catch: (e) =>
						new FileSystemError({
							operation: "write",
							path: filepath,
							reason: String(e),
						}),
				}).pipe(Effect.catch((error) => Effect.logWarning(`Failed to write pnpm-workspace.yaml: ${error.reason}`)));
			}
		}

		return results;
	});
