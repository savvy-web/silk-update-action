/**
 * Application layer composition.
 *
 * Wires library layers and domain service layers together.
 *
 * @module layers/app
 */

import { NodeContext } from "@effect/platform-node";
import {
	ActionStateLive,
	CheckRunLive,
	CommandRunnerLive,
	DryRunLive,
	GitBranchLive,
	GitCommitLive,
	GitHubGraphQLLive,
	GitHubToken,
	NpmRegistryLive,
	PullRequestLive,
} from "@savvy-web/github-action-effects";
import { Layer } from "effect";
import { WorkspaceDiscoveryLive, WorkspaceRootLive } from "workspaces-effect";

import { BranchManagerLive } from "../services/branch.js";
import { ChangesetConfigLive } from "../services/changeset-config.js";
import { ChangesetsLive } from "../services/changesets.js";
import { ConfigDepsLive } from "../services/config-deps.js";
import { PnpmUpgradeLive } from "../services/pnpm-upgrade.js";
import { PublishabilityDetectorAdaptiveLive } from "../services/publishability.js";
import { RegularDepsLive } from "../services/regular-deps.js";
import { ReportLive } from "../services/report.js";

/* v8 ignore start - pure Layer wiring, tested indirectly via service integration tests */
export const makeAppLayer = (dryRun: boolean) => {
	// The GitHub App installation token is provisioned in the pre phase and
	// persisted to ActionState. GitHubToken.client() reads it back and builds a
	// GitHubClient — no process.env.GITHUB_TOKEN bridge. ActionState is provided
	// here (backed by NodeContext's FileSystem) so the layer is self-contained
	// and the withCheckRun callback's R = never requirement holds; Layer.orDie
	// turns a missing/unreadable token into a fatal defect.
	const actionState = ActionStateLive.pipe(Layer.provide(NodeContext.layer));
	const githubClient = GitHubToken.client().pipe(Layer.provide(actionState), Layer.orDie);

	const ghGraphql = GitHubGraphQLLive.pipe(Layer.provide(githubClient));
	const npmRegistry = NpmRegistryLive.pipe(Layer.provide(CommandRunnerLive));
	const gitBranch = GitBranchLive.pipe(Layer.provide(githubClient));
	const gitCommit = GitCommitLive.pipe(Layer.provide(githubClient));
	const prLayer = PullRequestLive.pipe(Layer.provide(Layer.merge(githubClient, ghGraphql)));

	// Platform layer (FileSystem, Path) for workspaces-effect's WorkspaceDiscovery.
	const platform = NodeContext.layer;
	const workspaceRoot = WorkspaceRootLive.pipe(Layer.provide(platform));
	const workspaceDiscovery = WorkspaceDiscoveryLive.pipe(Layer.provide(Layer.merge(workspaceRoot, platform)));

	// ChangesetConfigLive (silk-effects, FileSystem-backed via its reader) and the
	// adaptive detector both require a platform FileSystem; provide the existing
	// `platform` (NodeContext.layer) here.
	const changesetConfig = ChangesetConfigLive.pipe(Layer.provide(platform));
	// PublishabilityDetectorAdaptiveLive overrides PublishabilityDetector and
	// reads ChangesetConfig.mode per-call to dispatch to silk/vanilla/noop.
	const publishabilityDetector = PublishabilityDetectorAdaptiveLive.pipe(
		Layer.provide(Layer.merge(changesetConfig, platform)),
	);

	const libraryLayers = Layer.mergeAll(
		githubClient,
		gitBranch,
		gitCommit,
		CheckRunLive.pipe(Layer.provide(githubClient)),
		prLayer,
		npmRegistry,
		CommandRunnerLive,
		DryRunLive(dryRun),
	);

	const domainLayers = Layer.mergeAll(
		workspaceDiscovery,
		changesetConfig,
		publishabilityDetector,
		ChangesetsLive.pipe(Layer.provide(Layer.mergeAll(workspaceDiscovery, publishabilityDetector, changesetConfig))),
		BranchManagerLive.pipe(Layer.provide(Layer.mergeAll(gitBranch, gitCommit, CommandRunnerLive))),
		PnpmUpgradeLive.pipe(Layer.provide(CommandRunnerLive)),
		ConfigDepsLive.pipe(Layer.provide(npmRegistry)),
		RegularDepsLive.pipe(Layer.provide(Layer.merge(npmRegistry, workspaceDiscovery))),
		ReportLive.pipe(Layer.provide(prLayer)),
	);

	return Layer.provideMerge(domainLayers, libraryLayers);
};
/* v8 ignore stop */
