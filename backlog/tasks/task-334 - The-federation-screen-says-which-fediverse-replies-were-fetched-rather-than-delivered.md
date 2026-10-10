---
id: TASK-334
title: >-
  The federation screen says which fediverse replies were fetched rather than
  delivered
status: Done
assignee:
  - '@claude'
created_date: '2026-10-10 19:37'
updated_date: '2026-10-10 20:17'
labels:
  - federation
  - admin
dependencies:
  - TASK-321
references:
  - packages/cms/src/federation/backfill.ts
priority: low
type: enhancement
ordinal: 293800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TASK-321 logs replies read from replies collections as inbox lines marked fetched (ap_inbox.fetched). The federation screen lists them with the delivered ones and no label, so an owner cannot tell what the inbox was sent from what the site went and read.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The federation screen's inbox list marks a fetched reply as fetched, with where it was read from
- [x] #2 A delivered reply that replaced a fetched one shows as delivered
- [x] #3 Admin tests cover both labels
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Add InboxRow.via (ReplyVia: delivered | fetched with from) in admin/federation.ts, derived from InboxActivity.fetched and inReplyTo; null for Like/Announce.
2. Render it in admin/pages/federation/followers.njk with the shared badge macro: an info soft 'fetched' badge plus a link to the note it was read from, an outline 'delivered' badge otherwise.
3. Tests in admin/federation.test.ts: fetched label and source link, delivered label, a delivery replacing a fetched line reads delivered, likes and boosts carry no label.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Where it was read from: no new field. backfill.ts replyOf keeps only items whose inReplyTo names the note whose replies collection was read, so a fetched line's inReplyTo (already an ap_inbox column) is that note. The row links it as 'from the replies to the note it answers'.
Labels are on replies only. Likes and boosts are only ever delivered, so a badge on them would be noise.
Verified: pnpm build, test (5383 pass, 0 fail), typecheck, lint, format:check. Scratch site under scratchpad/site334 with a seeded inbox log (one delivered reply, one fetched reply-to-reply): signed in and curled /admin/federation; the fetched row shows the fetched badge and links remote.example/users/ada/statuses/9, the delivered row shows the delivered badge. AC#2 is proven by the admin test through appendInboxActivity, the same function inbox.ts calls on a delivery; a signed live delivery was not sent.
<!-- SECTION:NOTES:END -->

## Comments

<!-- COMMENTS:BEGIN -->
created: 2026-10-10 20:17
---
Orchestrator review: every fetched reply answers a fediverse reply, so its row read "something of ours". localPosts now takes the conversation reader's documentOf as a fallback and the row reads "in the thread on <post>" (LocalPost.inThread). The fetched-label test asserts it and failed first.
---
<!-- COMMENTS:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
The federation screen's recent activity labels each reply as delivered or fetched (DaisyUI badge macro), and a fetched reply links the note whose replies collection it was read from, taken from the logged inReplyTo. A delivery that replaces a fetched line reads delivered. Covered by three new admin tests; verified by curling the screen on a signed-in scratch site and the full build/test/typecheck/lint/format run.
<!-- SECTION:FINAL_SUMMARY:END -->
