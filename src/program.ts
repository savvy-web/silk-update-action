/**
 * Action program and utilities.
 *
 * Contains the main Effect program and helper functions, separated from
 * the entry point (`main.ts`) so tests can import without triggering
 * module-level `Action.run` execution.
 *
 * @module program
 */

import type { CommandRunnerError, LogLevelInput } from "@savvy-web/github-action-effects";
import {
	Action,
	ActionEnvironment,
	ActionInputError,
	ActionOutputs,
	CheckRun,
	CommandRunner,
} from "@savvy-web/github-action-effects";
import { Config, Duration, Effect, LogLevel, Logger } from "effect";
import { Range } from "semver-effect";
import { makeAppLayer } from "./layers/app.js";
import type { ChangesetFile, DependencyUpdateResult, PullRequestResult } from "./schemas/domain.js";
import { BranchManager } from "./services/branch.js";
import { Changesets } from "./services/changesets.js";
import { ConfigDeps } from "./services/config-deps.js";
import { captureLockfileState, compareLockfiles } from "./services/lockfile.js";
import type { PeerSyncConfig } from "./services/peer-sync.js";
import { syncPeers } from "./services/peer-sync.js";
import { PnpmUpgrade } from "./services/pnpm-upgrade.js";
import { RegularDeps } from "./services/regular-deps.js";
import { Report } from "./services/report.js";
import { RuntimeUpgrade } from "./services/runtime-upgrade.js";
import { formatWorkspaceYaml, readWorkspaceYaml } from "./services/workspace-yaml.js";
import { resolveTargetBranch } from "./utils/branch.js";
import { matchesPattern } from "./utils/deps.js";
import { parseMultiValueInput } from "./utils/input.js";

/**
 * Result of running custom commands.
 */
export interface RunCommandsResult {
	readonly successful: ReadonlyArray<string>;
	readonly failed: ReadonlyArray<{ command: string; error: string; exitCode?: number | undefined }>;
}

/**
 * Run custom commands after dependency updates.
 *
 * Commands are executed sequentially. All commands are attempted even if some fail,
 * but failures are collected and returned for the caller to handle.
 */
export const runCommands = (commands: ReadonlyArray<string>): Effect.Effect<RunCommandsResult, never, CommandRunner> =>
	Effect.gen(function* () {
		const runner = yield* CommandRunner;
		const successful: string[] = [];
		const failed: Array<{ command: string; error: string; exitCode?: number | undefined }> = [];

		for (const command of commands) {
			yield* Effect.logInfo(`Running: ${command}`);

			// Split command into executable and args for CommandRunner
			const result = yield* runner.execCapture("sh", ["-c", command]).pipe(
				Effect.map(() => ({ success: true as const })),
				Effect.catchAll((error: CommandRunnerError) =>
					Effect.succeed({
						success: false as const,
						error: error.reason ?? "Unknown error",
						exitCode: error.exitCode,
					}),
				),
			);

			if (result.success) {
				yield* Effect.logInfo(`Command completed: ${command}`);
				successful.push(command);
			} else {
				yield* Effect.logError(`Command failed: ${command}`);
				yield* Effect.logDebug(
					`Command error: ${JSON.stringify({ command, stderr: result.error, exitCode: result.exitCode })}`,
				);
				failed.push({ command, error: result.error, exitCode: result.exitCode });
			}
		}

		return { successful, failed };
	});

/**
 * Regenerate the lockfile: `pnpm clean --lockfile` then
 * `pnpm install --frozen-lockfile=false`.
 *
 * This action mutates the three inputs to pnpm resolution — the pnpm version
 * (`upgrade-package-manager`), the pnpm config (config dependencies in
 * `pnpm-workspace.yaml` and the `pnpm-plugin-silk` hooks), and dependency
 * ranges. `--fix-lockfile` only repairs broken entries against the existing
 * lockfile; it does not re-run resolution under the changed pnpm/config/ranges,
 * so it can silently carry a stale graph forward and commit an inconsistent
 * lockfile (e.g. an upstream peer range moving leaves a required peer unfilled).
 * A full regeneration is the only reliable way to produce a correct, installable
 * lockfile that reflects the new pnpm version, config, and ranges. As a
 * dependency updater obeying the declared ranges and rules, advancing
 * transitives is expected, not noise.
 *
 * `pnpm clean --lockfile` removes the lockfile and node_modules via Node.js, so
 * it unlinks cleanly across platforms (including Windows junctions) — preferable
 * to `rm -rf`. Caveat: `pnpm clean` runs a consumer's own `clean`/`purge`
 * package.json script instead of the built-in if one exists, and it requires
 * pnpm 11+. `--frozen-lockfile=false` opts out of the CI default that refuses to
 * write lockfile changes.
 */
export const runInstall = (): Effect.Effect<void, CommandRunnerError, CommandRunner> =>
	Effect.gen(function* () {
		const runner = yield* CommandRunner;
		yield* runner.exec("pnpm", ["clean", "--lockfile"]);
		yield* runner.exec("pnpm", ["install", "--frozen-lockfile=false"]);
	});

/**
 * Main action program (the `main` phase).
 *
 * Orchestrates the full dependency-update workflow: input parsing, the check
 * run, and the update steps. The GitHub App token lifecycle lives in the
 * pre/post phases — provisioned via `GitHubToken.provision` in `pre.ts` and
 * read here through the app layer's `GitHubToken.client()`.
 */
/* v8 ignore start -- orchestration code tested via integration */
export const program = Effect.gen(function* () {
	// Parse inputs via Config API
	yield* Effect.logInfo("Starting Silk Update Action");

	const branch = yield* Config.string("branch").pipe(Config.withDefault("pnpm/config-deps"));
	const sourceBranch = yield* Config.string("source-branch").pipe(Config.withDefault("main"));
	const rawTargetBranch = yield* Config.string("target-branch").pipe(Config.withDefault(""));
	const targetBranch = resolveTargetBranch(rawTargetBranch, sourceBranch);
	const rawConfigDeps = yield* Config.string("config-dependencies").pipe(Config.withDefault(""));
	const configDependencies = parseMultiValueInput(rawConfigDeps);
	const rawDeps = yield* Config.string("dependencies").pipe(Config.withDefault(""));
	const dependencies = parseMultiValueInput(rawDeps);
	const rawPeerLock = yield* Config.string("peer-lock").pipe(Config.withDefault(""));
	const peerLock = parseMultiValueInput(rawPeerLock);
	const rawPeerMinor = yield* Config.string("peer-minor").pipe(Config.withDefault(""));
	const peerMinor = parseMultiValueInput(rawPeerMinor);
	const rawRun = yield* Config.string("run").pipe(Config.withDefault(""));
	const run = parseMultiValueInput(rawRun);
	const upgradePackageManager = yield* Config.string("upgrade-package-manager").pipe(Config.withDefault("true"));
	const changesets = yield* Config.boolean("changesets").pipe(Config.withDefault(true));
	const autoMerge = yield* Config.string("auto-merge").pipe(Config.withDefault(""));
	const dryRun = yield* Config.boolean("dry-run").pipe(Config.withDefault(false));
	const logLevel = yield* Config.string("log-level").pipe(Config.withDefault("auto"));
	const timeout = yield* Config.integer("timeout").pipe(Config.withDefault(180));
	const rawRuntimeNode = yield* Config.string("upgrade-runtime-node").pipe(Config.withDefault("false"));
	const rawRuntimeDeno = yield* Config.string("upgrade-runtime-deno").pipe(Config.withDefault("false"));
	const rawRuntimeBun = yield* Config.string("upgrade-runtime-bun").pipe(Config.withDefault("false"));
	const runtimeData = yield* Config.string("runtime-data").pipe(Config.withDefault("offline"));
	if (runtimeData !== "offline" && runtimeData !== "live") {
		yield* Effect.logWarning(`Unknown runtime-data value "${runtimeData}", defaulting to "offline"`);
	}
	const runtimeLive = runtimeData === "live";

	// Validate upgrade-package-manager and each runtime input: must be an allowed keyword
	// or a parseable semver range.
	for (const [inputName, value, keywords] of [
		["upgrade-runtime-node", rawRuntimeNode, ["auto", "false"]],
		["upgrade-runtime-deno", rawRuntimeDeno, ["auto", "false"]],
		["upgrade-runtime-bun", rawRuntimeBun, ["auto", "false"]],
		["upgrade-package-manager", upgradePackageManager, ["true", "false", "auto"]],
	] as const) {
		if (!(keywords as ReadonlyArray<string>).includes(value)) {
			yield* Range.parse(value).pipe(
				Effect.mapError(
					(e) =>
						new ActionInputError({
							inputName,
							reason: `Invalid semver range: ${String(e)}`,
							rawValue: value,
						}),
				),
			);
		}
	}

	const anyRuntime = rawRuntimeNode !== "false" || rawRuntimeDeno !== "false" || rawRuntimeBun !== "false";
	if (anyRuntime) {
		yield* Effect.logInfo(`Runtime upgrades enabled (data source: ${runtimeData})`);
	}

	// Cross-validate: at least one update type must be active
	if (
		configDependencies.length === 0 &&
		dependencies.length === 0 &&
		upgradePackageManager === "false" &&
		!anyRuntime
	) {
		yield* Effect.fail(
			new ActionInputError({
				inputName: "config-dependencies",
				reason: "At least one update type must be active",
				rawValue: undefined,
			}),
		);
	}

	// Validate peer-lock and peer-minor don't overlap
	const peerOverlap = peerLock.filter((p) => peerMinor.includes(p));
	if (peerOverlap.length > 0) {
		yield* Effect.fail(
			new ActionInputError({
				inputName: "peer-lock",
				reason: `Packages appear in both peer-lock and peer-minor: ${peerOverlap.join(", ")}`,
				rawValue: undefined,
			}),
		);
	}

	// Warn if peer entries don't match any dependencies pattern
	for (const pkg of [...peerLock, ...peerMinor]) {
		const hasMatch = dependencies.some((p) => matchesPattern(pkg, p));
		if (!hasMatch) {
			yield* Effect.logWarning(`peer-lock/peer-minor entry "${pkg}" does not match any dependencies pattern`);
		}
	}

	// Resolve log level
	const resolvedLogLevel = Action.resolveLogLevel(logLevel as LogLevelInput);
	// Map ActionLogLevel ("info" | "verbose" | "debug") to Effect LogLevel
	// "info" = show info and above (default CI behavior)
	// "verbose" = show all info (same as info for Effect's logger)
	// "debug" = show debug and above (verbose output)
	const effectLogLevel =
		resolvedLogLevel === "debug" ? LogLevel.Debug : resolvedLogLevel === "verbose" ? LogLevel.Debug : LogLevel.Info;

	yield* Effect.logDebug("Debug mode enabled - verbose logging active");
	yield* Effect.logDebug(
		`Parsed inputs: ${JSON.stringify({
			branch,
			configDependencies,
			dependencies,
			peerLock,
			peerMinor,
			upgradePackageManager,
			dryRun,
		})}`,
	);

	if (dryRun) {
		yield* Effect.logWarning("Running in dry-run mode - will detect changes but skip commit/push/PR");
	}

	// Read head SHA and run the main workflow. The GitHub App installation token
	// was provisioned in the pre phase and is read back inside the app layer via
	// GitHubToken.client(); no token plumbing happens here.
	const env = yield* ActionEnvironment;
	const github = yield* env.github;
	const headSha = github.sha;

	const appLayer = makeAppLayer(dryRun, { runtimeLive });
	yield* innerProgram(
		{
			branch,
			sourceBranch,
			targetBranch,
			"config-dependencies": configDependencies,
			dependencies,
			"peer-lock": peerLock,
			"peer-minor": peerMinor,
			"upgrade-package-manager": upgradePackageManager,
			changesets,
			"auto-merge": autoMerge as "" | "merge" | "squash" | "rebase",
			run,
			runtime: { node: rawRuntimeNode, deno: rawRuntimeDeno, bun: rawRuntimeBun },
		},
		dryRun,
		headSha,
		appLayer,
	)
		.pipe(Logger.withMinimumLogLevel(effectLogLevel))
		.pipe(
			Effect.timeoutFail({
				duration: Duration.seconds(timeout),
				onTimeout: () => new Error(`Action timed out after ${timeout} seconds`),
			}),
		);
});

/**
 * Inner program that runs with all services provided.
 */
const innerProgram = (
	inputs: {
		branch: string;
		sourceBranch: string;
		targetBranch: string;
		"config-dependencies": ReadonlyArray<string>;
		dependencies: ReadonlyArray<string>;
		"peer-lock": ReadonlyArray<string>;
		"peer-minor": ReadonlyArray<string>;
		"upgrade-package-manager": string;
		changesets: boolean;
		"auto-merge": "" | "merge" | "squash" | "rebase";
		run: ReadonlyArray<string>;
		runtime: { node: string; deno: string; bun: string };
	},
	dryRun: boolean,
	headSha: string,
	appLayer: ReturnType<typeof makeAppLayer>,
) =>
	// appLayer is provided at two levels: here (outer) for services used before
	// withCheckRun, and again inside the withCheckRun callback (inner) because
	// the callback signature requires R = never (all services resolved).
	Effect.provide(
		Effect.gen(function* () {
			const outputs = yield* ActionOutputs;
			const checkRunService = yield* CheckRun;

			// Create check run for visibility
			const checkRunName = dryRun ? "Dependency Updates (Dry Run)" : "Dependency Updates";

			yield* checkRunService.withCheckRun(checkRunName, headSha, (checkRunId) =>
				Effect.provide(
					Effect.gen(function* () {
						// Validate refs before any destructive branch operation, then manage branch
						yield* Effect.logInfo("Step 1: Managing branch");
						const branchManager = yield* BranchManager;
						yield* branchManager.validateBranches(inputs.sourceBranch, inputs.targetBranch);
						const branchResult = yield* branchManager.manage(inputs.branch, inputs.sourceBranch);
						yield* Effect.logInfo(`Branch: ${branchResult.branch} (created: ${branchResult.created})`);

						// Capture lockfile state before updates
						yield* Effect.logInfo("Step 2: Capturing lockfile state (before)");
						const lockfileBefore = yield* captureLockfileState();
						yield* Effect.logDebug(
							`Lockfile state (before): ${JSON.stringify({
								packages: Object.keys(lockfileBefore?.packages || {}).length,
								importers: Object.keys(lockfileBefore?.importers || {}).length,
							})}`,
						);

						// Upgrade pnpm (if enabled)
						const configUpdatesFromPnpm: DependencyUpdateResult[] = [];
						if (inputs["upgrade-package-manager"] !== "false") {
							yield* Effect.logInfo("Step 3: Upgrading pnpm");
							const pnpmUpgradeService = yield* PnpmUpgrade;
							const pnpmUpgrade = yield* pnpmUpgradeService.upgrade(inputs["upgrade-package-manager"]).pipe(
								Effect.catchAll((error) => {
									return Effect.gen(function* () {
										yield* Effect.logWarning(`Failed to upgrade pnpm: ${error.reason}`);
										return null;
									});
								}),
							);

							if (pnpmUpgrade) {
								yield* Effect.logInfo(`pnpm: ${pnpmUpgrade.from ?? "added"} -> ${pnpmUpgrade.to}`);
								configUpdatesFromPnpm.push({
									dependency: "pnpm",
									from: pnpmUpgrade.from,
									to: pnpmUpgrade.to,
									type: "config",
									package: null,
								});
							} else {
								yield* Effect.logInfo("pnpm is already up-to-date");
							}
						}

						// Upgrade runtimes (devEngines.runtime)
						yield* Effect.logInfo("Step 3b: Upgrading runtimes");
						const runtimeUpdates: DependencyUpdateResult[] = [];
						const runtimeUpgradeService = yield* RuntimeUpgrade;
						const runtimeResults = yield* runtimeUpgradeService.upgrade(inputs.runtime).pipe(
							Effect.catchAll((error) =>
								Effect.gen(function* () {
									yield* Effect.logWarning(`Failed to upgrade runtimes: ${error.reason}`);
									return [] as const;
								}),
							),
						);
						for (const r of runtimeResults) {
							yield* Effect.logInfo(`${r.runtime}: ${r.from ?? "added"} -> ${r.to}`);
							runtimeUpdates.push({
								dependency: r.runtime,
								from: r.from,
								to: r.to,
								type: "runtime",
								package: null,
							});
						}

						// Update config dependencies
						yield* Effect.logInfo("Step 4: Updating config dependencies");
						const workspaceBefore = yield* readWorkspaceYaml().pipe(Effect.catchAll(() => Effect.succeed(null)));
						yield* Effect.logDebug(`pnpm-workspace.yaml (before): ${JSON.stringify(workspaceBefore)}`);

						const configDepsService = yield* ConfigDeps;
						const configUpdates = yield* configDepsService.updateConfigDeps(inputs["config-dependencies"]);
						yield* Effect.logDebug(`Config dependency updates: ${JSON.stringify(configUpdates)}`);

						// Update regular dependencies
						yield* Effect.logInfo("Step 5: Updating regular dependencies");
						const regularDepsService = yield* RegularDeps;
						const regularUpdates = yield* regularDepsService.updateRegularDeps(inputs.dependencies);

						// Sync peer dependencies
						const peerSyncConfig: PeerSyncConfig = {
							lock: inputs["peer-lock"],
							minor: inputs["peer-minor"],
						};
						yield* Effect.logInfo("Step 5b: Syncing peer dependencies");
						const peerUpdates = yield* syncPeers(peerSyncConfig, regularUpdates);
						if (peerUpdates.length > 0) {
							yield* Effect.logInfo(`Synced ${peerUpdates.length} peer dependency range(s)`);
						}

						// Reconcile lockfile and install
						if (
							configUpdates.length > 0 ||
							regularUpdates.length > 0 ||
							configUpdatesFromPnpm.length > 0 ||
							peerUpdates.length > 0
						) {
							yield* Effect.logInfo("Step 6: Regenerating lockfile and installing");
							yield* runInstall();
						}

						// Format pnpm-workspace.yaml
						yield* Effect.logInfo("Step 7: Formatting pnpm-workspace.yaml");
						yield* formatWorkspaceYaml();

						const workspaceAfter = yield* readWorkspaceYaml().pipe(Effect.catchAll(() => Effect.succeed(null)));
						yield* Effect.logDebug(`pnpm-workspace.yaml (after): ${JSON.stringify(workspaceAfter)}`);

						// Run custom commands (if specified)
						if (inputs.run.length > 0) {
							yield* Effect.logInfo("Step 8: Running custom commands");
							const runCommandsResult = yield* runCommands(inputs.run);

							if (runCommandsResult.failed.length > 0) {
								const failedCommands = runCommandsResult.failed.map((f) => f.command).join(", ");
								yield* Effect.logError(`${runCommandsResult.failed.length} command(s) failed: ${failedCommands}`);

								const failureDetails = runCommandsResult.failed.map((f) => `- \`${f.command}\`: ${f.error}`).join("\n");

								yield* checkRunService.complete(checkRunId, "failure", {
									title: "Custom Commands Failed",
									summary: `Custom commands failed:\n\n${failureDetails}`,
								});

								yield* outputs.set("has-changes", "false");
								yield* outputs.set("updates-count", "0");

								return yield* Effect.fail(new Error(`Custom commands failed: ${failedCommands}`));
							}
						}

						// Capture lockfile state after updates
						yield* Effect.logInfo("Step 9: Capturing lockfile state (after)");
						const lockfileAfter = yield* captureLockfileState();
						yield* Effect.logDebug(
							`Lockfile state (after): ${JSON.stringify({
								packages: Object.keys(lockfileAfter?.packages || {}).length,
								importers: Object.keys(lockfileAfter?.importers || {}).length,
							})}`,
						);

						// Detect changes
						yield* Effect.logInfo("Step 10: Detecting changes");
						const changes = yield* compareLockfiles(lockfileBefore, lockfileAfter);
						yield* Effect.logDebug(`Detected changes: ${JSON.stringify(changes)}`);

						const allUpdates = [
							...configUpdatesFromPnpm,
							...runtimeUpdates,
							...configUpdates,
							...regularUpdates,
							...peerUpdates,
						];
						yield* Effect.logDebug(
							`Total updates: ${allUpdates.length} (config: ${configUpdates.length + configUpdatesFromPnpm.length}, dev: ${regularUpdates.length}, peer: ${peerUpdates.length})`,
						);

						// Check if there are any changes via git status.
						//
						// Use core.fileMode=false so executable-bit-only flips (e.g. husky
						// chmod-ing .husky hooks during a `run` command) are not counted as
						// changes. They don't survive the content-based GitHub API commit
						// (mode 100644), so treating them as changes would otherwise produce
						// an empty commit and a spurious PR. This must stay consistent with
						// BranchManager.commitChanges, which queries status the same way.
						const runner = yield* CommandRunner;
						const statusResult = yield* runner.execCapture("git", [
							"-c",
							"core.fileMode=false",
							"status",
							"--porcelain",
						]);
						const hasChanges = statusResult.stdout.trim().length > 0;
						yield* Effect.logDebug(`Git status has changes: ${hasChanges}`);

						if (!hasChanges && changes.length === 0) {
							yield* Effect.logInfo("No dependency updates available");

							yield* checkRunService.complete(checkRunId, "neutral", {
								title: "No Updates",
								summary: "No dependency updates available. All dependencies are up-to-date.",
							});

							yield* outputs.set("has-changes", "false");
							yield* outputs.set("updates-count", "0");

							return;
						}

						// Create changesets (if enabled)
						let changesets: ReadonlyArray<ChangesetFile> = [];
						if (inputs.changesets) {
							yield* Effect.logInfo("Step 11: Creating changesets");
							// DepsRegen diffs against merge-base(target-branch); make sure that
							// history is available locally before it runs (no-op on a
							// fetch-depth: 0 checkout of the target).
							yield* branchManager.ensureBaseHistory(inputs.targetBranch);
							const changesetsService = yield* Changesets;
							// DepsRegen recomputes the cumulative dependency diff from
							// merge-base(target-branch) → worktree and consolidates/dedupes
							// existing pure-dep changesets. The per-run `changes`/
							// `regularUpdates`/`peerUpdates` still drive reporting below.
							changesets = yield* changesetsService.create(process.cwd(), inputs.targetBranch);
						} else {
							yield* Effect.logInfo("Step 11: Skipping changesets (disabled)");
						}

						// Commit and push
						const report = yield* Report;
						if (dryRun) {
							yield* Effect.logInfo("Step 12: [DRY RUN] Skipping commit and push");
						} else {
							yield* Effect.logInfo("Step 12: Committing via GitHub API");
							const commitMessage = report.generateCommitMessage(allUpdates);
							yield* branchManager.commitChanges(commitMessage, inputs.branch);
						}

						// Create/update PR
						let pr: PullRequestResult | null = null;
						if (dryRun) {
							yield* Effect.logInfo("Step 13: [DRY RUN] Skipping PR creation/update");
						} else {
							yield* Effect.logInfo("Step 13: Creating/updating PR");
							pr = yield* report
								.createOrUpdatePR(
									inputs.branch,
									inputs.targetBranch,
									allUpdates,
									changesets,
									inputs["auto-merge"] || undefined,
								)
								.pipe(
									Effect.catchAll((error) =>
										Effect.gen(function* () {
											yield* Effect.logWarning(`PR creation failed: ${error.reason}`);
											return null;
										}),
									),
								);
						}

						// Update check run
						const summaryText = report.generateSummary(allUpdates, changesets, pr, dryRun);
						yield* checkRunService.complete(checkRunId, "success", {
							title: "Dependency Updates Complete",
							summary: summaryText,
						});

						// Set outputs
						yield* outputs.set("has-changes", "true");
						yield* outputs.set("updates-count", String(allUpdates.length));
						if (pr) {
							yield* outputs.set("pr-number", String(pr.number));
							yield* outputs.set("pr-url", pr.url);
						}

						// Write job summary
						const jobSummaryLines = ["# Dependency Updates"];
						if (dryRun) {
							jobSummaryLines.push("", "> **DRY RUN MODE** - Changes detected but not committed/pushed");
						}
						jobSummaryLines.push("", summaryText);
						yield* outputs.summary(jobSummaryLines.join("\n"));

						yield* Effect.logInfo("Dependency update action completed successfully");
					}),
					appLayer,
				),
			);
		}),
		appLayer,
	);
/* v8 ignore stop */
