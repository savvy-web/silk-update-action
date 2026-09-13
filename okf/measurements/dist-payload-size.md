---
type: Measurement
title: Committed dist payload size
description: The byte cost every consumer downloads on every run, and what enabling persistLocal would add to it.
status: draft
stale_after: 2026-12-13T00:00:00Z
tags:
  - bundle
justifies:
  - ../decisions/persist-local-disabled.md
generated:
  by: okfit/claude-code
  at: 2026-09-13T20:05:44Z
  body_sha256: 9ac1b7a15ee17a08502dd09b8ddf254954ca1be99efc608dacf79353c1283987
sources:
  - id: dist-main
    resource: ../../dist/main.js
  - id: dist-pre
    resource: ../../dist/pre.js
  - id: dist-post
    resource: ../../dist/post.js
  - id: action-yml
    resource: ../../action.yml
---

# Committed dist payload size

## Inputs

The three bundled entry points this repository commits to `dist/`
(`main.js`, `pre.js`, `post.js`), plus `action.yml`, which
`@savvy-web/github-action-builder`'s `persistLocal` option would also copy
into `.github/actions/local` if enabled.

## Method

`cat dist/*.js | wc -c` for the combined bundle size; `ls -la dist/*.js` for
the per-file breakdown; `wc -c action.yml` for the manifest.

## Numbers

Re-measured 2026-09-13:

| file | bytes |
| --- | --- |
| `dist/main.js` | 1,527,665 |
| `dist/pre.js` | 300,719 |
| `dist/post.js` | 300,629 |
| **total (`dist/*.js`)** | **2,129,013** |
| `action.yml` | 6,835 |

Previously recorded (undated in the source it came from, prior to this
re-measurement): committed `dist` = 2,080,144 bytes; `action.yml` = 6,835
bytes. A `persistLocal`-enabled build was separately measured to add
2,086,999 bytes — about 20 bytes more than the recorded `dist` total, which is
consistent with the persisted copy also carrying a repointed `action.yml`
(`runs.main` etc. rewritten to the local path) rather than an identical copy.

The current total is **48,869 bytes larger** than the prior measurement
(2,129,013 vs 2,080,144), a difference attributable to ordinary code growth
between the two measurement dates rather than to any change in what is being
measured.

## What this rules in and out

- **Rules in:** enabling `persistLocal` would still roughly **double** the
  tracked build output that every consumer downloads on every run — the
  earlier delta (≈2.09 MB added atop ≈2.08 MB already committed) and the
  current total (≈2.13 MB) are the same order of magnitude, so the
  doubling claim is not an artifact of a stale number.
- **Rules out:** that the `dist` size is currently shrinking or has
  stabilized — it grew by roughly 2.3% between the two measurements, so a
  reader should expect this number to keep moving and re-derive it rather
  than trust either figure indefinitely.
- **Does not measure:** whether `action.yml` itself would need to be
  duplicated byte-for-byte or only repointed under `persistLocal` — the ≈20
  byte discrepancy in the prior measurement is noted but not decomposed here.

Re-derive with `cat dist/*.js | wc -c` and `wc -c action.yml` directly; do not
carry either number in this table forward without re-running both commands.
