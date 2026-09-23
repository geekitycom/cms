---
id: TASK-122
title: 'Reply feeds: a reply names its target in Atom and JSON Feed'
status: Done
assignee:
  - '@claude'
created_date: '2026-09-23 19:09'
updated_date: '2026-09-23 19:16'
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
- [x] #1 An Atom entry for a reply carries a `thr:in-reply-to` element whose `ref` and `href` are the reply target URL, and the feed declares the `http://purl.org/syndication/thread/1.0` namespace
- [x] #2 A JSON Feed item for a reply names the target URL in an extension object whose key starts with an underscore, and the choice of key and shape is written down in the docs that describe the feeds
- [x] #3 A post that is not a reply, or whose `in-reply-to` is invalid, gets neither addition
- [x] #4 RSS output is unchanged
- [x] #5 The feed ETag revision (`FEED_ITEM_REVISION`) moves so cached feeds are refetched once
- [x] #6 Tests cover a reply and a non-reply in both Atom and JSON Feed
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Add inReplyTo?: string to FeedItem, set from replyTarget(document) in feedItem(), so validity is decided once (TASK-121's rule).
2. Atom: declare xmlns:thr="http://purl.org/syndication/thread/1.0" on <feed>; atomEntry writes <thr:in-reply-to ref href/> (ref is the target's identity, href where it is read, the same URL here) when the item has a target.
3. JSON Feed: JsonFeedItem gains _geekity?: JsonFeedGeekity { in_reply_to: string }, publisher-named per JSON Feed 1.1's extension convention and matching the site's existing /_geekity/ namespace; absent for a non-reply. Export the type beside JsonFeedItem.
4. RSS untouched; test that an RSS item for a reply renders identically to the same item without a target.
5. FEED_ITEM_REVISION 3 -> 4, doc comment updated; a unit test pins 4, and a live before/after of the ETags proves the validators move.
6. Tests first: feed-item.test (reply target, invalid targets, non-reply, revision), feed-formats.test (Atom/JSON reply and non-reply, RSS unchanged), feeds.test (end-to-end Atom namespace + element, JSON extension, RSS clean, over a reply, an invalid reply and a standalone post).
7. Docs: doc-3 Feeds section and packages/cms/README.md 'What every format says about a post' describe thr:in-reply-to and the _geekity extension.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Built test-first: 6 new tests failed before the code (Atom element, JSON extension, feed-item target, revision pin, two end-to-end), then passed.

Decisions:
- The target lives on FeedItem.inReplyTo, derived once with replyTarget(), so the three serialisers cannot disagree about validity (decision-12's one-model rule).
- Atom: ref and href are both the target URL. RFC 4685 makes ref the target's persistent id and href an optional location; the post names one URL, which is both. Placed after rel=alternate. The xmlns:thr declaration is on every Atom feed, reply or not, like xmlns:source.
- JSON Feed key: _geekity, shape { in_reply_to: <url> }. Named after the publisher, as the JSON Feed 1.1 spec's _blue_shed example is and as /_geekity/ routes already are. No about URL, because the package has no published docs URL to point at. Written down in doc-3 (Feeds) and packages/cms/README.md (Replies paragraph).
- RSS: feed-rss.ts is untouched.

Validation:
- pnpm build, pnpm test (2223 + 30 pass, 0 fail), pnpm typecheck, pnpm lint, pnpm format:check all pass.
- Live: scratch CMS on :3999 over a reply, an invalid in-reply-to ('not a url') and a standalone post. /feed/atom/ declares xmlns:thr and only the reply's entry carries <thr:in-reply-to ref="https://remote.example/notes/1" href="https://remote.example/notes/1"/>; /feed/json/ gives _geekity {in_reply_to} on the reply only; /feed/ has no thr or target text. Server stopped.
- ETag: same content served with dist FEED_ITEM_REVISION temporarily set to 3 then 4 gave different ETags for all three feeds (e.g. atom 212f41cd... -> 8e6c94fa...). dist restored to 4.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
A reply now names what it answers in Atom and JSON Feed. FeedItem gains inReplyTo, set from replyTarget() so only an absolute http(s) in-reply-to counts. Atom feeds declare xmlns:thr (RFC 4685) and a reply's entry carries <thr:in-reply-to ref href/> with the target URL; a JSON Feed reply item carries _geekity: { in_reply_to }, documented in doc-3 and the package README. RSS is unchanged. FEED_ITEM_REVISION moves 3 -> 4 so feed ETags change once. Verified with unit and end-to-end tests (reply, invalid reply and non-reply in Atom and JSON, RSS identical), the full build/test/typecheck/lint/format gate, and curl against a live scratch server including a revision 3 vs 4 ETag comparison.
<!-- SECTION:FINAL_SUMMARY:END -->
