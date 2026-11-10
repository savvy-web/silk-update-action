# src/

The action's source. This file routes into the `okf/` bundle; it does not
restate it. Start from [`okf/modules/silk-update-action.md`](../okf/modules/silk-update-action.md)
for the architecture (entry points, `program.ts`, steps, services, layers).

## Before you change code here

| Doing | Read |
| --- | --- |
| Adding or editing a service | [`okf/conventions/static-layer-in-class-body.md`](../okf/conventions/static-layer-in-class-body.md) |
| Resolving a service in a second layer, or editing `layers/app.ts` | [`okf/conventions/adopting-a-service-is-a-wiring-change.md`](../okf/conventions/adopting-a-service-is-a-wiring-change.md), [`okf/gotchas/unprovided-service-is-not-a-type-error.md`](../okf/gotchas/unprovided-service-is-not-a-type-error.md) |
| Reading an action input | [`okf/conventions/read-inputs-via-actioninput.md`](../okf/conventions/read-inputs-via-actioninput.md) |
| Touching workspace files | [`okf/conventions/workspace-root-is-required.md`](../okf/conventions/workspace-root-is-required.md) |
| Writing `package.json` | [`okf/decisions/package-json-modify-only.md`](../okf/decisions/package-json-modify-only.md) |
| Adding an error, tag or interface field | [`okf/conventions/no-export-without-construction-site.md`](../okf/conventions/no-export-without-construction-site.md) |
| Changing a computed `import()` | [`okf/decisions/computed-dynamic-imports.md`](../okf/decisions/computed-dynamic-imports.md) |
| Imports, formatting, commits | [`okf/conventions/code-style.md`](../okf/conventions/code-style.md) |

The kit and Effect v4 are the first answer for any capability: check the
installed `@effected/*` and `effect` types before writing a helper.
