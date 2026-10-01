---
id: TASK-203
title: Receive pingbacks as mentions
status: To Do
assignee: []
created_date: '2026-10-01 17:13'
updated_date: '2026-10-01 17:18'
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
- [ ] #1 Posts advertise the pingback endpoint in an X-Pingback header and a <link rel="pingback">
- [ ] #2 A valid pingback.ping is verified, moderated and displayed exactly like the equivalent webmention, and a repeated one updates rather than duplicates it
- [ ] #3 Invalid calls get the spec's XML-RPC fault codes; malformed or oversized XML is refused without parsing external entities
- [ ] #4 A pingback from a real WordPress site is received end to end, or the notes record what was checked
<!-- AC:END -->
