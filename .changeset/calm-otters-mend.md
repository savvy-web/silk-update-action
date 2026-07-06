---
"silk-update-action": patch
---

## Bug Fixes

- Fixed the pnpm self-upgrade silently skipping with a warning on GitHub's macOS runners. Resolving available pnpm versions now goes through the action's npm registry client (which redirects npm's cache to a runner-writable directory) instead of shelling out to `npm view`, which failed with `EACCES` against the partially root-owned `~/.npm` cache.

## Features

- PR and commit subject lines now break down dependency updates by `package.json` section instead of lumping them together — for example `chore(deps): update 1 config dependency and 4 devDependencies` instead of `chore(deps): update 1 config and 4 dependencies` — so it's clear at a glance whether an update touched runtime, dev, or peer dependencies.
