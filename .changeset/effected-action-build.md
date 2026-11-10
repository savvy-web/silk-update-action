---
"silk-update-action": patch
---

## Bug Fixes

* `upgrade-package-manager`, `upgrade-runtime-node`, `upgrade-runtime-deno` and `upgrade-runtime-bun` still reject a range with an empty `||` alternative, such as `^24.0.0 ||` or `^1.0.0 || || ^2.0.0`. The updated semver parser reads an empty alternative as "any version", as npm does, so without this check a stray `||` would have quietly widened a pinned range to every release, including the next major.

## Build System

* The action now builds with `effected action build` from `@effected/plugin`, configured by `effected.toml`, replacing the deprecated `@savvy-web/github-action-builder`. `dist/pre.js`, `dist/main.js` and `dist/post.js` keep their paths, so `action.yml` is unchanged. The bundles are about 18% smaller: `main.js` drops from 1.62 MB to 1.32 MB.
