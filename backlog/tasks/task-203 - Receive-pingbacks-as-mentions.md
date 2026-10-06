---
id: TASK-203
title: Receive pingbacks as mentions
status: Done
assignee:
  - '@claude'
created_date: '2026-10-01 17:13'
updated_date: '2026-10-06 01:55'
labels:
  - webmention
  - wordpress
  - interop
milestone: m-28
dependencies: []
references:
  - packages/cms/src/webmention/receive.ts
  - packages/cms/src/webmention/routes.ts
  - 'https://www.hixie.ch/specs/pingback/pingback'
priority: medium
type: feature
ordinal: 219800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
WordPress sites send pingbacks, not webmentions, unless they run the Webmention plugin, so links to this site from most WordPress blogs are never seen. Accept Pingback 1.0: advertise the endpoint with an X-Pingback header and <link rel="pingback"> on posts, accept the XML-RPC pingback.ping(source, target) call, and hand it to the same verification, moderation, spam check and display path as a webmention (webmention/receive.ts), so a pingback is just a webmention that arrived another way. Answer with the XML-RPC fault codes the spec defines (0x0010 source not found, 0x0011 no link, 0x0020 target not found, 0x0021 not a target, 0x0030 already registered). Do not send pingbacks.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Posts advertise the pingback endpoint in an X-Pingback header and a <link rel="pingback">
- [x] #2 A valid pingback.ping is verified, moderated and displayed exactly like the equivalent webmention, and a repeated one updates rather than duplicates it
- [x] #3 Invalid calls get the spec's XML-RPC fault codes; malformed or oversized XML is refused without parsing external entities
- [x] #4 A pingback from a real WordPress site is received end to end, or the notes record what was checked
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Data shape: a PingbackFault table (0x0010 source, 0x0011 no link, 0x0020 target, 0x0021 not a target, 0x0030 already registered, 0 generic, -32700/-32601/-32602 for XML-RPC interop) and a parsed call {source, target}.
2. receive.ts: checkWebmentionRequest refusals name their problem (source, target, elsewhere, same) so the pingback route can map them to fault codes; verifyWebmention's deleted/ignored outcomes say why (gone, unlinked, discarded) so 0x0010 and 0x0011 can be told apart. Webmention behaviour unchanged.
3. New webmention/pingback.ts: PINGBACK_PATH /_geekity/pingback; a strict, capped XML-RPC reader that refuses any DOCTYPE/ENTITY declaration and any entity beyond the five predefined and numeric ones (so nothing external is ever resolved), and a body cap; mountPingbacks awaits webmentions.receive (the same verify, moderation, spam check and display pipeline) and answers methodResponse or fault. A target page that is not answerable gets 0x0021. A repeat updates the held comment and answers 0x0030. Gated by the webmentionsReceive setting (404 when off).
4. Advertise: X-Pingback header (absolute URL) on a document response and pingback on the render context, both only when the site takes webmentions and answerable(document, commentPolicyOf(site), now) holds; base.njk writes <link rel="pingback">.
5. Tests first (pingback.test.ts) per AC; docs in packages/cms/README.md and the default theme README.
6. Verify with pnpm build/test/typecheck/lint/format:check and curl against a running demo site.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Order: if TASK-196 (comments on pages) has landed, advertise the pingback endpoint on pages that accept comments too, not just posts. Not a hard dependency.

Built /_geekity/pingback (packages/cms/src/webmention/pingback.ts). A pingback.ping goes through checkWebmentionRequest and webmentions.receive, the same verify/spam-check/intake path as a webmention, and is filed as source "webmention" (deliberately: one entry per source URL whichever way it arrived). The endpoint awaits verification because XML-RPC answers in-band, so a slow source holds the request up to VERIFY_TIMEOUT_MS (15s).

Decisions:
- Advertised (X-Pingback absolute URL + <link rel="pingback">) via pingbackEndpointFor(site, document, now): webmentionsReceive on and answerable() holds, so every post and pages with comments open. Same rule refuses a ping to a page that takes no comments with 0x0021.
- A repeated ping rewrites the held entry (as a re-sent webmention does) and answers 0x0030, reconciling AC#2 with the spec's already-registered fault.
- Faults: 0x0010 missing/non-http/private source or a 4xx source; 0x0011 no link; 0x0020 no such target; 0x0021 target elsewhere, same as source, or page closed to comments; 0 for an unreadable source (5xx/timeout) or a checker discard; -32700 malformed, over 16 KB, or any DOCTYPE/<! declaration; -32601 unknown method; -32602 wrong arg count.
- XML is read by a small strict reader, not a parser: any DOCTYPE is refused, only the five predefined and numeric character references are decoded, anything else is -32700. Nothing external can be resolved.
- receive.ts: refusals now carry a problem (source/target/elsewhere/same) and deleted/ignored outcomes carry why (gone/unlinked/discarded). Webmention HTTP behaviour unchanged.

Verification: pingback.test.ts (20 tests, envelope matches WordPress IXR_Request) incl. a test that a pinged link and the same webmention store identical records; mutation check (dropping the answerable gate or the size cap) fails tests. Full pnpm build/test (4650+30 pass)/typecheck/lint/format:check green. Curl against a scratch CMS on :3123 with a source on src.localtest.me:8099: X-Pingback + link on a post and on the comments-open front page, none on /colophon/; first ping -> success string, repeat -> 48 with one stored entry, no link -> 17, 404 source -> 16, missing target -> 32, closed page -> 33, DOCTYPE with external entity -> -32700 and the entity URL never fetched, 20 KB body -> -32700. anonymous-pages.golden.json regenerated: the only change is the new x-pingback header.

AC#4 open: no deployed site reachable from a real WordPress install in this session. Checked instead: the test envelope is byte-for-byte the shape WordPress's IXR client writes. Proof needs a deploy and a WordPress post linking to it.

AC#4 checked on its own second clause: the notes above record what was checked (WordPress IXR envelope in tests, live curl end to end against a local site). A ping from a real WordPress blog is still worth trying after the next deploy.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added Pingback 1.0 receive at /_geekity/pingback. Posts and comment-open pages advertise it in an X-Pingback header and <link rel="pingback">. A pingback.ping goes through the webmention check, verification, spam checker and moderation queue and is stored as the same entry a webmention would be; a repeat rewrites it and answers 0x0030. Spec fault codes for bad source/target, XML-RPC interop codes for bad calls, and a strict 16 KB reader that refuses any DOCTYPE so no entity is ever resolved. Verified with pingback.test.ts (20 tests), the full build/test/typecheck/lint/format suite, and curl against a running site.
<!-- SECTION:FINAL_SUMMARY:END -->
