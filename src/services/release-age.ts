/**
 * Release-age gate discovery and publish-time helpers.
 *
 * pnpm's `minimumReleaseAge` / `minimumReleaseAgeExclude` settings reject
 * versions published inside the cutoff window at install time
 * (`ERR_PNPM_NO_MATURE_MATCHING_VERSION`). The action mirrors that gate at
 * resolution time so it never proposes a version pnpm would refuse to
 * install. The effective settings come from two sources:
 *
 * - inline keys in `pnpm-workspace.yaml` (`readInlineReleaseAge`), and
 * - config-dependency `pnpmfile` `updateConfig` hooks
 *   (`replayHookReleaseAge`) — pnpm does not replay hooks for
 *   `pnpm config get`, so repos that receive the settings via a config
 *   dependency (e.g. `@savvy-web/pnpm-plugin-silk`) can only be read by
 *   replaying the hooks.
 *
 * The replay runs in a `node` subprocess via `CommandRunner` rather than an
 * in-process dynamic `import()`: the rspack bundle miscompiles a computed
 * dynamic import into a context module (see the `action.config.ts` note on
 * `nativeDynamicImports`), and a subprocess also keeps config-dependency code
 * out of the action's own process. Discovery is best-effort by design — any
 * failure degrades to "no gate" (today's behavior) with a warning rather
 * than failing the run.
 *
 * Combining the two sources, exclude matching, and version filtering are
 * deliberately NOT implemented here — that vocabulary is being ported
 * upstream into `@effected/npm` (see the dogfood loop with
 * `savvy-web-systems`) and this module's `PartialReleaseAgeGate` matches its
 * requested `PartialGate` shape for drop-in adoption.
 *
 * @module services/release-age
 */

import { tmpdir } from "node:os";
import { join } from "node:path";
import { CommandRunner } from "@savvy-web/github-action-effects";
import { Effect } from "effect";

import type { FileSystemError } from "../errors/errors.js";
import { readWorkspaceYaml } from "./workspace-yaml.js";

/**
 * One source's contribution to the release-age gate; absent fields
 * contribute nothing. Matches the `PartialGate` shape requested from
 * `@effected/npm` so the kit's combine can consume these directly.
 */
export interface PartialReleaseAgeGate {
	readonly ageMinutes?: number;
	readonly exclude?: readonly string[];
}

/**
 * The same runner-writable npm cache the library's `NpmRegistryLive` uses,
 * sidestepping the partially root-owned `~/.npm` on GitHub macOS runners.
 */
const npmCacheArgs = (): string[] => ["--cache", join(process.env.RUNNER_TEMP ?? tmpdir(), "silk-npm-cache")];

/**
 * Build a gate from raw `minimumReleaseAge` / `minimumReleaseAgeExclude`
 * values, or `null` when neither is usable.
 */
const gateFrom = (age: unknown, exclude: unknown): PartialReleaseAgeGate | null => {
	const out: { ageMinutes?: number; exclude?: readonly string[] } = {};
	if (typeof age === "number" && Number.isFinite(age)) {
		out.ageMinutes = age;
	}
	if (Array.isArray(exclude)) {
		const patterns = exclude.filter((entry): entry is string => typeof entry === "string");
		if (patterns.length > 0) {
			out.exclude = patterns;
		}
	}
	return out.ageMinutes === undefined && out.exclude === undefined ? null : out;
};

/**
 * Read the release-age gate declared inline in `pnpm-workspace.yaml`.
 *
 * @param workspaceRoot - Workspace root (defaults to cwd)
 * @returns The inline gate values, or `null` when neither key is declared
 */
export const readInlineReleaseAge = (
	workspaceRoot: string = process.cwd(),
): Effect.Effect<PartialReleaseAgeGate | null, FileSystemError> =>
	Effect.gen(function* () {
		const content = yield* readWorkspaceYaml(workspaceRoot);
		if (content === null) {
			return null;
		}
		return gateFrom(content.minimumReleaseAge, content.minimumReleaseAgeExclude);
	});

/**
 * The subprocess program that replays config-dependency `updateConfig` hooks
 * and prints the release-age slice of the resulting config as JSON.
 *
 * Receives the workspace root and the config-dependency names as argv (never
 * string-interpolated — `CommandRunner.execCapture` spawns without a shell).
 * Mirrors pnpm 11's loader order (`pnpmfile.mjs` first, `pnpmfile.cjs`
 * fallback) and tolerates every per-dependency failure: a dependency whose
 * pnpmfile is missing, fails to load, or throws contributes nothing. This is
 * lenient where `@effected/workspaces`' `ConfigDependencyHooks` fails typed,
 * because discovery here is best-effort — a lost gate degrades to today's
 * behavior instead of failing the run.
 */
const REPLAY_SCRIPT = `
const [root, ...names] = process.argv.slice(1);
const { pathToFileURL } = await import("node:url");
const { join } = await import("node:path");
let config = { catalog: {}, catalogs: {} };
for (const name of names) {
	let mod;
	for (const filename of ["pnpmfile.mjs", "pnpmfile.cjs"]) {
		try {
			mod = await import(pathToFileURL(join(root, "node_modules", ".pnpm-config", name, filename)).href);
			break;
		} catch {}
	}
	if (!mod) continue;
	const candidates = [mod, mod.default].filter((m) => m && typeof m === "object");
	let hook;
	for (const candidate of candidates) {
		if (candidate.hooks && typeof candidate.hooks.updateConfig === "function") {
			hook = candidate.hooks.updateConfig;
			break;
		}
		if (typeof candidate.updateConfig === "function") {
			hook = candidate.updateConfig;
			break;
		}
	}
	if (!hook) continue;
	try {
		const next = await hook(config);
		if (next && typeof next === "object") config = next;
	} catch {}
}
process.stdout.write(JSON.stringify({
	minimumReleaseAge: config.minimumReleaseAge,
	minimumReleaseAgeExclude: config.minimumReleaseAgeExclude,
}));
`;

/**
 * Replay the workspace's config-dependency `updateConfig` hooks in a `node`
 * subprocess and read the release-age gate they inject.
 *
 * @param workspaceRoot - Workspace root (defaults to cwd)
 * @returns The hook-injected gate values, or `null` when there are no config
 *   dependencies, no hook sets the keys, or the replay fails (best-effort)
 */
export const replayHookReleaseAge = (
	workspaceRoot: string = process.cwd(),
): Effect.Effect<PartialReleaseAgeGate | null, never, CommandRunner> =>
	Effect.gen(function* () {
		const content = yield* readWorkspaceYaml(workspaceRoot).pipe(Effect.catch(() => Effect.succeed(null)));
		const configDependencies = content?.configDependencies ?? {};
		// A `..` path segment would escape node_modules/.pnpm-config — skip it.
		const names = Object.keys(configDependencies).filter((name) => !name.split(/[/\\]/).includes(".."));
		if (names.length === 0) {
			return null;
		}

		const runner = yield* CommandRunner;
		const result = yield* runner
			.execCapture("node", ["--input-type=module", "-e", REPLAY_SCRIPT, workspaceRoot, ...names])
			.pipe(Effect.catch(() => Effect.succeed(null)));
		if (result === null) {
			yield* Effect.logWarning("Config-dependency hook replay failed; release-age gate from hooks unavailable");
			return null;
		}

		const parsed = yield* Effect.try({
			try: () => JSON.parse(result.stdout) as { minimumReleaseAge?: unknown; minimumReleaseAgeExclude?: unknown },
			catch: () => null,
		}).pipe(Effect.catch(() => Effect.succeed(null)));
		if (parsed === null) {
			yield* Effect.logWarning("Config-dependency hook replay produced unparseable output; ignoring");
			return null;
		}

		return gateFrom(parsed.minimumReleaseAge, parsed.minimumReleaseAgeExclude);
	});

/**
 * Fetch a package's publish timestamps from the npm registry
 * (`npm view <pkg> time --json`), keyed by version.
 *
 * Best-effort: a failed query or unparseable output yields an empty record,
 * which downstream filtering treats as "no timestamp data" for every
 * version. The registry's non-version `created` / `modified` entries are
 * dropped.
 *
 * @param pkg - Package name
 * @returns Version → ISO-8601 publish timestamp record
 */
export const getPublishTimes = (pkg: string): Effect.Effect<Record<string, string>, never, CommandRunner> =>
	Effect.gen(function* () {
		const runner = yield* CommandRunner;
		const result = yield* runner
			.execCapture("npm", ["view", pkg, "time", "--json", ...npmCacheArgs()])
			.pipe(Effect.catch(() => Effect.succeed(null)));
		if (result === null) {
			yield* Effect.logWarning(`Failed to fetch publish times for ${pkg}; release-age filtering unavailable`);
			return {};
		}

		const parsed = yield* Effect.try({
			try: () => JSON.parse(result.stdout) as Record<string, unknown>,
			catch: () => null,
		}).pipe(Effect.catch(() => Effect.succeed(null)));
		if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
			yield* Effect.logWarning(`Unparseable publish-time data for ${pkg}; release-age filtering unavailable`);
			return {};
		}

		const times: Record<string, string> = {};
		for (const [key, value] of Object.entries(parsed)) {
			if (key !== "created" && key !== "modified" && typeof value === "string") {
				times[key] = value;
			}
		}
		return times;
	});
