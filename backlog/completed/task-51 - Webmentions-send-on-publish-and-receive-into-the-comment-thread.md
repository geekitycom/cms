---
id: TASK-51
title: 'Webmentions: send on publish and receive into the comment thread'
status: Done
assignee:
  - '@claude'
created_date: '2026-09-04 01:35'
updated_date: '2026-09-20 21:06'
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
- [x] #1 Publishing a post with external links sends a webmention to every link whose target advertises an endpoint, proved against a stubbed endpoint, and outcomes are recorded and resendable
- [x] #2 Post pages advertise the receiving endpoint by Link header and link element
- [x] #3 A valid incoming webmention whose source links to the target is stored as a comment of the right kind (reply, like, repost, mention) with the author and content parsed from microformats, held for moderation
- [x] #4 A webmention whose source does not link to the target is rejected, and a later one from a source that dropped the link removes the stored comment
- [ ] #5 The webmention.rocks receiver tests pass against a dev server, or the failures are listed in the notes with reasons
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Vocabulary first: add `mention` and `repost` to COMMENT_KINDS and InteractionKind, and an optional `url` to a comment record (where a webmention lives on its own site). The conversation gains a `mentions` group; a `repost` joins the boosts, because to a reader it is one.
2. Store: migration adding `comments.url` and a `webmentions_sent` outcome table (slug, target, source, endpoint, status, error, attemptedAt), keyed per (post, target) so a resend moves a row rather than adding one — the way ap_deliveries works.
3. src/webmention/links.ts: the external links in a post's rendered body.
4. src/webmention/discovery.ts: endpoint discovery in the W3C order — Link header, then <link>/<a rel=webmention> in document order — resolved against the URL after redirects.
5. src/webmention/send.ts: a sender on a queue of its own, driven by the same index changes delivery is (never a full scan), sending to the union of the links before and after so an unpublished post is withdrawn too; send(slug) is what a resend calls.
6. src/webmention/html.ts and microformats.ts: a small hand-rolled HTML tree parser and the h-entry/h-card subset mf2 needs, rather than a dependency.
7. src/webmention/receive.ts and routes.ts: POST /_geekity/webmention, validating source and target and answering 202 or 400, then verifying asynchronously that the source still links to the target, parsing it, and storing the result as a pending comment through the same CommentChecker seam a native comment runs through. A later webmention from the same source updates its comment, and one whose link is gone deletes it.
8. Advertise the endpoint: a Link header on every document page and a <link rel=webmention> in the theme's head.
9. Settings: webmentionsSend and webmentionsReceive, both on by default.
10. Docs: a new backlog doc for webmentions, doc-6 for the new entry keys, the theme README and the Eleventy mirror, and the package README for the settings.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Built in `packages/cms/src/webmention/`: `html.ts` (a small tree parser), `microformats.ts` (`linksTo` for verification and `sourceEntry` for an h-entry/h-card subset), `links.ts` (the external links in a rendered body), `discovery.ts` (endpoint discovery in the W3C order), `service.ts` (the sender on the index changes plus the incoming queue), `receive.ts` (validation, verification, storage) and `routes.ts` (POST /_geekity/webmention).

Dependency decision: no new dependency. `microformats-parser` is MIT but pulls parse5 and implements nested items, hentry backcompat, rel-urls, the value-class pattern and the full implied-property rules, none of which changes what reaches a comment file. The subset needed is h-entry, h-card and eight properties, which is about 200 lines over a 250-line tree parser; the repo already tokenises HTML by hand in web/sanitize.ts. Recorded in doc-7.

Vocabulary: COMMENT_KINDS and InteractionKind gain `mention` and `repost`. A repost is grouped with the boosts (to a reader they are the same act); a mention is neither an answer nor a reaction and gets `conversation.mentions` of its own, rendered by a new `mentions()` macro in the theme partial. The Reply link is narrowed to `source == "comment"`.

A comment record gains `url` (a webmention's source page, which is its identity for updates and deletes) and `author.avatar` (the source h-card's u-photo). Migration 15 adds both columns and the `webmentions_sent` outcome table; both stay indexes of the files, rebuilt on every boot.

Settings: `webmentionsSend` and `webmentionsReceive`, both on by default, on the settings screen under a Webmentions heading. Receiving off takes the endpoint off every page and answers the endpoint with 404.

Security: a source on a loopback or private address is refused with 400, so the receiver is not a way of reaching this network. It stops the obvious spelling and not a hostname that resolves to one; noted in doc-7.

Verification (all from the repo root, all passing): pnpm build, pnpm test (1185), pnpm test:11ty (15 + 11 + 5), pnpm typecheck, pnpm lint, pnpm format:check.

Per criterion:
- #1 src/webmention/send.test.ts — publishing a post into a stubbed web sends exactly one POST (to the page that advertised an endpoint), records three outcomes (sent / none / failed) with the endpoint and the reason, sends nothing for a boot scan, sends nothing with the setting off, and `webmentions.send(slug)` sends them again from the file and moves the row rather than adding one.
- #2 src/webmention/receive.test.ts 'puts it on a post's Link header and in its head', plus src/web/negotiation.test.ts, which now asserts the endpoint on the Link header of all three representations. The negative case is covered too.
- #3 src/webmention/receive.test.ts stores a reply pending with the author name, URL, photo, sanitised e-content and dt-published, and stores a like, a repost and a plain mention as their own kinds; src/webmention/microformats.test.ts covers the parsing on its own.
- #4 src/webmention/receive.test.ts — a source that only writes the target out as text stores nothing, a second webmention whose source dropped the link deletes what it left, and so does one whose source answers 404 or 410. A 5xx changes nothing, which is the case a delete-on-any-error receiver gets wrong.
- #5 NOT CHECKED. webmention.rocks needs a public URL to reach a dev server and this environment has none, so the receiver cases are reproduced hermetically in src/webmention/receive.test.ts against a stubbed web: the link in an <a>, a <link>, an <img>, a <video>, written relative, behind a redirect, in plain text, in JSON, only in the prose (rejected), inside a <script> (rejected), removed from a page that had it (deleted), and a source answering 404, 410 or 503. src/webmention/microformats.test.ts adds the 'link is in a different h-entry' case. That is the same ground the published receiver tests cover, but it is not the live run the criterion asks for, so it is left unchecked for whoever deploys the site to do against https://webmention.rocks/.

Also covered: the CommentChecker seam is asked about every incoming webmention with comment.source 'webmention', its 'spam' verdict files one as spam and 'discard' stores none; an approved webmention appears in the thread linking to the page that sent it, with no Reply link; and the Eleventy mirror puts a webmention in conversation.mentions from the same comment file (packages/cms/test/eleventy.test.ts).

Docs: new doc-7 (Webmentions), doc-6 updated for the url and avatar keys and the webmention entry, doc-4 for the two new kinds and the mentions group, the theme README for the conversation shape and the <link>, and the package README for the settings, the behaviour and the two /_geekity/ routes.

Backlog review, 2026-09-20: AC #5 (the webmention.rocks receiver tests) was never run and no failures were listed, so neither branch of that criterion was met. The task was closed on the rest of the evidence above. Recorded here rather than silently left unmet; running the suite against a dev server is still worth doing if the receiver is changed again.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Webmentions in both directions, joining the thread native comments and fediverse replies already share. Sending runs off the same index changes ActivityPub delivery does — never a full scan — discovering each external link's endpoint in the W3C order and recording one outcome per (post, target) in a new webmentions_sent table; the federation screen shows the counts and its Resend button sends them again from the file. Receiving advertises /_geekity/webmention by Link header on every representation and by <link> in the head, answers 202 or 400 synchronously, then verifies out of band that the source really links to the target, reads a deliberate h-entry/h-card subset of microformats with no new dependency, and files the result as a pending comment with source 'webmention' through the same CommentChecker seam a form submission goes through. A later webmention from the same source updates its comment; one whose link or page has gone deletes it. Both directions are settings, on by default. Verified with pnpm build, test, test:11ty, typecheck, lint and format:check, and with new hermetic suites in src/webmention/ that reproduce the webmention.rocks receiver cases against a stubbed web. AC #5 is left unchecked: the live webmention.rocks run needs a public URL this environment does not have.
<!-- SECTION:FINAL_SUMMARY:END -->
