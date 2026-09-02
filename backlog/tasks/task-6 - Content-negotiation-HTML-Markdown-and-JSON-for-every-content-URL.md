---
id: TASK-6
title: 'Content negotiation: HTML, Markdown, and JSON for every content URL'
status: Done
assignee:
  - '@andrewshell'
created_date: '2026-09-02 13:25'
updated_date: '2026-09-02 20:53'
labels:
  - web
milestone: m-0
dependencies:
  - TASK-5
references:
  - backlog/docs/doc-3 - Content-Negotiation.md
type: feature
ordinal: 6000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement doc-3. Select representation by .md or .json extension first, then by Accept with q-values. Add Vary and Link alternate headers, ETag and Last-Modified with 304 handling, and a 406 with a JSON list of options. Listings negotiate HTML and JSON only.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Accept: text/markdown on a post URL returns the stored file text with front matter and Content-Type text/markdown
- [x] #2 Accept: application/json returns the documented JSON shape with schema, frontMatter, markdown, html, and url
- [x] #3 Appending .md or .json to a permalink returns that representation regardless of Accept
- [x] #4 Missing Accept or */* returns HTML
- [x] #5 Accept with only unsupported types returns 406 with a JSON body listing alternates
- [x] #6 Responses include Vary: Accept and Link alternate headers, and If-None-Match with a matching ETag returns 304
- [x] #7 GET / with Accept: application/json returns an array of post summaries without markdown or html unless ?full=1
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Add src/web/negotiate.ts: the whole negotiation policy as pure functions — Representation ('html' | 'markdown' | 'json'), REPRESENTATIONS media types, parseAccept() (a small in-house q-value parser), selectRepresentation({accept, available}) returning a representation or 'not-acceptable', splitRepresentationExtension() for the .md/.json escape hatch (handles both /x.md and /x/index.md), alternateLinks(), representationEtag(), lastModifiedOf(), isNotModified() for If-None-Match/If-Modified-Since, and the JSON shapes (documentJson, documentSummaryJson) with schema 1.
2. Export documentFrontMatter() from src/content/writer.ts (extracted from the private frontMatterOf) so the JSON frontMatter block and the serialized file text cannot drift.
3. Rework resolveDocument() in src/web/routes.ts: try the exact path, then strip a .md/.json suffix and retry through the single publicDocumentAt() lookup, then branch on representation. Extension wins over Accept; Accept follows with q-values; missing Accept and */* give HTML; an unsupported-only Accept gives 406 with a JSON body listing the alternates.
4. Make the listing routes negotiate HTML and JSON only, via one serveListing() that both the routes and the extension path use, so /index.json, /page/2/index.json and /tags/x/index.json work too. Listing JSON is an array of summaries without markdown or html unless ?full=1.
5. Every negotiated response carries Vary: Accept, Link rel=alternate for the other representations, ETag (sha256 over representation + document hash) and Last-Modified (updated, else date), with 304 on a matching If-None-Match or a fresh If-Modified-Since. HTML validators are withheld while watch is on, because a template edit does not move the document hash and must not be answered with a stale 304.
6. Test-first with node:test through cms.app.request(): src/web/negotiate.test.ts for the parser and selector, src/web/negotiation.test.ts for the HTTP behaviour. Keep every TASK-5 HTML assertion in site.test.ts passing untouched.
7. Document the representations, the selection rules, the JSON shapes and the caching headers in packages/cms/README.md. Verify with pnpm test, pnpm typecheck, pnpm build, then curl each representation, a 304 and a 406 against the demo server.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Added src/web/negotiate.ts as the one place the representation policy lives: Representation ('html' | 'markdown' | 'json'), MEDIA_TYPES and REPRESENTATION_EXTENSIONS as the two tables everything else derives from, an in-house parseAccept()/selectRepresentation() with q-values (no new dependency), splitRepresentationExtension()/representationHref() for the .md and .json escape hatch, representationResponse()/notAcceptableResponse() for the headers, and documentJson() for the shape. routes.ts wires it: resolveDocument() tries the exact path, then the same publicDocumentAt() lookup with the suffix stripped, so no representation can resolve to a document the others cannot see; homeListing/tagListing collapsed into one listing() that both the routes and the extension path call.

Decisions worth recording:
- The Link header advertises `<permalink>index.md` and `<permalink>index.json`, the spelling doc-3 gives. `/2026/09/hello.md` is accepted too, because that is what people type.
- JSON `frontMatter` is documentFrontMatter(), extracted from writer.ts's private frontMatterOf() and now exported, so the JSON and the .md file cannot disagree about a document's front matter. `markdown` is the body without the front matter (the front matter is already its own key); `url` is absolute, on baseUrl.
- ETag is sha256 over representation + document hash, so the three bodies at a URL never share a validator. A listing hashes its href, its pagination, the ?full flag and the hashes of the documents on the page.
- Cache-Control: no-cache accompanies every validator, so a client revalidates rather than guessing a freshness lifetime.
- While watch is on, the HTML representation is served without validators. Only the document is hashed and a template edit does not move that hash, so a development server would otherwise answer 304 with a page that had already changed. The .md and .json representations are validated either way. Covered by a test.
- Listings offer HTML and JSON only; Accept: text/markdown on a listing is a 406 whose alternates list the two.
- /feed.xml and /feed.json are untouched, as doc-3 requires.

Validation: pnpm test 227 pass / 0 fail (36 new assertions across src/web/negotiate.test.ts and src/web/negotiation.test.ts); pnpm typecheck and pnpm build clean. Then the demo booted on :3000 and curl -i showed each representation, the extension beating Accept, a 304 from If-None-Match and from If-Modified-Since, the 406 body, and the home listing as summaries with and without ?full=1; the server was killed and lsof -nP -iTCP:3000 came back empty.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Implemented doc-3. Every public content URL now serves HTML, Markdown or JSON, chosen by a .md/.json suffix first and then by Accept with q-values, with */* and a missing header meaning HTML and an unsatisfiable Accept meaning 406 with the alternates in the body. Listings negotiate HTML and JSON only, JSON being an array of summaries that gains markdown and html under ?full=1. All of it carries Vary: Accept, Link rel=alternate, ETag over representation plus document hash, Last-Modified, and 304 for If-None-Match and If-Modified-Since. The policy lives in the new src/web/negotiate.ts; routes.ts only wires it. Verified by 227 passing node:test cases (36 new, driven through cms.app.request()), clean pnpm typecheck and pnpm build, and curl -i against the running demo showing each representation, the extension overriding Accept, a 304 and a 406.
<!-- SECTION:FINAL_SUMMARY:END -->
