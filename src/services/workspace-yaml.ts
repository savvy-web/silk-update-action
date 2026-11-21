/**
 * `pnpm-workspace.yaml` formatting and reading.
 *
 * Formats the workspace file with `@savvy-web/silk-effects`' own
 * `PnpmWorkspace.sortContent` and `PnpmWorkspace.formatContentEffect`, the
 * functions the consumer's lint-staged handler runs, so the hook leaves the
 * file exactly as this action committed it. There is no local copy of the
 * key order or the stringify options to keep in step with silk.
 *
 * **Standalone functions, not a service.** There was a `WorkspaceYaml` tag and
 * a `WorkspaceYamlLive` layer here; both were deleted because nothing in `src/`
 * ever wired them — the only code that resolved the tag was this module's own
 * test suite, so the tests passed precisely because they were the sole callers.
 * That is the same reasoning that removed four unconstructed error classes from
 * `errors/errors.ts` on this branch: a construct whose only consumer is its own
 * test is indistinguishable from dead code, and renaming it to the kit's layer
 * convention would only have made it tidier dead code.
 *
 * The suite now drives {@link formatWorkspaceYaml} / {@link readWorkspaceYaml}
 * directly, which is what `program.ts`, `ConfigDeps` and the config-dependency
 * step actually call — so it exercises the production path rather than a
 * parallel one.
 *
 * @module services/workspace-yaml
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { YamlStringifyError } from "@effected/yaml";
import { Yaml } from "@effected/yaml";
import { Lint } from "@savvy-web/silk-effects";
import { Effect } from "effect";

import { FileSystemError } from "../errors/errors.js";

/**
 * Shape of pnpm-workspace.yaml content.
 */
export interface PnpmWorkspaceContent {
	packages?: string[];
	onlyBuiltDependencies?: string[];
	publicHoistPattern?: string[];
	configDependencies?: Record<string, string>;
	[key: string]: unknown;
}

/**
 * Keys whose object entries should be sorted alphabetically by key.
 *
 * Kept here, on top of silk's sort, deliberately. Silk sorts the top-level
 * keys and three arrays and leaves nested maps in source order, so its lint
 * hook never reorders these entries and sorting them here cannot fight it. The
 * action rewrites `configDependencies` entries, and sorting keeps the order of
 * an updated file independent of the order the updates were applied in.
 */
const SORTABLE_MAP_KEYS = new Set(["configDependencies"]);

/**
 * Sort pnpm-workspace.yaml content.
 *
 * `PnpmWorkspace.sortContent` from silk-effects (top-level keys, `packages`,
 * `onlyBuiltDependencies` and `publicHoistPattern`), then the keys of each
 * map in {@link SORTABLE_MAP_KEYS}.
 */
export const sortContent = (content: PnpmWorkspaceContent): PnpmWorkspaceContent => {
	const result: PnpmWorkspaceContent = Lint.PnpmWorkspace.sortContent(content);

	for (const key of SORTABLE_MAP_KEYS) {
		const value = result[key];
		if (value && typeof value === "object" && !Array.isArray(value)) {
			const sorted: Record<string, unknown> = {};
			for (const k of Object.keys(value as Record<string, unknown>).sort()) {
				sorted[k] = (value as Record<string, unknown>)[k];
			}
			result[key] = sorted;
		}
	}

	return result;
};

/**
 * Sort workspace content and stringify it to silk's canonical bytes.
 *
 * `PnpmWorkspace.formatContentEffect` owns the stringify options, so this is
 * byte-identical to what the consumer's lint hook would write for the same
 * content.
 */
export const formatWorkspaceContent = (content: PnpmWorkspaceContent): Effect.Effect<string, YamlStringifyError> =>
	Lint.PnpmWorkspace.formatContentEffect(sortContent(content));

// ══════════════════════════════════════════════════════════════════════════════
// Implementation Functions
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Format pnpm-workspace.yaml file.
 *
 * Reads, sorts, formats, and writes back the workspace file.
 * This ensures consistency with the lint-staged handler.
 */
export const formatWorkspaceYaml = (workspaceRoot: string): Effect.Effect<void, FileSystemError> =>
	formatWorkspaceYamlImpl(workspaceRoot);

/**
 * Read pnpm-workspace.yaml content.
 */
export const readWorkspaceYaml = (workspaceRoot: string): Effect.Effect<PnpmWorkspaceContent | null, FileSystemError> =>
	readWorkspaceYamlImpl(workspaceRoot);

const formatWorkspaceYamlImpl = (workspaceRoot: string): Effect.Effect<void, FileSystemError> =>
	Effect.gen(function* () {
		const filepath = `${workspaceRoot}/pnpm-workspace.yaml`;

		// Check if file exists
		if (!existsSync(filepath)) {
			yield* Effect.logWarning(`pnpm-workspace.yaml not found at ${filepath}`);
			return;
		}

		// Read and parse
		const content = yield* Effect.try({
			try: () => readFileSync(filepath, "utf-8"),
			catch: (e) =>
				new FileSystemError({
					operation: "read",
					path: filepath,
					reason: String(e),
				}),
		});

		const parsed = (yield* Yaml.parse(content).pipe(
			Effect.mapError(
				(e) =>
					new FileSystemError({
						operation: "read",
						path: filepath,
						reason: `Invalid YAML: ${e}`,
					}),
			),
		)) as PnpmWorkspaceContent;

		// Sort and format
		const formatted = yield* formatWorkspaceContent(parsed).pipe(
			Effect.mapError(
				(e) =>
					new FileSystemError({
						operation: "write",
						path: filepath,
						reason: `Failed to stringify YAML: ${e}`,
					}),
			),
		);

		// Write back
		yield* Effect.try({
			try: () => writeFileSync(filepath, formatted, "utf-8"),
			catch: (e) =>
				new FileSystemError({
					operation: "write",
					path: filepath,
					reason: String(e),
				}),
		});

		yield* Effect.logInfo("Formatted pnpm-workspace.yaml");
	});

/**
 * Read pnpm-workspace.yaml content.
 */
const readWorkspaceYamlImpl = (workspaceRoot: string): Effect.Effect<PnpmWorkspaceContent | null, FileSystemError> =>
	Effect.gen(function* () {
		const filepath = `${workspaceRoot}/pnpm-workspace.yaml`;

		if (!existsSync(filepath)) {
			return null;
		}

		const content = yield* Effect.try({
			try: () => readFileSync(filepath, "utf-8"),
			catch: (e) =>
				new FileSystemError({
					operation: "read",
					path: filepath,
					reason: String(e),
				}),
		});

		return (yield* Yaml.parse(content).pipe(
			Effect.mapError(
				(e) =>
					new FileSystemError({
						operation: "read",
						path: filepath,
						reason: `Invalid YAML: ${e}`,
					}),
			),
		)) as PnpmWorkspaceContent;
	});
