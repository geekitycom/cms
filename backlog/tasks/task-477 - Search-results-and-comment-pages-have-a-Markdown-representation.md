---
id: TASK-477
title: Search results and comment pages have a Markdown representation
status: Done
assignee:
  - '@claude'
created_date: '2026-10-21 23:42'
updated_date: '2026-10-22 01:11'
labels:
  - markdown
  - public-site
milestone: m-44
dependencies: []
references:
  - packages/cms/src/web/markdown-representation.ts
  - packages/cms/themes/default/partials/markdown-footer.md.njk
  - packages/cms/themes/default/partials/markdown-header.md.njk
  - docs/theme/markdown.md
  - docs/public-site.md
  - packages/cms/src/web/listing-pages.ts
ordinal: 402800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
/search/?q= serves HTML and JSON only: Accept text/markdown answers 406 and /search/index.md 404s. A comment permalink (/comment/{key}/) answers Accept text/markdown with 200 HTML and its index.md 404s. Both should have a Markdown representation like every other page, advertised in their Link header.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 /search/index.md?q=... and Accept text/markdown on /search/?q=... answer text/markdown listing the results in the listing Markdown shape, with the query and paging
- [x] #2 A comment permalink answers .md and Accept text/markdown with the comment, its author and date, the post it is on, and its place in the thread as the HTML shows it
- [x] #3 Both advertise the Markdown alternate in the Link header and are documented in docs/public-site.md; tests cover them
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. representationHref keeps a query string after the extension, so /search/?q=x maps to /search/index.md?q=x and the 406 body and Link header of search are right; search uses the default alternates.
2. SEARCH_REPRESENTATIONS gains markdown and text; /search/index.md routes to search(c,'markdown'); searchMarkdown in markdown-representation.ts writes front matter (title, permalink with query, query, home, previous/next), a summary line, ## Results as an entry list with the snippet (matches in bold), ## More results pager, and the theme chrome.
3. markdownHrefFor recognises /search/ (keeping the link's query) and a visible comment page, so links to both get their .md.
4. Comment page: /comment/{key}/index.md route and Accept negotiation in commentPage; commentMarkdown writes front matter (title, permalink, author, date), chrome type 'comment' with the thread chain (post, then ancestors or a withheld placeholder) and the comment's byline for the header, the comment's words as the body, and the replies plus the link to the whole conversation for the footer. Link header advertises the alternates.
5. Tests first: search.test.ts (md, Accept, paging, Link, 406 alternates), conversation-markdown.test.ts (comment page md, withheld ancestor, Link), update expected /comment/ URLs and the anonymous-pages golden.
6. Document in docs/public-site.md, docs/theme/markdown.md and doc-3; run the full check suite and curl the scratch site.

7. The footer's reply macros move to partials/markdown-reply.md.njk (named, said, reply), imported with context by both partials; a quote filter on the Markdown environment writes the thread's quotes.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Search: representationHref now keeps a query after the extension, so the negotiator's own Link header and 406 body are right for /search/?q=… and the hand-built search alternates in listing-pages.ts are gone. SEARCH_REPRESENTATIONS is removed; search negotiates LISTING_REPRESENTATIONS and /search/index.md routes to it. searchMarkdown writes front matter title (the HTML <title>, ', page N' after the first), permalink with the query, query, home, previous/next; then a summary line (N results / Nothing found / how to search with ?q=), ## Results (entryList with snippetMarkdown: escaped, matched words in **bold**) and ## More results (Previous results / More results). searchHref lost its unused representation parameter. /search/?q=index.md is a search for the words 'index.md' and answers HTML, which is right; /search/index.md?q=index.md answers Markdown. The short spelling /search.md 404s, as /search.json already did.

Comment pages: commentPage negotiates COMMENT_REPRESENTATIONS (html, markdown, text; no JSON) through representationResponse, so it now sends Vary and a Link header; Markdown gets an ETag over its bytes. /comment/:id/index.md is a route. commentMarkdown builds chrome type 'comment' with thread {post, ancestors, comment, url} from markdownCommentThread; the header writes the chain and the comment's byline, the comment's words are the body, the footer writes ## Replies and the link to the comment's anchor on the post. markdownHrefFor recognises /search/ (keeping the link's query) and /comment/{key}/ for an approved form comment on a served post, read from the comment's record rather than the thread so a post with many replies does not regather per link. Menu links to /search/ now point at /search/index.md (tests in markdown-representation.test.ts updated), and reply links at /comment/{key}/index.md (conversation-markdown.test.ts); golden regenerated (search Link headers only).

Docs: docs/public-site.md (Content negotiation, The Markdown), docs/theme/markdown.md (thread context, quote filter, markdown-reply partial, type comment), docs/comments.md, doc-3 (Search, new Comment pages section).

Verified: pnpm build && pnpm test && pnpm test:11ty && pnpm typecheck && pnpm lint && pnpm format:check all exit 0. Curled the scratch site on :3472: /search/index.md?q=theme and Accept text/markdown answer text/markdown with Link alternates carrying the query, page 2 has previous, a 406 body names all three URLs with the query; /comment/…a1,a2,a4/index.md 200 with thread, a3 (pending) 404, HTML /comment/…a2/ Link advertises index.md, the post's Markdown links replies at /comment/…/index.md.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Search results and native comment pages now have a Markdown representation. /search/index.md?q=… and Accept text/markdown on /search/?q=… write the listing shape (front matter with the query, a result count line, ## Results with bolded snippets, ## More results with the query kept); representationHref keeps a query after the extension so the Link header and 406 body name the right URLs. /comment/{key}/index.md and Accept text/markdown write the comment with its author and date, the post it is on, each ancestor (a hidden one as a placeholder), its replies, and the link to the thread; links to both from any Markdown become .md links. Documented in docs/public-site.md, docs/theme/markdown.md, docs/comments.md and doc-3. Verified with new tests in search.test.ts and conversation-markdown.test.ts, the full build/test/test:11ty/typecheck/lint/format:check run, and curl against the scratch site.
<!-- SECTION:FINAL_SUMMARY:END -->
