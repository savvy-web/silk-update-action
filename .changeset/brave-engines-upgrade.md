---
"silk-update-action": patch
---

## Other

Upgrade `@savvy-web/silk-effects` to `^3.0.0` (changesets v3 `next` engine) and `@savvy-web/silk` to `^2.0.0`. Adds `build.nativeDynamicImports` for `@changesets/apply-release-plan` and `workspaces-effect` so their fully dynamic `await import()` calls survive bundling instead of failing at runtime with `Cannot find module`.

## Dependencies

| Dependency              | Type          | Action  | From    | To      |
| ----------------------- | ------------- | ------- | ------- | ------- |
| @savvy-web/silk-effects | dependency    | updated | ^2.1.0  | ^3.0.0  |
| @savvy-web/silk         | devDependency | updated | ^1.3.11 | ^2.0.0  |
