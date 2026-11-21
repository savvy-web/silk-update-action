---
"silk-update-action": patch
---

## Refactoring

* Lockfile changes are now computed by the kit's `LockfileDiff.compare` instead of a local diff. The reported rows keep the same rules: specifier moves only, catalog changes per consuming package, and no rows for importers that appear or disappear whole. A bun catalog entry's resolved version now comes from the version its consumers actually resolved to, rather than a name lookup across the package list
* `pnpm-workspace.yaml` is formatted with silk's own `PnpmWorkspace` sort and format functions, so the bytes the action commits match what the consumer's lint hook writes without a local copy of its rules. `configDependencies` keys are still sorted, which silk leaves alone
