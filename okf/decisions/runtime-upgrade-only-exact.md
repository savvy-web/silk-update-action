---
type: Decision
title: Runtime upgrades only ever upgrade an existing entry, and always write a bare exact version
description: RuntimeUpgrade never adds a devEngines.runtime entry a manifest lacks, and it never writes a range operator back — both rules hold in every mode, because a downstream consumer cannot accept either.
status: draft
tags:
  - compat
generated:
  by: okfit/claude-code
  at: 2026-10-21T14:36:45Z
sources:
  - id: runtime-upgrade-service
    resource: ../../src/services/runtime-upgrade.ts
  - id: runtime-utils
    resource: ../../src/utils/runtime.ts
  - id: runtime-upgrade-unit-test
    resource: ../../__test__/unit/services/runtime-upgrade.test.ts
integrity:
  generated:
    body: 89f3b297bdfd5a95
---

# Runtime upgrades only ever upgrade an existing entry, and always write a bare exact version

## Context

`RuntimeUpgrade.upgrade(config, workspaceRoot)` reads the root manifest's
`devEngines.runtime` entries (node/deno/bun) and, per runtime, resolves a
target version through `@effected/runtimes` and writes it back through
`PackageJsonFile.modify`.[^runtime-upgrade-service] Two rules govern that
write, and both are stated as absolutes in the module's own doc comment
because an earlier version of each was looser and produced a bug a consumer
had to notice.[^runtime-upgrade-service]

## Decision

1. **Upgrade only, never add.** `upgradeOne` calls `locateRuntimeEntry` first;
   when no entry exists for a runtime, it logs a warning naming the input and
   returns `null` without touching the manifest — in every mode, `auto` and an
   explicit range alike.[^runtime-upgrade-service] An earlier version let an
   explicit range add a missing entry, so a bun-only repository that merely
   set `upgrade-runtime-node` grew a `node` entry it never
   declared.[^runtime-upgrade-service]
2. **Always write a bare, exact version.** The range in play — the existing
   entry's own version string under `auto`, or the user-typed input under an
   explicit range — only selects *which* line `@effected/runtimes` resolves;
   the value written back is always `.latest` with no operator re-attached.
   An existing `"^24.0.0"` resolves within `^24.0.0` and is rewritten as, for
   example, `"24.9.1"`, never as `"^24.9.1"`.[^runtime-upgrade-service] This
   is not a style preference: the next pipeline step,
   [silk-runtime-action](../consumers/silk-runtime-action.md), does not
   support range operators in `devEngines.runtime`, so any operator written
   here is a latent failure one step downstream rather than here.

`locateRuntimeEntry` returns the located entry **and** the JSONC path to its
`version` field in one walk, rather than the entry alone.[^runtime-utils]
`devEngines.runtime` is legally either a single object or an array, so the
path is `["devEngines", "runtime", "version"]` in the first shape and
`["devEngines", "runtime", <index>, "version"]` in the second — one walker
produces both so a second walker deriving the path separately cannot drift
from the first.[^runtime-utils] The returned entry is documented as
read-only: it exists to read the current version for the decision, never to
be mutated. A prior version of this helper (`findRuntimeEntry`) returned the
live object specifically so a caller could assign `.version =` in place and
then re-serialize the whole manifest, guessing its indentation; the current
design is the opposite of that on purpose, since the write is now a surgical
`PackageJsonFile.modify` edit at the returned path rather than a whole-file
rewrite.[^runtime-utils]

Resolver failures — including `VersionNotFoundError` for an end-of-life major
line — are caught per runtime and degrade to a warning; they never fail the
whole `upgrade` call, whose declared error channel covers only the
filesystem read/write around the manifest.[^runtime-upgrade-service]

## Alternatives rejected

- **Let an explicit range add a missing `devEngines.runtime` entry.** This
  is what an earlier version did, and it is rejected now precisely because it
  shipped: a bun-only repository configuring `upgrade-runtime-node: "^24"`
  gained a `node` entry the manifest never declared, silently changing what
  runtimes the repository claims to need.
- **Preserve the original range operator on write.** Rejected because the
  only downstream consumer of `devEngines.runtime` in this pipeline —
  [silk-runtime-action](../consumers/silk-runtime-action.md) — does not
  accept one; writing `^24.9.1` would pass this action's own validation and
  fail one step later.
- **Return the live parsed entry for in-place mutation.** Rejected once the
  write moved to `PackageJsonFile.modify`: mutating a value nothing reads
  again buys nothing, and returning the entry alongside a path (rather than
  the entry alone) is what lets the write stay a surgical edit instead of a
  whole-manifest re-serialize.

## Consequences

- A repository that wants a *new* `devEngines.runtime` entry created must add
  it by hand; no input to this action will create one.
- `auto` is a no-op whenever the existing entry is already a static version
  (`isStaticVersion`) — there is no range in that case to resolve
  against.[^runtime-upgrade-service]
- `NodeResolver.resolve` is passed `phases: current, active-lts,
  maintenance-lts` (`NODE_PHASES`). Its default omits maintenance-LTS, so a
  major entering maintenance (Node 24 on 2026-10-20) would resolve to
  `NoMatchingVersionError`, get logged as a warning and skipped — `auto` would
  silently stop patching that line. Only an end-of-life major is now
  skipped.[^runtime-upgrade-service]
- The tests use mock resolvers with fixed versions, never the bundled
  offline cache: that cache and the phase window move with the Node release
  calendar, so a test asserting on them fails on a date rather than on a
  change. An offline-cache integration suite was removed for exactly
  this.[^runtime-upgrade-unit-test]

## What would change the answer

If a downstream consumer of `devEngines.runtime` in this pipeline ever
accepted a range operator, the "always exact" half of this decision would
still likely hold for the other reason it exists — a bare version is
unambiguous evidence of what was actually resolved — but it would no longer
be forced by a hard failure one step away.

[^runtime-upgrade-service]: `src/services/runtime-upgrade.ts`
[^runtime-utils]: `src/utils/runtime.ts`
[^runtime-upgrade-unit-test]: `__test__/unit/services/runtime-upgrade.test.ts`
