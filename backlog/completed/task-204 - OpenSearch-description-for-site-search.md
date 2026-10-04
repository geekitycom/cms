---
id: TASK-204
title: OpenSearch description for site search
status: Done
assignee:
  - '@claude'
created_date: '2026-10-01 17:13'
updated_date: '2026-10-01 17:29'
labels:
  - search
  - theme
dependencies: []
references:
  - packages/cms/themes/default/layouts/base.njk
  - packages/cms/themes/default/layouts/search.njk
priority: low
type: feature
ordinal: 220800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Browsers can offer a site's own search from the address bar when the site publishes an OpenSearch description document and links it with <link rel="search" type="application/opensearchdescription+xml">. Serve /opensearch.xml built from the site's title, tagline, icon and the existing search URL (/search/?q={searchTerms}), with the right content type, and link it from every page's head. Nothing to configure.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 /opensearch.xml answers application/opensearchdescription+xml with ShortName, Description, the favicon as Image and a Url template pointing at /search/?q={searchTerms}
- [x] #2 Every public page's head links it with rel="search"
- [x] #3 The values follow site settings without a restart, and a base path is respected
- [x] #4 A Chromium or Firefox browser offers the site as a search engine after visiting it, or the notes record what was checked
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Data shape: an OpenSearchDescription value { shortName, description, image?, searchTemplate, self } built by a pure function in packages/cms/src/web/opensearch.ts from the site title, tagline, icon setting and config.baseUrl; serialised to XML with the existing escapeXml.
2. Route GET /opensearch.xml in mountPublicSite beside the manifest, reading renderer.site() per request; content type application/opensearchdescription+xml; ETag + 304 like the manifest.
3. ShortName is the title cut to OpenSearch's 16 characters; Description is the tagline, else the title; Image is /favicon.ico (16x16, image/x-icon) only when the site has an icon source; Url template is the absolute /search/?q={searchTerms} with the base path, plus a rel=self Url.
4. Link it from base.njk outside the overridable head block, next to the webmention link, with the site title as its title attribute.
5. Tests first in web/opensearch.test.ts over HTTP: document shape, live settings change, base path, head link on every page kind. Regenerate the anonymous-pages golden.
6. Document in packages/cms/README.md route table and the theme README head section.
7. Verify with build/test/typecheck/lint/format and curl a running server; check browser AC only with real evidence.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Where the link lives: in the theme (base.njk), not injected by middleware. Every other discovery link the site offers (manifest, icons, feeds, webmention, llms.txt) is a theme line, and the theme README already tells a theme replacing base.njk which lines to carry; the IndieAuth link is injected because sign-in breaks without it and it touches only identity paths. Injecting rel=search would buffer and rewrite the body of every HTML response for a convenience feature. The line sits outside the overridable head block, beside the webmention link, so a site overriding head without super() keeps it. The theme README says a replacing base.njk copies the line.

Document: packages/cms/src/web/opensearch.ts builds OpenSearch 1.1 XML from renderer.site() per request and config.baseUrl (the same base the manifest and the absoluteUrl filter use). ShortName is the title cut to 16 characters (code points, trailing space trimmed), Description is the tagline else the title, Image is /favicon.ico at 16x16 image/x-icon only when siteIconSource finds an icon (otherwise that URL 404s), and two Url elements: text/html search template and rel=self. ETag + 304 like the manifest.

Tests: src/web/opensearch.test.ts (8 tests) failed first with 404 and an empty link list, then passed. The base-path test sets an avatar without writing the upload, because a written upload starts background variant derivation that races the sandbox cleanup (ENOTEMPTY on rmdir).

HTTP check: demo server on port 3917 over a scratch copy of apps/demo/content with GEEKITY_BASE_URL=http://localhost:3917/blog. curl /opensearch.xml answered 200 application/opensearchdescription+xml; charset=utf-8 with templates under /blog; home and /posts/ heads carried href=/blog/opensearch.xml. Editing site.json title to 'Renamed Demo Site Here' changed ShortName to 'Renamed Demo Sit' and the link title on the next request with no restart.

Browser check (AC #4): Chrome 154 via the Claude in Chrome extension against the root-based server. On the home page, the link resolved to http://localhost:3917/opensearch.xml, fetched 200, parsed with DOMParser as application/xml with no parsererror, and its text/html template with 'hello' answered 200. Not observed: whether Chrome then listed the site under Settings > Search engines, because the extension cannot open chrome:// pages. Firefox was not tried.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Serve /opensearch.xml, an OpenSearch 1.1 description built per request from the site title, tagline and icon with absolute, base-path-aware URLs to /search/?q={searchTerms}, and link it from every page of the default theme with rel=search. Verified by 8 HTTP-level tests in src/web/opensearch.test.ts (written failing first), the full build/test/typecheck/lint/format run, curl against a demo server with a /blog base path including a live title change, and a Chrome fetch-and-parse of the linked document. Chrome's search engine list itself was not inspected (chrome:// is off limits to the extension).
<!-- SECTION:FINAL_SUMMARY:END -->
