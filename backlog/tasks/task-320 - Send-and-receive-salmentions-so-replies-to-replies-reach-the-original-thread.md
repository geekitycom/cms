---
id: TASK-320
title: Send and receive salmentions so replies to replies reach the original thread
status: To Do
assignee: []
created_date: '2026-10-10 12:31'
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
- [ ] #1 When a reply post's replies change, the site re-sends a webmention from the reply post to its in-reply-to target
- [ ] #2 A webmention from a source already held re-fetches and updates it rather than adding a duplicate
- [ ] #3 Replies nested in a received source's h-entry appear in the thread under that source, with their own URLs, and disappear when the source drops them
- [ ] #4 A nested reply that is itself one of ours, or already held from its own webmention, is not shown twice
- [ ] #5 Re-sending is bounded, so two salmention sites replying to each other cannot loop
- [ ] #6 doc-6 Native Comments describes salmention support and its limits
<!-- AC:END -->
