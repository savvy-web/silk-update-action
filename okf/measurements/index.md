# Measurement

* [Committed dist payload size](dist-payload-size.md) - The byte cost every consumer downloads on every run, and what enabling persistLocal would add to it.
* [Isolating experiment over a duplicated @effected/github pair](github-0-6-0-isolating-experiment.md) - A controlled comparison across two states of the same duplicated pair, showing that the duplicate held constant while the type-check result flipped — so the stale transitive dependency inside one copy, not the duplication itself, was the actual variable.
* [Kit single-copy probe](kit-single-copy-probe-2026-09-04.md) - Whether each installed @effected/* package resolves to exactly one copy, and whether a resolved duplicate actually reaches the bundled dist — measured twice, nine days apart, with different answers.
* [Test suite count and its accounting history](test-suite-count.md) - The suite's test count across a sequence of changes, with each delta explained rather than merely observed — because an unexplained delta in either direction has twice been evidence of a real problem rather than noise.
