---
id: TASK-289
title: 'Serve Markdown and plain text for listings, the front page included'
status: In Progress
assignee:
  - '@claude'
created_date: '2026-10-07 21:59'
updated_date: '2026-10-07 22:00'
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
- [ ] #1 GET / with Accept: text/markdown on a site whose front page is the latest posts returns 200 text/markdown with the same body /llms.txt serves (the site's own content/llms.txt when it has one, else the generated one), whether or not the llmsTxt setting is on
- [ ] #2 /page/N/, tag and category archives, author archives and the posts page return 200 text/markdown in the llms.txt shape: the listing's title as the heading, the posts on that page as links to their index.md with descriptions, and links to the newer and older pages' Markdown
- [ ] #3 {listing}/index.md serves the same Markdown as the Accept header does, and listing responses advertise the Markdown alternate in their Link header
- [ ] #4 Accept: text/plain on a post, a page or a listing returns 200 with the Markdown body and Content-Type text/plain; charset=utf-8; text/markdown still wins when the request ranks it at least as high
- [ ] #5 Accept: text/html and Accept: */* still get HTML, and search still offers HTML and JSON only
- [ ] #6 doc-3 describes the new listing Markdown and text/plain behaviour
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
