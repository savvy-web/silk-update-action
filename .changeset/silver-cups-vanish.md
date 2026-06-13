---
"silk-update-action": minor
---

## Features

### Caret-on-zero regular deps roll forward to the first stable major

Regular dependencies declared with a caret on a pre-1.0 version (`^0.y.z`) now
resolve within a widened range (`>=0.y.z <2.0.0`) instead of the literal caret
range (`0.y.x`). This lets a pre-stable dependency advance across `0.x` minor
lines and adopt the first stable `1.x` release when one is available, rather
than being trapped by npm's caret-on-zero semantics.

All other specifier forms are unchanged: tilde (`~0.y.z`), exact pins (`0.y.z`),
comparator ranges (`>=0.y.z`), and caret deps on `>=1.0.0` versions continue to
resolve within the literal specifier.

```yaml
# package.json (before)
"some-lib": "^0.14.0"   # was trapped in 0.14.x

# package.json (after a run with some-lib@1.2.0 published)
"some-lib": "^1.2.0"    # advanced to latest stable major
```

