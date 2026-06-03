import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CommandRunner } from "@savvy-web/github-action-effects";
import type { Context } from "effect";
import { Effect, Layer, LogLevel, Logger } from "effect";
import { describe, expect, it } from "vitest";

import { corepackHashFromIntegrity, formatPnpmVersion, parsePnpmVersion } from "../utils/pnpm.js";
import { resolveLatestInRange, resolveLatestSatisfying } from "../utils/semver.js";
import { PnpmUpgrade, PnpmUpgradeLive } from "./pnpm-upgrade.js";

// ══════════════════════════════════════════════════════════════════════════════
// Test Helpers
// ══════════════════════════════════════════════════════════════════════════════

const makeTempDir = () => mkdtempSync(join(tmpdir(), "upgrade-test-"));

const writePackageJson = (dir: string, content: Record<string, unknown>) => {
	writeFileSync(join(dir, "package.json"), `${JSON.stringify(content, null, "\t")}\n`, "utf-8");
};

const readPackageJson = (dir: string) => {
	return JSON.parse(readFileSync(join(dir, "package.json"), "utf-8"));
};

type CommandRunnerShape = Context.Tag.Service<typeof CommandRunner>;

const versions = JSON.stringify(["10.27.0", "10.28.0", "10.28.2", "10.29.0", "10.29.1", "11.0.0"]);

const makeExecCapture =
	(handler: (command: string, args?: ReadonlyArray<string>) => string) =>
	(command: string, args?: ReadonlyArray<string>) =>
		Effect.succeed({ exitCode: 0, stdout: handler(command, args), stderr: "" });

const defaultExecCapture = makeExecCapture(() => "ok");

const makeRunner = (
	execCaptureOverride?: (
		command: string,
		args?: ReadonlyArray<string>,
	) => Effect.Effect<{ exitCode: number; stdout: string; stderr: string }, never>,
): CommandRunnerShape => ({
	exec: (_cmd, _args) => Effect.succeed(0),
	execCapture: execCaptureOverride ?? defaultExecCapture,
	execJson: (_cmd, _args, _schema) => Effect.die("not implemented"),
	execLines: (_cmd, _args) => Effect.succeed([]),
});

const runWithService = <A, E>(
	fn: (service: Context.Tag.Service<typeof PnpmUpgrade>) => Effect.Effect<A, E>,
	execCaptureOverride?: (
		command: string,
		args?: ReadonlyArray<string>,
	) => Effect.Effect<{ exitCode: number; stdout: string; stderr: string }, never>,
) => {
	const commandRunnerLayer = Layer.succeed(CommandRunner, makeRunner(execCaptureOverride));
	const layer = PnpmUpgradeLive.pipe(Layer.provide(commandRunnerLayer));
	return Effect.runPromise(
		Effect.gen(function* () {
			const service = yield* PnpmUpgrade;
			return yield* fn(service);
		}).pipe(Effect.provide(layer), Logger.withMinimumLogLevel(LogLevel.None)),
	);
};

const runWithServiceEither = <A, E>(
	fn: (service: Context.Tag.Service<typeof PnpmUpgrade>) => Effect.Effect<A, E>,
	execCaptureOverride?: (
		command: string,
		args?: ReadonlyArray<string>,
	) => Effect.Effect<{ exitCode: number; stdout: string; stderr: string }, never>,
) => {
	const commandRunnerLayer = Layer.succeed(CommandRunner, makeRunner(execCaptureOverride));
	const layer = PnpmUpgradeLive.pipe(Layer.provide(commandRunnerLayer));
	return Effect.runPromise(
		Effect.either(
			Effect.gen(function* () {
				const service = yield* PnpmUpgrade;
				return yield* fn(service);
			}),
		).pipe(Effect.provide(layer), Logger.withMinimumLogLevel(LogLevel.None)),
	);
};

// ══════════════════════════════════════════════════════════════════════════════
// corepackHashFromIntegrity
// ══════════════════════════════════════════════════════════════════════════════

describe("corepackHashFromIntegrity", () => {
	it("converts an npm sha512 integrity to the corepack hex hash", () => {
		const npmIntegrity =
			"sha512-tY+95tymapKVOAIVgfZItFcLbKGbGOfL1/LAenskRUFVOI2s3wjyrzZ46IptH+BPnWCd8kv1FzWgYOoEGzdKtw==";
		expect(corepackHashFromIntegrity(npmIntegrity)).toBe(
			"sha512.b58fbde6dca66a929538021581f648b4570b6ca19b18e7cbd7f2c07a7b24454155388dacdf08f2af3678e88a6d1fe04f9d609df24bf51735a060ea041b374ab7",
		);
	});

	it("trims surrounding whitespace", () => {
		const npmIntegrity =
			"  sha512-tY+95tymapKVOAIVgfZItFcLbKGbGOfL1/LAenskRUFVOI2s3wjyrzZ46IptH+BPnWCd8kv1FzWgYOoEGzdKtw==\n";
		expect(corepackHashFromIntegrity(npmIntegrity)).toBe(
			"sha512.b58fbde6dca66a929538021581f648b4570b6ca19b18e7cbd7f2c07a7b24454155388dacdf08f2af3678e88a6d1fe04f9d609df24bf51735a060ea041b374ab7",
		);
	});

	it("returns null for a non-sha512 or empty value", () => {
		expect(corepackHashFromIntegrity("")).toBeNull();
		expect(corepackHashFromIntegrity("sha1-abc")).toBeNull();
		expect(corepackHashFromIntegrity("not-an-integrity")).toBeNull();
	});

	it("handles a JSON-quoted integrity value", () => {
		const quoted = '"sha512-tY+95tymapKVOAIVgfZItFcLbKGbGOfL1/LAenskRUFVOI2s3wjyrzZ46IptH+BPnWCd8kv1FzWgYOoEGzdKtw=="';
		expect(corepackHashFromIntegrity(quoted)).toBe(
			"sha512.b58fbde6dca66a929538021581f648b4570b6ca19b18e7cbd7f2c07a7b24454155388dacdf08f2af3678e88a6d1fe04f9d609df24bf51735a060ea041b374ab7",
		);
	});
});

// ══════════════════════════════════════════════════════════════════════════════
// parsePnpmVersion
// ══════════════════════════════════════════════════════════════════════════════

describe("parsePnpmVersion", () => {
	describe("with pnpm@ prefix (packageManager field)", () => {
		it("parses exact version", () => {
			const result = parsePnpmVersion("pnpm@10.28.2", true);
			expect(result).toEqual({ version: "10.28.2", hasCaret: false, hasSha: false });
		});

		it("parses version with sha suffix", () => {
			const result = parsePnpmVersion("pnpm@10.28.2+sha512.abc123", true);
			expect(result).toEqual({ version: "10.28.2", hasCaret: false, hasSha: true });
		});

		it("parses caret version", () => {
			const result = parsePnpmVersion("pnpm@^10.28.2", true);
			expect(result).toEqual({ version: "10.28.2", hasCaret: true, hasSha: false });
		});

		it("parses caret version with sha", () => {
			const result = parsePnpmVersion("pnpm@^10.28.2+sha512.abc123", true);
			expect(result).toEqual({ version: "10.28.2", hasCaret: true, hasSha: true });
		});

		it("returns null for non-pnpm packageManager", () => {
			const result = parsePnpmVersion("yarn@4.0.0", true);
			expect(result).toBeNull();
		});

		it("returns null for empty string", () => {
			const result = parsePnpmVersion("", true);
			expect(result).toBeNull();
		});

		it("returns null for invalid semver", () => {
			const result = parsePnpmVersion("pnpm@notaversion", true);
			expect(result).toBeNull();
		});
	});

	describe("without prefix (devEngines version field)", () => {
		it("parses exact version", () => {
			const result = parsePnpmVersion("10.28.2");
			expect(result).toEqual({ version: "10.28.2", hasCaret: false, hasSha: false });
		});

		it("parses caret version", () => {
			const result = parsePnpmVersion("^10.28.2");
			expect(result).toEqual({ version: "10.28.2", hasCaret: true, hasSha: false });
		});

		it("returns null for empty string", () => {
			const result = parsePnpmVersion("");
			expect(result).toBeNull();
		});

		it("returns null for invalid semver", () => {
			const result = parsePnpmVersion("invalid");
			expect(result).toBeNull();
		});
	});
});

// ══════════════════════════════════════════════════════════════════════════════
// formatPnpmVersion
// ══════════════════════════════════════════════════════════════════════════════

describe("formatPnpmVersion", () => {
	it("formats version with caret", () => {
		expect(formatPnpmVersion("10.29.0", true)).toBe("^10.29.0");
	});

	it("formats exact version without caret", () => {
		expect(formatPnpmVersion("10.29.0", false)).toBe("10.29.0");
	});
});

// ══════════════════════════════════════════════════════════════════════════════
// resolveLatestInRange
// ══════════════════════════════════════════════════════════════════════════════

describe("resolveLatestInRange", () => {
	const versionList = ["10.27.0", "10.28.0", "10.28.2", "10.29.0", "10.29.1", "11.0.0", "11.0.0-beta.1"];

	it("finds the highest version satisfying ^current", async () => {
		const result = await Effect.runPromise(resolveLatestInRange(versionList, "10.28.2"));
		expect(result).toBe("10.29.1");
	});

	it("returns current if it is the highest in range", async () => {
		const result = await Effect.runPromise(resolveLatestInRange(versionList, "10.29.1"));
		expect(result).toBe("10.29.1");
	});

	it("skips pre-release versions", async () => {
		const result = await Effect.runPromise(resolveLatestInRange(versionList, "11.0.0"));
		// Only 11.0.0 is stable in the 11.x range
		expect(result).toBe("11.0.0");
	});

	it("returns null when no versions match the range", async () => {
		const result = await Effect.runPromise(resolveLatestInRange(versionList, "12.0.0"));
		expect(result).toBeNull();
	});

	it("returns null for empty versions array", async () => {
		const result = await Effect.runPromise(resolveLatestInRange([], "10.28.2"));
		expect(result).toBeNull();
	});

	it("does not jump to next major version", async () => {
		const result = await Effect.runPromise(resolveLatestInRange(versionList, "10.27.0"));
		expect(result).toBe("10.29.1");
	});
});

// ══════════════════════════════════════════════════════════════════════════════
// resolveLatestSatisfying
// ══════════════════════════════════════════════════════════════════════════════

describe("resolveLatestSatisfying", () => {
	const versionList = ["10.27.0", "10.28.0", "10.28.2", "10.29.0", "10.29.1", "11.0.0", "11.0.0-beta.1"];

	it("resolves the latest stable satisfying a caret range", async () => {
		const result = await Effect.runPromise(resolveLatestSatisfying(versionList, "^10.28.0"));
		expect(result).toBe("10.29.1");
	});

	it("crosses majors when the range allows it", async () => {
		const result = await Effect.runPromise(resolveLatestSatisfying(versionList, "^11"));
		expect(result).toBe("11.0.0");
	});

	it("resolves an exact-major range", async () => {
		const result = await Effect.runPromise(resolveLatestSatisfying(versionList, "11"));
		expect(result).toBe("11.0.0");
	});

	it("skips pre-release versions", async () => {
		const result = await Effect.runPromise(resolveLatestSatisfying(versionList, ">=11.0.0-0"));
		expect(result).toBe("11.0.0");
	});

	it("returns null when nothing satisfies the range", async () => {
		const result = await Effect.runPromise(resolveLatestSatisfying(versionList, "^99"));
		expect(result).toBeNull();
	});
});

// ══════════════════════════════════════════════════════════════════════════════
// PnpmUpgrade service (Effect integration tests)
// ══════════════════════════════════════════════════════════════════════════════

describe("PnpmUpgrade service", () => {
	/** Helper to extract the shell command from execCapture args */
	const getShellCmd = (_command: string, args?: ReadonlyArray<string>) => args?.[1] ?? "";

	// A valid arbitrary base64 sha512 used for the resolved version in tests.
	const FAKE_INTEGRITY =
		"sha512-tY+95tymapKVOAIVgfZItFcLbKGbGOfL1/LAenskRUFVOI2s3wjyrzZ46IptH+BPnWCd8kv1FzWgYOoEGzdKtw==";
	const EXPECTED_HASH = corepackHashFromIntegrity(FAKE_INTEGRITY) as string; // sha512.<hex>

	/** Standard exec mock — answers versions list and per-version integrity; NO corepack. */
	const makeExec = (capturedCmds?: string[]) => (_command: string, args?: ReadonlyArray<string>) => {
		const cmd = getShellCmd(_command, args);
		capturedCmds?.push(cmd);
		if (cmd.includes("npm view pnpm versions")) {
			return Effect.succeed({ exitCode: 0, stdout: versions, stderr: "" });
		}
		if (/npm view pnpm@\S+ dist\.integrity/.test(cmd)) {
			return Effect.succeed({ exitCode: 0, stdout: `${FAKE_INTEGRITY}\n`, stderr: "" });
		}
		return Effect.succeed({ exitCode: 0, stdout: "ok", stderr: "" });
	};

	/** Exec mock that returns empty integrity (graceful fallback test). */
	const makeExecNoIntegrity = () => (_command: string, args?: ReadonlyArray<string>) => {
		const cmd = getShellCmd(_command, args);
		if (cmd.includes("npm view pnpm versions")) {
			return Effect.succeed({ exitCode: 0, stdout: versions, stderr: "" });
		}
		if (/npm view pnpm@\S+ dist\.integrity/.test(cmd)) {
			return Effect.succeed({ exitCode: 0, stdout: "", stderr: "" });
		}
		return Effect.succeed({ exitCode: 0, stdout: "ok", stderr: "" });
	};

	it("returns null when no pnpm fields in package.json", async () => {
		const dir = makeTempDir();
		writePackageJson(dir, { name: "test", version: "1.0.0" });

		const result = await runWithService((s) => s.upgrade("true", dir), makeExec());
		expect(result).toBeNull();
	});

	it("returns null when packageManager is not pnpm", async () => {
		const dir = makeTempDir();
		writePackageJson(dir, { name: "test", packageManager: "yarn@4.0.0" });

		const result = await runWithService((s) => s.upgrade("true", dir), makeExec());
		expect(result).toBeNull();
	});

	it("upgrades pnpm (packageManager only, in-major) writing pinned version+hash to file", async () => {
		const dir = makeTempDir();
		writePackageJson(dir, { name: "test", packageManager: "pnpm@10.28.2" });
		const capturedCmds: string[] = [];

		const result = await runWithService((s) => s.upgrade("true", dir), makeExec(capturedCmds));

		expect(result).not.toBeNull();
		expect(result?.from).toBe("10.28.2");
		expect(result?.to).toBe("10.29.1");
		expect(result?.packageManagerUpdated).toBe(true);
		expect(result?.devEnginesUpdated).toBe(false);
		expect(result?.added).toBe(false);

		// Direct file write: pinned version+hash, NO corepack
		const pkg = readPackageJson(dir);
		expect(pkg.packageManager).toBe(`pnpm@10.29.1+${EXPECTED_HASH}`);
		expect(capturedCmds.some((c) => c.includes("corepack"))).toBe(false);
	});

	it("returns null when already on latest in range", async () => {
		const dir = makeTempDir();
		writePackageJson(dir, { name: "test", packageManager: "pnpm@10.29.1" });

		const result = await runWithService((s) => s.upgrade("true", dir), makeExec());
		expect(result).toBeNull();
	});

	it("updates both fields with pinned version+hash when both are present (auto)", async () => {
		const dir = makeTempDir();
		writePackageJson(dir, {
			name: "test",
			packageManager: "pnpm@10.29.1",
			devEngines: { packageManager: { name: "pnpm", version: "10.28.2" } },
		});

		const result = await runWithService((s) => s.upgrade("auto", dir), makeExec());

		// devEngines-favored: ^10.28.2 -> 10.29.1 is an upgrade
		expect(result).not.toBeNull();
		expect(result?.from).toBe("10.28.2");
		expect(result?.to).toBe("10.29.1");
		expect(result?.packageManagerUpdated).toBe(true);
		expect(result?.devEnginesUpdated).toBe(true);

		const pkg = readPackageJson(dir);
		expect(pkg.packageManager).toBe(`pnpm@10.29.1+${EXPECTED_HASH}`);
		expect(pkg.devEngines.packageManager.version).toBe(`10.29.1+${EXPECTED_HASH}`);
	});

	it("upgrades across a major writing pinned form for both fields", async () => {
		const dir = makeTempDir();
		writePackageJson(dir, {
			name: "test",
			packageManager: "pnpm@10.28.2",
			devEngines: { packageManager: { name: "pnpm", version: "10.28.2" } },
		});
		const capturedCmds: string[] = [];

		const result = await runWithService((s) => s.upgrade("^11", dir), makeExec(capturedCmds));

		expect(result?.from).toBe("10.28.2");
		expect(result?.to).toBe("11.0.0");
		expect(result?.packageManagerUpdated).toBe(true);
		expect(result?.devEnginesUpdated).toBe(true);

		const pkg = readPackageJson(dir);
		expect(pkg.packageManager).toBe(`pnpm@11.0.0+${EXPECTED_HASH}`);
		expect(pkg.devEngines.packageManager.version).toBe(`11.0.0+${EXPECTED_HASH}`);
		expect(capturedCmds.some((c) => c.includes("corepack"))).toBe(false);
	});

	it("adds packageManager field (added: true) when no pnpm fields exist and a range is given", async () => {
		const dir = makeTempDir();
		writePackageJson(dir, { name: "test", version: "1.0.0" });
		const capturedCmds: string[] = [];

		const result = await runWithService((s) => s.upgrade("^11", dir), makeExec(capturedCmds));

		expect(result).not.toBeNull();
		expect(result?.from).toBeNull();
		expect(result?.to).toBe("11.0.0");
		expect(result?.added).toBe(true);
		expect(result?.packageManagerUpdated).toBe(true);
		expect(capturedCmds.some((c) => c.includes("corepack"))).toBe(false);

		const pkg = readPackageJson(dir);
		expect(pkg.packageManager).toBe(`pnpm@11.0.0+${EXPECTED_HASH}`);
	});

	it("updates devEngines only (no packageManager) writing pinned form, no corepack", async () => {
		const dir = makeTempDir();
		writePackageJson(dir, {
			name: "test",
			devEngines: { packageManager: { name: "pnpm", version: "10.28.2" } },
		});
		const capturedCmds: string[] = [];

		const result = await runWithService((s) => s.upgrade("^11", dir), makeExec(capturedCmds));

		expect(result?.from).toBe("10.28.2");
		expect(result?.to).toBe("11.0.0");
		expect(result?.packageManagerUpdated).toBe(false);
		expect(result?.devEnginesUpdated).toBe(true);
		expect(result?.added).toBe(false);
		expect(capturedCmds.some((c) => c.includes("corepack"))).toBe(false);

		const pkg = readPackageJson(dir);
		expect(pkg.devEngines.packageManager.version).toBe(`11.0.0+${EXPECTED_HASH}`);
		expect(pkg.packageManager).toBeUndefined();
	});

	it("handles devEngines only (no packageManager) in-major", async () => {
		const dir = makeTempDir();
		writePackageJson(dir, {
			name: "test",
			devEngines: { packageManager: { name: "pnpm", version: "10.28.2" } },
		});

		const result = await runWithService((s) => s.upgrade("true", dir), makeExec());

		expect(result).not.toBeNull();
		expect(result?.from).toBe("10.28.2");
		expect(result?.to).toBe("10.29.1");
		expect(result?.packageManagerUpdated).toBe(false);
		expect(result?.devEnginesUpdated).toBe(true);
	});

	it("skips devEngines when packageManager name is not pnpm", async () => {
		const dir = makeTempDir();
		writePackageJson(dir, {
			name: "test",
			packageManager: "pnpm@10.28.2",
			devEngines: { packageManager: { name: "yarn", version: "4.0.0" } },
		});

		const result = await runWithService((s) => s.upgrade("true", dir), makeExec());

		expect(result).not.toBeNull();
		expect(result?.packageManagerUpdated).toBe(true);
		expect(result?.devEnginesUpdated).toBe(false);
	});

	it("detects tab indentation and preserves it", async () => {
		const dir = makeTempDir();
		writeFileSync(
			join(dir, "package.json"),
			`${JSON.stringify(
				{
					name: "test",
					packageManager: "pnpm@10.28.2",
					devEngines: { packageManager: { name: "pnpm", version: "10.28.2" } },
				},
				null,
				"\t",
			)}\n`,
		);

		await runWithService((s) => s.upgrade("true", dir), makeExec());

		const raw = readFileSync(join(dir, "package.json"), "utf-8");
		expect(raw).toMatch(/^\t"/m);
	});

	it("detects space indentation and preserves it", async () => {
		const dir = makeTempDir();
		writeFileSync(
			join(dir, "package.json"),
			`${JSON.stringify(
				{
					name: "test",
					packageManager: "pnpm@10.28.2",
					devEngines: { packageManager: { name: "pnpm", version: "10.28.2" } },
				},
				null,
				2,
			)}\n`,
		);

		await runWithService((s) => s.upgrade("true", dir), makeExec());

		const raw = readFileSync(join(dir, "package.json"), "utf-8");
		expect(raw).toMatch(/^ {2}"/m);
		expect(raw).not.toMatch(/^\t"/m);
	});

	it("returns null when no newer version is available", async () => {
		const dir = makeTempDir();
		writePackageJson(dir, { name: "test", packageManager: "pnpm@11.0.0" });

		const result = await runWithService((s) => s.upgrade("true", dir), makeExec());
		expect(result).toBeNull();
	});

	it("returns null when no versions satisfy the range", async () => {
		const dir = makeTempDir();
		writePackageJson(dir, { name: "test", packageManager: "pnpm@12.0.0" });

		const result = await runWithService((s) => s.upgrade("true", dir), makeExec());
		expect(result).toBeNull();
	});

	it("fails when package.json does not exist", async () => {
		const dir = makeTempDir();

		const result = await runWithServiceEither((s) => s.upgrade("true", dir), makeExec());

		expect(result._tag).toBe("Left");
		if (result._tag === "Left") {
			expect(result.left._tag).toBe("FileSystemError");
		}
	});

	it("fails when package.json has invalid JSON", async () => {
		const dir = makeTempDir();
		writeFileSync(join(dir, "package.json"), "{ not valid json");

		const result = await runWithServiceEither((s) => s.upgrade("true", dir), makeExec());

		expect(result._tag).toBe("Left");
		if (result._tag === "Left") {
			expect(result.left._tag).toBe("FileSystemError");
		}
	});

	it("fails when npm view returns invalid JSON", async () => {
		const dir = makeTempDir();
		writePackageJson(dir, { name: "test", packageManager: "pnpm@10.28.2" });

		const result = await runWithServiceEither(
			(s) => s.upgrade("true", dir),
			(_command, args) => {
				const cmd = getShellCmd(_command, args);
				if (cmd.includes("npm view pnpm versions")) {
					return Effect.succeed({ exitCode: 0, stdout: "not json", stderr: "" });
				}
				return Effect.succeed({ exitCode: 0, stdout: "ok", stderr: "" });
			},
		);

		expect(result._tag).toBe("Left");
		if (result._tag === "Left") {
			expect(result.left._tag).toBe("FileSystemError");
		}
	});

	it("favors the devEngines version as the reference (auto)", async () => {
		const dir = makeTempDir();
		// packageManager is already latest-in-major (10.29.1); devEngines is behind.
		writePackageJson(dir, {
			name: "test",
			packageManager: "pnpm@10.29.1",
			devEngines: { packageManager: { name: "pnpm", version: "10.28.2" } },
		});

		const result = await runWithService((s) => s.upgrade("auto", dir), makeExec());

		// If packageManager were the reference, ^10.29.1 -> 10.29.1 == current -> null.
		// devEngines-favored: ^10.28.2 -> 10.29.1, so an upgrade is reported.
		expect(result).not.toBeNull();
		expect(result?.from).toBe("10.28.2");
		expect(result?.to).toBe("10.29.1");
	});

	it("treats true and auto identically", async () => {
		const dir = makeTempDir();
		writePackageJson(dir, { name: "test", packageManager: "pnpm@10.28.2" });

		const result = await runWithService((s) => s.upgrade("auto", dir), makeExec());

		expect(result?.from).toBe("10.28.2");
		expect(result?.to).toBe("10.29.1");
		expect(result?.added).toBe(false);
	});

	it("skips with true/auto when no pnpm field exists", async () => {
		const dir = makeTempDir();
		writePackageJson(dir, { name: "test", version: "1.0.0" });

		const result = await runWithService((s) => s.upgrade("auto", dir), makeExec());
		expect(result).toBeNull();
	});

	it("skips entirely when mode is false", async () => {
		const dir = makeTempDir();
		writePackageJson(dir, { name: "test", packageManager: "pnpm@10.28.2" });

		const result = await runWithService((s) => s.upgrade("false", dir));
		expect(result).toBeNull();
	});

	it("returns null when an explicit range matches nothing", async () => {
		const dir = makeTempDir();
		writePackageJson(dir, { name: "test", packageManager: "pnpm@10.28.2" });

		const result = await runWithService((s) => s.upgrade("^99", dir), makeExec());
		expect(result).toBeNull();
	});

	it("writes bare version (no hash) when integrity is unavailable", async () => {
		const dir = makeTempDir();
		writePackageJson(dir, { name: "test", packageManager: "pnpm@10.28.2" });

		const result = await runWithService((s) => s.upgrade("true", dir), makeExecNoIntegrity());

		expect(result).not.toBeNull();
		expect(result?.to).toBe("10.29.1");

		const pkg = readPackageJson(dir);
		// No +sha512 suffix — bare version fallback
		expect(pkg.packageManager).toBe("pnpm@10.29.1");
	});
});
