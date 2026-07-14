import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeContext } from "@effect/platform-node";
import { ActionInputError } from "@savvy-web/github-action-effects";
import { Effect, Exit, Layer, LogLevel, Logger } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PackageManagerDetectorLive, WorkspaceRootLive } from "workspaces-effect";
import { detectPackageManager } from "./package-manager.js";

let root: string;

const layer = Layer.mergeAll(PackageManagerDetectorLive, WorkspaceRootLive.pipe(Layer.provide(NodeContext.layer))).pipe(
	Layer.provide(NodeContext.layer),
);

const run = <A, E>(effect: Effect.Effect<A, E, never>) => Effect.runPromise(effect);

const detect = (cwd: string) =>
	detectPackageManager(cwd).pipe(Effect.provide(layer), Logger.withMinimumLogLevel(LogLevel.None));

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "pm-detect-"));
});

afterEach(() => {
	rmSync(root, { recursive: true, force: true });
});

describe("detectPackageManager", () => {
	it("detects bun from devEngines.packageManager", async () => {
		writeFileSync(
			join(root, "package.json"),
			JSON.stringify({
				name: "root",
				workspaces: ["."],
				devEngines: { packageManager: { name: "bun", version: "1.3.14" } },
			}),
		);

		const result = await run(detect(root));

		expect(result.pm).toBe("bun");
		expect(result.version).toBe("1.3.14");
		expect(result.root).toBe(root);
	});

	it("detects pnpm from pnpm-workspace.yaml", async () => {
		writeFileSync(join(root, "package.json"), JSON.stringify({ name: "root" }));
		writeFileSync(join(root, "pnpm-workspace.yaml"), "packages:\n  - .\n");

		const result = await run(detect(root));

		expect(result.pm).toBe("pnpm");
	});

	it("detects npm from the workspaces field", async () => {
		writeFileSync(join(root, "package.json"), JSON.stringify({ name: "root", workspaces: ["packages/*"] }));

		const result = await run(detect(root));

		expect(result.pm).toBe("npm");
	});

	it("fails with ActionInputError on yarn", async () => {
		writeFileSync(
			join(root, "package.json"),
			JSON.stringify({ name: "root", workspaces: ["."], packageManager: "yarn@4.10.0" }),
		);
		writeFileSync(join(root, "yarn.lock"), "");

		const exit = await Effect.runPromiseExit(detect(root));

		if (!Exit.isFailure(exit)) {
			throw new Error("Expected Failure exit");
		}

		expect(exit.cause._tag).toBe("Fail");
		if (exit.cause._tag !== "Fail") {
			throw new Error("Expected Fail cause");
		}

		const error = exit.cause.error;
		expect(error).toBeInstanceOf(ActionInputError);
		if (error instanceof ActionInputError) {
			expect(error.reason).toContain("Detected yarn");
		}
	});

	it("fails with ActionInputError when nothing is detectable", async () => {
		const exit = await Effect.runPromiseExit(detect(root));

		if (!Exit.isFailure(exit)) {
			throw new Error("Expected Failure exit");
		}

		expect(exit.cause._tag).toBe("Fail");
		if (exit.cause._tag !== "Fail") {
			throw new Error("Expected Fail cause");
		}

		const error = exit.cause.error;
		expect(error).toBeInstanceOf(ActionInputError);
	});
});
