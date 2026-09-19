---
type: Measurement
title: npm 11 to 12 pin bump probe against the bundled kit
description: On 2026-09-18 the installed @effected/github-actions@0.13.3 provisioned npm 12.0.2 and 11.19.1 through the tool-cache path with no kit change, and an npm 12 install accepted the +sha512 devEngines pin the upgrade step writes; the stale-manager negative control failed with EBADDEVENGINES and wrote no lockfile.
status: draft
stale_after: 2027-03-18T00:00:00Z
tags:
  - compat
  - deps
  - testing
sources:
  - id: activate-step
    resource: ../../src/steps/activate-package-manager.ts
  - id: upgrade-service
    resource: ../../src/services/package-manager-upgrade.ts
  - id: install-step
    resource: ../../src/steps/install.ts
  - id: program-test
    resource: ../../__test__/unit/program.inner.test.ts
  - id: issue-449
    resource: "https://github.com/savvy-web/silk-update-action/issues/449"
  - id: effected-776
    resource: "https://github.com/spencerbeggs/effected/issues/776"
generated:
  by: okfit/claude-code
  at: 2026-09-19T02:17:51Z
  body_sha256: a693703a33772404b90f6264d832235cb53fa7d9babdc6da6c28d6322537552a
---

# npm 11 to 12 pin bump probe against the bundled kit

## Inputs

- `@effected/github-actions@0.13.3`, as installed in this repository's
  `node_modules` on 2026-09-18; `PackageManagerInstaller.layer` provided with
  `ToolInstaller.layer`, a fresh `RUNNER_TOOL_CACHE`, macOS arm64, node 26.9.0
  (bundled npm 11.19.1).
- Pins built the way `services/package-manager-upgrade` writes
  them:[^upgrade-service] `npm@12.0.2+sha512.<hex>` and `npm@11.19.1+sha512.<hex>`,
  the hex derived from each version's registry `dist.integrity`.
- A one-package npm workspace (`isarray@1.0.0`) carrying both `packageManager`
  and `devEngines.packageManager` (`onFail: error`), first pinned to 11.19.1.

## Method

1. `installer.install(pin, { allowAmbient: false })` for each pin, then
   `<binDir>/npm --version` — the call `steps/activate-package-manager`
   makes.[^activate-step]
2. The same 12.0.2 pin with `allowAmbient: true` while the ambient npm is 11.19.1.
3. In the workspace: install under the 11 shim; rewrite both fields to the 12.0.2
   pin exactly as the upgrade service does; remove `package-lock.json` and
   install under the 12 shim, which is `steps/install`'s npm
   recipe.[^install-step]
4. Negative control: remove the lockfile again and install under the OLD 11 shim
   against the 12 pin.

## Results

| Case | Result |
| --- | --- |
| `npm@12.0.2` tool-cache | `source: tool-cache`, bins `bin/npm-cli.js` / `bin/npx-cli.js`, shim prints `12.0.2` |
| `npm@11.19.1` tool-cache | `tool-cache`, shim prints `11.19.1` |
| `npm@12.0.2`, `allowAmbient: true`, ambient 11.19.1 | `tool-cache` — the ambient version is rejected, not accepted as close enough |
| install under 12 against the 12 pin | no `EBADDEVENGINES`; `+sha512` in `devEngines.packageManager.version` satisfies npm 12's check; `lockfileVersion: 3` |
| install under 11 against the 12 pin (`onFail: error`) | `EBADDEVENGINES … "12.0.2+sha512…" does not match "11.19.1"`, exit non-zero, no lockfile written |

## What this rules in or out

- npm 12 needs no kit change on the tool-cache path: its `bin` shape did not
  move between 11 and 12, so the installer that already handles npm 11 handles
  12. effected#776's remaining scope is the ambient path on a runner whose
  bundled npm is itself 12.x (no hosted image ships one as of this date) and
  documentation.[^effected-776]
- The guard issue #449 asks for — a pin bump must not land in a state the runner
  cannot run — is `steps/activate-package-manager` failing the job when the pin
  cannot be provisioned. The negative control shows what that guard prevents on
  npm: the old manager refuses the new `devEngines` pin outright, so a run that
  skipped activation would commit nothing usable. The npm cases in
  `program.inner.test.ts` pin both halves (provision-and-install under the new
  bin dir; fail-and-never-install when provisioning fails).[^program-test][^issue-449]
- Not covered here: a real consumer run through the committed `dist` on a
  hosted runner. No npm workspace in either organisation consumes this action,
  so the end-to-end proof for npm lives in silk-runtime-action's provisioning
  matrix (`node-npm-12` fixture) rather than in a pin-bump PR.

[^activate-step]: `src/steps/activate-package-manager.ts` calls `installer.install(parsed, { allowAmbient: false })` and fails typed on any installer error.
[^upgrade-service]: `src/services/package-manager-upgrade.ts` writes `<pm>@<version>+<hash>` into `packageManager` and `<version>+<hash>` into `devEngines.packageManager.version` for corepack-managed managers (npm, pnpm).
[^install-step]: `src/steps/install.ts` removes `package-lock.json` via `node:fs` and runs `npm install` with the activated bin dir ahead on `PATH`.
[^program-test]: `__test__/unit/program.inner.test.ts`, "innerProgram — package-manager activation", the two npm 11 → 12 cases.
[^issue-449]: <https://github.com/savvy-web/silk-update-action/issues/449>
[^effected-776]: <https://github.com/spencerbeggs/effected/issues/776>
