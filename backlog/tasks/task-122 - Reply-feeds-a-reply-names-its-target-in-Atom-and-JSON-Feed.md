---
id: TASK-122
title: 'Reply feeds: a reply names its target in Atom and JSON Feed'
status: To Do
assignee: []
created_date: '2026-09-23 19:09'
labels: []
milestone: m-17
dependencies:
  - TASK-121
references:
  - 'https://www.rfc-editor.org/rfc/rfc4685'
  - 'https://www.jsonfeed.org/version/1.1/'
  - packages/cms/src/web/feed-item.ts
  - packages/cms/src/content/post-type.ts
type: feature
ordinal: 146800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TASK-121 made `in-reply-to` a reply on the page, in the fediverse and by webmention, but the feeds still carry a reply as if it were a standalone post. A feed reader (and anything that threads from a feed) cannot tell what the post answers. Atom has a standard for this in RFC 4685 (Atom Threading Extensions, `thr:in-reply-to`). JSON Feed 1.1 has no reply field, so the target has to go in an extension object, which the spec allows under a key that starts with an underscore. RSS 2.0 has no equivalent and is out of scope.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 An Atom entry for a reply carries a `thr:in-reply-to` element whose `ref` and `href` are the reply target URL, and the feed declares the `http://purl.org/syndication/thread/1.0` namespace
- [ ] #2 A JSON Feed item for a reply names the target URL in an extension object whose key starts with an underscore, and the choice of key and shape is written down in the docs that describe the feeds
- [ ] #3 A post that is not a reply, or whose `in-reply-to` is invalid, gets neither addition
- [ ] #4 RSS output is unchanged
- [ ] #5 The feed ETag revision (`FEED_ITEM_REVISION`) moves so cached feeds are refetched once
- [ ] #6 Tests cover a reply and a non-reply in both Atom and JSON Feed
<!-- AC:END -->
