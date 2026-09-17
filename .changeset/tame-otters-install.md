---
"silk-update-action": patch
---

## Bug Fixes

Installs and runs custom commands under the package manager version that was just pinned, instead of the version the job started on.

* After `upgrade-package-manager` rewrites the pin, the exact `<pm>@<version>+<hash>` is now provisioned and put on `PATH` before `pnpm clean --lockfile && pnpm install` and any `run` custom commands execute
* Fixes lockfile rejections (`ERR_PNPM_LOCKFILE_CONFIG_MISMATCH`) that occurred when, e.g., pnpm was pinned to 12 but the install still ran under pnpm 11
* Applies to pnpm, npm, and bun
* If the pinned version cannot be provisioned, the run now fails instead of silently installing under the old manager
