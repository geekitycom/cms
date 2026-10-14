---
id: TASK-393
title: Resending announced posts runs as a queued job from the admin
status: Done
assignee:
  - '@claude'
created_date: '2026-10-13 16:48'
updated_date: '2026-10-14 11:32'
labels: []
milestone: m-38
dependencies:
  - TASK-391
references:
  - >-
    backlog/decisions/decision-54 -
    Admin-jobs-run-on-a-swappable-transport-with-their-status-in-a-CMS-owned-job-record.md
  - packages/cms/src/admin/federation.ts
  - packages/cms/src/cli.ts
priority: medium
type: enhancement
ordinal: 347800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Resending a post sends an Update to every follower inbox, and the federation screen does it inside the request (packages/cms/src/admin/federation.ts, RESEND_PATH, which calls delivery.resend). `geekity resend --all` does it for every announced post. With many followers or posts this risks a proxy timeout. Move both onto the job queue from TASK-391, as decided in the referenced decision record: the per-post resend button and a new resend-all action queue a job and show its progress and result. The CLI command stays as a thin layer over the same job. Resending twice is allowed (receivers treat an Update as the same post), but the handler should stop between posts when its signal is aborted. Dev mode must still hold deliveries as it does today.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The per-post resend button on the federation screen queues a job and answers at once
- [x] #2 An admin action queues a resend of every announced post and answers at once
- [x] #3 The federation screen shows the latest resend job: progress in posts, and when finished, per post how many inboxes were reached, which posts dev mode held and which slugs had nothing to resend
- [x] #4 A resend job cut off part way is run again by the next worker and finishes; a test proves it
- [x] #5 Dev mode still holds every resend, and the job result says so
- [x] #6 geekity resend, with slugs or --all, runs the same job, prints the same report as today and keeps its exit codes
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Add packages/cms/src/federation/resend-job.ts: RESEND_JOB, resendJob({ store, delivery, webmentions }) with payload { slugs: string[] | 'all', webmentions: boolean }. 'all' resolves to the announced posts when the job runs. Per post: throwIfAborted, delivery.resend, optional webmentions.send, progress { done, total }. Result: { posts: [{ slug, activity: { activityType, held, inboxes, reached, queued, failed } | null, webmentions: { pages, told, none, failed } | null }] }; a post with neither is a slug with nothing to resend. resendReport(json) reads it back.
2. Register it in services.ts next to strip-metadata.
3. Federation screen: per-post Resend queues { slugs: [slug], webmentions: true } through enqueueUnlessActive; new POST /admin/federation/resend-all queues { slugs: 'all', webmentions: false }. Both flash and 303 to #resend. A Resend section shows the latest resend job via the job-status component: progress in posts, and when finished, per post the inboxes reached, what dev mode held and the slugs with nothing to resend.
4. geekity resend enqueues the same job (webmentions false), runs it with cms.jobs.run after cms.sync, keeps federation.queue null, prints the same lines from resendReport and keeps exit codes.
5. Tests first for each AC: job unit tests (report, dev-mode hold, cut off and finished by the next worker), admin tests (queues and answers at once, resend-all, screen rendering of running/finished), CLI tests unchanged plus held and missing-slug output.
6. Docs: docs/federation.md, docs/admin.md, docs/cli.md where resend is described.
7. pnpm build, test, typecheck, lint, format:check; curl a running site for the POST answers.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Built packages/cms/src/federation/resend-job.ts: RESEND_JOB ('resend'), resendJob({ store, delivery, webmentions }) and resendReport(json). Payload { slugs: string[] | 'all', webmentions: boolean }; 'all' resolves to store.listFederated() when the job runs. Per post it checks signal.throwIfAborted(), calls delivery.resend and, when asked, webmentions.send, then reports progress { done, total }. Result { posts: [{ slug, activity: { activityType, held, inboxes, reached, queued, failed } | null, webmentions: { pages, told, none, failed } | null }] }; both null means nothing to resend. Registered in services.ts beside strip-metadata.

Federation screen: per-post Resend queues { slugs: [slug], webmentions: true } (keeps TASK-51's webmentions with the button); new POST /admin/federation/resend-all queues { slugs: 'all', webmentions: false } (same as the CLI --all). Both go through enqueueUnlessActive, so a press while a resend is queued or running queues nothing and flashes a warning; both 303 to /admin/federation#resend. A Resend card above the Delivery table shows the latest resend job through components/job-status.njk (verb Sent, unit posts) and, when finished, per post the inboxes reached of the total, queued and failed counts, webmentions, dev-mode holds, and a 'Nothing to resend' list. An empty slug field still flashes the old error and queues nothing. resendMessage and its helpers were deleted; its last caller (dev-mode-site.test.ts) now runs the job.

CLI: geekity resend keeps watch: false, federation.queue: null and cms.sync(), then enqueues the job with webmentions: false and cms.jobs.run(id), and prints the same lines from resendReport. Exit 1 when any slug had nothing to resend or the job did not finish.

Choice: a job cut off part way sends every post again from the first, not only the rest. The task allows resending twice, and it keeps the result whole.

Verification: resend-job.test.ts (8 tests: per-post report, all resolved at run time, dev-mode held, webmentions counted, payload parse, stop between posts and finish in the next worker, crash recovery as attempt 2, result reader); federation.test.ts 'resending a post' (5 tests); cli-resend.test.ts (3 new: job record, missing slug exit 1, dev mode held); dev-mode-site.test.ts runs the job and checks activity.held; send.test.ts runs the queued job. pnpm build, test (cms 5983 pass, 0 fail; all packages pass), typecheck, lint, format:check all exit 0. Live check: geekity serve on a scratch site with a loopback follower inbox. POST /admin/federation/resend answered 303 to #resend in 2.5 ms, the job ran in the server, and the inbox got an Update. The screen showed 'Resent 1 post. hello: Update reached 0 of 1 inbox, 1 queued' (the server uses the federation queue). POST /resend-all answered 303 in 2.6 ms, and a second press while it was active queued nothing. geekity resend hello nope beside the running server printed the old lines and exited 1, and --all exited 0. Servers stopped afterwards.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Resending announced posts now runs as the 'resend' admin job (decision-54). The federation screen's per-post Resend button and a new 'Resend every announced post' action queue it and answer at once. A Resend panel shows the latest job's progress in posts and, when it finishes, per post the inboxes reached, the posts dev mode held and the slugs with nothing to resend. geekity resend runs the same job with the same output and exit codes. The job checks its signal between posts, and tests prove that a job stopped or crashed part way finishes in the next worker. Docs updated in federation.md, admin.md, cli.md, configuration.md and webmentions.md. Verified with new and updated tests, the full build/test/typecheck/lint/format run, and curl against a live geekity serve.
<!-- SECTION:FINAL_SUMMARY:END -->
