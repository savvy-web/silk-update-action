import { defineConfig } from "vitest/config";

// TEMPORARY (Effect v4 migration): @vitest-agent/plugin@1.1.9 (latest) is an
// Effect v3 package — importing AgentPlugin transitively loads
// @effect/sql-sqlite-node@0.52.0, whose v3-only SqliteClient calls
// Context.GenericTag (removed in v4) at config-eval and crashes the whole run.
// Effect v3 and v4 cannot coexist. This plain config runs the same suite with
// the same coverage gate the AgentPlugin enforced
// (COVERAGE_LEVELS.strict.thresholds). Restore the AgentPlugin config once a
// v4-line @vitest-agent/plugin ships.
export default defineConfig({
	test: {
		// Both the co-located unit tests and the integration suites under __test__.
		include: ["src/**/*.test.ts", "__test__/**/*.test.ts"],
		// Forks (not threads) for Effect-TS compatibility.
		pool: "forks",
		globalSetup: ["vitest.setup.ts"],
		coverage: {
			enabled: true,
			provider: "v8",
			// The aggregate (whole-run) minimums COVERAGE_LEVELS.strict resolved to.
			thresholds: { lines: 80, functions: 80, branches: 75, statements: 80 },
			exclude: [],
		},
	},
});
