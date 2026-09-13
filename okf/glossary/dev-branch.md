---
type: Glossary
title: dev (branch)
description: The long-lived feature branch consumers pin @dev against and run the committed dist from — never a scratch integration branch, and never rewritten.
status: draft
tags:
  - release
  - ci
generated:
  by: okfit/claude-code
  at: 2026-09-13T20:05:44Z
  body_sha256: ede1d29b71fc6456a31a8eb60df35e128fe9d4f27563382a0510fdfcb61eea2f
sources:
  - id: branch-sync-workflow
    resource: ../../.github/workflows/branch-sync.yml
  - id: action-config
    resource: ../../action.config.ts
---

# dev (branch)

**The wider ecosystem's sense:** a `dev`/`develop` branch is usually a scratch
integration branch — feature branches merge into it, it gets rebased or
force-pushed freely, and nothing external depends on its exact history.

**This repository's sense is the opposite of that.** `dev` **is** the feature
branch: work is committed to it directly with ordinary commits, not merged in
from short-lived branches. It is long-lived and it is never rewritten — no
squash, no rebase, no force-push — because this action is bundled
(`action.config.ts` inlines every runtime dependency into
`dist/{pre,main,post}.js`[^action-config]), and a consumer workflow that pins
`uses: savvy-web/silk-update-action@dev` runs that **committed `dist`**, not
`node_modules`. Other repositories' CI is pinned to whatever commit currently
sits at the tip of `dev`, which is the property an ordinary scratch `dev`
branch does not have. `main` is the last **released** state, reached only
through a `dev → main` pull request that GitHub squashes at merge without
rewriting `dev` itself — see
[the `branch-sync.yml` workflow](../../.github/workflows/branch-sync.yml)[^branch-sync-workflow].

See [never rewrite the dev branch](../conventions/never-rewrite-dev.md) for
the full rule and the consequences of forgetting it.

[^action-config]: `action.config.ts`
[^branch-sync-workflow]: `.github/workflows/branch-sync.yml`
