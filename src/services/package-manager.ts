/**
 * Detect the package manager a workspace is using, once per run.
 *
 * @module services/package-manager
 */

import { ActionInputError } from "@savvy-web/github-action-effects";
import { Effect } from "effect";
import { PackageManagerDetector, WorkspaceRoot } from "workspaces-effect";

/**
 * The package managers this action supports.
 *
 * Yarn is detected upstream but not supported here: nothing in the config-dep,
 * install or upgrade paths is wired or tested for it.
 */
export type SupportedPm = "pnpm" | "bun" | "npm";

/** The package manager this run is operating on, resolved once. */
export interface DetectedPm {
	readonly pm: SupportedPm;
	readonly version: string | undefined;
	readonly root: string;
}

/**
 * Detect the package manager for the workspace.
 *
 * Delegates to workspaces-effect's `PackageManagerDetector`, which is also what
 * `LockfileReader` and `PointInTimeWorkspace` consult internally — so the PM the
 * action dispatches on is always the one those libraries parse for. It reads
 * `devEngines.packageManager` first, then falls back to lockfile and config-file
 * presence.
 *
 * `WorkspaceRoot.find` and `PackageManagerDetector.detect` share the same
 * marker checks (`pnpm-workspace.yaml`, `package.json`'s `workspaces` field),
 * so a `WorkspaceRootNotFoundError` and a `PackageManagerDetectionError` are
 * mapped to `ActionInputError` through one shared handler below rather than
 * two — both upstream errors carry the same `reason` / `searchPath` shape.
 */
export const detectPackageManager = (
	cwd?: string,
): Effect.Effect<DetectedPm, ActionInputError, PackageManagerDetector | WorkspaceRoot> =>
	Effect.gen(function* () {
		const workspaceRoot = yield* WorkspaceRoot;
		const detector = yield* PackageManagerDetector;

		const startDir = cwd ?? process.cwd();
		const root = yield* workspaceRoot.find(startDir);
		const detected = yield* detector.detect(root);

		if (detected.type === "yarn") {
			return yield* Effect.fail(
				new ActionInputError({
					inputName: "workspace",
					reason: "Detected yarn, which this action does not support. Supported: pnpm, bun, npm.",
					rawValue: root,
				}),
			);
		}

		return { pm: detected.type, version: detected.version, root };
	}).pipe(
		Effect.mapError((error) =>
			error instanceof ActionInputError
				? error
				: new ActionInputError({
						inputName: "workspace",
						reason: `Could not detect a package manager at "${error.searchPath}": ${error.reason}`,
						rawValue: error.searchPath,
					}),
		),
	);
