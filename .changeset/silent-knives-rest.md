---
"silk-update-action": patch
---

## Bug Fixes

`runInstall()` — the lockfile-reconciliation step that runs after pnpm, config dependency, runtime, and regular/peer range updates — now fully regenerates the lockfile instead of patching it. It runs `pnpm clean --lockfile` followed by `pnpm install --frozen-lockfile=false`, replacing the previous `pnpm install --frozen-lockfile=false --fix-lockfile`.

`--fix-lockfile` only repaired broken entries against the existing lockfile and did not re-run resolution under the changed pnpm version, config, and dependency ranges. This could commit an internally inconsistent `pnpm-lock.yaml` — most visibly when an upstream peer range changed (for example, a transitive raising its required `@effect/cluster` peer) and the new required peer was left unfilled, causing a downstream command to fail with `ERR_MODULE_NOT_FOUND`.

Regenerating the lockfile from scratch guarantees the committed `pnpm-lock.yaml` is correct and installable for the resolved pnpm version, config dependencies, and declared ranges.

- Expect larger `pnpm-lock.yaml` diffs in update PRs than before. Because the action obeys declared ranges, lockfile regeneration will advance transitive dependencies within their ranges. This is intentional — the previous behavior was silently suppressing those advancements.
- Requires pnpm 11+ for `pnpm clean`. If your root `package.json` defines a `clean` or `purge` script, pnpm will run that instead of the built-in lockfile cleanup; rename those scripts if they conflict.
