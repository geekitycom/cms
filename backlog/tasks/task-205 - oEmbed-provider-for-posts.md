---
id: TASK-205
title: oEmbed provider for posts
status: Done
assignee:
  - '@claude'
created_date: '2026-10-01 17:13'
updated_date: '2026-10-01 17:40'
labels:
  - interop
  - embed
dependencies: []
references:
  - packages/cms/src/web/routes.ts
  - 'https://oembed.com/'
priority: low
type: feature
ordinal: 221800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
WordPress, Discourse and many other tools turn a pasted URL into an embedded card by asking the page's oEmbed provider. Serve an oEmbed endpoint for posts and pages (JSON, and XML if cheap) of type rich, with an html snippet that is a self-contained blockquote card (title or excerpt, author, date, link back) that needs no script from this site, plus title, author_name, author_url, provider_name, provider_url and thumbnail when the post has an image. Advertise it with <link rel="alternate" type="application/json+oembed"> on each post. maxwidth and maxheight are honoured or ignored per the spec; unknown URLs get 404.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Each post and page links its oEmbed endpoint with rel="alternate" type="application/json+oembed"
- [x] #2 The endpoint answers type rich with html, title, author_name, author_url, provider_name and provider_url, and a thumbnail when the post has an image
- [x] #3 The html is a static blockquote with no script and escapes everything from the post
- [x] #4 A URL that is not a published post or page gets 404, and a draft is never exposed
- [x] #5 Pasting a post URL into a WordPress editor produces the embed, or the notes record what was checked
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Data shape: an OEmbed rich object (version, type rich, title, author_name/url, provider_name/url, width, height, html, thumbnail trio only together) built by a pure builder in packages/cms/src/web/oembed.ts, serialised to JSON or XML; a response function with contentEtag/isNotModified like opensearch.ts.
2. Endpoint at /_geekity/oembed (the CMS's reserved prefix, so no permalink can shadow it), mounted next to the OpenSearch route in mountPublicSite. url is resolved with permalinkOfObjectId (origin + base path) then publicDocumentAt (drafts, trash, scheduled hidden); / resolves to the static homepage; the posts page (a listing at its URL) does not embed. format json (default) or xml; anything else 501. maxwidth/maxheight clamp width/height; a thumbnail larger than them is dropped.
3. html: a static blockquote card (linked title or label, excerpt, author, readable date in the site's zone and locale, link to the site), every value escaped, no script.
4. Author from the document's author via authorContext over listUsers, else the site author (siteAuthorContext), as the byline does; author_url absolute.
5. Thumbnail: the post's own image (not the site avatar) with the size recorded in its variant sidecar; omitted when the size is unknown, since the spec requires width and height with it.
6. Discovery: default theme base.njk prints <link rel=alternate type=application/json+oembed> (and text/xml+oembed) for posts and pages (isEntry), outside the head block, href built with absoluteUrl.
7. Tests first per AC in src/web/oembed.test.ts over HTTP; then README/theme README notes; verify with build/test/typecheck/lint/format and curl against a running demo, emulating WordPress discovery.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Built:
- packages/cms/src/web/oembed.ts: oEmbedRequest (query parse; format json default, xml, anything else 501), oEmbedFor (pure builder of a type rich object), oEmbedResponse (contentEtag/isNotModified, JSON or XML via escapeXml). Endpoint at /_geekity/oembed, the CMS's reserved prefix, so no permalink can shadow it; mounted beside the OpenSearch route in mountPublicSite.
- Resolution (routes.ts embeddableAt): permalinkOfObjectId (same origin, under the base path, no query) then publicDocumentAt, the router's own lookup, so drafts, trash and scheduled posts are 404. / is the static homepage when one is set; the posts page (a listing at its URL) is 404.
- Author: authorContext(listUsers, document.author) else siteAuthorContext(site.author), the byline's resolution; author_url absolute.
- Thumbnail: the post's own image (never the avatar) with its size from the variant sidecar; omitted when no size is recorded, because the spec requires width and height with it, and dropped when larger than maxwidth/maxheight. width/height are 600x338, clamped to maxwidth/maxheight.
- html: <blockquote class="geekity-embed" cite> with a linked title (postLabel, so a note gets its first words), the excerpt for titled posts, author link and <time> in the site's zone and locale, and a link to the site. Every value goes through escapeXml; no script, no event handlers.
- base.njk: <link rel=alternate type=application/json+oembed> and text/xml+oembed for isEntry pages, outside the head block, href built with absoluteUrl.
- Docs: route table in packages/cms/README.md, a paragraph in themes/default/README.md.

Evidence: src/web/oembed.test.ts, 15 tests over HTTP (AC1 to AC4), including base path, static homepage, posts page, draft, scheduled, foreign origin, query, maxwidth/maxheight, XML parsed with the strict reader, 501, 304. Mutation check: replacing publicDocumentAt with a raw getByPermalink fails 2 tests. pnpm build, pnpm test (3038 + 30 pass), pnpm typecheck, pnpm lint, pnpm format:check all pass.

Live check against apps/demo on port 3417: the post page links http://localhost:3417/_geekity/oembed?url=...&format=json; fetching it with maxwidth=500&maxheight=750 (what WordPress sends) answers 200 application/json, type rich, width 500.

AC #5 NOT met, left unchecked. Checked with WordPress 7.1.2's own code (wordpress.org/latest.tar.gz) run under PHP against the demo: WP_oEmbed discovery regex finds the link and data2html returns our blockquote, but wp_filter_oembed_result (hooked on oembed_dataparse, wp-includes/embed.php:934) passes any non-allowlisted provider's rich html through wp_kses allowing only a, blockquote and iframe, then requires an <iframe> ("We require at least the iframe to exist") and returns false otherwise. Result: false, so the WordPress editor shows the URL as could-not-embed. A script-free blockquote-only card cannot embed in WordPress by design. Making it work needs a separate decision: an iframe-able embed view per post (as WordPress's own /embed/ pages) with frame-ancestors relaxed for that route only (the site currently sends X-Frame-Options SAMEORIGIN and frame-ancestors 'self'), placed after the blockquote in the html. Out of this task's stated scope; needs the owner's call.

Orchestrator: AC #5's WordPress embed cannot pass with a script-free blockquote card, by WordPress's design (it requires an iframe for non-allowlisted providers). What was checked is recorded above, as the criterion's clause allows; making WordPress embed work is tracked as TASK-208, which needs an iframe embed route and a framing-policy exception.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Posts and pages advertise an oEmbed endpoint (/_geekity/oembed, JSON and XML) answering a static, fully escaped rich blockquote card with author, date, excerpt and a thumbnail when sized; drafts, scheduled posts and listings 404. Verified with 15 HTTP tests, a mutation check on the draft guard, curl against the demo, and WordPress 7.1.2's own discovery and filter code, which accepts discovery but drops iframe-less cards; WordPress embedding is TASK-208.
<!-- SECTION:FINAL_SUMMARY:END -->
