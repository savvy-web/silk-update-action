---
"silk-update-action": patch
---

## Bug Fixes

### Version selection now respects declared semver ranges

Previously, both regular and config dependency updates resolved to npm's absolute `latest` tag, ignoring the specifier declared in `package.json` or `pnpm-workspace.yaml`. This caused caret- and tilde-pinned deps to silently cross major boundaries — for example, a `^4.0.0` entry could be bumped to `5.x`.

Version selection now honors the existing specifier:

- **Regular dependencies** (`dependencies` input): resolves the highest published version satisfying the existing `package.json` specifier. A `^4.0.0` entry stays within `4.x`, a `~3.0.0` entry stays within `3.0.x`, and an exact pin (e.g. `4.0.0`) is left untouched. Prereleases are excluded. An unbounded range such as `>=4.0.0` may still advance across majors, matching its declared intent.

- **Config dependencies** (`config-dependencies` input, hash-pinned entries in `pnpm-workspace.yaml`): resolves within a conservative range derived from the current version's major. A `>=1.0.0` dep stays within its major; a pre-stable dep (`0.x`) may advance to the first stable major but never crosses two majors in one step.
