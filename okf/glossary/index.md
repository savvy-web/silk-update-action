# Glossary

* [config dependency](config-dependency.md) - pnpm's configDependencies mechanism, and this action's own reproduction of the workflow for bun; not the same thing this repository consumes to get its own @effected ranges.
* [dev (branch)](dev-branch.md) - The long-lived feature branch consumers pin @dev against and run the committed dist from — never a scratch integration branch, and never rewritten.
* [kept (catalog delta)](kept-delta.md) - A CatalogDelta action of "kept" means exactly one thing — a user override or addition survived the three-way catalog merge. An entry that is ours and did not move produces no delta at all.
* [proven-clean](proven-clean.md) - The one peer-report state that gates positively — supported, no unresolved importers, nothing unverified, and no required rows — distinct from a bare "no required rows", which can also mean "not examined".
* [release-age gate](release-age-gate.md) - This action's resolution-time mirror of pnpm's minimumReleaseAge/minimumReleaseAgeExclude, combined strictest-wins across inline settings and replayed config-dependency hooks, and fail-open by design.
* [unsatisfiable (package-manager upgrade)](unsatisfiable.md) - The PackageManagerUpgrade skip kind meaning nothing in the detected manager's own release list satisfies the configured range — almost always a range typed for a different manager, and the only skip kind logged at warning.
