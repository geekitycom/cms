---
id: TASK-438
title: A background job's status box updates itself until the job finishes
status: Done
assignee:
  - '@claude'
created_date: '2026-10-20 14:04'
updated_date: '2026-10-20 14:50'
labels:
  - admin
dependencies: []
references:
  - packages/cms/admin/components/job-status.njk
  - packages/cms/src/admin/job-status.ts
priority: medium
type: bug
ordinal: 375800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
On Tools > Maintenance, running the metadata sweep shows a progress bar that never changes until you leave the page and come back. By design the job status box (packages/cms/admin/components/job-status.njk) does not reload itself and offers a Check again link, which is easy to miss and not what people expect. With JavaScript on, the box should poll and redraw itself while the job is queued or running, then show the result when it ends. Every screen that uses jobStatus gets this, not only the sweep. Without JavaScript, Check again stays.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 With JavaScript on, a queued or running job's box refreshes on its own every few seconds and shows the progress, then the finished result, failure or interruption without a page load
- [x] #2 Polling stops once the job is no longer queued or running, and when the page is hidden it slows or pauses
- [x] #3 Every screen that uses the jobStatus component gets this behaviour
- [x] #4 The script obeys the admin CSP (no inline script) and the progress is announced politely to screen readers
- [x] #5 Without JavaScript the Check again link still works
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Screens that show a job: Tools > Maintenance (strip-metadata), Tools > Export (site.export), Federation (resend), and the Media library's sweep notice (strip-metadata via jobStatusView, its own markup). No plugin or import screen reads a job.
2. Markup hooks: jobStatusView carries the job's name. The jobStatus macro's box gets data-job-status=<name>, data-job-state, data-job-label and, while the job is queued or running, data-job-refresh=<refreshUrl>; its message line is data-job-message and its Check again wrapper data-job-check-again. A page whose controls depend on whether the job is active wraps them with the box in data-job-region (maintenance section, resend section, export's status + form). The media notice section carries the attributes itself, and polls Maintenance (data-job-refresh) and redraws from the library (data-job-redraw) only when the state changes, because the library is costly to draw.
3. static/job-status.js, loaded deferred by each of the four pages like media.js: every 3 s fetch the URL, parse it in a <template>, find the box with the same name, and swap the region. Stop when the new box names no page to fetch; remove the old region when the page no longer shows it; on an error or a redirect show Check again and retry after 15 s. Pause while document.hidden, poll at once when shown. Keep focus across a swap. One sr-only role=status element made at start announces state changes at once and progress at most every 15 s.
4. Node tests first: each screen with a running job carries the hooks and loads job-status.js; a finished box names nothing to fetch; Check again stays; the script is served under script-src 'self' with no inline script.
5. Playwright on a scratch server with 15000-40000 seeded JPEGs: sweep from Maintenance, notice on Media, export, resend.
6. Update the component header comment and docs/admin.md, docs/federation.md, docs/media.md.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Built: jobStatusView now carries the job name. job-status.njk marks the box (data-job-status, data-job-state, data-job-label, data-job-refresh while active, data-job-message, data-job-check-again). Maintenance, Federation resend and Export wrap the status and the controls hidden while the job runs in data-job-region, so the Run again / Resend / Export form comes back when the job ends. static/job-status.js is loaded deferred per page (maintenance, export, followers, media library), not from shell.njk: shell.test.ts pins the shell to the admin-bar script alone, and that matches how media.js and copy.js are loaded.
Media notice: polling /admin/media every 3 s with 15000 uploads took 2.5 s a request and starved the sweep (6189 of 15000 in two minutes). The notice therefore polls the Maintenance panel (data-job-refresh) and redraws from the library (data-job-redraw) only when the sweep's state changes there; once the sweep finishes the library has no notice, so the script removes it, announces Finished, and moves focus to #main if it was inside.
Fetched pages are parsed in a <template> as media.js does, so their nonced styles are inert. A failed fetch or a redirect (signed out) shows Check again again and retries after 15 s. Accessibility: one sr-only role=status element, made at start outside every swapped region, reads the state and progress line: a state change at once, progress at most every 15 s. Focus on a link or button inside a swapped region moves to the same-text control in the new one, or the region.
Verification: new src/admin/job-status-refresh.test.ts (7 tests, written first and failing). Playwright (headless Chromium, scratch server on port 3438): Maintenance sweep of 40000 and of 15000 files went queued -> running with Checked n of N updating every 3 s -> finished, zero navigations, no console errors except the pre-existing /favicon.ico 404; with document.hidden forced true for 8 s it made 0 fetches and 1 right after it was shown; no fetches after the end. Media notice: running -> removed when the sweep finished, polled /admin/tools/maintenance 54 times and drew /admin/media once. Export: queued -> running (Exported n of 15002 files) -> finished with the Download button and the form back. Resend: running -> finished. pnpm build, test (6324 cms pass), test:11ty, typecheck, lint, format:check all pass.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
A queued or running job's status box now redraws itself every 3 s with JavaScript on, until the job ends, on Tools > Maintenance, Tools > Export, Federation (resend) and the Media library's sweep notice. static/job-status.js fetches the page named in the box's data-job-refresh, parses it in an inert <template>, and swaps in the box or its data-job-region, so the controls hidden during the job return when it ends. It pauses while the tab is hidden, stops when the job ends, announces progress through one polite status region, and keeps focus. The media notice polls the cheaper Maintenance page and redraws from the library only on a state change. Without JavaScript the Check again link stays. Docs updated in docs/admin.md, federation.md, media.md. Verified with job-status-refresh.test.ts, Playwright runs of all four screens with real jobs (no navigations, no console or CSP errors), and the full build/test/typecheck/lint/format suite.
<!-- SECTION:FINAL_SUMMARY:END -->
