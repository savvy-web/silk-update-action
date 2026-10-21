---
"silk-update-action": patch
---

## Bug Fixes

`upgrade-runtime-node` now resolves within Node lines that have entered maintenance-LTS. Previously the resolver only accepted current and active-LTS releases, so a repository declaring `^24.0.0` stopped receiving Node 24 patch upgrades the day Node 24 entered maintenance (2026-10-20); the run logged a warning and skipped the entry. Only end-of-life lines are now skipped.
