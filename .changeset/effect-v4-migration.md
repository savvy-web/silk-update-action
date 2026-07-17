---
"silk-update-action": minor
---

## Maintenance

Migrate the action to Effect v4 (`effect@4.0.0-beta.98`) and the `@effected` app kit. The action's inputs and outputs are unchanged.

### Effect v4 and the @effected kit

- `effect` and `@effect/platform-node` now resolve from the `catalog:effect` v4 catalog; the separate `@effect/platform` dependency is dropped (it is folded into core in v4).
- The standalone Effect libraries are replaced by their `@effected` equivalents: `semver-effect` becomes `@effected/semver`, `workspaces-effect` becomes `@effected/workspaces` (with `@effected/lockfiles` for lockfile parsing), `runtime-resolver` becomes `@effected/runtimes`, and `yaml` becomes `@effected/yaml`.
- Domain services move to the v4 class-based `Context.Service` form and the v4 error, layer and schema APIs.

### Package-manager detection

Detection is now stricter: a bun or pnpm repository is identified from its lockfile together with the manifest, not from `devEngines.packageManager` alone (the same rule already applied to yarn). A repository that names a package manager only in `devEngines` and has no lockfile is now treated as npm.

### Test harness

The Vitest config temporarily runs without `@vitest-agent/plugin`, which is Effect v3-only and crashes Vitest at config load under v4; the same coverage gate is preserved. Restore the plugin once it ships a v4-compatible release.
