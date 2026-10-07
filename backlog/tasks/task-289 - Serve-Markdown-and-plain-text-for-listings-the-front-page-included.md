---
id: TASK-289
title: 'Serve Markdown and plain text for listings, the front page included'
status: In Progress
assignee:
  - '@claude'
created_date: '2026-10-07 21:59'
updated_date: '2026-10-07 22:50'
labels: []
dependencies: []
references:
  - packages/cms/src/web/negotiate.ts
  - packages/cms/src/web/routes.ts
  - packages/cms/src/web/llms.ts
ordinal: 245800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Every listing URL (the home listing, /page/N/, tag and category archives, author archives, the posts page) answers 406 to Accept: text/markdown, because doc-3 said Markdown is not offered for listings. A tool or agent that asks for Markdown only, which is the reader the Markdown representation exists for, gets an error on the first URL it tries. Listings now answer Markdown in the llms.txt shape, and the first page of the home listing answers with the site's llms.txt itself. Every representation that answers Markdown also answers Accept: text/plain with the same body labelled text/plain.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 /page/N/, tag and category archives, author archives and the posts page return 200 text/markdown in the llms.txt shape: the listing's title as the heading, the posts on that page as links to their index.md with descriptions, and links to the newer and older pages' Markdown
- [x] #2 {listing}/index.md serves the same Markdown as the Accept header does, and listing responses advertise the Markdown alternate in their Link header
- [x] #3 Accept: text/plain on a post, a page or a listing returns 200 with the Markdown body and Content-Type text/plain; charset=utf-8; text/markdown still wins when the request ranks it at least as high
- [x] #4 Accept: text/html and Accept: */* still get HTML, and search still offers HTML and JSON only
- [x] #5 doc-3 describes the new listing Markdown and text/plain behaviour
- [x] #6 GET / with Accept: text/markdown on a site whose front page is the latest posts returns 200 text/markdown rendered from the listing itself (site title, tagline, that page's posts, a link to /page/2/index.md), not /llms.txt, which a site may curate separately; a front page that is a page keeps serving that page's Markdown
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Add a 'text' representation in negotiate.ts: same body as markdown, labelled text/plain; charset=utf-8, inline; ordered after markdown so text/markdown wins a tie; not advertised in Link alternates or the 406 list (it has no URL of its own).
2. Add markdown and text to LISTING_REPRESENTATIONS; give search its own HTML+JSON list.
3. listing(): home page 1 Markdown is ownLlmsTxt ?? generatedLlmsTxt(llmsIndex); other pages render an llms.txt-shaped listing (heading, posts on the page, newer/older links) from llms.ts.
4. Body-hash etags for the Markdown so the llms.txt page revalidates correctly.
5. Handle 'text' in errors.ts and maintenance.ts; documents serve text like markdown.
6. Tests per AC; update doc-3.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Posts page: {postsPage}/index.md and index.json now serve the listing, not the page's own file, so the extension and Accept agree at that URL (front-page.test.ts). Search keeps HTML and JSON only (SEARCH_REPRESENTATIONS). Validation: pnpm typecheck, pnpm lint, pnpm test (4838 pass) in packages/cms; live demo on :3999 returned text/markdown and text/plain on /posts/, /posts/page/2/, /category/general/ and a post, index.md equal to Accept, 304 on If-None-Match, search 406. AC#1 is covered by tests; the demo's front page is a page, so the shll.me check (curl -H 'Accept: text/markdown' https://shll.me/ equals /llms.txt) waits on the next release deploy before Done.

Changed after review: the home listing no longer serves llms.txt, because content/llms.txt can be curated differently from the site's posts. / is rendered like every other listing, with the tagline as a quote and pagination. Test: negotiation.test.ts 'renders the home listing under the site's title and tagline, not llms.txt' (with a content/llms.txt present). pnpm test 4833 pass, typecheck and lint clean.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Listings, the latest-posts front page included, answer text/markdown in the llms.txt shape rendered from the listing (title, tagline or description, the page's posts, newer/older links), and every Markdown representation also answers text/plain. Verified by tests per AC and curl against the running demo; shll.me confirmation waits on deploy.
<!-- SECTION:FINAL_SUMMARY:END -->
