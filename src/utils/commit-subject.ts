import type { DependencyUpdateResult } from "../schemas/domain.js";
import type { RuntimeName } from "./runtime.js";

/**
 * Build the conventional-commit subject line for a dependency-update run.
 *
 * Returns the full subject including the `chore(deps): ` prefix. The same
 * string is used for both the PR title (which becomes the squash-commit subject
 * on the default branch) and the branch commit subject, so a reader can tell
 * runs apart from the history alone instead of a uniform "Update Silk
 * Dependencies".
 *
 * Resolution is first-match-wins over the run's contents, partitioned into four
 * buckets — the package manager (pnpm), runtime engines (node/deno/bun), pnpm
 * config dependencies, and regular dependencies. A single change is named
 * outright; a single category is summarized; a mix is composed into an
 * `upgrade … , update …` shape. Anything that cannot be summarized within the
 * 72-character header budget falls back to a safe generic subject.
 */
export const buildUpdateSubject = (updates: ReadonlyArray<DependencyUpdateResult>): string => {
	const subject = `${PREFIX}${resolveSubject(updates)}`;
	// Global header-budget guard: any subject that overflows (a long scoped
	// package name, an unexpectedly long version) degrades to the safe default
	// rather than emitting an over-long, lint-violating subject.
	return subject.length <= HEADER_MAX ? subject : `${PREFIX}${FALLBACK}`;
};

/**
 * Strip a leading range operator (`^`, `~`, `>=`, …) and any `+build` suffix so
 * the subject shows a clean version — `^24.16.0` -> `24.16.0`,
 * `11.7.0+sha512.abc` -> `11.7.0`.
 */
const displayVersion = (raw: string): string => raw.replace(/^[\s^~>=<]+/, "").split("+")[0];

const PREFIX = "chore(deps): ";
const FALLBACK = "update dependencies";
const HEADER_MAX = 72;

const DEP_TYPES = new Set<DependencyUpdateResult["type"]>([
	"dependency",
	"devDependency",
	"peerDependency",
	"optionalDependency",
]);

/** Canonical display order + casing for runtime engines. */
const RUNTIME_ORDER: ReadonlyArray<RuntimeName> = ["node", "deno", "bun"];
const RUNTIME_LABEL: Record<RuntimeName, string> = { node: "Node", deno: "Deno", bun: "Bun" };

const resolveSubject = (updates: ReadonlyArray<DependencyUpdateResult>): string => {
	const pm = updates.find((u) => u.type === "config" && u.dependency === "pnpm") ?? null;
	const runtimes = RUNTIME_ORDER.filter((r) => updates.some((u) => u.type === "runtime" && u.dependency === r));
	const config = updates.filter((u) => u.type === "config" && u.dependency !== "pnpm");
	const deps = updates.filter((u) => DEP_TYPES.has(u.type));

	const configNames = distinct(config.map((u) => u.dependency));
	const depNames = distinct(deps.map((u) => u.dependency));
	const total = (pm ? 1 : 0) + runtimes.length + configNames.length + depNames.length;

	// Rule 10: nothing to describe.
	if (total === 0) return FALLBACK;

	// Rules 1-4: a single distinct change — name it.
	if (total === 1) {
		if (pm) return `upgrade pnpm to ${displayVersion(pm.to)}`;
		if (runtimes.length === 1) {
			return `upgrade ${RUNTIME_LABEL[runtimes[0]]} to ${displayVersion(runtimeTo(updates, runtimes[0]))}`;
		}
		if (configNames.length === 1) return `bump ${configNames[0]} to ${displayVersion(config[0].to)}`;
		return `bump ${depNames[0]} to ${displayVersion(deps[0].to)}`;
	}

	const buckets =
		(pm ? 1 : 0) + (runtimes.length > 0 ? 1 : 0) + (configNames.length > 0 ? 1 : 0) + (depNames.length > 0 ? 1 : 0);

	// Rules 5-8: a single category with several items.
	if (buckets === 1) {
		if (runtimes.length > 0) return `upgrade ${joinAnd(runtimes.map((r) => RUNTIME_LABEL[r]))}`;
		if (configNames.length > 0) return `update ${configNames.length} config dependencies`;
		const sharedWorkspace = singleWorkspace(deps);
		if (sharedWorkspace) return `update dependencies in ${sharedWorkspace}`;
		return `update ${depNames.length} dependencies`;
	}

	// Rule 9: mixed categories — compose. The global guard in buildUpdateSubject
	// degrades an over-budget composition to the default.
	return compose(pm, runtimes, configNames.length, depNames.length);
};

const compose = (
	pm: DependencyUpdateResult | null,
	runtimes: ReadonlyArray<RuntimeName>,
	configCount: number,
	depCount: number,
): string => {
	const clauses: string[] = [];

	const upgradeTargets = [...(pm ? ["pnpm"] : []), ...runtimes.map((r) => RUNTIME_LABEL[r])];
	if (upgradeTargets.length > 0) clauses.push(`upgrade ${joinAnd(upgradeTargets)}`);

	const updateClause = updatePhrase(configCount, depCount);
	if (updateClause) clauses.push(updateClause);

	if (clauses.length === 1) return clauses[0];
	// Use a comma when a clause is already compound ("upgrade pnpm and Node"),
	// otherwise "and" reads more naturally ("upgrade pnpm and update 6 …").
	const separator = clauses.some((c) => c.includes(" and ")) ? ", " : " and ";
	return clauses.join(separator);
};

/** "update 4 config and 6 dependencies", or either half alone. */
const updatePhrase = (configCount: number, depCount: number): string | null => {
	if (configCount === 0 && depCount === 0) return null;
	if (configCount > 0 && depCount > 0) return `update ${configCount} config and ${pluralize(depCount)}`;
	if (configCount > 0) return `update ${configCount} config ${noun(configCount)}`;
	return `update ${pluralize(depCount)}`;
};

const pluralize = (n: number): string => `${n} ${noun(n)}`;
const noun = (n: number): string => (n === 1 ? "dependency" : "dependencies");

/** The single non-null workspace shared by every dep, or null otherwise. */
const singleWorkspace = (deps: ReadonlyArray<DependencyUpdateResult>): string | null => {
	const packages = distinct(deps.map((u) => u.package).filter((p): p is string => p !== null));
	const hasRoot = deps.some((u) => u.package === null);
	return !hasRoot && packages.length === 1 ? packages[0] : null;
};

const runtimeTo = (updates: ReadonlyArray<DependencyUpdateResult>, runtime: RuntimeName): string =>
	updates.find((u) => u.type === "runtime" && u.dependency === runtime)?.to ?? "";

const distinct = (values: ReadonlyArray<string>): string[] => [...new Set(values)];

const joinAnd = (items: ReadonlyArray<string>): string => {
	if (items.length <= 1) return items[0] ?? "";
	if (items.length === 2) return `${items[0]} and ${items[1]}`;
	return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
};
