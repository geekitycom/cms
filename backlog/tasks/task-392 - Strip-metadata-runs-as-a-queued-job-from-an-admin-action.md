---
id: TASK-392
title: Strip-metadata runs as a queued job from an admin action
status: Done
assignee:
  - '@claude'
created_date: '2026-10-13 16:48'
updated_date: '2026-10-14 11:16'
labels: []
milestone: m-38
dependencies:
  - TASK-391
references:
  - >-
    backlog/decisions/decision-54 -
    Admin-jobs-run-on-a-swappable-transport-with-their-status-in-a-CMS-owned-job-record.md
  - packages/cms/src/content/metadata/sweep.ts
  - packages/cms/src/cli.ts
  - packages/cms/src/admin/media.ts
priority: medium
type: enhancement
ordinal: 346800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Sweeping content/uploads for location and camera metadata is today only `geekity strip-metadata` (stripMetadataCommand in packages/cms/src/cli.ts, stripStoredUploads in packages/cms/src/content/metadata/sweep.ts). On a site with many uploads it is too long to run inside a request. Make it a job on the job queue from TASK-391 and give the admin a button that queues it and shows its progress and result, as decided in the referenced decision record. The CLI command stays as a thin layer over the same job. The handler must be safe to run twice and should stop between files when its signal is aborted, so a reload is not held up.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 An admin action queues the sweep and answers at once, without waiting for the sweep
- [x] #2 The admin shows the latest sweep: queued, running with files checked out of the total, finished with the stripped, clean and unreadable counts and the stripped files, failed with the error, or interrupted
- [x] #3 Running the sweep twice, or again after it was cut off part way, leaves every upload the same as running it once; a test proves it
- [x] #4 The handler stops between files when the queue stops, and the sweep then finishes in the next worker; a test proves it
- [x] #5 geekity strip-metadata runs the same job, prints the same report as today and keeps its exit codes
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. sweep.ts: stripStoredUploads lists the strippable files first, takes { signal, progress }, checks the signal before each file and reports { done, total } after each one. Replacing a file stays write-temp-then-rename, so a cut-off run leaves the original or the stripped bytes and a rerun converges.
2. content/metadata/strip-job.ts: stripMetadataJob(contentDir), a JobDefinition named strip-metadata with a null payload, whose result is a StripReport { checked, stripped: [{ path, removed }], clean, unreadable: [{ path, problem }] }, plus a parser that reads a report back from a JobStatus result.
3. cms/services.ts registers the built-in job beside the configured definitions.
4. cli.ts: geekity strip-metadata creates the CMS without watching, enqueues the job and runs it with cms.jobs.run(id), prints the same lines from the report, exits 1 on unreadable files or a failed job.
5. Admin: POST /admin/media/strip-metadata enqueues the job (or says one is already queued or running) and redirects at once. The media screen shows the latest sweep through a shared components/job-status.njk macro and an admin/job-status.ts view helper (state, label, progress), with the sweep's result rendered by the media template. Settings > Privacy points at the media screen.
6. Tests first for each AC: admin enqueue answers with the job still queued; each state rendered; run twice and cut-off-then-rerun give identical bytes; a queue stopped after the first file hands the job back and a second worker finishes it; CLI output and exit codes unchanged (existing cli-strip-metadata tests) plus a job record left behind.
7. Docs: docs/media.md, docs/cli.md, docs/settings.md.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Built: stripStoredUploads takes { signal, progress }, checks the signal before each file and skips a file deleted mid-sweep. content/metadata/strip-job.ts defines the strip-metadata job (null payload, StripReport result) and stripReport() to read a result back; services.ts registers it before the configured definitions. geekity strip-metadata creates the CMS without watching, enqueues the job and runs it with cms.jobs.run(id); output and exit codes unchanged, plus exit 1 with 'The sweep did not finish: …' if the job fails. Admin: POST /admin/media/strip-metadata queues the job unless one is queued or running (enqueueUnlessActive), flashes and 303s to /admin/media#strip-metadata. The Media screen has a 'Location and camera metadata' card showing the latest sweep through the shared components/job-status.njk macro, fed by jobStatusView() in src/admin/job-status.ts. New badge statuses: queued, running, finished, interrupted. Settings > Privacy links to the Media card.
Decisions: the result covers what this run did, so after a cut-off the resumed run counts already-stripped files as clean. enqueueUnlessActive reads latest then enqueues without a lock, so two presses at the same instant could queue two sweeps; harmless because the job is idempotent. The page does not reload itself; it offers a Check again link while the job is active.
Evidence: AC1 media-strip-metadata.test.ts (POST answers 303 with the job still queued and the upload unstripped; sandbox queue is not started) and curl against a real geekity serve (303 in 2 ms, page then showed Finished, 3 stripped). AC2 media-strip-metadata.test.ts renders queued, running (Checked 2 of 5 files + progress value/max), finished (counts, stripped files with what was removed, unreadable files), failed (escaped error) and interrupted. AC3 strip-job.test.ts: two runs give identical hashes and mtimes; a run cut off after 2 files plus a half-written .geekity-strip temp, then run again, equals one whole run. AC4 strip-job.test.ts: a queue stopped after file 1 leaves the job queued at attempt 1 with only a.jpg stripped; a second worker finishes it (attempt 1, 3 stripped, 1 clean). Removing throwIfAborted makes AC3-cut-off and AC4 fail. AC5 cli-strip-metadata.test.ts (existing output/exit-code tests pass unchanged, new test sees a finished strip-metadata record in data/jobs.json); also ran the built CLI beside a running server: 'Checked 3 files: 0 stripped, 3 already clean, 0 unreadable', exit 0.
Validation: pnpm build, pnpm test (cms 5968 pass, plugins and demo pass), pnpm typecheck, pnpm lint, pnpm format:check all exit 0.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
geekity strip-metadata is now a queued job (strip-metadata) on the TASK-391 queue. The Media screen has a button that queues it and returns at once, and it shows the latest sweep through a shared job-status component. The sweep checks its abort signal between files and reports files checked out of the total. A cut-off or repeated run converges to the same uploads. The CLI runs the same job with its old report and exit codes. Verified with new tests (strip-job.test.ts, media-strip-metadata.test.ts, cli-strip-metadata.test.ts), a mutation check on the abort check, curl against a real geekity serve, the built CLI beside it, and the full build/test/typecheck/lint/format run.
<!-- SECTION:FINAL_SUMMARY:END -->
