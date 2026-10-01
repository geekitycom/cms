---
id: TASK-149
title: Generate /llms.txt from site content
status: Done
assignee:
  - '@claude'
created_date: '2026-09-28 23:36'
updated_date: '2026-10-01 12:54'
labels:
  - agents
milestone: m-22
dependencies: []
references:
  - 'https://specification.website/spec/agent-readiness/llms-txt/'
  - 'https://specification.website/spec/agent-readiness/link-headers/'
priority: low
type: feature
ordinal: 173800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The CMS already serves every document as Markdown (.md or Accept: text/markdown), which is what agents want. There is no /llms.txt index that points them at it. A generated llms.txt (site name, tagline, and the key pages and recent posts linked to their .md URLs) is cheap to produce from the content index.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 /llms.txt is served as text/markdown and lists the site title, description, pages and recent posts, each linked to its .md URL
- [x] #2 It is advertised with a Link header and a link element on the home page
- [x] #3 It has validators and 304 support like the sitemap
- [x] #4 A site can turn it off, or replace it with its own file
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Data shape: an LlmsIndex (site title, tagline, pages, recent posts; each entry a title, its .md site path, an optional description and its last-modified date) rendered to Markdown by a pure function, and the source of the file as one choice per request: off, the site's own content/llms.txt, or generated.

1. New packages/cms/src/web/llms.ts: LLMS_TXT_PATH, llmsTxt(index, baseUrl) writing the llmstxt.org shape (# title, > tagline, ## Pages, ## Recent posts, '- [Title](absolute .md URL): description'), llmsTxtResponse(body, lastModified, conditional) with ETag + Last-Modified + no-cache + 304 like the sitemap, served as text/markdown; charset=utf-8, and LLMS_TXT_LINK, the describedby Link value.
2. routes.ts: a fixed root route beside robots.txt. Settings read per request: llmsTxt off answers 404; content/llms.txt present is served verbatim, validated by its bytes and mtime; otherwise the index is built from the store (public pages sorted by title, the newest feedSize public posts), with each entry's .md URL spelled by representationHref.
3. The home page advertises it while it is on: a Link header on '/' (listing or static homepage) and an llmsTxt href on the render context that the default theme's base layout prints as <link rel="describedby" type="text/markdown"> at the root only.
4. Setting llmsTxt (boolean, default on) on the Reading screen under Crawlers, through every settings.ts touchpoint, the reading template, the SETTINGS_PAGE_FORMS fixture and the README.
5. Tests first for each AC in packages/cms/src/web/llms.test.ts, then the code; then build/test/typecheck/lint/format and curl a running demo.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Built as planned. packages/cms/src/web/llms.ts holds the format (llmsTxt), the site's own file reader (ownLlmsTxt, content/llms.txt) and the response (ETag over the body, Last-Modified = newest entry or the own file's mtime, no-cache, 304 on If-None-Match or If-Modified-Since). routes.ts registers /llms.txt beside robots.txt and the manifest; llmsIndex() lists every public page sorted by label and the newest feedSize public posts, each at representationHref(..., 'markdown'); the static homepage is listed at /index.md.

Advertising: the '/' route appends Link: </llms.txt>; rel="describedby"; type="text/markdown" to whatever it answers (listing or static homepage, every representation). render() puts llmsTxt on every template context while site.json does not say llmsTxt: false; the default base layout prints <link rel="describedby" ...> only when atRoot. Home page only, per the AC; the spec suggests every response, which is a later call.

Setting: llmsTxt (boolean, default true) on Settings > Reading as a checkbox under Crawlers; off answers 404 even when content/llms.txt exists. Fixtures updated: SETTINGS_PAGE_FORMS.reading and settings-pages.test.ts READING gained llms_txt: '1'; settings.test.ts expects llmsTxt: true. The admin-bar golden (anonymous-pages.golden.json) was regenerated with GEEKITY_UPDATE_GOLDEN=1: only the four home-page link headers changed.

Validation: pnpm build && pnpm test (2730 pass, cms; 30 pass, demo) && pnpm typecheck && pnpm lint && pnpm format:check all exit 0. Curled the demo on :3149: /llms.txt 200 text/markdown with 7 pages and 5 posts, every listed .md URL 200 text/markdown; home Link header and link element present, absent on a post; If-None-Match and If-Modified-Since both 304; playground/llms.txt served verbatim; llmsTxt:false gave 404 and no advertisement. Server stopped, playground restored.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added /llms.txt: a generated llmstxt.org index (site title, tagline, public pages, recent posts, each linked to its .md URL) served as text/markdown with ETag, Last-Modified and 304s, advertised from the home page by a describedby Link header and link element. A site turns it off with the new Serve /llms.txt checkbox on Settings > Reading (llmsTxt in site.json) or replaces it with content/llms.txt. Verified by src/web/llms.test.ts (13 tests, one suite per AC), a Reading-screen test, the full gate run, and curl against the running demo.
<!-- SECTION:FINAL_SUMMARY:END -->
