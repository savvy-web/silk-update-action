import {
	ActionOutputs,
	AmbientPackageManager,
	CachedPackageManager,
	PackageManagerInstaller,
	PackageManagerInstallerError,
} from "@effected/github-actions";
import type { IntegrityHashBrand } from "@effected/npm";
import { CorepackIntegrityHash } from "@effected/npm";
import { Effect, Exit, Layer, Option, References } from "effect";
import { describe, expect, it, vi } from "vitest";
import { activatePackageManagerStep } from "../../../src/steps/activate-package-manager.js";

/**
 * The installer double answers `tool-cache` — the only source `allowAmbient:
 * false` admits — and records what it was handed. `addPath` records what was
 * published for later workflow steps.
 */
const harness = (install?: (...args: ReadonlyArray<unknown>) => Effect.Effect<unknown, unknown>) => {
	const paths: string[] = [];
	const installSpy = vi.fn(
		install ??
			((pin: unknown) => {
				const p = pin as { name: "pnpm"; version: { toString(): string } };
				return Effect.succeed(
					CachedPackageManager.make({
						source: "tool-cache",
						name: p.name,
						version: String(p.version),
						directory: "/toolcache/pnpm/12.4.2/x64",
						binDir: "/toolcache/pnpm/12.4.2/x64/.bin",
						bins: { pnpm: "/toolcache/pnpm/12.4.2/x64/pnpm" },
					}),
				);
			}),
	);
	const layer = Layer.mergeAll(
		PackageManagerInstaller.layerTest({
			install: installSpy as unknown as Effect.Success<typeof PackageManagerInstaller>["install"],
		}),
		ActionOutputs.layerTest({
			addPath: (dir: string) =>
				Effect.sync(() => {
					paths.push(dir);
				}),
		}),
	);
	const run = (pin: string, integrity: IntegrityHashBrand | null = null) =>
		Effect.runPromiseExit(
			activatePackageManagerStep(pin, integrity).pipe(
				Effect.provide(layer),
				Effect.provideService(References.MinimumLogLevel, "None"),
			),
		);
	return { run, installSpy, paths };
};

// A real corepack-form sha512: the installer option is the branded type, so the
// test hands it exactly what the upgrade outcome carries.
const INTEGRITY = Effect.runSync(
	CorepackIntegrityHash.fromSri(
		"sha512-Iv0lXkpG6NXcNu/khNeaNfpcI8KMnyOnmiB+BbwCw1t0csCZPzLf7EJ4zCuvD/yg1oyHquMXzBQHAzyGq+CnZw==",
	),
);

describe("activatePackageManagerStep", () => {
	it("hands the installer the bare pin plus the integrity as an option, so the download is still verified", async () => {
		const { run, installSpy } = harness();

		const exit = await run("pnpm@12.4.2", INTEGRITY);

		expect(Exit.isSuccess(exit)).toBe(true);
		const [pin, options] = installSpy.mock.calls[0] as [
			{ name: string; version: { toString(): string }; integrity: string | undefined },
			unknown,
		];
		expect(String(pin.version)).toBe("12.4.2");
		// The manifest no longer carries the hash; the option does.
		expect(pin.integrity).toBeUndefined();
		expect(options).toStrictEqual({ allowAmbient: false, integrity: INTEGRITY });
	});

	it("installs without an integrity option when none could be derived — the installer warns", async () => {
		// The control for the case above: no `integrity` key at all, not an
		// explicit `undefined` that a strict comparison would also catch.
		const { run, installSpy } = harness();

		const exit = await run("pnpm@12.4.2", null);

		expect(Exit.isSuccess(exit)).toBe(true);
		expect(installSpy.mock.calls[0]?.[1]).toStrictEqual({ allowAmbient: false });
	});

	it("provisions the pin without an ambient short-circuit, publishes the bin dir, and returns it", async () => {
		const { run, installSpy, paths } = harness();

		const exit = await run("pnpm@12.4.2+sha512.abc");

		expect(Exit.isSuccess(exit)).toBe(true);
		expect(Exit.isSuccess(exit) && Option.getOrNull(exit.value)).toBe("/toolcache/pnpm/12.4.2/x64/.bin");
		// The pin reached the installer parsed — name, version and the hash tail
		// — and the ambient probe is off: the runner's ambient manager is the
		// stale one this step exists to get past.
		expect(installSpy).toHaveBeenCalledTimes(1);
		const [pin, options] = installSpy.mock.calls[0] as [
			{ name: string; version: { toString(): string }; integrity: string | undefined },
			{ allowAmbient: boolean },
		];
		expect(pin.name).toBe("pnpm");
		expect(String(pin.version)).toBe("12.4.2");
		expect(pin.integrity).toBe("sha512.abc");
		expect(options).toEqual({ allowAmbient: false });
		// And later workflow steps see it too.
		expect(paths).toEqual(["/toolcache/pnpm/12.4.2/x64/.bin"]);
	});

	it("publishes nothing and returns None if the installer ever answers ambient", async () => {
		// `allowAmbient: false` makes this arm unreachable today; the union still
		// has it, and an ambient answer carries no bin dir to publish.
		const { run, paths } = harness(() =>
			Effect.succeed(AmbientPackageManager.make({ source: "ambient", name: "pnpm", version: "12.4.2", bins: {} })),
		);

		const exit = await run("pnpm@12.4.2");

		expect(Exit.isSuccess(exit) && Option.isNone(exit.value)).toBe(true);
		expect(paths).toEqual([]);
	});

	it("fails typed — never silently — when the installer cannot provision the pin", async () => {
		const { run, paths } = harness(() =>
			Effect.fail(
				new PackageManagerInstallerError({
					reason: "unsupportedPlatform",
					name: "pnpm",
					version: "12.4.2",
					subject: "Linux/riscv64",
				}),
			),
		);

		const exit = await run("pnpm@12.4.2");

		expect(Exit.isFailure(exit)).toBe(true);
		if (Exit.isFailure(exit)) {
			const message = String(exit.cause);
			expect(message).toContain("PackageManagerActivationError");
			expect(message).toContain("pnpm@12.4.2");
		}
		expect(paths).toEqual([]);
	});

	it("fails typed on a pin the installer cannot even parse", async () => {
		const { run, installSpy } = harness();

		const exit = await run("yarn-berry@@nope");

		expect(Exit.isFailure(exit)).toBe(true);
		expect(installSpy).not.toHaveBeenCalled();
	});
});
