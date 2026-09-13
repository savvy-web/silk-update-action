---
type: Convention
title: Read every input through ActionInput, never bare Config
description: readInputs must resolve every action input via ActionInput.*, not Config.*, because bare Config resolves nothing under the runner's mangled INPUT_* names and silently takes its default.
status: draft
stale_after: 2027-03-12T00:00:00Z
tags:
  - ci
  - dx
generated:
  by: okfit/claude-code
  at: 2026-09-13T20:05:44Z
  body_sha256: bab2dd3b78e8ccfbcb9b573b00e35feeeb16849a4a635ed83fd9c4122d399b2e
sources:
  - id: inputs-ts
    resource: ../../src/schema/inputs.ts
  - id: inputs-test
    resource: ../../__test__/unit/schema/inputs.test.ts
---

# Read every input through ActionInput, never bare Config

Read every action input with `ActionInput.string` / `.boolean` / `.integer` /
`.list`, never with bare `Config.string` / `Config.boolean` / etc.[^inputs-ts]
Do this even where a `Config`-shaped read would type-check — it will not
resolve anything under a real runner.

## Why

GitHub Actions exports inputs as `INPUT_*` environment variables, mangling
only spaces in the name (`upgrade-runtime-node` becomes
`INPUT_UPGRADE-RUNTIME-NODE`, dash intact). `ActionInput`'s accessors know
this mangling; a bare `Config.string("dependencies")` looks up the literal
name `dependencies`, finds nothing, and silently falls through to its
`withDefault` — including on `dry-run`, so a workflow asking to rehearse a
run performs a live one instead. Nothing in that failure mode raises or
warns: every step just reports "not configured," and the run reports
success having answered a question nobody asked. This is the regression
`readInputs` and its test exist to prevent.[^inputs-ts]

`ActionInput.list` additionally owns the multi-value grammar (newline lists
with `-`/`*` bullets, `#` comment lines dropped, JSON arrays, comma-separated
values) for `config-dependencies`, `dependencies`, `peer-lock`, `peer-minor`
and `run`. It **fails** on an absent input and on an empty one, which makes
the `Config.withDefault([])` piped onto every list read load-bearing rather
than decorative — remove the `withDefault` and a workflow that sets nothing
for that input fails the run instead of getting an empty list.[^inputs-ts]

## How to check

- Grep `src/schema/inputs.ts` for any `Config.string(`, `Config.boolean(`,
  `Config.integer(` or `Config.array(` call that is not immediately piped
  from an `ActionInput.*` read — none should exist.
- Run `__test__/unit/schema/inputs.test.ts`, which injects a runner-shaped
  `INPUT_*` environment through `ActionInput.layer` rather than
  `process.env` directly.[^inputs-test] Reverting any input to bare `Config`
  fails every assertion for that input, because the injected environment
  only satisfies the mangled name `ActionInput` derives.
- If a new input is added to `action.yml`, confirm it is added to
  `INPUT_NAMES` in the same commit — a mirror-as-data tuple the input test
  compares against the manifest, so the two cannot silently disagree.

See [action inputs](../interfaces/action-inputs.md) for the full grammar and
validation this rule feeds into.

[^inputs-ts]: `../../src/schema/inputs.ts`
[^inputs-test]: `../../__test__/unit/schema/inputs.test.ts`
