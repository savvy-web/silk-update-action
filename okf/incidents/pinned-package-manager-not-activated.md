---
type: Incident
title: A pnpm 11 to 12 upgrade committed a lockfile pnpm 12 refuses
description: The upgrade step rewrote the pin to pnpm 12.4.2 and the install then ran under the pnpm 11 shim the runtime action had put on PATH at job start, so the committed lockfile carried a v11 pnpmfileChecksum that pnpm 12 rejects with ERR_PNPM_LOCKFILE_CONFIG_MISMATCH.
status: draft
occurred: "2026-09-17"
guard: ../../__test__/unit/program.inner.test.ts
tags:
  - ci
  - compat
  - deps
generated:
  by: okfit/claude-code
  at: 2026-09-17T21:20:52Z
  body_sha256: 7c9aec905d2e9589377897a6fef51a6afd6379ad271465bd95db30f390ae0a78
sources:
  - id: activate-step
    resource: ../../src/steps/activate-package-manager.ts
  - id: upgrade-service
    resource: ../../src/services/package-manager-upgrade.ts
  - id: program-test
    resource: ../../__test__/unit/program.inner.test.ts
  - id: template-pr-196
    resource: "https://github.com/savvy-web/pnpm-module-template/pull/196"
  - id: template-run-196
    resource: "https://github.com/savvy-web/pnpm-module-template/actions/runs/35272832963/job/105376169449"
  - id: template-pr-198
    resource: "https://github.com/savvy-web/pnpm-module-template/pull/198"
---

# A pnpm 11 to 12 upgrade committed a lockfile pnpm 12 refuses

## Occurred

2026-09-17, in
[the pnpm-module-template consumer](../consumers/pnpm-module-template.md),
on the first run of `upgrade-package-manager: "^12.0.0"` against a workspace
pinned to pnpm 11.27.0.

## Where it surfaced

The update job itself was green and opened a PR bumping
`packageManager` and `devEngines.packageManager` to
`pnpm@12.4.2+sha512…`.[^template-pr-196] The PR's own CI then failed in its
install step with `ERR_PNPM_LOCKFILE_CONFIG_MISMATCH`: *the current
"pnpmfileChecksum" configuration doesn't match the value found in the
lockfile*.[^template-run-196]

## What it looked like

A PR that upgrades pnpm and cannot be installed by the pnpm it upgrades to.
The committed `pnpm-lock.yaml` still carried the `pnpmfileChecksum` line
byte-identical to `main`'s, which is a pnpm 11 artifact — pnpm 12 does not
write that key for config-dependency pnpmfiles and rejects a frozen install
that carries a stale one.

## Root cause (as a mechanism)

Writing the manifest fields activates nothing. The runtime action provisions
the package manager the workspace pinned **when the job started** and puts a
version-pinned shim directory on `PATH`; there is no corepack on the runner
to re-read `packageManager` afterward. So every spawn this action made after
the upgrade — `pnpm clean --lockfile`, `pnpm install`, the `run` commands —
executed pnpm 11 against a manifest naming pnpm 12, and pnpm 11 wrote the
lockfile.

The service's own comment had claimed the opposite ("the subsequent install
activates the new version via corepack reading the updated
fields"),[^upgrade-service] a statement that was true under the corepack-era
runtime action and had silently stopped being true. pnpm's own
`manage-package-manager-versions` self-switch, which would have papered
over this, did **not** fire for a real install in this workspace — a
workspace whose `devEngines.packageManager` carries `onFail: ignore` —
although `pnpm --version` in a minimal fixture did switch. The
first-encountered case of the mismatch also required a separate upstream
fix: the runtime action could not even *run* pnpm 12, because pnpm 12's
npm tarball ships `bin.pnpm` as a shebang-less shell placeholder that a
lifecycle script replaces with a native binary (fixed in
`@effected/github-actions@0.13.2`).

## Guard

`steps/activate-package-manager` now runs whenever the upgrade step wrote a
pin: it provisions that exact `<pm>@<version>+<hash>` spec through
`PackageManagerInstaller` with `allowAmbient: false`, publishes the bin
directory with `addPath` for later workflow steps, and returns it so the
install and custom-command steps prepend it to their children's `PATH`
through `ChildEnv.prependPath`. A pin that cannot be provisioned fails the
job rather than falling back to the old manager.[^activate-step] The
program-level suite asserts that an applied upgrade calls the installer with
the hashed pin and that the two install commands and the shelled `run`
command all carry a `PATH` leading with the provisioned directory, with a
no-upgrade control proving those spawns carry no env at all
otherwise.[^program-test] The end-to-end re-run against the same consumer
produced a PR whose lockfile had no `pnpmfileChecksum` and whose CI
installed under `pnpm v12.4.2`.[^template-pr-198]

## What it taught

An action that edits a manifest field controlling *which tool runs* must
also switch the tool in its own process, because the mechanism that once
did that for free (corepack) can be removed from the runner without any
change in this repository. The comment asserting the free behaviour was
the only place the assumption lived, and nothing tested it.

[^activate-step]: `src/steps/activate-package-manager.ts`
[^upgrade-service]: `src/services/package-manager-upgrade.ts`
[^program-test]: `__test__/unit/program.inner.test.ts`
[^template-pr-196]: <https://github.com/savvy-web/pnpm-module-template/pull/196>
[^template-run-196]: <https://github.com/savvy-web/pnpm-module-template/actions/runs/35272832963/job/105376169449>
[^template-pr-198]: <https://github.com/savvy-web/pnpm-module-template/pull/198>
