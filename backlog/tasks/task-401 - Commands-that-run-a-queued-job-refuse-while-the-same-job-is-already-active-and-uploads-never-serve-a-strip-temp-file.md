---
id: TASK-401
title: >-
  Commands that run a queued job refuse while the same job is already active,
  and uploads never serve a strip temp file
status: Done
assignee:
  - '@claude'
created_date: '2026-10-14 11:58'
updated_date: '2026-10-14 12:24'
labels: []
milestone: m-38
dependencies:
  - TASK-399
references:
  - packages/cms/src/cli.ts
  - packages/cms/src/admin/job-status.ts
  - packages/cms/src/content/metadata/sweep.ts
priority: low
type: bug
ordinal: 357800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
geekity strip-metadata and geekity resend (packages/cms/src/cli.ts) enqueue and run their job without checking for an active job of the same name, while the admin uses enqueueUnlessActive (packages/cms/src/admin/job-status.ts). A CLI sweep overlapping the server's sweep job can delete the job's in-flight .geekity-strip temp file (TASK-399 cleans leftovers at the start of every sweep), and the job's rename then fails with ENOENT. Separately, the /uploads/ route (findUpload -> findAsset) still serves a leftover .geekity-strip file at its URL until the next sweep removes it.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 geekity strip-metadata and geekity resend print a clear message and exit non-zero, running nothing, when a job of the same name is queued or running; a test proves it
- [x] #2 A request for a .geekity-strip file under /uploads/ answers 404; a test proves it
- [x] #3 docs/cli.md says what the commands do when the job is already active
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Add JobQueue.active(name) in jobs/queue.ts: the newest job of a name when it is queued, or running in this queue's own worker or a claimer that is still alive (isCutOff false). Admin's enqueueUnlessActive uses it, so admin and CLI share one rule.
2. Add isServing(dataDir) in supervisor/control.ts: true when something answers on the control socket.
3. cli.ts: strip-metadata and resend call a shared refuse step before enqueue (and before resend's sync). A running job that is not cut off refuses; a queued job refuses only when a server answers, since only a started queue runs a job it did not queue itself; a queued leftover with no server is ignored and the CLI runs its own job. Message to stderr, exit 1.
4. content/uploads.ts findUpload returns undefined for a name ending in STRIP_TEMPORARY_SUFFIX, so /uploads/ answers 404.
5. Tests first: queue.test for active(); cli-strip-metadata and cli-resend for refuse on live running, refuse on queued with a listener on the control socket, run on a queued leftover with no server; site.test for the 404.
6. docs/cli.md: what the commands do when the job is already active.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Shared rule: JobQueue.active(name) in jobs/queue.ts returns the newest job of a name when it is queued, or running in this queue's own worker or in a claimer that is still alive (isCutOff false). Admin enqueueUnlessActive now calls it; a started queue reconciles in latest() first, so admin behavior is unchanged.
CLI rule (cli.ts alreadyActive): a running active job refuses. A queued one refuses only when isServing(dataDir) finds a geekity serve answering on the control socket (supervisor/control.ts), because only a started queue runs a job it did not queue; a queued leftover from a command that died before claiming is ignored when no server is up, and the next server runs it too (handlers are safe to run twice). A dead-claimer running job is not active, so the CLI runs its own. Refusal: stderr 'A <name> job is already <state>, so this one did not start. Run the command again once it finishes.', exit 1, nothing queued, resend checks before its sync.
Uploads: findUpload returns undefined for a name ending in .geekity-strip, case-insensitively (macOS volumes), so /uploads/ answers 404.
Tests: jobs/queue.test.ts 'the active job of a name' (5); cli-strip-metadata.test.ts refuses on live running, refuses on queued with a control-socket listener, runs past a queued leftover with no server; cli-resend.test.ts refuses on live running and sends nothing; web/site.test.ts 404 for the temp file. Helpers in __testing__/jobs.ts.
Known gap: the check and the enqueue are not atomic, so two commands started at the same instant can both run; the cost is the TASK-399 ENOENT failure of one sweep, not data loss.
Validation: pnpm build, pnpm test (cms 6007 pass, 0 fail), pnpm typecheck, pnpm lint, pnpm format:check all pass.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
geekity strip-metadata and geekity resend now refuse with a stderr message and exit 1, starting nothing, when a job of the same name is running in a live process, or queued while a server answers on the control socket. Admin and CLI share one rule through the new JobQueue.active(name). /uploads/ answers 404 for .geekity-strip temp files. docs/cli.md has a 'When the job is already running' section. Verified with new tests in jobs/queue.test.ts, cli-strip-metadata.test.ts, cli-resend.test.ts and web/site.test.ts, plus the full build, test, typecheck, lint and format checks.
<!-- SECTION:FINAL_SUMMARY:END -->
