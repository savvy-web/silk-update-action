/**
 * Step: put the freshly pinned package manager on `PATH` before anything spawns it.
 *
 * `steps/upgrade-package-manager` rewrites `packageManager` /
 * `devEngines.packageManager`, but writing the fields activates nothing. The
 * runtime action provisioned the manager the workspace pinned when the job
 * STARTED and put a version-pinned shim directory on `PATH`; there is no
 * corepack on the runner to re-read the manifest. So without this step every
 * later spawn — `pnpm install`, the `run` commands — executes the OLD manager
 * against a manifest naming the new one, and the lockfile it commits is the old
 * manager's. That is not hypothetical: pnpm's own `manage-package-manager-versions`
 * self-switch did not fire for an install in a workspace whose
 * `devEngines.packageManager` carried `onFail: ignore`, and pnpm 11 wrote a
 * lockfile pnpm 12 then rejected with `ERR_PNPM_LOCKFILE_CONFIG_MISMATCH`
 * (savvy-web/pnpm-module-template#196).
 *
 * **Failure posture: fail-the-job.** An install under the wrong manager commits
 * a lockfile the consumer's CI cannot use, which is strictly worse than no PR.
 *
 * @module steps/activate-package-manager
 */

import type { ActionOutputError, PackageManagerInstallerError } from "@effected/github-actions";
import { ActionOutputs, PackageManagerInstaller } from "@effected/github-actions";
import type { InvalidPackageManagerPinError } from "@effected/npm";
import { PackageManagerPin } from "@effected/npm";
import { Data, Effect, Option } from "effect";

/** Raised when the newly pinned manager could not be provisioned or published to `PATH`. */
export class PackageManagerActivationError extends Data.TaggedError("PackageManagerActivationError")<{
	readonly pin: string;
	readonly message: string;
	readonly cause: InvalidPackageManagerPinError | PackageManagerInstallerError | ActionOutputError;
}> {}

/**
 * Provision `pin` into the tool cache and publish its bin directory.
 *
 * Returns the directory to prepend to every later child's `PATH` — `None` only
 * when the installer answered from an ambient install, which `allowAmbient:
 * false` rules out here (the runner's ambient manager is precisely the stale one
 * this step exists to get past). `ActionOutputs.addPath` writes `GITHUB_PATH`
 * for LATER workflow steps and never touches this process's `PATH`, which is why
 * the directory is also returned: the install step has to prepend it itself.
 *
 * `pin` is the exact spec the manifest now carries, hash included, so the
 * tarball the installer downloads is verified against the same integrity the
 * consumer's own corepack/pnpm will check.
 */
export const activatePackageManagerStep = (
	pin: string,
): Effect.Effect<Option.Option<string>, PackageManagerActivationError, PackageManagerInstaller | ActionOutputs> =>
	Effect.gen(function* () {
		yield* Effect.logInfo(`Step: package manager activation — provisioning ${pin} for the install`);

		const installer = yield* PackageManagerInstaller;
		const outputs = yield* ActionOutputs;

		const parsed = yield* PackageManagerPin.parse(pin);
		const installed = yield* installer.install(parsed, { allowAmbient: false });

		if (installed.source !== "tool-cache") {
			yield* Effect.logWarning(`  ${pin} answered from an ambient install; later steps keep the inherited PATH`);
			return Option.none();
		}

		yield* outputs.addPath(installed.binDir);
		yield* Effect.logInfo(`  ${pin} activated at ${installed.binDir}`);
		return Option.some(installed.binDir);
	}).pipe(
		Effect.catch((cause: InvalidPackageManagerPinError | PackageManagerInstallerError | ActionOutputError) =>
			Effect.fail(
				new PackageManagerActivationError({
					pin,
					message: `Failed to activate ${pin} before the install: ${cause.message}`,
					cause,
				}),
			),
		),
	);
