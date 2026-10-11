---
id: TASK-345
title: 'The homepage is named and served at / in every representation, not only HTML'
status: Done
assignee:
  - '@claude'
created_date: '2026-10-11 13:38'
updated_date: '2026-10-11 14:11'
labels:
  - public-site
dependencies:
  - TASK-343
references:
  - packages/cms/src/web/routes.ts
priority: medium
type: bug
ordinal: 304800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Seen on shll.me (v0.30.0), whose homepage is the About page. The HTML form knows the page is the homepage: /about/ answers 301 to /. The other representations do not:
- https://shll.me/index.md has front matter `permalink: /about/`, a URL that redirects; the HTML version names the page /.
- /about/index.md and /about/index.json answer 200 with the page, so the homepage is served at two URLs per representation.
- /about.md answers 301 to /about/index.md, which then answers 200, instead of one 301 to /index.md.

Every representation of the homepage should say it is /, and the page's own permalink should redirect to the root form of the same representation in one hop.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 /index.md and /index.json name the homepage by / (front matter permalink in Markdown, url in JSON), as the HTML does
- [x] #2 /about/index.md, /about/index.json and /about.md each answer one 301 to /index.md or /index.json when that page is the homepage; /about/ still answers 301 to /
- [x] #3 A page that is not the homepage keeps its URLs and redirects
- [x] #4 Tests cover each representation; doc-3 and docs/public-site.md say so
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Name the rule once in web/routes.ts: servedPath(document, pages), the path the public site serves a document at ('/' for the homepage page, its permalink otherwise). Every place that spells the homepage rule (embeddableAt, movedHref, canonicalTarget, llmsEntry, the HTML redirect) uses it, so TASK-346's links inherit it.
2. negotiateDocument drops its href argument and takes the served path from servedPath; the Markdown and JSON are built from the document with that path as its permalink, so /index.md front matter says permalink: / and /index.json url is the site root.
3. The .md/.json suffix lookup redirects to representationHref(servedPath(found)) whenever that differs from the request, so /about/index.md, /about/index.json and /about.md each answer one 301 to /index.md or /index.json. The posts page keeps its listing branch.
4. Tests first in web/front-page.test.ts: front matter and url name /, each permalink representation answers one 301 to the root form, a non-homepage page keeps its URLs and the short .md redirect, the posts page keeps its listing representations.
5. Docs: doc-3 (backlog doc update) and docs/public-site.md.
6. Verify build, test, typecheck, lint, format:check; curl a scratch site whose homepage is a page with permalink /about/ (curl -sI and curl -sL --max-redirs 1).
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
servedPath(document, home) in web/routes.ts is the one place a document's public path is decided: '/' for the homepage page, its permalink otherwise. negotiateDocument lost its href argument and reads servedPath itself; the Markdown and JSON are built from the document with that path as its permalink, so /index.md says permalink: / and /index.json url is the root. The .md/.json suffix lookup redirects to representationHref(servedPath(found)) whenever that differs from the request, which makes /about/index.md, /about.md, /about/index.json and /about.json one 301 each. embeddableAt, movedHref, canonicalTarget, llmsEntry and the HTML permalink redirect now use servedPath; the five spellings of document.path === home?.path ? '/' : permalink are gone, as are the candidate === '/' href override and the servesListing flag.
The posts page keeps its listing at {permalink}index.md and index.json, and /news.md 301s to /news/index.md as before.
Validation: pnpm build, pnpm test (cms 5458 pass, plugin-llm 48, demo 32), typecheck, lint, format:check all exit 0. Curl on a scratch site (homepage about at /about/, posts page news, page contact): /index.md front matter permalink: /; /index.json url http://localhost:4345/ and frontMatter.permalink /; /about/, /about/index.md, /about.md, /about/index.json, /about.json and /about/index.md?x=1 each curl -sI 301 to /, /index.md or /index.json (query kept), and curl -sL --max-redirs 1 lands 200 after 1 redirect; /contact/, /contact/index.md, /contact/index.json 200 with permalink /contact/, /contact.md 301 to /contact/index.md; /news/index.md is the listing.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
A static homepage is now named and served at / in every representation. servedPath(document, home) in web/routes.ts decides a document's public path ('/' for the homepage page, its permalink otherwise) and every route uses it: the HTML redirect, the Markdown and JSON bodies (front matter permalink: / and url at the root), the .md/.json suffix redirects (each of the homepage's own representation URLs answers one 301 to /index.md or /index.json), oEmbed, moved URLs, slash canonicalisation and llms.txt. Other pages and the posts page keep their URLs. Verified by three new tests in src/web/front-page.test.ts, the full build/test/typecheck/lint/format:check run, and curl -sI / curl -sL --max-redirs 1 on a served scratch site. doc-3, docs/public-site.md and docs/settings.md describe it.
<!-- SECTION:FINAL_SUMMARY:END -->
