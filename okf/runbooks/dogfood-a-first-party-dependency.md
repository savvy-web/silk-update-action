---
type: Runbook
title: Dogfood a fix to a first-party dependency before it publishes
description: Link an unreleased fix from a sibling checkout into this action's dev branch, exercise it end to end against a real consumer, then unlink once the dependency publishes.
status: draft
tags:
  - deps
  - dx
resource: ../../pnpm-workspace.yaml
generated:
  by: okfit/claude-code
  at: 2026-09-13T20:05:44Z
  body_sha256: bcd73598484dbab6c610f9b5315251bbe0a2ac9d969b173807197102365c0749
sources:
  - id: pnpm-workspace
    resource: ../../pnpm-workspace.yaml
  - id: package-json
    resource: ../../package.json
---

# Dogfood a fix to a first-party dependency before it publishes

Every first-party dependency this action consumes — the `@savvy-web/*`
packages and the whole `@effected/*` kit — lives in a sibling repository this
project also controls, so a bug or a missing API can be fixed there and
proven here before it is ever published. This action is **bundled**
(`pnpm build` inlines everything into `dist/{pre,main,post}.js`), so nothing
short of a full build-and-push exercises a change the way a consumer
actually runs it.

**Trigger:** a bug or missing capability in a first-party dependency needs to
be fixed and verified against this action before the fix is published.

## Steps

1. Build the dependency in its own repository checkout (for example
   `pnpm ci:build`) so its own build output is current.
2. Link it into this repository, choosing the mechanism by whether the
   package is also pulled in **transitively**:
   - **Direct-only** — the `@savvy-web/*` packages from `savvy-web/systems`
     — use `pnpm link ../systems/packages/<name>`.
   - **Also transitive** — the whole `@effected/*` kit from
     `spencerbeggs/effected`, which every kit package depends on other kit
     packages for — add a `pnpm-workspace.yaml` `overrides` entry targeting
     `link:../../spencerbeggs/effected/packages/<name>/dist/dev/pkg`, then
     run `pnpm install`. A bare `pnpm link` here leaves the transitive copy
     resolved to the registry version and bundles two copies of the
     package into `dist`.
3. Verify the link or override actually took effect, rather than assuming
   it did: `find node_modules -path "*@effected/<name>"` for an override,
   or `pnpm why <pkg>` either way. Do not check with
   `require('.../package.json').version` in isolation — a package's
   `exports` map can hide the file that check reads.
4. Keep the declared range for the linked package correct for the eventual
   unlinked install, so removing the link later does not leave a range that
   cannot resolve the published fix.
5. Iterate against the link: `pnpm typecheck`, `pnpm test`,
   `pnpm build`.
6. Commit the **full dogfood state** to `dev` in one commit — `src`,
   `dist`, the changeset, the override entry, and `pnpm-lock.yaml` — signed
   with the verified GPG key. See
   [never rewrite dev](../conventions/never-rewrite-dev.md): this state is
   committed directly to the long-lived `dev` branch, not to a short-lived
   feature branch, because only a push to `dev` is exercised by a real
   consumer.
7. Exercise it via a consumer workflow running against `@dev` — see
   [test a dev-branch build](test-a-dev-branch-build.md).
8. Once the dependency publishes, remove the `pnpm link` or the
   `overrides` entry, pin the now-published range, reinstall, and rebuild
   `dist` against the registry version. Push that rebuild to `dev` as well
   — a `dist` still bundling the linked copy is not the artifact any
   consumer should keep running.

For coordinating this loop across two agent sessions in sibling checkouts —
one working the dependency, one working this action — use the `/silk:dogfood`
mailbox protocol rather than improvising a handoff; it already encodes the
request/deliver/adopt/exit phases this loop goes through.

## Observable end state

Nothing is linked: `pnpm-workspace.yaml` carries no `overrides` entries, no
package in `node_modules` resolves through a local `link:` target, and the
committed `dist` was built against the published registry versions. The
declared range for the dependency that was fixed now admits the version that
carries the fix.

## Related

The `@effected/*` ranges this repository declares do not name a version
directly — see
[kit ranges come from a config dependency](../gotchas/kit-ranges-come-from-a-config-dependency.md)
for the extra indirection that adds when linking or unlinking a kit package,
and [bump the effected kit](bump-the-effected-kit.md) for the procedure that
applies once the fix has actually published and needs to be pulled in
through the normal pin rather than a link.
