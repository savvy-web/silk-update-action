/**
 * Integration tests for workspaces-effect's WorkspaceDiscovery against real fixtures.
 *
 * Verifies the upstream service correctly returns the root and all workspace
 * leaf packages for both single-leaf and multi-leaf fixtures.
 */

import { NodeServices } from "@effect/platform-node";
import { WorkspaceDiscovery, WorkspaceRoot } from "@effected/workspaces";
import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { loadFixture } from "./utils/load-fixture.js";

const platform = NodeServices.layer;

// @effected/workspaces binds the discovery root at layer-build time, so the
// fixture cwd is passed to `WorkspaceDiscovery.layer({ cwd })` rather than to
// `listPackages`/`importerMap` (which take no arguments in v4).
const discoveryLayerFor = (cwd: string) =>
	WorkspaceDiscovery.layer({ cwd }).pipe(
		Layer.provide(Layer.merge(WorkspaceRoot.layer.pipe(Layer.provide(platform)), platform)),
	);

const runWith = <A, E>(cwd: string, eff: Effect.Effect<A, E, WorkspaceDiscovery>): Promise<A> =>
	Effect.runPromise(Effect.provide(eff, discoveryLayerFor(cwd)));

describe("WorkspaceDiscovery integration", () => {
	it("listPackages returns the root and leaf for a single-leaf private root fixture", async () => {
		const fixture = loadFixture("single-package-private-root");

		const packages = await runWith(
			fixture.path,
			Effect.gen(function* () {
				const ws = yield* WorkspaceDiscovery;
				return yield* ws.listPackages();
			}),
		);

		const names = packages.map((p) => p.name).sort();
		expect(names).toEqual(["@scope/test-leaf", "test-root"]);
	});

	it("importerMap keys '.' to the root package for the single-leaf fixture", async () => {
		const fixture = loadFixture("single-package-private-root");

		const map = await runWith(
			fixture.path,
			Effect.gen(function* () {
				const ws = yield* WorkspaceDiscovery;
				return yield* ws.importerMap();
			}),
		);

		expect(map.get(".")?.name).toBe("test-root");
		expect(map.get("package")?.name).toBe("@scope/test-leaf");
	});

	it("listPackages returns root + 2 leaves for a multi-leaf public root fixture", async () => {
		const fixture = loadFixture("multi-package-public-root");

		const packages = await runWith(
			fixture.path,
			Effect.gen(function* () {
				const ws = yield* WorkspaceDiscovery;
				return yield* ws.listPackages();
			}),
		);

		const names = packages.map((p) => p.name).sort();
		expect(names).toEqual(["@scope/a", "@scope/b", "test-root-multi"]);
	});
});
