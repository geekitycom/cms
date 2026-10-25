---
id: TASK-517
title: Retry a failed Create as a Create, not an Update
status: To Do
assignee: []
created_date: '2026-10-25T16:59:00Z'
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
- [ ] #1 A retry to a recipient whose newest failed delivery is a Create sends a Create for the post's current object
- [ ] #2 A retry to a recipient whose newest failed delivery is an Update still sends an Update
- [ ] #3 The admin Resend button keeps its current behaviour unless the task notes say why it changes
- [ ] #4 docs/mcp.md and docs/federation.md describe what a retry sends
<!-- AC:END -->
