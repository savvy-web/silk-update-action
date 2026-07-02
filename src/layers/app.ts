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
import { Changesets as SilkChangesets } from "@savvy-web/silk-effects";
import { Layer } from "effect";
import {
	AutoBunCacheLive,
	AutoDenoCacheLive,
	AutoNodeCacheLive,
	BunResolverLive,
	BunVersionFetcherLive,
	DenoResolverLive,
	DenoVersionFetcherLive,
	GitHubAutoAuth,
	GitHubClientLive,
	NodeResolverLive,
	NodeScheduleFetcherLive,
	NodeVersionFetcherLive,
	OfflineBunCacheLive,
	OfflineDenoCacheLive,
	OfflineNodeCacheLive,
} from "runtime-resolver";
import { WorkspaceDiscoveryLive, WorkspaceRootLive } from "workspaces-effect";

import { BranchManagerLive } from "../services/branch.js";
import { ChangesetsLive } from "../services/changesets.js";
import { ConfigDepsLive } from "../services/config-deps.js";
import { PnpmUpgradeLive } from "../services/pnpm-upgrade.js";
import { RegularDepsLive } from "../services/regular-deps.js";
import { ReportLive } from "../services/report.js";
import { RuntimeUpgradeLive } from "../services/runtime-upgrade.js";

/* v8 ignore start - pure Layer wiring, tested indirectly via service integration tests */

/** Build the three runtime-resolver services, offline (bundled) or live (Auto, falls back to bundled). */
const makeRuntimeResolvers = (live: boolean) => {
	if (!live) {
		return Layer.mergeAll(
			NodeResolverLive.pipe(Layer.provide(OfflineNodeCacheLive)),
			DenoResolverLive.pipe(Layer.provide(OfflineDenoCacheLive)),
			BunResolverLive.pipe(Layer.provide(OfflineBunCacheLive)),
		);
	}
	// Live path: runtime-resolver fetches GitHub/nodejs.org data. Auth comes from
	// GitHubAutoAuth (reads GITHUB_TOKEN / PAT from env); Layer.orDie keeps the E
	// channel `never` (GitHubAutoAuth only fails when GITHUB_APP_* env is set,
	// which this action does not use — it consumes app credentials as inputs).
	// Auto*CacheLive falls back to bundled data on any fetch failure, so an
	// unauthenticated live path still works. Caveat: if a workflow sets GITHUB_APP_*
	// env vars for some other purpose, the orDie defect fires at layer-construction
	// time and would escape program.ts's Effect.catchAll (before any fallback can
	// engage). Acceptable because runtime-data: live is opt-in; revisit orDie if
	// that constraint changes.
	const githubLayer = GitHubClientLive.pipe(Layer.provide(GitHubAutoAuth), Layer.orDie);
	const nodeFetchers = Layer.merge(
		NodeVersionFetcherLive.pipe(Layer.provide(githubLayer)),
		NodeScheduleFetcherLive.pipe(Layer.provide(githubLayer)),
	);
	return Layer.mergeAll(
		NodeResolverLive.pipe(Layer.provide(AutoNodeCacheLive.pipe(Layer.provide(nodeFetchers)))),
		DenoResolverLive.pipe(
			Layer.provide(AutoDenoCacheLive.pipe(Layer.provide(DenoVersionFetcherLive.pipe(Layer.provide(githubLayer))))),
		),
		BunResolverLive.pipe(
			Layer.provide(AutoBunCacheLive.pipe(Layer.provide(BunVersionFetcherLive.pipe(Layer.provide(githubLayer))))),
		),
	);
};

export const makeAppLayer = (dryRun: boolean, options: { runtimeLive: boolean } = { runtimeLive: false }) => {
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

	// DepsRegen (from @savvy-web/silk-effects) is the source of truth for
	// dependency changesets. DepsRegenDefault is the batteries-included layer: it
	// bundles the point-in-time workspace reader, ConfigInspector, WorkspaceDiscovery,
	// silk's adaptive PublishabilityDetector, and ChangesetConfig internally, so its
	// gating is silk "versionable-minus-ignored" and the only residual requirements
	// are the platform services (FileSystem/Path/CommandExecutor from NodeContext).
	const depsRegen = SilkChangesets.DepsRegenDefault.pipe(Layer.provide(platform));

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
		ChangesetsLive.pipe(Layer.provide(depsRegen)),
		BranchManagerLive.pipe(Layer.provide(Layer.mergeAll(gitBranch, gitCommit, CommandRunnerLive))),
		PnpmUpgradeLive.pipe(Layer.provide(CommandRunnerLive)),
		ConfigDepsLive.pipe(Layer.provide(npmRegistry)),
		RegularDepsLive.pipe(Layer.provide(Layer.merge(npmRegistry, workspaceDiscovery))),
		ReportLive.pipe(Layer.provide(prLayer)),
		RuntimeUpgradeLive.pipe(Layer.provide(makeRuntimeResolvers(options.runtimeLive))),
	);

	return Layer.provideMerge(domainLayers, libraryLayers);
};
/* v8 ignore stop */
