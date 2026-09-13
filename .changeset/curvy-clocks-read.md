---
"silk-update-action": patch
---

## Maintenance

* Updates the core `@effected` kit and moves `effect` to 4.0.0-rc.115
* Keeps the published `result` JSON Schema's objects closed (`additionalProperties: false`) after `effect` flipped the lowering's default to open — the emitted schema is unchanged
