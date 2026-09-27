---
"silk-update-action": minor
---

## Features

### Package manager and config dependency pins are written bare

`upgrade-package-manager` and `config-dependencies` no longer write inline
`+<integrity>` suffixes into `packageManager`, `devEngines.packageManager.version`,
or `pnpm-workspace.yaml`'s `configDependencies` entries. Every field is written
bare, in the format pnpm itself writes (`pnpm@11.0.0`, or `^11.0.0` when the
repo had a devEngines range operator — the operator is kept, as
`pnpm self-update` does). npm is normalized the same way; bun was already bare.

```yaml
packageManager: pnpm@11.1.0
devEngines:
  packageManager:
    name: pnpm
    version: ^11.1.0
```

corepack is no longer on the runners to verify the old `+sha512.<hex>` suffix,
and pnpm drops it on its own next write anyway — the lockfile is now where
package-manager and config-dependency integrity lives, refreshed by the
install step this action already runs.

Any existing suffix is stripped the first time this action touches a field,
even when the version underneath is already current. That normalization is
logged, not reported as an upgrade — so a repository that still carries the
old suffixed form may see one pull request with zero dependency updates and
the generic `chore(deps): update dependencies` title, purely to converge the
format.

The registry download is still verified: before activating a new pnpm or npm
version, the action converts the registry's integrity into the installer's
own integrity option and checks the download against it. Bun's installer
verifies a different (GitHub-release) artifact and never needed this.

## Bug Fixes

- A resolved package-manager version that carries build metadata (a form that
  cannot be re-anchored into an existing `devEngines.packageManager.version`
  range) is now refused as an error before anything is written, instead of
  being written as a `devEngines` range that pnpm would reject.
