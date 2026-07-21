---
"silk-update-action": patch
---

## Bug Fixes

* Stopped the action from rewriting scoped `pnpm-workspace.yaml` keys (e.g. `"@parcel/watcher"`) from double to single quotes on every run. `pnpm-workspace.yaml` formatting now quotes with double quotes, matching the quoting style already used elsewhere in the file, so re-running the action against an already-formatted workspace file no longer produces a spurious quote-style diff.
