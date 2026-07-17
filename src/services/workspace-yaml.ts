/**
 * WorkspaceYaml service for pnpm-workspace.yaml formatting and reading.
 *
 * Formats the workspace file consistently to match @savvy-web/lint-staged PnpmWorkspace handler,
 * avoiding lint-staged hook changes after our action commits.
 *
 * @module services/workspace-yaml
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { Yaml } from "@effected/yaml";
import { Context, Effect, Layer } from "effect";

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
 * Keys whose array values should be sorted alphabetically.
 */
const SORTABLE_ARRAY_KEYS = new Set(["packages", "onlyBuiltDependencies", "publicHoistPattern"]);

/**
 * Keys whose object entries should be sorted alphabetically by key.
 */
const SORTABLE_MAP_KEYS = new Set(["configDependencies"]);

/**
 * Default YAML stringify options for consistent formatting.
 * Must match @savvy-web/lint-staged PnpmWorkspace handler.
 */
export const STRINGIFY_OPTIONS = {
	indent: 2,
	lineWidth: 0, // Disable line wrapping
	// Indent block sequences one level under their mapping key, matching the
	// legacy `yaml` npm package's default output (byte-parity with prior runs).
	indentSequences: true,
} as const;

/**
 * Sort pnpm-workspace.yaml content.
 *
 * Matches @savvy-web/lint-staged PnpmWorkspace.sortContent pattern, extended
 * with configDependencies key sorting since updated entries may not preserve
 * alphabetical order.
 *
 * Sorts:
 * - `packages` array alphabetically
 * - `onlyBuiltDependencies` array (if present)
 * - `publicHoistPattern` array (if present)
 * - `configDependencies` object keys alphabetically
 * - All top-level keys alphabetically, keeping `packages` first
 */
export const sortContent = (content: PnpmWorkspaceContent): PnpmWorkspaceContent => {
	const result: PnpmWorkspaceContent = {};

	// Get all keys and sort them, but keep 'packages' first
	const keys = Object.keys(content).sort((a, b) => {
		if (a === "packages") return -1;
		if (b === "packages") return 1;
		return a.localeCompare(b);
	});

	for (const key of keys) {
		const value = content[key];

		// Sort array values for known sortable keys
		if (SORTABLE_ARRAY_KEYS.has(key) && Array.isArray(value)) {
			result[key] = [...value].sort();
		} else if (SORTABLE_MAP_KEYS.has(key) && value && typeof value === "object" && !Array.isArray(value)) {
			// Sort object keys alphabetically for known map keys
			const sorted: Record<string, unknown> = {};
			for (const k of Object.keys(value as Record<string, unknown>).sort()) {
				sorted[k] = (value as Record<string, unknown>)[k];
			}
			result[key] = sorted;
		} else {
			result[key] = value;
		}
	}

	return result;
};

// ══════════════════════════════════════════════════════════════════════════════
// Service Interface
// ══════════════════════════════════════════════════════════════════════════════

export class WorkspaceYaml extends Context.Service<
	WorkspaceYaml,
	{
		readonly format: (workspaceRoot?: string) => Effect.Effect<void, FileSystemError>;
		readonly read: (workspaceRoot?: string) => Effect.Effect<PnpmWorkspaceContent | null, FileSystemError>;
	}
>()("WorkspaceYaml") {}

export const WorkspaceYamlLive = Layer.succeed(WorkspaceYaml, {
	format: (workspaceRoot = process.cwd()) => formatWorkspaceYamlImpl(workspaceRoot),
	read: (workspaceRoot = process.cwd()) => readWorkspaceYamlImpl(workspaceRoot),
});

// ══════════════════════════════════════════════════════════════════════════════
// Implementation Functions
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Format pnpm-workspace.yaml file.
 *
 * Reads, sorts, formats, and writes back the workspace file.
 * This ensures consistency with the lint-staged handler.
 *
 * Standalone function exported for direct use by consumers that
 * haven't yet migrated to the WorkspaceYaml service.
 */
export const formatWorkspaceYaml = (workspaceRoot: string = process.cwd()): Effect.Effect<void, FileSystemError> =>
	formatWorkspaceYamlImpl(workspaceRoot);

/**
 * Read pnpm-workspace.yaml content.
 *
 * Standalone function exported for direct use by consumers that
 * haven't yet migrated to the WorkspaceYaml service.
 */
export const readWorkspaceYaml = (
	workspaceRoot: string = process.cwd(),
): Effect.Effect<PnpmWorkspaceContent | null, FileSystemError> => readWorkspaceYamlImpl(workspaceRoot);

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
		const sorted = sortContent(parsed);
		const formatted = yield* Yaml.stringify(sorted, STRINGIFY_OPTIONS).pipe(
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
