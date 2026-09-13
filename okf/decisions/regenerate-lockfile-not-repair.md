---
type: Decision
title: Regenerate the lockfile from a clean slate rather than repair it in place
description: Why runInstall runs a clean-and-reinstall sequence per package manager instead of a repair-only install, and why the npm path removes the lockfile via node:fs instead of a shelled rm.
status: draft
generated:
  by: okfit/claude-code
  at: 2026-09-13T20:05:44Z
  body_sha256: 9de37ee4c3c9e94d1b6f6e0b341863a681bc6744d657a105f3ee0565fd6f929c
sources:
  - id: steps-install
    resource: ../../src/steps/install.ts
  - id: format
    resource: ../../src/format.ts
---

# Regenerate the lockfile from a clean slate rather than repair it in place

## Context

A single run of this action can mutate three separate inputs to dependency
resolution in one pass: the package manager's own version (self-upgrade), the
package manager's config (config-dependency catalogs, pnpmfile hooks), and
the declared version ranges in every manifest (regular and peer dependency
bumps). Whatever regenerates the lockfile afterward has to reflect all three
changes at once, under whichever of pnpm, bun, or npm the workspace uses.

## Decision

`runInstall(pm, workspaceRoot)` regenerates the lockfile from a clean slate
rather than repairing it in place, with every command anchored at the
detected `workspaceRoot` rather than the process's current
directory.[^steps-install] Per manager:

- **pnpm:** `pnpm clean --lockfile`, then
  `pnpm install --frozen-lockfile=false`. `clean --lockfile` removes the
  lockfile and `node_modules` through pnpm itself (unlinking cleanly across
  platforms, including Windows junctions, and running a consumer's own
  `clean`/`purge` script instead of the built-in one when the workspace
  declares one), requiring pnpm 11+. `--frozen-lockfile=false` opts back out
  of the CI default that otherwise refuses to write lockfile changes.[^steps-install][^format]
- **bun:** `bun install --force`, which re-resolves every dependency against
  the registry rather than replaying the existing lockfile.[^steps-install][^format]
- **npm:** removes `package-lock.json` via Node's `rmSync` (`node:fs`, not a
  shelled `rm`), then runs a plain `npm install` — npm has no clean-and-resolve
  mode of its own (`npm ci` requires the lockfile to already be correct), so
  the file is removed first and a plain install re-resolves from
  scratch.[^steps-install][^format] The removal uses `node:fs` rather than
  shelling out because `rm` does not exist on a Windows
  runner.[^steps-install]

`runInstall` uses `Run.text`, which fails typed on a non-zero exit, so an
install failure aborts the run rather than proceeding with (or committing) a
lockfile that does not match the manifests.[^steps-install] `installStep`
gates the whole call on whether the package-manager, config, regular, or peer
steps actually produced any updates, logging why it was skipped when none
did, rather than always running install unconditionally.[^steps-install]

## Alternatives rejected

- **A repair-only install (e.g. pnpm's `--fix-lockfile`).** Rejected: a
  repair pass reconciles the lockfile against the *existing* resolution
  rather than re-running resolution under the changed inputs. Because this
  action can move all three resolution inputs in the same pass, a
  repair-only install can commit an internally inconsistent lockfile — for
  example, an upstream peer range moving without a fresh resolution can leave
  a required peer unfilled, surfacing as `ERR_MODULE_NOT_FOUND` for the
  consumer at runtime rather than at commit time.
- **Shell out to `rm` for the npm lockfile removal.** Rejected: `rm` is not
  present on a Windows GitHub Actions runner, where `node:fs`'s `rmSync` is
  portable.
- **Anchor install commands at `process.cwd()`.** Rejected for the same
  reason other steps require an explicit workspace root: the action can be
  invoked from a subdirectory of the workspace, and an install run against
  the wrong directory would regenerate the wrong lockfile (or none) while
  still reporting success.
- **Run install unconditionally, every run.** Rejected: a run that made no
  dependency, config, or package-manager changes has nothing to regenerate,
  and an unconditional install would add work (and log noise) with no
  possible effect on the outcome. `installStep` folds the four upstream
  steps' results together to decide, rather than each step reaching across to
  its siblings.

## Consequences

- Advancing transitive dependency versions on every run is expected, not a
  regression to investigate — a clean reinstall always re-resolves the full
  graph.
- pnpm's clean-and-reinstall path requires pnpm 11 or newer; an older pnpm in
  the detected workspace would need a different sequence (not currently
  handled).
- Each manager's exact command line is duplicated between the imperative
  `runInstall` switch and the `INSTALL_LABEL` record in `format.ts`, purely
  for logging — the label must be kept in sync with the command by hand if
  either changes, since nothing derives one from the other.[^format]

[^steps-install]: `src/steps/install.ts`
[^format]: `src/format.ts`
