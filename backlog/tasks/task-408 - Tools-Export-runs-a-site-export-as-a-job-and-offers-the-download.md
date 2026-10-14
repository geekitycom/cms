---
id: TASK-408
title: Tools > Export runs a site export as a job and offers the download
status: Done
assignee:
  - '@claude'
created_date: '2026-10-14 16:25'
updated_date: '2026-10-14 19:05'
labels: []
milestone: m-38
dependencies:
  - TASK-406
references:
  - >-
    backlog/decisions/decision-55 -
    Every-file-under-data-has-a-declared-class-and-a-site-export-follows-from-it.md
priority: medium
type: feature
ordinal: 364800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A `site.export` job on the decision-54 queue, with password re-entry, the credentials checkbox, progress, and a download.

From decision-55 (accepted), proposed task 6. Read the decision first; it lists every data file, its class and the design this task builds.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Starting an export needs the current user's password. A wrong password queues nothing.
- [x] #2 The page shows the number of deliveries waiting in `queue.sqlite` before the export starts.
- [x] #3 The page shows the job's progress and, when it finishes, a download that only a signed-in user can fetch.
- [x] #4 `data/exports/` keeps only the newest archive, deletes it after 24 hours, and is declared scratch.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. files/export-archives.ts (files layer, so the retention sweep may import it): archives in data/exports/ built with dataPath + EXPORTS; age from the timestamp in the file name (written with the injected clock); 24h lifetime; currentExport() is the newest unexpired archive; expireExports() deletes expired ones; the job clears leftover temp files before it starts and keeps only its own archive after.
2. export/export-job.ts: SITE_EXPORT_JOB = jobName<{withCredentials}, result>('site.export'); run plans with the booted settings and plugins and writes with signal and throttled progress (files; bytes in the note); registered in cms/services.ts beside strip-metadata and resend.
3. privacy/retention.ts: the 6-hourly sweep also deletes expired exports (exportsDeleted in the report).
4. admin/confirm-password.ts: confirmedUser lifted out of admin/plugins.ts and reused.
5. admin/export.ts + admin/pages/tools/export.njk: Tools > Export (pending deliveries, job status with progress, download with expiry, credentials checkbox + password form); POST checks the password before queueing; GET /admin/tools/export/download streams the archive with content-disposition: attachment behind the admin guard. Menu entry under Tools.
6. Tests first (admin/export.test.ts), docs (admin.md, cli.md, personal-data.md), full checks, curl drive against geekity serve.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Built test-first: admin/export.test.ts failed to load (no export-job module) before the code existed; 11 tests now pass.
Archive age comes from the time in its file name, not mtime, so it follows the injected clock (clock-boundary) and tests can move time.
export-archives.ts lives in files/ because the layer map forbids privacy/ importing export/.
The pending-deliveries line is a plain paragraph, not an alert: form-errors.test allows one role=alert (the error summary) on a refused form.
The job payload is {withCredentials} only; the password check happens in the request (confirmedUser), never in jobs.json.
A site.export job left queued/running in an export's jobs.json runs again on the imported site and writes a fresh archive there; harmless, but noted.
Validation: pnpm build && pnpm test (cms 6103 pass, plugins and demo pass) && pnpm typecheck && pnpm lint && pnpm format:check all exit 0.
curl drive against geekity serve (port 3917, scratch site): login 303; page shows '0 deliveries are waiting in data/queue.sqlite'; wrong password -> 400, 'Your password was not right, so nothing was exported.', no jobs.json written; right password -> 303 to /admin/tools/export; page then shows Finished, 8 files, Download; download 200 with content-type application/gzip, content-disposition attachment; filename="geekity-localhost-20261014T190405Z.tar.gz", cache-control no-store; tar -tzf lists manifest.json first then content/ and data/jobs.json, data/users.json; anonymous download -> 302 to /admin/login; second export (with credentials) left only the new archive in data/exports/. Server stopped.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Tools > Export queues a site.export job on the decision-54 queue after the signed-in user re-enters their password (wrong or empty queues nothing). The page shows deliveries waiting in queue.sqlite, the job's progress (files, and bytes in the note), and when finished a Download that streams the archive from data/exports/ with content-disposition: attachment behind the admin session check. The job keeps only the archive it wrote; an archive expires 24 hours after the time in its name, at which point the page and download stop offering it and the retention sweep (or the next page load) deletes it. data/exports/ is declared scratch. confirmedUser moved to admin/confirm-password.ts and is shared with Plugins. Docs: admin.md (Tools > Export), cli.md, personal-data.md. Verified by admin/export.test.ts (11 tests), the full build/test/typecheck/lint/format run, and a curl drive of geekity serve that downloaded and listed the archive.
<!-- SECTION:FINAL_SUMMARY:END -->
