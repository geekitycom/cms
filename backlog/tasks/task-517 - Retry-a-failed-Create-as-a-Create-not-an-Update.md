---
id: TASK-517
title: Retry a failed Create as a Create, not an Update
status: Done
assignee:
  - '@claude'
created_date: '2026-10-25T16:59:00Z'
updated_date: '2026-10-25T17:07:00Z'
labels:
  - mcp
  - federation
milestone: m-26
dependencies: []
priority: high
type: bug
ordinal: 419800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
retry_deliveries (and the resend path it reuses, DeliveryService.resend) sends an Update to a recipient whose failed delivery was the post's Create. Mastodon drops an Update for a status it never stored, so a retry cannot fix the most common failure. A retry should resend the activity that failed: a Create when the recipient never got the Create, an Update when an Update failed. Found while building the repair tools; see packages/cms/src/federation/retry-job.ts and resend-job.ts.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A retry to a recipient whose newest failed delivery is a Create sends a Create for the post's current object
- [x] #2 A retry to a recipient whose newest failed delivery is an Update still sends an Update
- [x] #3 The admin Resend button keeps its current behaviour unless the task notes say why it changes
- [x] #4 docs/mcp.md and docs/federation.md describe what a retry sends
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Data shape: a failed retry recipient carries missedAnnouncement, true when the newest Create the recipient was sent for that post failed (so it never stored the post). DeliveryService.resend's 'to' becomes { actors, missedAnnouncement }.
2. Failing tests first: retry-job unit tests for the flag and the job passing it; delivery.test.ts end to end, a failed Create retried through the real retry job arrives as a Create, a failed Update arrives as an Update.
3. failedRetries computes the flag from the delivery history; the job groups each post's recipients by the flag and resends each group; resend announces (Create, stamped id) for a group that missed the announcement.
4. Admin Resend and the CLI pass no recipients and keep sending an Update for an announced post.
5. Update docs/mcp.md and docs/federation.md; run the full check suite.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Reproduced first: delivery.test.ts 'retrying a failed delivery' runs the real retry-deliveries job against a site whose inbox refused the Create; before the fix it sent an Update (two of three tests failed), after it sends the Create.

Rule: a failed recipient missed the announcement when the newest Create row it was sent for the post failed. Judged from the Create rows, not only the newest failed row, so a Create that failed and the Update after it that failed (author edited while the server was down) still retries as a Create. A recipient with no Create row at all (database rebuilt, migrated post) gets an Update, since sending a Create to a server that holds the status changes nothing.

resend(slug, to) now takes { actors, missedAnnouncement }. When missedAnnouncement is true and the post is published, resend takes the announce branch: the Create under the deterministic Create id, built from the post as it reads now. A withdrawn post still sends a Delete, a like or repost still sends its own activity. The job resends each post's recipients in two groups, missed-announcement first, so a post can appear twice in the job report.

Admin Resend button and geekity resend: unchanged. They pass no recipients and still send an Update for an announced post; no concrete reason to change them, since they go to every follower and most of those hold the post.

Two repair.test.ts assertions encoded the bug (the fixture's failed delivery is a Create and they expected an Update); they now expect the Create. retry_deliveries' output gains missedAnnouncement per recipient.

Checks: pnpm build, test, test:11ty, typecheck, lint, format:check all exit 0.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
A retry now sends each recipient the activity it missed. Recipients whose newest Create for the post failed are sent the Create again (built from the post as it reads now, under the same Create id), so Mastodon stores the post instead of dropping an Update of a status it never had; recipients whose Update failed after a delivered Create still get an Update. failedRetries marks each recipient with missedAnnouncement, the retry-deliveries job resends the two groups separately, and DeliveryService.resend takes { actors, missedAnnouncement }. The admin Resend button and geekity resend are unchanged. docs/mcp.md and docs/federation.md describe what a retry sends. Verified by an end-to-end delivery test that failed before the fix, unit tests for the rule, and the full check suite.
<!-- SECTION:FINAL_SUMMARY:END -->
