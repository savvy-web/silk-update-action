---
"silk-update-action": major
---

## Features

The action is now package-manager-dispatched. One detected fact — the package manager — selects the implementation at four points: config dependencies, install, the package-manager upgrade, and the lockfile diff. pnpm, bun and npm repos are all supported. The package manager is detected from `devEngines.packageManager`, falling back to lockfile and config-file presence. Yarn is detected and rejected with a clear error rather than being silently treated as something else.

- **Config dependencies in bun repos.** pnpm reads config dependencies from `pnpm-workspace.yaml`. bun has no such concept, so a package listed in `config-dependencies` is instead located in the root manifest's dependencies, its module is fetched and executed, and its `catalogs` export is merged into the root `package.json`'s `catalog` / `catalogs` fields. The tarball is verified against the registry's integrity before it is executed.

  Merging is **three-way** against the version that was previously installed, because — unlike pnpm, which merges catalogs in memory at install time and never rewrites the manifest — compat mode must write the result to disk, and a later run cannot otherwise tell a deliberate user override from an entry the action itself wrote. Entries the manifest still agrees with the previous version on are the action's to update; entries that diverge are the user's and survive, even if upstream dropped them; upstream removals propagate.

- **`upgrade-package-manager` upgrades bun and npm**, not just pnpm. Corepack-managed managers (pnpm, npm) keep the pinned `+sha512` hash; bun is written as a bare version, because corepack does not manage bun and never reads that field.

- **The install step is package-manager aware**: pnpm regenerates the lockfile (`pnpm clean --lockfile` then `pnpm install --frozen-lockfile=false`), bun re-resolves against the registry (`bun install --force`), npm removes `package-lock.json` and installs. The rationale is unchanged — the action mutates every input to dependency resolution, so the lockfile is regenerated rather than repaired.

- **The lockfile diff is package-manager agnostic.** It reads `pnpm-lock.yaml`, `bun.lock` and `package-lock.json` through one parser, so it works in every supported repo instead of silently capturing nothing outside pnpm. The pnpm-only `@pnpm/lockfile.fs` and `@pnpm/lockfile.types` dependencies are gone.

- **Catalog changes are reported.** On a config-dependency bump the PR body and job summary now render the table of catalog ranges that actually moved. Without it a bun run reported "1 config dependency updated" and showed none of what changed.

- **Logging names every step and every decision.** The old step numbering had drifted out of sync with the steps. Steps are now named, every dispatch point states which path it took and on what evidence, and no step is skipped without saying so and why.

## Breaking Changes

- **`config-dependencies` means something different per package manager.** pnpm reads `pnpm-workspace.yaml`; bun merges the package's `catalogs` export into `package.json`. In an **npm** repo it is unsupported and skipped with a warning: npm does not implement the `catalog:` protocol (bun and yarn do; the npm CLI does not).

- **`upgrade-runtime-*` upgrades only, and never adds.** With no existing `devEngines.runtime` entry for a runtime, there is nothing to upgrade and the input is skipped with a warning — in every mode. Previously an explicit semver range would *add* a missing entry, which grew an unwanted `node` entry in a bun-only repo.

- **Runtime versions are always written exact.** The range now only selects which line to resolve; the value written is the bare resolved version with no operator, so an existing `^24.0.0` is rewritten as e.g. `24.9.1`. Operator preservation was dropped deliberately: `silk-runtime-action`, which consumes `devEngines.runtime` in the next pipeline step, does not support range operators, so any operator written here is a latent downstream failure.

- **Two lockfile-diff reporting changes on the pnpm path.** A dependency declared in both `dependencies` and `devDependencies` now emits one change record per section rather than one in total, and a `peerDependencies` specifier change is now typed `peerDependency` (it was previously mislabelled `dependency`). Both are corrections, but they move `updates-count` and the generated PR title for existing pnpm consumers.

- Yarn repos are rejected with a clear error instead of being treated as pnpm.

## Bug Fixes

- Bun catalogs are written at the **top level** of `package.json` (`catalog` / `catalogs` as siblings of `workspaces`) rather than nested inside the `workspaces` object. Both shapes are valid and bun reads either, so the nested form was not broken — but writing it rewrote an author's `"workspaces": ["."]` array into an object form they never wrote. A manifest already carrying the nested form is read and migrated on the next write, so it self-heals.

- A misconfigured `upgrade-package-manager` range now **warns**. A range that no release of the detected package manager satisfies (for example a pnpm range left behind in a bun repo) was reported at the same level as a routine skip, so it scrolled past as ordinary output.

- `pnpm-workspace.yaml` formatting is skipped in non-pnpm repos, where there is no such file to format.
