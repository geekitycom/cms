---
id: TASK-197
title: 'Original-post-discovery: reply to the original, not a silo copy'
status: Done
assignee:
  - '@claude'
created_date: '2026-10-01 17:01'
updated_date: '2026-10-06 03:10'
labels:
  - indieweb
  - webmention
milestone: m-28
dependencies:
  - TASK-155
  - TASK-199
references:
  - packages/cms/src/webmention/reply-context.ts
  - 'https://indieweb.org/original-post-discovery'
priority: low
type: feature
ordinal: 213800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
IndieMark level 4 asks for original-post-discovery: when someone replies to a POSSE copy of a post (a tweet, a Mastodon status), the reply should go to the original. Two halves. Sending: when a post's in-reply-to is a silo URL whose page carries a u-url/rel=canonical/original-of link back to an IndieWeb original, reply to the original and send the webmention there (keep the silo URL as an extra in-reply-to so Bridgy can thread it). Receiving: once TASK-155 records u-syndication links, a webmention or backfed response whose target is one of this site's syndicated copies is attached to the original post.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Replying to a silo copy that links to its original sends the webmention to the original and shows the original in the reply context
- [x] #2 The silo URL stays in the post's in-reply-to so syndication to that silo can thread the reply
- [x] #3 A response that targets one of this site's syndicated copies is shown on the original post
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Discovery (reply-context.ts): after reading a cited page, collect original candidates on another host: its h-entry u-url and u-uid, its rel=canonical link, and the url of the ActivityPub object it names (cited-post.ts returns it). Fetch each within the one deadline; the first whose page lists the cited URL (as fetched or after redirects) under u-syndication or rel=syndication is the original. Its page is described through the usual source chain and the context records original: <url>. No confirmation, no original: a copy cannot claim someone else's post.
2. Stored shape (reply-contexts.ts): entries gain optional original, parsed back defensively; decision-19 amendment.
3. Sending (service.ts): targetsOf adds the original of each cited URL from the stored contexts; the reply context service's onStored tells the webmention service when a target's original appears or changes, and it sends to the original for each public post citing that target.
4. Rendering: the reply context h-cite links the original as its u-url (so the original's receiver finds the link) and the silo copy stays printed as a u-in-reply-to beside it; front matter in-reply-to is never rewritten.
5. Receiving (receive.ts, routes.ts, pingback.ts, syndication.ts): a webmention whose target is one of this site's syndicated copies (front matter syndication or the copies file) is accepted for the post that owns the copy and stored on it.
6. Tests first for each AC; build, test, typecheck, lint, format; curl a running site with stubbed remote hosts.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Order: after TASK-155 (u-syndication records) and TASK-199. Both change src/webmention/reply-context.ts; original-post-discovery decides which URL the context is fetched for, so it builds on the source chain rather than racing it.

Discovery: fetchReplyContext reads the cited page, collects candidates on another host (h-entry u-url/u-uid, rel=canonical, the ActivityPub object's url, which cited-post.ts now returns), and accepts the first whose page lists the cited URL under u-syndication or rel=syndication. The confirmed original is described through the TASK-199 source chain and stored as original on the entry keyed by the copy (decision-19 amendment). No claim back, no original: a copy cannot borrow someone else's post.
Sending: targetsOf adds the original of a reply's target; the reply context service's onStored tells the webmention service (originalFound) when an original first appears or changes, so a reply saved before its context was fetched still reaches the original. Only replies act on it; likes/reposts/bookmarks of a copy keep citing the copy.
Rendering: reply-context.njk cites the original in the u-in-reply-to h-cite and prints the copy after it as its own u-in-reply-to (p.cite-copy). Feed citation lines link the original. Front matter and the federated inReplyTo stay the copy.
Receiving: checkWebmentionRequest takes syndicatedAt; the endpoint resolves a foreign target to the public post that lists it in front matter syndication or in _data/syndication.json (decision-26 amendment). Pingback and ActivityPub inbox replies to a syndicated copy are not covered; a pingback cannot reach a silo URL's server here, and the site federates itself.
Validation: src/webmention/original-post-discovery.test.ts (11 tests, written first, 7 failed before the code); pnpm build, test (4720 + 30 pass), typecheck, lint, format:check all clean. Live: a served site with stubbed remote hosts fetched the copy and original at boot, POSTed one webmention to the original's endpoint, served the reply page citing 'Growing beans' at the original with the copy as u-in-reply-to, answered 202 to a webmention targeting the post's syndicated copy (stored as a pending reply on that post) and 400 to a foreign URL that is no copy.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Original-post-discovery both ways. A reply to a silo copy whose original lists the copy as u-syndication now stores the original on the copy's reply context, describes and cites the original on the page, keeps the copy as a second u-in-reply-to (front matter untouched), and sends the webmention to the original as well, including after a late context fetch. A webmention targeting one of the site's syndicated copies (front matter syndication or the copies file) is accepted and stored on the post the copy is of. Verified by original-post-discovery.test.ts, the full suite, typecheck, lint, format, and a curl check against a served site with stubbed remote hosts.
<!-- SECTION:FINAL_SUMMARY:END -->
