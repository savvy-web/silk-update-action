/**
 * Tests for module-catalogs.
 *
 * @module services/module-catalogs.test
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HttpClient, HttpClientError, HttpClientResponse } from "@effect/platform";
import { CommandRunner, CommandRunnerError, NpmRegistryTest } from "@savvy-web/github-action-effects";
import { Effect, Layer, LogLevel, Logger } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeTarball } from "./__fixtures__/tarball.js";
import { fetchModuleCatalogs, resolveEntryPoint } from "./module-catalogs.js";

// Toggleable failure switches for `node:fs`'s sync APIs, read by the
// `vi.mock` factory below (hoisted above this file's imports, so the static
// `mkdtempSync`/`writeFileSync` imports above already resolve to the mocked
// versions). Both `fetchModuleCatalogs` itself and this test file's own
// `beforeEach`/fixture setup call these functions through the same mocked
// module, so each switch defaults to passthrough (calling the real
// implementation) and is only flipped on for the one test that exercises the
// wrapped-throw path — see FINDING 3 in the task brief.
const fsFailures = { mkdtemp: false, write: false };

vi.mock("node:fs", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:fs")>();
	return {
		...actual,
		mkdtempSync: (...args: Parameters<typeof actual.mkdtempSync>) => {
			if (fsFailures.mkdtemp) {
				throw new Error("ENOSPC: no space left on device, mkdtemp");
			}
			return actual.mkdtempSync(...args);
		},
		writeFileSync: (...args: Parameters<typeof actual.writeFileSync>) => {
			if (fsFailures.write) {
				throw new Error("ENOSPC: no space left on device, write");
			}
			return actual.writeFileSync(...args);
		},
	};
});

let work: string;
let tarballPath: string;

const httpStub = Layer.succeed(
	HttpClient.HttpClient,
	HttpClient.make((request) =>
		Effect.succeed(HttpClientResponse.fromWeb(request, new Response(readFileSync(tarballPath) as never))),
	),
);

const httpFailStub = Layer.succeed(
	HttpClient.HttpClient,
	HttpClient.make((request) =>
		Effect.fail(new HttpClientError.RequestError({ request, reason: "Transport", description: "network down" })),
	),
);

const httpNotFoundStub = Layer.succeed(
	HttpClient.HttpClient,
	HttpClient.make((request) =>
		Effect.succeed(HttpClientResponse.fromWeb(request, new Response("not found", { status: 404 }))),
	),
);

const realRunner = Layer.succeed(CommandRunner, {
	exec: (command: string, args: ReadonlyArray<string>) =>
		Effect.sync(() => {
			execFileSync(command, [...args]);
		}),
	execCapture: () => Effect.succeed({ stdout: "", stderr: "", exitCode: 0 }),
} as never);

const failingRunner = Layer.succeed(CommandRunner, {
	exec: () =>
		Effect.fail(
			new CommandRunnerError({
				command: "tar",
				args: [],
				exitCode: 1,
				stderr: "not a gzip file",
				reason: "tar failed",
			}),
		),
	execCapture: () => Effect.succeed({ stdout: "", stderr: "", exitCode: 0 }),
} as never);

const registry = (tarball: string | undefined, integrity?: string) =>
	NpmRegistryTest.layer({
		packages: new Map([
			[
				"@fixture/plugin",
				{
					versions: ["1.0.0"],
					latest: "1.0.0",
					distTags: { latest: "1.0.0" },
					...(tarball ? { tarball } : {}),
					...(integrity ? { integrity } : {}),
				},
			],
		]),
	});

/** The registry's `sha512-<base64>` integrity string for a tarball's actual bytes. */
const integrityOf = (path: string): string =>
	`sha512-${createHash("sha512").update(readFileSync(path)).digest("base64")}`;

// A JS default parameter substitutes on an explicit `undefined` argument just
// as it does on an omitted one, so `run()` cannot double as "no tarball URL"
// via `run(undefined)` — that would silently fall through to this same
// default instead of exercising the no-tarball path. `tarball` therefore has
// no default; every call site is explicit, and this constant names the
// common case.
const DEFAULT_TARBALL = "https://registry.example/plugin.tgz";

const run = (tarball: string | undefined) =>
	Effect.runPromise(
		fetchModuleCatalogs("@fixture/plugin", "1.0.0").pipe(
			Effect.provide(Layer.mergeAll(registry(tarball), httpStub, realRunner)),
			Logger.withMinimumLogLevel(LogLevel.None),
		),
	);

beforeEach(() => {
	work = mkdtempSync(join(tmpdir(), "modcat-"));
});

afterEach(() => {
	fsFailures.mkdtemp = false;
	fsFailures.write = false;
	rmSync(work, { recursive: true, force: true });
});

describe("fetchModuleCatalogs", () => {
	it("reads the catalogs export from a fetched tarball", async () => {
		tarballPath = makeTarball(
			work,
			"1.0.0",
			`export const catalogs = new Map([["silk", new Map([["effect", "^3.21.4"]])]]);`,
		);

		const result = await run(DEFAULT_TARBALL);

		expect(result).toEqual({ silk: { effect: "^3.21.4" } });
	});

	it("accepts a plain-object catalogs export", async () => {
		tarballPath = makeTarball(work, "1.0.0", `export const catalogs = { silk: { effect: "^3.21.4" } };`);

		expect(await run(DEFAULT_TARBALL)).toEqual({ silk: { effect: "^3.21.4" } });
	});

	it("falls back to a Map/object-shaped default export when there is no named catalogs export", async () => {
		tarballPath = makeTarball(work, "1.0.0", `export default new Map([["silk", new Map([["effect", "^3.21.4"]])]]);`);

		expect(await run(DEFAULT_TARBALL)).toEqual({ silk: { effect: "^3.21.4" } });
	});

	it("returns null when the module has no catalogs export", async () => {
		tarballPath = makeTarball(work, "1.0.0", `export const somethingElse = 1;`);

		expect(await run(DEFAULT_TARBALL)).toBeNull();
	});

	it("returns null when the catalogs export is malformed", async () => {
		tarballPath = makeTarball(work, "1.0.0", `export const catalogs = "not a catalog map";`);

		expect(await run(DEFAULT_TARBALL)).toBeNull();
	});

	it("returns null when the registry reports no tarball URL", async () => {
		tarballPath = makeTarball(work, "1.0.0", `export const catalogs = {};`);

		expect(await run(undefined)).toBeNull();
	});

	it("returns null when the npm registry query itself fails", async () => {
		tarballPath = makeTarball(work, "1.0.0", `export const catalogs = {};`);

		const result = await Effect.runPromise(
			fetchModuleCatalogs("@fixture/missing", "1.0.0").pipe(
				Effect.provide(Layer.mergeAll(NpmRegistryTest.empty(), httpStub, realRunner)),
				Logger.withMinimumLogLevel(LogLevel.None),
			),
		);

		expect(result).toBeNull();
	});

	it("returns null when the tarball download fails", async () => {
		tarballPath = makeTarball(work, "1.0.0", `export const catalogs = {};`);

		const result = await Effect.runPromise(
			fetchModuleCatalogs("@fixture/plugin", "1.0.0").pipe(
				Effect.provide(Layer.mergeAll(registry(DEFAULT_TARBALL), httpFailStub, realRunner)),
				Logger.withMinimumLogLevel(LogLevel.None),
			),
		);

		expect(result).toBeNull();
	});

	it("returns null when the tarball download responds with a non-2xx status", async () => {
		tarballPath = makeTarball(work, "1.0.0", `export const catalogs = {};`);

		const result = await Effect.runPromise(
			fetchModuleCatalogs("@fixture/plugin", "1.0.0").pipe(
				Effect.provide(Layer.mergeAll(registry(DEFAULT_TARBALL), httpNotFoundStub, realRunner)),
				Logger.withMinimumLogLevel(LogLevel.None),
			),
		);

		expect(result).toBeNull();
	});

	it("proceeds without verification when the registry reports no integrity for the version", async () => {
		tarballPath = makeTarball(work, "1.0.0", `export const catalogs = { silk: { effect: "^3.21.4" } };`);

		// The shared `registry()` helper omits `integrity` unless given one, so
		// every other passing test in this suite already exercises this path;
		// this test names it explicitly as the absent-integrity case.
		expect(await run(DEFAULT_TARBALL)).toEqual({ silk: { effect: "^3.21.4" } });
	});

	it("reads the catalogs export when the downloaded tarball matches the advertised integrity", async () => {
		tarballPath = makeTarball(work, "1.0.0", `export const catalogs = { silk: { effect: "^3.21.4" } };`);

		const result = await Effect.runPromise(
			fetchModuleCatalogs("@fixture/plugin", "1.0.0").pipe(
				Effect.provide(Layer.mergeAll(registry(DEFAULT_TARBALL, integrityOf(tarballPath)), httpStub, realRunner)),
				Logger.withMinimumLogLevel(LogLevel.None),
			),
		);

		expect(result).toEqual({ silk: { effect: "^3.21.4" } });
	});

	it("returns null and never extracts when the downloaded tarball does not match the advertised integrity", async () => {
		tarballPath = makeTarball(work, "1.0.0", `export const catalogs = { silk: { effect: "^3.21.4" } };`);

		// The registry vouches for bytes that are NOT what httpStub actually
		// serves (the real tarball) — a stand-in for a poisoned intermediary
		// (CDN edge, proxy, mirror) substituting different content in transit.
		const bogusIntegrity = `sha512-${createHash("sha512").update(Buffer.from("not-the-real-tarball-bytes")).digest("base64")}`;

		const result = await Effect.runPromise(
			fetchModuleCatalogs("@fixture/plugin", "1.0.0").pipe(
				Effect.provide(Layer.mergeAll(registry(DEFAULT_TARBALL, bogusIntegrity), httpStub, realRunner)),
				Logger.withMinimumLogLevel(LogLevel.None),
			),
		);

		expect(result).toBeNull();
	});

	it("returns null when creating the temp directory throws", async () => {
		tarballPath = makeTarball(work, "1.0.0", `export const catalogs = {};`);
		fsFailures.mkdtemp = true;

		expect(await run(DEFAULT_TARBALL)).toBeNull();
	});

	it("returns null when writing the downloaded tarball to disk throws", async () => {
		tarballPath = makeTarball(work, "1.0.0", `export const catalogs = {};`);
		fsFailures.write = true;

		expect(await run(DEFAULT_TARBALL)).toBeNull();
	});

	it("returns null when tarball extraction fails", async () => {
		tarballPath = makeTarball(work, "1.0.0", `export const catalogs = {};`);

		const result = await Effect.runPromise(
			fetchModuleCatalogs("@fixture/plugin", "1.0.0").pipe(
				Effect.provide(Layer.mergeAll(registry(DEFAULT_TARBALL), httpStub, failingRunner)),
				Logger.withMinimumLogLevel(LogLevel.None),
			),
		);

		expect(result).toBeNull();
	});

	it("returns null when the entry module cannot be imported (no node_modules for a runtime dependency)", async () => {
		tarballPath = makeTarball(
			work,
			"1.0.0",
			`import "this-package-does-not-exist-xyz-123"; export const catalogs = {};`,
		);

		expect(await run(DEFAULT_TARBALL)).toBeNull();
	});
});

describe("resolveEntryPoint", () => {
	// ── subpath map (the "." key) ────────────────────────────────────────────
	it("resolves a string exports['.'] entry", () => {
		expect(resolveEntryPoint({ exports: { ".": "./esm.js" } })).toBe("./esm.js");
	});

	it("resolves the import condition of an object exports['.'] entry", () => {
		expect(resolveEntryPoint({ exports: { ".": { import: "./esm.js", default: "./cjs.js" } } })).toBe("./esm.js");
	});

	it("resolves the default condition when import is absent", () => {
		expect(resolveEntryPoint({ exports: { ".": { default: "./cjs.js" } } })).toBe("./cjs.js");
	});

	it("resolves the '.' entry of a multi-subpath map, ignoring the other subpaths", () => {
		expect(resolveEntryPoint({ exports: { ".": "./esm.js", "./sub": "./sub.js" }, main: "./main.js" })).toBe(
			"./esm.js",
		);
	});

	// ── string shorthand ─────────────────────────────────────────────────────
	it("resolves a string exports field, which is sugar for { '.': <string> }", () => {
		// It must NOT fall through to `main`: the string IS the "." entry.
		expect(resolveEntryPoint({ exports: "./esm.js", main: "./main.js" })).toBe("./esm.js");
	});

	// ── root conditions (no "." key) ─────────────────────────────────────────
	it("resolves the import condition of a root conditional exports object", () => {
		expect(resolveEntryPoint({ exports: { import: "./esm.js", default: "./cjs.cjs" }, main: "./main.js" })).toBe(
			"./esm.js",
		);
	});

	it("resolves the default condition of a root conditional exports object when import is absent", () => {
		expect(resolveEntryPoint({ exports: { require: "./cjs.cjs", default: "./index.cjs" }, main: "./main.js" })).toBe(
			"./index.cjs",
		);
	});

	it("falls back to main for a root conditional exports object with no usable condition", () => {
		expect(resolveEntryPoint({ exports: { require: "./cjs.cjs" }, main: "./main.js" })).toBe("./main.js");
	});

	it("treats an object with any '.'-prefixed key as a subpath map, not as root conditions", () => {
		// `import` here is a condition-looking key inside a subpath map; with no
		// "." subpath there is no root entry, so `main` is correct.
		expect(resolveEntryPoint({ exports: { "./sub": "./sub.js", import: "./esm.js" }, main: "./main.js" })).toBe(
			"./main.js",
		);
	});

	// ── fallbacks ────────────────────────────────────────────────────────────
	it("falls back to main when exports['.'] has no usable condition", () => {
		expect(resolveEntryPoint({ exports: { ".": {} }, main: "./main.js" })).toBe("./main.js");
	});

	it("falls back to main when exports is an empty object", () => {
		expect(resolveEntryPoint({ exports: {}, main: "./main.js" })).toBe("./main.js");
	});

	it("falls back to main when exports is an array", () => {
		expect(resolveEntryPoint({ exports: ["./esm.js"], main: "./main.js" })).toBe("./main.js");
	});

	it("defaults to index.js when neither exports nor main is present", () => {
		expect(resolveEntryPoint({})).toBe("index.js");
	});
});

describe("fetchModuleCatalogs — exports shapes end to end", () => {
	const CATALOGS = `export const catalogs = { silk: { effect: "^3.21.4" } };`;

	it("loads the catalogs of a package whose exports is the string shorthand", async () => {
		tarballPath = makeTarball(work, "1.0.0", CATALOGS, "./index.js");

		expect(await run(DEFAULT_TARBALL)).toEqual({ silk: { effect: "^3.21.4" } });
	});

	it("loads the catalogs of a package with root conditional exports", async () => {
		tarballPath = makeTarball(work, "1.0.0", CATALOGS, { import: "./index.js", default: "./index.js" });

		expect(await run(DEFAULT_TARBALL)).toEqual({ silk: { effect: "^3.21.4" } });
	});

	it("loads the catalogs of a package with no exports field at all (index.js fallback)", async () => {
		// `null` is the fixture's "omit exports" sentinel — an explicit `undefined`
		// would substitute the default subpath map instead.
		tarballPath = makeTarball(work, "1.0.0", CATALOGS, null);

		expect(await run(DEFAULT_TARBALL)).toEqual({ silk: { effect: "^3.21.4" } });
	});
});
