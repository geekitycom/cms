---
id: TASK-299
title: The short `.md` spelling redirects to the `index.md` one
status: Done
assignee:
  - '@claude'
created_date: '2026-10-08 13:46'
updated_date: '2026-10-09 01:32'
labels: []
dependencies: []
ordinal: 259800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A post at `/2026/01/hello-world/` answers its Markdown at both `/2026/01/hello-world/index.md` (the spelling the `Link` header and llms.txt advertise) and `/2026/01/hello-world.md` (the one people type), each with a 200 and the same body. One resource should have one URL per representation, so the short spelling answers a 301 to the `index` one. `Accept: text/markdown` at the permalink itself keeps serving the Markdown in place. The same holds for `.json`.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A request for `/2026/01/hello-world.md` answers 301 with `Location: /2026/01/hello-world/index.md`, and `.json` likewise
- [x] #2 A listing asked for by the short spelling (`/tag/x.md`) redirects to `/tag/x/index.md`
- [x] #3 The query string is kept across the redirect
- [x] #4 A document whose permalink has no trailing slash still answers `{permalink}.md` with a 200
- [x] #5 `index.md` URLs and `Accept: text/markdown` at the permalink still answer 200 in place
- [x] #6 doc-3 (Content Negotiation) says the short spelling redirects
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. In resolveRequest, once a `.md`/`.json` candidate resolves to a document or listing, compare the request path with representationHref(candidate); answer 301 there (query kept) when they differ.
2. Tests in negotiation.test.ts: short spelling redirects for a post, a listing, with a query; slashless permalink still 200; index spelling and Accept still 200.
3. Update negotiate.ts docblock and doc-3.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Redirect lives in resolveRequest: once a .md/.json candidate resolves (document or listing), the request is compared with representationHref(candidate) and answers 301 there when they differ. robots.test.ts asked for /hello.md expecting 200; switched it to /hello/index.md. Verified: negotiation.test.ts covers post, json+query, /tag/notes.md, /page/2.json, slashless /colophon.md (200); index.md/index.json still 200; robots test covers Accept: text/markdown at the permalink. Full suite 4837/4837, tsc and prettier clean.

2026-10-08: verified on shll.me after the 0.25.0 deploy: /2026/01/hello-world.md answers 301 to /2026/01/hello-world/index.md (200), /2026/01/hello-world.json answers 301 to .../index.json, and the permalink with Accept: text/markdown answers 200 text/markdown in place.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
The short '/x.md' and '/x.json' spellings answer 301 to '/x/index.md' and '/x/index.json', while Accept negotiation at the permalink still serves in place (PR #140). Verified by negotiation and robots tests and on shll.me after the 0.25.0 deploy.
<!-- SECTION:FINAL_SUMMARY:END -->
