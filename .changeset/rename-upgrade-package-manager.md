---
"silk-update-action": major
---

## Breaking Changes

### Input renamed: `update-pnpm` → `upgrade-package-manager`

The pnpm self-upgrade input has been renamed from `update-pnpm` to `upgrade-package-manager` for consistency with the `upgrade-runtime-*` inputs. The old name is no longer recognized — consumers must rename the input in their workflow files.

```yaml
# Before
- uses: savvy-web/silk-update-action@v1
  with:
    update-pnpm: true

# After
- uses: savvy-web/silk-update-action@v1
  with:
    upgrade-package-manager: true
```

The input accepts `false` | `true` | `auto` | a semver range (default `true`). It currently upgrades pnpm only; support for other package managers is planned.

## Features

### Direct-edit pnpm upgrade with hash pinning and range support

`PnpmUpgrade` now edits the root `package.json` `packageManager` and `devEngines.packageManager` fields directly instead of running `corepack use` (which errors when both fields are present). The resolved version is written as a corepack-canonical `version+sha512.<hex>` hash derived from the npm registry integrity, so the committed fields are identical to what `corepack use` would produce.

The input also accepts explicit semver ranges (e.g. `^11`) that may cross majors and can add a `packageManager` field when none exists. `true`/`auto` resolve the latest within the current major, favoring the `devEngines.packageManager` version as the reference. The pnpm upgrade now triggers `pnpm install --fix-lockfile` to activate the new version via corepack reading the updated fields.

## Maintenance

Action and package renamed from `pnpm-config-dependency-action` to `silk-update-action` to align with the Silk Suite. Update `uses:` references accordingly:

```yaml
# Before
uses: savvy-web/pnpm-config-dependency-action@v1

# After
uses: savvy-web/silk-update-action@v1
```
