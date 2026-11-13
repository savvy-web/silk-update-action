---
"silk-update-action": patch
---

## Bug Fixes

Yarn workspaces are now refused by the package-manager detector itself, and the failure names the signal that identified yarn: its lockfile, `packageManager` or `devEngines.packageManager`. A workspace whose only yarn signal is a stray `yarn.lock` is refused instead of being treated as npm.

Package-manager provisioning after an upgrade supports pnpm 12, npm and bun.
