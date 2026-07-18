# Type Definitions

[Back to index](./_index.md)

## Overview

Types are defined using Effect Schema (v4) in `src/schemas/domain.ts`. Error
types use `Schema.TaggedErrorClass` (v4; was `Schema.TaggedError`) in
`src/errors/errors.ts`. Module-level types (e.g., `PnpmUpgradeResult`) are
defined in their respective service files.

No barrel re-exports exist. Import directly from the defining module.

Effect v4 Schema shifts the constructor spelling the snippets below use: literal
unions are `Schema.Literals([...])` (was `Schema.Literal(...)`) and refinements
attach via `.check(...)` (e.g. `Schema.String.check(Schema.isMinLength(1))`,
`Schema.Number.check(Schema.isGreaterThan(0))`) rather than `.pipe(Schema.…)`.

## Domain Schemas (src/schemas/domain.ts)

See `src/schemas/domain.ts` for the full set of `Schema.Struct` definitions
(`BranchResult`, `DependencyChange`, `ChangedPackage`, `ChangesetFile`,
`PullRequestResult`, `CatalogDelta`). Each schema derives its TypeScript type via
`typeof Schema.Type`.

The load-bearing type is the `DependencyType` discriminator, shared by
`DependencyUpdateResult` and `LockfileChange` and used across the pipeline as
the changeset-trigger signal:

```typescript
/**
 * Dependency type discriminator. The `runtime` member tags
 * devEngines.runtime engine bumps (node/deno/bun) emitted by RuntimeUpgrade.
 */
export const DependencyType = Schema.Literals([
 "config",
 "dependency",
 "devDependency",
 "peerDependency",
 "optionalDependency",
 "runtime",
]);

/** One per (path, dep, section) update; carries the precise `type`. */
export const DependencyUpdateResult = Schema.Struct({
 dependency: NonEmptyString,
 from: Schema.NullOr(Schema.String),
 to: NonEmptyString,
 type: DependencyType,
 package: Schema.NullOr(Schema.String),
});

/** One per (catalog change, importer, section) triple from compareLockfiles. */
export const LockfileChange = Schema.Struct({
 type: DependencyType,
 dependency: NonEmptyString,
 from: Schema.NullOr(Schema.String),
 to: NonEmptyString,
 affectedPackages: Schema.Array(Schema.String),
});
```

## Module-Level Types (src/services/pnpm-upgrade.ts)

```typescript
/** Result of a pnpm upgrade operation. */
export interface PnpmUpgradeResult {
 readonly from: string | null; // null when a packageManager field was added
 readonly to: string;
 readonly packageManagerUpdated: boolean;
 readonly devEnginesUpdated: boolean;
 readonly added: boolean; // true when a packageManager field was created
}
```

## Module-Level Types (src/services/runtime-upgrade.ts)

```typescript
/**
 * Result of a single runtime upgrade. `from` is always the version the manifest
 * already declared (an upgrade requires an existing entry); `to` is always a
 * bare, exact version (no range operator).
 */
export interface RuntimeUpgradeResult {
 readonly runtime: RuntimeName;
 readonly from: string;
 readonly to: string;
}

/** Per-runtime mode: "false" | "auto" | a semver range. */
export interface RuntimeUpgradeConfig {
 readonly node: string;
 readonly deno: string;
 readonly bun: string;
}
```

## Pure Helper Types (src/utils/pnpm.ts)

```typescript
/** Parsed pnpm version info. */
export interface ParsedPnpmVersion {
 readonly version: string;
 readonly hasCaret: boolean;
 readonly hasSha: boolean;
}
```

## Pure Helper Types (src/utils/runtime.ts)

```typescript
/** A JavaScript runtime managed by this action. */
export type RuntimeName = "node" | "deno" | "bun";

/** A single devEngines.runtime entry (extra keys preserved on write). */
export interface RuntimeEntry {
 name?: string;
 version?: string;
 onFail?: string;
 [key: string]: unknown;
}
```

## Effect Error Types (src/errors/errors.ts)

Errors use Effect v4's `Schema.TaggedErrorClass` for typed error handling with
rich metadata. See `src/errors/errors.ts` for the full definitions. The local
`ActionError` union covers:

- `InvalidInputError` — `{ field, value, reason }`.
- `GitHubApiError` — `{ operation, statusCode?, message }`. Exposes
  `isRateLimited` (429), `isServerError` (>= 500) and `isRetryable`
  (rate-limited or server error).
- `GitError` — `{ operation, exitCode, stderr }`; `isRetryable` for `fetch`/`push`.
- `PnpmError` — `{ command, dependency?, exitCode, stderr }`; `isRetryable` for `install`.
- `ChangesetError` — `{ reason, packages? }`.
- `FileSystemError` — `{ operation, path, reason }`.
- `LockfileError` — `{ operation, reason }`.
- `DependencyUpdateFailures` — aggregate `{ failures, successful }` for
  partial-success batch updates; exposes `partialSuccess`.

`isRetryableError(error)` and `getErrorMessage(error)` are exported helpers
over the union.

Input validation inside `program.ts` raises the library `ActionInputError`
(from `@savvy-web/github-action-effects`), not the local `InvalidInputError`.
