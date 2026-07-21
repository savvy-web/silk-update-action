/**
 * Application layer composition.
 *
 * Wires library layers and domain service layers together.
 *
 * @module layers/app
 */

import { NodeServices } from "@effect/platform-node";
import { BunResolver, DenoResolver, NodeResolver, GitHubClient as RuntimesGitHubClient } from "@effected/runtimes";
import { LockfileReader, PackageManagerDetector, WorkspaceDiscovery, WorkspaceRoot } from "@effected/workspaces";
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
import { FetchHttpClient } from "effect/unstable/http";

import { BranchManagerLive } from "../services/branch.js";
import { CatalogConfigDepsLive } from "../services/catalog-config-deps.js";
import { ChangesetsLive } from "../services/changesets.js";
import { ConfigDepsLive } from "../services/config-deps.js";
import { PackageManagerUpgradeLive } from "../services/package-manager-upgrade.js";
import { RegularDepsLive } from "../services/regular-deps.js";
import { ReleaseAgeLive } from "../services/release-age.js";
import { ReportLive } from "../services/report.js";
import { RuntimeUpgradeLive } from "../services/runtime-upgrade.js";

/* v8 ignore start - pure Layer wiring, tested indirectly via service integration tests */

/** Build the three @effected/runtimes resolver services, offline (bundled snapshot) or live (feed, falls back to snapshot). */
const makeRuntimeResolvers = (live: boolean) => {
	if (!live) {
		// The bundled offline snapshot: no IO, no requirements.
		return Layer.mergeAll(NodeResolver.layerOffline, DenoResolver.layerOffline, BunResolver.layerOffline);
	}
	// Live path: NodeResolver reads nodejs.org (unauthenticated, needs only an
	// HttpClient); Bun/Deno read GitHub releases through the authenticated seam.
	// GitHubClient.layerDefault pre-wires GitHubAuth.layerConfig + FetchHttpClient,
	// so the live graph is self-contained (E = never). Each resolver's `.layer`
	// falls back to the bundled snapshot on any fetch failure (logging a warning).
	const github = RuntimesGitHubClient.layerDefault;
	return Layer.mergeAll(
		NodeResolver.layer.pipe(Layer.provide(FetchHttpClient.layer)),
		DenoResolver.layer.pipe(Layer.provide(github)),
		BunResolver.layer.pipe(Layer.provide(github)),
	);
};

export const makeAppLayer = (dryRun: boolean, options: { runtimeLive: boolean } = { runtimeLive: false }) => {
	// The GitHub App installation token is provisioned in the pre phase and
	// persisted to ActionState. GitHubToken.client() reads it back and builds a
	// GitHubClient — no process.env.GITHUB_TOKEN bridge. ActionState is provided
	// here (backed by NodeContext's FileSystem) so the layer is self-contained
	// and the withCheckRun callback's R = never requirement holds; Layer.orDie
	// turns a missing/unreadable token into a fatal defect.
	const actionState = ActionStateLive.pipe(Layer.provide(NodeServices.layer));
	const githubClient = GitHubToken.client().pipe(Layer.provide(actionState), Layer.orDie);

	const ghGraphql = GitHubGraphQLLive.pipe(Layer.provide(githubClient));
	const npmRegistry = NpmRegistryLive.pipe(Layer.provide(CommandRunnerLive));
	// Effective pnpm minimumReleaseAge gate (inline pnpm-workspace.yaml keys +
	// config-dependency hook replay), applied by ConfigDeps/RegularDeps before
	// version resolution. Inert when the workspace declares no gate.
	const releaseAge = ReleaseAgeLive().pipe(Layer.provide(CommandRunnerLive));
	const gitBranch = GitBranchLive.pipe(Layer.provide(githubClient));
	const gitCommit = GitCommitLive.pipe(Layer.provide(githubClient));
	const prLayer = PullRequestLive.pipe(Layer.provide(Layer.merge(githubClient, ghGraphql)));

	// Platform layer (FileSystem, Path, ChildProcessSpawner, …) for @effected/workspaces.
	const platform = NodeServices.layer;
	const workspaceRoot = WorkspaceRoot.layer.pipe(Layer.provide(platform));
	const workspaceDiscovery = WorkspaceDiscovery.layer().pipe(Layer.provide(Layer.merge(workspaceRoot, platform)));
	const packageManagerDetector = PackageManagerDetector.layer.pipe(Layer.provide(platform));
	// The lockfile is the record of which config-dependency version is actually
	// installed — the merge base for CatalogConfigDeps' three-way catalog merge.
	// @effected/workspaces' LockfileReader also depends on WorkspaceDiscovery.
	const lockfileReader = LockfileReader.layer().pipe(
		Layer.provide(Layer.mergeAll(workspaceRoot, packageManagerDetector, workspaceDiscovery, platform)),
	);

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
		FetchHttpClient.layer,
	);

	const domainLayers = Layer.mergeAll(
		workspaceRoot,
		workspaceDiscovery,
		packageManagerDetector,
		ChangesetsLive.pipe(Layer.provide(depsRegen)),
		BranchManagerLive.pipe(Layer.provide(Layer.mergeAll(gitBranch, gitCommit, CommandRunnerLive))),
		PackageManagerUpgradeLive.pipe(Layer.provide(npmRegistry)),
		ConfigDepsLive.pipe(Layer.provide(Layer.merge(npmRegistry, releaseAge))),
		CatalogConfigDepsLive.pipe(
			Layer.provide(Layer.mergeAll(npmRegistry, lockfileReader, FetchHttpClient.layer, CommandRunnerLive)),
		),
		RegularDepsLive.pipe(Layer.provide(Layer.mergeAll(npmRegistry, workspaceDiscovery, releaseAge))),
		ReportLive.pipe(Layer.provide(prLayer)),
		RuntimeUpgradeLive.pipe(Layer.provide(makeRuntimeResolvers(options.runtimeLive))),
	);

	return Layer.provideMerge(domainLayers, libraryLayers);
};
/* v8 ignore stop */
