/**
 * Action program and utilities.
 *
 * Contains the main Effect program and helper functions, separated from
 * the entry point (`main.ts`) so tests can import without triggering
 * module-level `Action.run` execution.
 *
 * @module program
 */

import { CheckRun, CheckRunOutput } from "@effected/github";
import { ActionEnvironment, ActionLogger, ActionOutputs } from "@effected/github-actions";
import { Duration, Effect, Option, References } from "effect";
import { INSTALL_LABEL, resultLines, runContextLines } from "./format.js";
import { makeAppLayer } from "./layers/app.js";
import type {
	CatalogDelta,
	ChangesetFile,
	DependencyUpdateResult,
	LockfileChange,
	PeerIssue,
	PullRequestResult,
	RunResultDocument,
} from "./schema/domain.js";
import { SCHEMA_URL } from "./schema/hosted.js";
import type { InnerProgramInputs } from "./schema/inputs.js";
import { readInputs } from "./schema/inputs.js";
import { emitOutputs, emitRunResult, initialOutputs } from "./schema/outputs.js";
import { LOCKFILE_NAMES, compareLockfiles } from "./services/lockfile.js";
import type { DetectedPm } from "./services/package-manager.js";
import { Report } from "./services/report.js";
import { activatePackageManagerStep } from "./steps/activate-package-manager.js";
import { branchStep } from "./steps/branch.js";
import { changesetsStep } from "./steps/changesets.js";
import { commitAndPrStep } from "./steps/commit-and-pr.js";
import { configDependenciesStep } from "./steps/config-dependencies.js";
import { configureStatusStep } from "./steps/configure-status.js";
import { customCommandsStep, failedCommandNames, formatCommandFailures } from "./steps/custom-commands.js";
import { detectChangesStep } from "./steps/detect-changes.js";
import { detectPackageManagerStep } from "./steps/detect-package-manager.js";
import { formatWorkspaceStep } from "./steps/format-workspace.js";
import { installStep } from "./steps/install.js";
import { lockfileSnapshotStep } from "./steps/lockfile-snapshot.js";
import { peerCheckStep } from "./steps/peer-check.js";
import { peerSyncStep } from "./steps/peer-sync.js";
import { regularDependenciesStep } from "./steps/regular-dependencies.js";
import { upgradePackageManagerStep } from "./steps/upgrade-package-manager.js";
import { upgradeRuntimesStep } from "./steps/upgrade-runtimes.js";

/**
 * Assemble the structured `result` document from the run's own values.
 *
 * Built from the same records that drive the scalar outputs and the PR body —
 * not a parallel reporting shape — so the two cannot disagree about what
 * happened.
 */
const buildRunResult = (params: {
	readonly hasChanges: boolean;
	readonly dryRun: boolean;
	readonly detected: DetectedPm;
	readonly branch: string;
	readonly targetBranch: string;
	readonly updates: ReadonlyArray<DependencyUpdateResult>;
	readonly deltas: ReadonlyArray<CatalogDelta>;
	readonly lockfileChanges: ReadonlyArray<LockfileChange>;
	readonly changesets: ReadonlyArray<ChangesetFile>;
	readonly peerIssues: ReadonlyArray<PeerIssue>;
	readonly pullRequest: PullRequestResult | null;
}): RunResultDocument => ({
	$schema: SCHEMA_URL,
	hasChanges: params.hasChanges,
	dryRun: params.dryRun,
	packageManager: params.detected.pm,
	workspaceRoot: params.detected.root,
	branch: params.branch,
	targetBranch: params.targetBranch,
	updates: params.updates,
	catalogDeltas: params.deltas,
	peerIssues: params.peerIssues,
	lockfileChanges: params.lockfileChanges,
	changesets: params.changesets,
	pullRequest: params.pullRequest,
});

/** `1 update`, `3 updates`: the count words every step summary uses. */
const count = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? "" : "s"}`;

/**
 * Main action program (the `main` phase).
 *
 * Orchestrates the full dependency-update workflow: input parsing, the check
 * run, and the update steps. The GitHub App token lifecycle lives in the
 * pre/post phases — provisioned via `GitHubToken.provision` in `pre.ts` and
 * read here through the app layer's `GitHubToken.client()`.
 */
/* v8 ignore start -- real layer wiring; exercised end-to-end on the runner, not in-process */
export const program = Effect.gen(function* () {
	yield* Effect.logInfo("Starting Silk Update Action");

	// Publish the all-disabled baseline BEFORE any work, so every declared output
	// has a value on every exit path — including a failure in `readInputs` itself,
	// which is the earliest thing that can abort the run.
	//
	// Emitted first rather than from `Effect.onError`, deliberately. A failure
	// handler that re-emits the baseline also OVERWRITES anything a step already
	// published: a run that opened a PR and then failed later would report
	// `pr-number: ""` and `has-changes: false`, which is not a conservative
	// default, it is a false statement about work that actually happened. Writing
	// the baseline up front and letting steps refine it gives the same guarantee
	// with no lying.
	yield* emitOutputs(initialOutputs);

	const { inputs, dryRun, timeout, runtimeLive } = yield* readInputs;

	// Resolve log level: normal (info) or debug when step debug logging is
	// enabled on the runner (RUNNER_DEBUG=1 via ACTIONS_STEP_DEBUG). The kit has
	// no Action.resolveLogLevel — ActionEnvironment.isDebug is the seam that
	// reads the runner flag.
	const env = yield* ActionEnvironment;
	const effectLogLevel = (yield* env.isDebug) ? "Debug" : "Info";

	yield* Effect.logDebug("Debug mode enabled - verbose logging active");
	yield* Effect.logDebug(
		`Parsed inputs: ${JSON.stringify({
			branch: inputs.branch,
			configDependencies: inputs["config-dependencies"],
			dependencies: inputs.dependencies,
			peerLock: inputs["peer-lock"],
			peerMinor: inputs["peer-minor"],
			upgradePackageManager: inputs["upgrade-package-manager"],
			dryRun,
		})}`,
	);

	if (dryRun) {
		yield* Effect.logWarning("Running in dry-run mode - will detect changes but skip commit/push/PR");
	}

	// Read head SHA and run the main workflow. The GitHub App installation token
	// was provisioned in the pre phase and is read back inside the app layer via
	// GitHubToken.clientLayer(); no token plumbing happens here.
	const github = yield* env.github;
	const headSha = github.sha;

	const appLayer = makeAppLayer(dryRun, { runtimeLive });
	yield* innerProgram(inputs, dryRun, headSha, appLayer)
		.pipe(Effect.provideService(References.MinimumLogLevel, effectLogLevel))
		.pipe(
			Effect.timeoutOrElse({
				duration: Duration.seconds(timeout),
				orElse: () => Effect.fail(new Error(`Action timed out after ${timeout} seconds`)),
			}),
		);
});
/* v8 ignore stop */

/**
 * Inner program that runs with all services provided.
 *
 * Every step is named, not numbered — there is no fixed sequence once the
 * package manager, config-dependency and install steps each dispatch on the
 * detected package manager. A step that does not run always logs that it
 * did not, and why: `changesets: false`, "no .changeset/ directory" and
 * "nothing to install" must never look like silence. Decisions (which path a
 * dispatch point took, and on what evidence; a resolution's input range,
 * resolved value, current value and verdict) are logged at info; per-item
 * evidence (registry queries, per-file writes) stays at debug so the info
 * stream reads end to end as a decision log.
 *
 * Exported for testability — `program.inner.test.ts` drives it directly with a
 * fake app layer (mock domain services, the library's in-memory ActionOutputs /
 * CheckRun test layers, and the real upstream WorkspaceRoot /
 * PackageManagerDetector over a temp-dir fixture) and captures the log stream to
 * assert on the decisions above: which package manager each dispatch point
 * routed to, that the install and workspace-format gates opened only when they
 * should, that every skipped step said so with a reason, and that an
 * unsatisfiable `upgrade-package-manager` range warns rather than passing for a
 * routine skip.
 */
export const innerProgram = (
	inputs: InnerProgramInputs,
	dryRun: boolean,
	headSha: string,
	appLayer: ReturnType<typeof makeAppLayer>,
) =>
	// appLayer is provided ONCE, here. There used to be a second provide inside the
	// withCheckRun callback, justified by "the callback signature requires R =
	// never" — that is false against @effected/github: `withCheckRun` is generic in
	// R (`use: (id, conclude) => Effect<A, E, R>` returning `Effect<A, E |
	// GitHubError, R | Repo>`), so the callback inherits the surrounding context
	// like any other effect and the inner provide was redundant wiring built on a
	// stale claim.
	Effect.provide(
		Effect.gen(function* () {
			const outputs = yield* ActionOutputs;
			const checkRunService = yield* CheckRun;
			// The run's log is a step log: four phases, each holding one step per
			// unit of work. A step folds its detail (every info and debug line the
			// step module writes) behind one result line, and writes it unfolded
			// when the step fails. Warnings and errors still go out as annotations
			// the moment they happen.
			//
			// Each phase is opened as `logger.phase(title, Effect.void)` rather than
			// by wrapping its steps: a phase writes its heading when it starts and
			// nothing when it ends, so the output is the same, and the early exits
			// below (foreign commits, failed commands, no changes) can keep
			// returning from this one generator instead of threading a result out
			// of a nested one.
			const logger = yield* ActionLogger;

			// Create check run for visibility
			const checkRunName = dryRun ? "Dependency Updates (Dry Run)" : "Dependency Updates";

			yield* checkRunService.withCheckRun(checkRunName, headSha, (_checkRunId, conclude) =>
				Effect.gen(function* () {
					// Detect the package manager once, up front: every dispatch below
					// (config deps, install, package-manager upgrade) reads this one
					// value. It runs inside withCheckRun — like validateBranches, and
					// for the same reason — so an unsupported workspace (yarn, or no
					// workspace root at all) fails with a check run in the GitHub UI
					// rather than an invisible early exit.
					yield* logger.phase("Setup", Effect.void);
					const { detected, evidence, packageCount } = yield* logger.step(
						"Detect package manager",
						detectPackageManagerStep(),
						{ summary: (r) => `Package manager · ${r.detected.pm} at ${r.detected.root}` },
					);
					const lockfileName = LOCKFILE_NAMES[detected.pm];

					for (const line of runContextLines({
						detected,
						evidence,
						packageCount,
						lockfileName,
						branch: inputs.branch,
						sourceBranch: inputs.sourceBranch,
						targetBranch: inputs.targetBranch,
						dryRun,
						changesets: inputs.changesets,
						runtimeData: inputs.runtimeData,
					})) {
						yield* Effect.logInfo(line);
					}

					// ── git config ──────────────────────────────────────────────────
					// Before ANY status read, and once for the whole run, so this run's
					// change verdict and the commit's contents cannot disagree.
					yield* logger.step("Configure git status", configureStatusStep(detected.root));

					// ── branch ────────────────────────────────────────────────────
					const branchOutcome = yield* logger.step(
						"Prepare branch",
						branchStep(inputs.branch, inputs.sourceBranch, inputs.targetBranch, detected.root),
						{
							summary: (o) =>
								o._tag === "ForeignCommits"
									? `Branch · ${inputs.branch} has ${count(o.commits.length, "foreign commit")}, left as is`
									: `Branch · ${inputs.branch} ready`,
						},
					);
					if (branchOutcome._tag === "ForeignCommits") {
						// Someone else pushed to the update branch (#296). The reset would
						// discard their work, so nothing below runs: the branch and its
						// pull request stay exactly as they are, and the run ends neutral
						// with the reason where a maintainer will look for it.
						const commitList = branchOutcome.commits
							.map((c) => `- \`${c.sha.slice(0, 7)}\` by ${c.authorLogin ?? c.author}: ${c.subject}`)
							.join("\n");
						yield* conclude(
							"neutral",
							CheckRunOutput.make({
								title: "Update branch has commits from someone else",
								summary:
									`\`${inputs.branch}\` has commits this action did not make, and updating it would discard them. ` +
									`No updates were made.\n\n${commitList}\n\n` +
									"Merge or close the pull request, or delete the branch, and the next run updates it again.",
							}),
						);
						yield* outputs.set("has-changes", "false");
						yield* outputs.set("updates-count", "0");
						// Detection succeeded, so the baseline document no longer describes
						// this run; nothing after the branch step ran, so every list is
						// empty because it was never computed.
						yield* emitRunResult(
							buildRunResult({
								hasChanges: false,
								dryRun,
								detected,
								branch: inputs.branch,
								targetBranch: inputs.targetBranch,
								updates: [],
								deltas: [],
								peerIssues: [],
								lockfileChanges: [],
								changesets: [],
								pullRequest: null,
							}),
						);
						return;
					}

					// ── lockfile snapshot (before) ──────────────────────────────────
					// Every step below reads and writes at `detected.root` — the resolved
					// workspace root — not at the process cwd. They are not the same thing:
					// the action can be invoked from a subdirectory of the workspace, and a
					// helper defaulting to `process.cwd()` would then read (and rewrite) the
					// wrong manifests, or none at all.
					yield* logger.phase("Update", Effect.void);
					const lockfileBefore = yield* logger.step(
						"Snapshot lockfile (before)",
						lockfileSnapshotStep("before", detected.pm, detected.root),
					);

					// ── package manager ─────────────────────────────────────────────
					const pmOutcome = yield* logger.step(
						"Upgrade package manager",
						upgradePackageManagerStep(inputs["upgrade-package-manager"], detected.pm, detected.root),
						{
							summary: (r) =>
								r.pin !== null
									? `Package manager · pinned ${r.pin}`
									: `Package manager · ${r.skipReason ?? "already current"}`,
						},
					);
					const configUpdatesFromPackageManager = pmOutcome.updates;
					const pmSkipReason = pmOutcome.skipReason;

					// ── package manager activation ──────────────────────────────────
					// Only when the pin moved. The `PATH` this process inherited leads
					// with the manager the job STARTED on; every spawn below that must
					// see the new one gets this directory prepended. `None` when nothing
					// changed — the inherited manager is then the pinned one already.
					const pmBinDir =
						pmOutcome.pin === null
							? Option.none<string>()
							: yield* logger.step(
									"Activate package manager",
									activatePackageManagerStep(pmOutcome.pin, pmOutcome.integrity),
									{ summary: () => `Activate · ${pmOutcome.pin}` },
								);

					// ── runtimes ─────────────────────────────────────────────────────
					const runtimeUpdates = (yield* logger.step(
						"Upgrade runtimes",
						upgradeRuntimesStep(inputs.runtime, detected.root),
						{ summary: (r) => `Runtimes · ${count(r.updates.length, "update")}` },
					)).updates;

					// ── config dependencies ─────────────────────────────────────────
					const configResult = yield* logger.step(
						"Update config dependencies",
						configDependenciesStep(inputs["config-dependencies"], inputs.dependencies, detected.pm, detected.root),
						{
							summary: (r) =>
								`Config dependencies · ${count(r.updates.length, "update")}, ${count(r.deltas.length, "catalog change")}`,
						},
					);
					const configUpdates = configResult.updates;
					const configDeltas = configResult.deltas;
					yield* Effect.logDebug(`Config dependency updates: ${JSON.stringify(configUpdates)}`);
					if (configDeltas.length > 0) {
						yield* Effect.logDebug(`Catalog deltas: ${JSON.stringify(configDeltas)}`);
					}

					// Assigned by the peer-check step below, which runs only once a PR
					// is actually going to be opened. Declared here rather than inline
					// at each exit path so all three report the SAME value -- the
					// failure exit has already shipped a bug of exactly that shape,
					// reporting `updates: []` for a run that really did update things.
					// The two early exits keep `[]`, which is honest: they open no PR,
					// so nothing was examined and nothing is gated.
					let peerIssues: ReadonlyArray<PeerIssue> = [];
					let withholdAutoMerge = false;

					// ── regular dependencies ────────────────────────────────────────
					const regularUpdates = (yield* logger.step(
						"Update dependencies",
						regularDependenciesStep(inputs.dependencies, inputs["config-dependencies"], detected.pm, detected.root),
						{ summary: (r) => `Dependencies · ${count(r.updates.length, "update")}` },
					)).updates;

					// ── peer sync ────────────────────────────────────────────────────
					const peerResult = yield* logger.step(
						"Sync peer dependencies",
						peerSyncStep({ lock: inputs["peer-lock"], minor: inputs["peer-minor"] }, regularUpdates),
						{
							summary: (r) =>
								r.configured ? `Peer sync · ${count(r.updates.length, "update")}` : "Peer sync · not configured",
						},
					);
					const peerUpdates = peerResult.updates;
					const peerConfigured = peerResult.configured;

					// ── install ──────────────────────────────────────────────────────
					const shouldInstall =
						configUpdates.length > 0 ||
						regularUpdates.length > 0 ||
						configUpdatesFromPackageManager.length > 0 ||
						peerUpdates.length > 0;
					yield* logger.phase("Install", Effect.void);
					yield* logger.step(
						"Install",
						installStep(shouldInstall, detected.pm, detected.root, inputs["retry-unmatched"], pmBinDir),
						{
							summary: () =>
								shouldInstall ? `Install · ${INSTALL_LABEL[detected.pm]}` : "Install · nothing to install",
						},
					);

					// ── workspace formatting ────────────────────────────────────────
					yield* logger.step("Format workspace", formatWorkspaceStep(detected.pm, detected.root));

					// Aggregated HERE, above the custom-commands step, not below it.
					// Every source is already resolved by this point, and the failure
					// exit below has to describe them: a run that updated five
					// dependencies and then failed `pnpm test` did do that work, and a
					// document reporting an empty update set for it is false.
					const allUpdates = [
						...configUpdatesFromPackageManager,
						...runtimeUpdates,
						...configUpdates,
						...regularUpdates,
						...peerUpdates,
					];

					// ── custom commands ─────────────────────────────────────────────
					// The step reports what happened; concluding the check run and
					// publishing outputs stay here, because the run's verdict is a
					// composition concern.
					const commandsResult = yield* logger.step(
						"Run custom commands",
						customCommandsStep(inputs.run, detected.root, pmBinDir),
						{
							summary: (r) =>
								r === null
									? "Custom commands · none configured"
									: `Custom commands · ${r.successful.length} passed, ${r.failed.length} failed`,
						},
					);
					if (commandsResult !== null && commandsResult.failed.length > 0) {
						yield* conclude(
							"failure",
							CheckRunOutput.make({
								title: "Custom Commands Failed",
								summary: `Custom commands failed:\n\n${formatCommandFailures(commandsResult)}`,
							}),
						);

						// `has-changes` is false because nothing was committed and no PR
						// opened — that is what the flag means. `updates-count` reports the
						// updates that DID happen, so it cannot contradict the document
						// below; the two are the same fact, and one path wording it two
						// ways is exactly the drift the single-document design forbids.
						yield* outputs.set("has-changes", "false");
						yield* outputs.set("updates-count", String(allUpdates.length));
						// Re-encode `result` rather than leaving the pre-run baseline in
						// place. Detection HAS succeeded by now, and so have the update
						// steps — a run that bumped five dependencies and then failed
						// `pnpm test` did that work, and the working tree still holds it.
						// Publishing an empty update set here would be a false statement
						// about a run that a consumer is reading precisely to find out
						// what happened before it broke.
						yield* emitRunResult(
							buildRunResult({
								hasChanges: false,
								dryRun,
								detected,
								branch: inputs.branch,
								targetBranch: inputs.targetBranch,
								updates: allUpdates,
								deltas: configDeltas,
								peerIssues,
								// The "after" lockfile snapshot and its comparison run
								// below this exit, so there is genuinely nothing to
								// report here — empty because it was never computed,
								// not because it was discarded.
								lockfileChanges: [],
								changesets: [],
								pullRequest: null,
							}),
						);

						return yield* Effect.fail(new Error(`Custom commands failed: ${failedCommandNames(commandsResult)}`));
					}

					// ── lockfile snapshot (after) ───────────────────────────────────
					yield* logger.phase("Publish", Effect.void);
					const lockfileAfter = yield* logger.step(
						"Snapshot lockfile (after)",
						lockfileSnapshotStep("after", detected.pm, detected.root),
					);

					// ── changes ──────────────────────────────────────────────────────
					const changes = yield* logger.step(
						"Compare lockfiles",
						compareLockfiles(lockfileBefore, lockfileAfter, detected.root),
						{ summary: (c) => `Lockfile · ${count(c.length, "change")}` },
					);
					yield* Effect.logDebug(`Detected changes: ${JSON.stringify(changes)}`);

					yield* Effect.logDebug(
						`Total updates: ${allUpdates.length} (config: ${configUpdates.length + configUpdatesFromPackageManager.length}, dev: ${regularUpdates.length}, peer: ${peerUpdates.length})`,
					);

					const { entries: changedEntries, hasChanges } = yield* logger.step(
						"Detect changes",
						detectChangesStep(detected.root),
						{ summary: (r) => `Working tree · ${count(r.entries.length, "file")} modified` },
					);

					yield* Effect.logInfo(
						`Step: changes — ${allUpdates.length} dependency change(s), ${changes.length} lockfile change(s), ${changedEntries.length} file(s) modified`,
					);

					if (!hasChanges && changes.length === 0) {
						yield* Effect.logInfo(
							"Step: changes — SKIPPED: no changes detected; changesets, commit and pull request steps do not run",
						);

						yield* conclude(
							"neutral",
							CheckRunOutput.make({
								title: "No Updates",
								summary: "No dependency updates available. All dependencies are up-to-date.",
							}),
						);

						yield* outputs.set("has-changes", "false");
						yield* outputs.set("updates-count", "0");
						// Same reasoning as the custom-commands exit: detection succeeded,
						// so the baseline document no longer describes this run. A
						// no-changes run is the case a consumer is MOST likely to inspect
						// programmatically, and "which package manager and root did you
						// find nothing in?" is the first question it would ask.
						yield* emitRunResult(
							buildRunResult({
								hasChanges: false,
								dryRun,
								detected,
								branch: inputs.branch,
								targetBranch: inputs.targetBranch,
								updates: allUpdates,
								deltas: configDeltas,
								peerIssues,
								lockfileChanges: changes,
								changesets: [],
								pullRequest: null,
							}),
						);

						return;
					}

					// ── changesets ───────────────────────────────────────────────────
					const changesetsResult = yield* logger.step(
						"Write changesets",
						changesetsStep(inputs.changesets, inputs.targetBranch, detected.root),
						{
							summary: (r) =>
								r.skipReason !== null
									? `Changesets · skipped: ${r.skipReason}`
									: `Changesets · ${count(r.files.length, "file")} written`,
						},
					);
					const changesetFiles = changesetsResult.files;
					const changesetsSkipReason = changesetsResult.skipReason;

					// ── peer check ───────────────────────────────────────────────────
					// Runs against the "after" snapshot -- the lockfile this PR will
					// carry -- and only on the path that actually opens a PR, so a
					// no-changes run never spawns the config-dependency hook replay.
					const peerCheckResult = yield* logger.step(
						"Check peers",
						peerCheckStep(inputs["check-peers"], lockfileAfter, detected.root, inputs["auto-merge"] !== ""),
						{
							summary: (r) =>
								`Peers · ${count(r.issues.length, "issue")}${r.decision.withhold ? ", auto-merge withheld" : ""}`,
						},
					);
					peerIssues = peerCheckResult.issues;
					withholdAutoMerge = peerCheckResult.decision.withhold;
					// `null` when the check did not run, so the Result block reports it
					// as a skip rather than as a clean pass.
					const peerSummary =
						inputs["check-peers"] === "false"
							? null
							: {
									issues: peerCheckResult.issues.length,
									required: peerCheckResult.requiredCount,
									withheld: peerCheckResult.decision.withhold,
									reason: peerCheckResult.decision.reason,
									unverifiedReasons: peerCheckResult.unverifiedReasons,
								};

					// ── commit and pull request ─────────────────────────────────────
					const { pullRequest: pr } = yield* logger.step(
						dryRun ? "Commit and pull request (dry run)" : "Commit and pull request",
						commitAndPrStep({
							branch: inputs.branch,
							targetBranch: inputs.targetBranch,
							// Withholding is a SEPARATE call being skipped, not a different
							// merge method: the PR still opens, it just cannot merge itself.
							autoMerge: withholdAutoMerge ? "" : inputs["auto-merge"],
							updates: allUpdates,
							changesets: changesetFiles,
							deltas: configDeltas,
							peerIssues,
							peerGate: {
								withheld: withholdAutoMerge,
								reason: peerCheckResult.decision.reason,
								unverifiedReasons: peerCheckResult.unverifiedReasons,
							},
							changedFileCount: changedEntries.length,
							workspaceRoot: detected.root,
							dryRun,
						}),
						{
							summary: (r) =>
								r.pullRequest === null
									? "Pull request · none opened"
									: `Pull request · #${r.pullRequest.number} ${r.pullRequest.url}`,
						},
					);

					// ── Result ───────────────────────────────────────────────────────
					for (const line of resultLines({
						updates: allUpdates,
						deltas: configDeltas,
						packageManagerSkip: pmSkipReason,
						peerConfigured,
						isPnpm: detected.pm === "pnpm",
						customCommandsConfigured: inputs.run.length > 0,
						peers: peerSummary,
						changesetsSkip: changesetsSkipReason,
					})) {
						yield* Effect.logInfo(line);
					}

					// Update check run
					const report = yield* Report;
					const summaryText = report.generateSummary(allUpdates, changesetFiles, pr, dryRun, configDeltas, peerIssues, {
						withheld: withholdAutoMerge,
						reason: peerCheckResult.decision.reason,
						unverifiedReasons: peerCheckResult.unverifiedReasons,
					});
					yield* conclude(
						"success",
						CheckRunOutput.make({
							title: "Dependency Updates Complete",
							summary: summaryText,
						}),
					);

					// Set outputs
					yield* outputs.set("has-changes", "true");
					yield* outputs.set("updates-count", String(allUpdates.length));
					if (pr) {
						yield* outputs.set("pr-number", String(pr.number));
						yield* outputs.set("pr-url", pr.url);
					}
					yield* emitRunResult(
						buildRunResult({
							hasChanges: true,
							dryRun,
							detected,
							branch: inputs.branch,
							targetBranch: inputs.targetBranch,
							updates: allUpdates,
							deltas: configDeltas,
							peerIssues,
							lockfileChanges: changes,
							changesets: changesetFiles,
							pullRequest: pr,
						}),
					);

					// Write job summary
					const jobSummaryLines = ["# Dependency Updates"];
					if (dryRun) {
						jobSummaryLines.push("", "> **DRY RUN MODE** - Changes detected but not committed/pushed");
					}
					jobSummaryLines.push("", summaryText);
					yield* outputs.summary(jobSummaryLines.join("\n"));

					yield* Effect.logInfo("Dependency update action completed successfully");
				}),
			);
		}),
		appLayer,
	);
