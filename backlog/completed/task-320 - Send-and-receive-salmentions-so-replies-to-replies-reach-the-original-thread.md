---
id: TASK-320
title: Send and receive salmentions so replies to replies reach the original thread
status: Done
assignee:
  - '@claude'
created_date: '2026-10-10 12:31'
updated_date: '2026-10-10 17:30'
labels:
  - webmention
  - indieweb
dependencies:
  - TASK-300
  - TASK-319
references:
  - 'https://indieweb.org/Salmention'
  - packages/cms/src/webmention/receive.ts
  - packages/cms/src/webmention/service.ts
documentation:
  - backlog/docs/doc-6 - Native-Comments.md
priority: low
type: feature
ordinal: 279800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
With plain webmention, when someone replies on their own site to a reply that another site sent us, their webmention goes to that other site and never to us, so our thread never shows it. Salmention (https://indieweb.org/Salmention) closes this when every site in the chain cooperates: a site that receives a reply re-sends webmentions upstream to what its own post replies to, and the upstream site re-fetches the source and reads the replies nested inside its h-entry.

We cannot make other sites do it, but this site can do both halves. Sending: when a reply post of ours (TASK-300) or a comment page (TASK-318) gains, changes or loses a reply, re-send the webmention to what it replies to. Receiving: when a source we already hold is sent again, re-fetch it, update it, and add the replies nested in its h-entry (children with u-in-reply-to, or h-cite comments) to the thread under it.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 When a reply post's replies change, the site re-sends a webmention from the reply post to its in-reply-to target
- [x] #2 A webmention from a source already held re-fetches and updates it rather than adding a duplicate
- [x] #3 Replies nested in a received source's h-entry appear in the thread under that source, with their own URLs, and disappear when the source drops them
- [x] #4 A nested reply that is itself one of ours, or already held from its own webmention, is not shown twice
- [x] #5 Re-sending is bounded, so two salmention sites replying to each other cannot loop
- [x] #6 doc-6 Native Comments describes salmention support and its limits
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Receiving (data shape): sourceEntry reads the replies nested in the chosen h-entry (p-comment items and child h-entries answering it), each with url, author, content, published and its own nested replies, bounded in depth and count.
2. Storage: a nested reply is a comment record like any webmention (source webmention, kind reply, url its own page) with a new via field naming the source page that carried it; file + index column (admin migration 24); updateComment can set via.
3. verifyWebmention: after the carrier is stored, intake each nested reply through intakeComment (same moderation, checker and notices), threaded under the carrier (or its nested parent); skip own-site URLs and anything the conversation already names that this carrier did not bring; delete this carrier's via-records it no longer carries, and all of them when the carrier is deleted. A direct webmention from a page held as a nested reply takes it over (via cleared).
4. Sending: ConversationReader.upstreams(document) lists every page of the thread the document is in that answers something off this site (reply posts by in-reply-to, native comment pages whose parent is a webmention reply) with the replies a reader sees under it. The webmention service re-sends source->target when the fingerprint of those replies differs from the one last sent (admin state ledger), capped per pair per hour.
5. Triggers: AdminStore notifies listeners on putComment/deleteComment/logInboxActivity (not rebuilds); index.ts routes those and non-scan content changes to the service, which coalesces them per document.
6. Theme: a reply post page prints its replies inside its h-entry as p-comment h-cite.
7. doc-6 section on salmention; decision recorded; tests for each AC with every fetch stubbed.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Receiving: sourceEntry reads NestedReply trees (p-comment items and child h-entry/h-cite answering the entry's u-url; 8 deep, 200 max, url required). verifyWebmention intakes each through intakeComment (origin webmention) as a comment record with via = the source URL, under the carrier or its nested parent; skips own-origin URLs and anything replyNamed already names that this source did not bring; deletes via-records the source no longer carries, and all of them when the source is deleted. A nested reply later sent on its own is the same record with via cleared (intake's update now writes via). via is in the comment file and the index (admin migration 24).
Sending: ConversationReader gained documentOf(url) and upstreams(document) (reply posts with an off-site in-reply-to, comment pages under an off-site webmention reply, for the whole thread). AdminStore.onConversationWrite fires on putComment/deleteComment/logInboxActivity (not on replaceComments/replaceInboxActivities); index.ts routes it to WebmentionService.heard, and handle() looks at every non-scan content change too. Changes are coalesced per document on the send chain. A page sends when the fingerprint of its visible replies differs from the admin-state ledger salmention:{page} {target} (missing = no replies, so the first publish stays the ordinary webmention); at most SALMENTION_LIMIT (5) per pair per hour; a migrated post's first look records its fingerprint without sending.
Theme: a reply post prints its thread inside its h-entry as p-comment h-cite (conversationPart replies/reactions in partials/conversation.njk); facepiles stay below the entry. Theme README notes it.
handle() calls the salmention look after the ordinary send so the ordinary send keeps its place on the chain (web/reply-context.test.ts depends on fetch order).
Validation: pnpm build, pnpm -r test (cms 5315 pass), typecheck, lint, format:check all pass. Scratch site: /2026/09/re-upstream/ served with comments c1 > c2, and sourceEntry on the fetched HTML returned c1's /comment/c1/ with c2 nested under it.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Salmention, both halves (decision-49). Receiving: a re-sent source still updates its one entry, and the replies nested in its h-entry become webmention comment records under it with their own URLs and a via field naming the source, moderated like any webmention, removed when the source drops them, never copied when they are this site's own or already held. Sending: a reply post, or a comment's page under a webmention reply, re-sends its webmention upstream when the fingerprint of its visible replies changes, at most 5 times an hour per target, so two salmention sites converge. Reply post pages now print their replies inside the h-entry. Verified with new tests in webmention/salmention.test.ts and microformats.test.ts (every fetch stubbed, mutation-checked), the full suite, typecheck, lint and format, and a scratch-site page parsed by sourceEntry.
<!-- SECTION:FINAL_SUMMARY:END -->
