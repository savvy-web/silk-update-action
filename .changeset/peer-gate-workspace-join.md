---
"silk-update-action": patch
---

## Bug Fixes

- The `check-peers` gate now works on pnpm monorepos with internal dependencies. With `@effected/workspaces` 0.29 and later, every `link:` dependency on a workspace package was reported as unverified, which would have withheld auto-merge on every run. The peer check now passes the workspace's packages and catalogs to the check, so linked packages' peer dependencies, including `catalog:` ranges, are verified the way `pnpm peers check` verifies them.
- A peer satisfied by a `file:`, git or tarball dependency now withholds auto-merge, reported as `peerVersionUnresolved`, instead of being counted as satisfied. pnpm 11 and 12 disagree on whether such a peer is satisfied, so the gate no longer calls it clean.
- If the workspace packages or catalogs cannot be read, the check still withholds auto-merge rather than treating the report as clean.
