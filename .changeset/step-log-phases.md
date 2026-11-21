---
"silk-update-action": minor
---

## Features

### Phased job log

The job log is now grouped into four phase headings: Setup, Update, Install and Publish. Each step writes one result line, marked `✓`, `⚠` or `✗`, with its duration and a short summary such as `Dependencies · 3 updates` or `Pull request · #42`.

* A step that succeeds folds its detail, including the reason it was skipped, under its result line
* A failed step writes its detail unfolded, and warnings and errors still appear as annotations right away
* Install and the `run` commands write their command line, output and exit code as their step's detail, so a failed install or test run shows its output in the log
* A step running longer than 30 seconds, such as a slow install, streams its output live; with step debug logging on, every step streams from the start
* The pre and post phases each write one step, for provisioning and revoking the GitHub App token, and a failed revocation shows as `⚠` without failing the job

Inputs, outputs and the `result` document are unchanged.
