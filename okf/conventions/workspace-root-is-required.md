---
type: Convention
title: Require the workspace root as a parameter everywhere it is used
description: Every service method and standalone helper that reads or writes workspace files takes the workspace root as a required parameter; none may default to process.cwd().
status: draft
stale_after: 2027-03-12T00:00:00Z
tags:
  - architecture
generated:
  by: okfit/claude-code
  at: 2026-09-13T20:05:44Z
  body_sha256: aeded23c20d139b1f47af95a595b6a4a56838efdaa0e74b7ec4e093e26882098
sources:
  - id: program
    resource: ../../src/program.ts
  - id: custom-commands
    resource: ../../src/steps/custom-commands.ts
  - id: branch-service
    resource: ../../src/services/branch.ts
  - id: peer-sync
    resource: ../../src/services/peer-sync.ts
  - id: package-manager-service
    resource: ../../src/services/package-manager.ts
---

# Require the workspace root as a parameter everywhere it is used

Give every service method and standalone helper that reads or writes a
workspace file — git commands, manifest edits, custom-command execution,
lockfile capture — a required `workspaceRoot: string` (or equivalently named)
parameter, and thread `detected.root` (the root `detectPackageManager`
resolved) through from `program.ts`.[^program] Never let such a parameter
default to `process.cwd()`. The one legitimate exception is
`detectPackageManager` itself, whose own `cwd?: string` parameter defaults to
`process.cwd()` as the *starting point* for walking up to find the root in
the first place — there is no root yet to require at that call.[^package-manager-service]

## Why

This action can legitimately be invoked from a subdirectory of the
workspace it operates on. A parameter that quietly defaults to
`process.cwd()` does not fail in that case — it reads (or writes) a
different, wrong directory, succeeds, and reports a confident wrong answer.
That is worse than an error: nothing distinguishes the wrong-directory run
from a correct one except its content.

This defect entered through the same shape four separate times, in four
separate rounds, three of them caught by reviewers rather than by an
internal check: `commitChanges`, `ensureBaseHistory`, the step now in
`steps/detect-changes.ts`, and `steps/custom-commands.ts` each had a
parameter that silently defaulted to `process.cwd()` before being made
required.[^branch-service][^custom-commands] `syncPeers` never had this bug
because it takes **no** workspace-root parameter at all —
`WorkspaceDiscovery` binds its root when its layer is built, so a root
parameter on `syncPeers` could only ever have been ignored, and passing one
would have been a parameter nobody read.[^peer-sync]

Making the parameter required rather than optional converts every future
instance of this bug into a compile error instead of a silent wrong
directory. When the four instances above were fixed, `src/` itself needed
no other edits — every production caller was already passing a root
explicitly, so the defaults were pure hazard providing nothing. It was test
call sites relying on the defaults, two of which were `chdir`-ing the whole
test process into a temp directory specifically to reach the default — a
mutation of global process state to work around an unnecessary optional
parameter.

## How to check

- `grep -rn "process.cwd" src/` should show only the one exception in
  `detectPackageManager`'s own `cwd ?? process.cwd()` fallback, and doc
  comments referencing the rule — no other call in `src/` should read or
  default to `process.cwd()`.[^package-manager-service]
- For any new service method or step that reads or writes a workspace file,
  confirm its workspace-root parameter has no default and is threaded from
  `detected.root` in `program.ts`, not re-derived.[^program]
- For a helper backed by a root-bound kit layer (like `WorkspaceDiscovery`),
  confirm it takes **no** root parameter at all, since one would be
  unreachable dead code rather than a safety net.[^peer-sync]

[^program]: `../../src/program.ts`
[^custom-commands]: `../../src/steps/custom-commands.ts`
[^branch-service]: `../../src/services/branch.ts`
[^peer-sync]: `../../src/services/peer-sync.ts`
[^package-manager-service]: `../../src/services/package-manager.ts`
