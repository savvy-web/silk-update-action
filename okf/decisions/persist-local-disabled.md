---
type: Decision
title: Keep persistLocal disabled
description: The builder's persistLocal option, which would commit a duplicate copy of dist/ into .github/actions/local for an act smoke-test loop, stays off because nothing in this repository runs act.
status: draft
tags:
  - bundle
  - ci
generated:
  by: okfit/claude-code
  at: 2026-09-13T20:05:44Z
  body_sha256: c9692a231b9beb822ecf104a45150291cc17a174483a0b3562472d485ae75ae6
sources:
  - id: action-config
    resource: ../../action.config.ts
---

# Keep persistLocal disabled

## Context

`@savvy-web/github-action-builder`'s `persistLocal` option writes a byte-for-byte
copy of the built `dist/{pre,main,post}.js` into a second location
(`.github/actions/local` here) so a workflow can reference the action by local
path — the intended use is an `act`-based smoke test that runs the action
without a published tag. This action is bundled and fetched fresh by every
consumer on every run, so anything added to the repository's tracked output
is downloaded by every one of those consumers.[^action-config]

## Decision

`persistLocal.enabled` stays `false`.[^action-config] Persisting would
duplicate the committed `dist` output — see
[dist payload size](../measurements/dist-payload-size.md) for the measured
byte counts — roughly doubling what every consumer downloads on every run, to
serve a local `act` loop nobody exercises in this repository. The workflow
scaffolding that would have consumed a persisted local copy
(`.github/workflows/act-test.yml`, referencing `.github/actions/local`) never
actually worked even when it existed, since that path was never generated
without `persistLocal` enabled — it was removed rather than fed.

## Alternatives rejected

- **Enable `persistLocal` to match the kit's own canonical guidance**, which
  recommends it so a committed local path exists as an `act` target. Rejected
  on measured cost against zero measured benefit: no workflow in this
  repository invokes `act`, and the byte cost is not hypothetical — it is a
  near-doubling of the tracked build output.
- **Keep the broken `act-test.yml` workflow around in case `persistLocal` is
  enabled later.** Rejected: a workflow that references a path nobody
  generates is not scaffolding, it is a trap for the next reader who assumes
  its presence means the path exists.

## Consequences

- No local, path-referenceable copy of this action exists for `act` to run
  against. A contributor who wants to smoke-test the action locally with
  `act` would need to enable `persistLocal` themselves and accept the
  temporary payload increase, or test against a real consumer workflow
  instead (see the `dev`-branch testing runbook).
- The committed `dist` size stays at roughly its built size rather than
  roughly double it.

## What would change the answer

A real consumer of the persisted output — a working `act` job, or a CI step
that runs the action from the local path — would justify re-enabling this.
Canon alignment on its own is not sufficient justification; the workflow that
would consume the output has to exist and work first.

[^action-config]: `../../action.config.ts`
