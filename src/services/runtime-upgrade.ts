/**
 * RuntimeUpgrade service for devEngines.runtime upgrades.
 *
 * Reads the root package.json, resolves the latest version satisfying a target
 * range (per runtime) via runtime-resolver, re-decorates with the caller's
 * operator, and writes back — preserving the object/array shape of
 * devEngines.runtime. Mirrors PnpmUpgrade; resolver failures are caught and
 * skipped per-runtime, never fatal.
 *
 * @module services/runtime-upgrade
 */

import { readFileSync, writeFileSync } from "node:fs";
import { Context, Effect, Layer } from "effect";
import { BunResolver, DenoResolver, NodeResolver } from "runtime-resolver";

import { FileSystemError } from "../errors/errors.js";
import { detectIndent } from "../utils/pnpm.js";
import type { RuntimeName } from "../utils/runtime.js";
import {
	findRuntimeEntry,
	isStaticVersion,
	parseRuntimeOperator,
	redecorateVersion,
	upsertRuntimeEntry,
} from "../utils/runtime.js";

type NodeResolverShape = Context.Tag.Service<typeof NodeResolver>;
type DenoResolverShape = Context.Tag.Service<typeof DenoResolver>;
type BunResolverShape = Context.Tag.Service<typeof BunResolver>;

// ── Types ─────────────────────────────────────────────────────────────────────

/** Result of a single runtime upgrade. */
export interface RuntimeUpgradeResult {
	readonly runtime: RuntimeName;
	readonly from: string | null;
	readonly to: string;
	readonly added: boolean;
}

/** Per-runtime mode: "false" | "auto" | a semver range. */
export interface RuntimeUpgradeConfig {
	readonly node: string;
	readonly deno: string;
	readonly bun: string;
}

// ── Service ───────────────────────────────────────────────────────────────────

export class RuntimeUpgrade extends Context.Tag("RuntimeUpgrade")<
	RuntimeUpgrade,
	{
		readonly upgrade: (
			config: RuntimeUpgradeConfig,
			workspaceRoot?: string,
		) => Effect.Effect<readonly RuntimeUpgradeResult[], FileSystemError>;
	}
>() {}

export const RuntimeUpgradeLive = Layer.effect(
	RuntimeUpgrade,
	Effect.gen(function* () {
		const node = yield* NodeResolver;
		const deno = yield* DenoResolver;
		const bun = yield* BunResolver;
		return {
			upgrade: (config, workspaceRoot = process.cwd()) => upgradeImpl({ node, deno, bun }, config, workspaceRoot),
		};
	}),
);

// ── Implementation ──────────────────────────────────────────────────────────────

const fsReadError = (path: string, e: unknown) => new FileSystemError({ operation: "read", path, reason: String(e) });
const fsWriteError = (path: string, e: unknown) => new FileSystemError({ operation: "write", path, reason: String(e) });

interface Resolvers {
	readonly node: NodeResolverShape;
	readonly deno: DenoResolverShape;
	readonly bun: BunResolverShape;
}

/** Resolve `.latest` for a target range; null on any resolver failure (logged). */
const resolveLatest = (
	resolver: { resolve: (o?: { semverRange?: string }) => Effect.Effect<{ latest: string; source: string }, unknown> },
	runtime: RuntimeName,
	semverRange: string,
): Effect.Effect<string | null, never> =>
	resolver.resolve({ semverRange }).pipe(
		// Note: r.source ("api"/"cache") is runtime-resolver's data-origin label on
		// the snapshot, not a live-fetch indicator — the offline cache reports
		// "api" without any network call — so it is deliberately not logged here.
		Effect.tap((r) => Effect.logInfo(`Resolved ${runtime} ${semverRange} -> ${r.latest}`)),
		Effect.map((r) => r.latest as string | null),
		Effect.catchAll((e) =>
			Effect.as(Effect.logWarning(`Could not resolve ${runtime} for range "${semverRange}": ${String(e)}`), null),
		),
	);

const upgradeOne = (
	resolver: { resolve: (o?: { semverRange?: string }) => Effect.Effect<{ latest: string; source: string }, unknown> },
	runtime: RuntimeName,
	mode: string,
	pkgJson: Record<string, unknown>,
): Effect.Effect<RuntimeUpgradeResult | null, never> =>
	Effect.gen(function* () {
		if (mode === "false") return null;

		const entry = findRuntimeEntry(pkgJson.devEngines, runtime);
		let targetRange: string;
		let operator: string;

		if (mode === "auto") {
			if (!entry?.version) {
				yield* Effect.logWarning(
					`upgrade-runtime-${runtime}: auto requested but no devEngines.runtime entry found, skipping`,
				);
				return null;
			}
			if (isStaticVersion(entry.version)) {
				yield* Effect.logInfo(`${runtime} is pinned to ${entry.version}, auto leaves it unchanged`);
				return null;
			}
			targetRange = entry.version;
			operator = parseRuntimeOperator(entry.version);
		} else {
			// The explicit range selects which line to resolve; the OUTPUT operator
			// follows the existing entry so its pattern is preserved (an exact pin
			// stays exact, a caret stays caret). Only when adding a brand-new entry
			// do we fall back to the operator the user typed in the range.
			targetRange = mode;
			operator = entry?.version !== undefined ? parseRuntimeOperator(entry.version) : parseRuntimeOperator(mode);
		}

		const resolved = yield* resolveLatest(resolver, runtime, targetRange);
		if (resolved === null) return null;

		const newVersion = redecorateVersion(resolved, operator);
		const from = entry?.version ?? null;
		if (from !== null && newVersion === from) {
			yield* Effect.logInfo(`${runtime} ${from} is already current`);
			return null;
		}

		const { added } = upsertRuntimeEntry(pkgJson, runtime, newVersion);
		return { runtime, from, to: newVersion, added };
	});

const upgradeImpl = (
	resolvers: Resolvers,
	config: RuntimeUpgradeConfig,
	workspaceRoot: string,
): Effect.Effect<readonly RuntimeUpgradeResult[], FileSystemError> =>
	Effect.gen(function* () {
		const packageJsonPath = `${workspaceRoot}/package.json`;

		const raw = yield* Effect.try({
			try: () => readFileSync(packageJsonPath, "utf-8"),
			catch: (e) => fsReadError(packageJsonPath, e),
		});
		const pkgJson = yield* Effect.try({
			try: () => JSON.parse(raw) as Record<string, unknown>,
			catch: (e) => fsReadError(packageJsonPath, `Invalid JSON: ${e}`),
		});
		const indent = detectIndent(raw);

		const plan: ReadonlyArray<[RuntimeName, Resolvers[keyof Resolvers], string]> = [
			["node", resolvers.node, config.node],
			["deno", resolvers.deno, config.deno],
			["bun", resolvers.bun, config.bun],
		];

		const results: RuntimeUpgradeResult[] = [];
		for (const [runtime, resolver, mode] of plan) {
			const result = yield* upgradeOne(resolver, runtime, mode, pkgJson);
			if (result) results.push(result);
		}

		if (results.length > 0) {
			yield* Effect.try({
				try: () => writeFileSync(packageJsonPath, `${JSON.stringify(pkgJson, null, indent)}\n`, "utf-8"),
				catch: (e) => fsWriteError(packageJsonPath, e),
			});
		}

		return results;
	});
