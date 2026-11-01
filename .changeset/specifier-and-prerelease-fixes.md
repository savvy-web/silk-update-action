---
"silk-update-action": patch
---

## Bug Fixes

* A compound dependency range such as `>=1.2.3 <2.0.0`, `1.2.3 || 2.0.0` or `1.2.3 - 2.0.0` is now left exactly as written. It was previously rewritten to a single bound, dropping its upper limit or its other alternatives.
* `upgrade-runtime-*` in `auto` mode no longer moves a pinned prerelease whose identifier contains an `x` (for example `22.11.0-next.1`); it was misread as a wildcard range.
* An invalid `auto-merge` value now fails with an error that names the input, the value received and the allowed methods (`merge`, `squash`, `rebase`). An empty value still disables auto-merge.
* Dependency patterns now match the same way on every runner OS, including Windows. As before, a bare `*` matches unscoped names only; use `@scope/*` or `**` for scoped packages.
