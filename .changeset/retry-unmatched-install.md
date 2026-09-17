---
"silk-update-action": minor
---

## Features

### `retry-unmatched` input

npm's publish-time malware scan can hold a freshly published version back from the registry for minutes while the publish itself reports success. An update run triggered off that publish failed the install with `ERR_PNPM_NO_MATCHING_VERSION` (npm `ETARGET`, bun `No version matching`) — a transient failure that read as a wrong range.

* New `retry-unmatched` input (default `1`, `0` disables): retries the install when the failure is that one no-matching-version shape, waiting 3, 6, 10, 15, then +10 minutes between attempts, and logs the wait before each retry. Any other install failure still fails the job immediately.
* The retry waits count against `timeout`. A `retry-unmatched` whose total wait does not fit inside `timeout` is rejected at input read with both numbers named, never clamped.
* `timeout` default raised from `180` to `480` seconds so the default retry fits with headroom. A workflow that sets `timeout` below `180` must also set `retry-unmatched: 0`.
