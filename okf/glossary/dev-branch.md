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
  at: 2026-11-10T18:07:49Z
sources:
  - id: branch-sync-workflow
    resource: ../../.github/workflows/branch-sync.yml
  - id: effected-toml
    resource: ../../effected.toml
integrity:
  generated:
    body: bf09eb097321ad8d
---

# dev (branch)

**The wider ecosystem's sense:** a `dev`/`develop` branch is usually a scratch
integration branch — feature branches merge into it, it gets rebased or
force-pushed freely, and nothing external depends on its exact history.

**This repository's sense is the opposite of that.** `dev` **is** the feature
branch: work is committed to it directly with ordinary commits, not merged in
from short-lived branches. It is long-lived and it is never rewritten — no
squash, no rebase, no force-push — because this action is bundled
(`effected action build`, configured by `effected.toml`, inlines every
runtime dependency into `dist/{pre,main,post}.js`[^effected-toml]), and a consumer workflow that pins
`uses: savvy-web/silk-update-action@dev` runs that **committed `dist`**, not
`node_modules`. Other repositories' CI is pinned to whatever commit currently
sits at the tip of `dev`, which is the property an ordinary scratch `dev`
branch does not have. `main` is the last **released** state, reached only
through a `dev → main` pull request that GitHub squashes at merge without
rewriting `dev` itself — see
[the `branch-sync.yml` workflow](../../.github/workflows/branch-sync.yml)[^branch-sync-workflow].

See [never rewrite the dev branch](../conventions/never-rewrite-dev.md) for
the full rule and the consequences of forgetting it.

[^effected-toml]: `effected.toml`
[^branch-sync-workflow]: `.github/workflows/branch-sync.yml`
