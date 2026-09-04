---
id: TASK-51
title: 'Webmentions: send on publish and receive into the comment thread'
status: To Do
assignee: []
created_date: '2026-09-04 01:35'
updated_date: '2026-09-04 01:35'
labels:
  - web
  - federation
milestone: m-7
dependencies:
  - TASK-19
  - TASK-49
  - TASK-50
references:
  - 'https://www.w3.org/TR/webmention/'
  - 'https://webmention.rocks/'
type: feature
ordinal: 41000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Sending: when a post is published or updated (the same index changes that drive delivery, never a full scan), discover a Webmention endpoint for every external link in the rendered body and POST source and target to it, recording outcomes per link the way deliveries are recorded; resend covers them. Receiving: advertise the endpoint with `Link: <…/webmention>; rel="webmention"` on post pages and a `<link>` in the head, accept POSTs of source and target, verify asynchronously that the source really links to the target, parse the source for microformats (h-entry author, content, published, and whether it is a reply, like, repost or mention), and store the result as a comment with `source: "webmention"` in the same files and thread native comments and fediverse replies use, held for moderation like a native comment. A later webmention from the same source updates or, if the link is gone, deletes the earlier one. Both directions are switchable in settings.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Publishing a post with external links sends a webmention to every link whose target advertises an endpoint, proved against a stubbed endpoint, and outcomes are recorded and resendable
- [ ] #2 Post pages advertise the receiving endpoint by Link header and link element
- [ ] #3 A valid incoming webmention whose source links to the target is stored as a comment of the right kind (reply, like, repost, mention) with the author and content parsed from microformats, held for moderation
- [ ] #4 A webmention whose source does not link to the target is rejected, and a later one from a source that dropped the link removes the stored comment
- [ ] #5 The webmention.rocks receiver tests pass against a dev server, or the failures are listed in the notes with reasons
<!-- AC:END -->
