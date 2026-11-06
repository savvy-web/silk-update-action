---
"silk-update-action": patch
---

## Bug Fixes

- A first-time `catalog` or `catalogs` block written to a root `package.json` now goes straight after `workspaces` rather than at the end of the file. Existing blocks stay where they are.
