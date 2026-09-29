---
id: TASK-128
title: 'Site-level redirect list, and X-Redirect-By on every redirect the CMS sends'
status: Done
assignee:
  - '@claude'
created_date: '2026-09-28 23:36'
updated_date: '2026-09-29 00:26'
labels:
  - seo
  - urls
milestone: m-18
dependencies:
  - TASK-127
references:
  - 'https://specification.website/spec/seo/redirects/'
  - 'https://specification.website/spec/resilience/redirect-by/'
priority: medium
type: feature
ordinal: 152800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Sites that move to this CMS, or reorganise, need arbitrary old paths to point somewhere new, for example WordPress ?p=123 links or a retired section. There is no way to declare a redirect today. Every redirect the CMS sends should also name the CMS in X-Redirect-By, so someone debugging a redirect chain behind a proxy can tell which layer issued it.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A site declares redirects in a file (source path, target path or URL, permanent or temporary) that is part of the site's content, and they are served with the declared status
- [x] #2 Declared redirects are checked before the 404 page and never shadow a live document
- [x] #3 Invalid entries and redirect loops are reported at boot, not served
- [x] #4 Every redirect the CMS sends carries X-Redirect-By: Geekity CMS
- [x] #5 packages/cms/README.md documents the file format
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Data shape: content/_data/redirects.json, a JSON list of { from, to, status? }. from is a site path starting with / and may carry a query string (e.g. /?p=123); to is a site path or an absolute http(s) URL; status is 301, 302, 307 or 308, default 301.
2. src/web/redirects.ts: pure parseRedirects(text) -> { table, problems }, which drops malformed entries, second declarations of a source and every entry leading into a loop (all loops found before any entry is dropped). createRedirectSource reads the file per call, re-parses only when its text changes and warns each problem once per change; createCms asks once at boot.
3. Serve: path-only sources in resolveRequest after every live lookup, moved URLs and the canonical slash redirect, just before the 404; a slashless request whose slash form is declared reaches the target in one hop. Query sources match only that exact query (parameters sorted) in a public-site middleware registered before the / route, since documents are never addressed by a query.
4. X-Redirect-By: one app-level middleware (redirectBy) that stamps X-Redirect-By: Geekity CMS on any 3xx carrying a Location, covering the public site, admin 303s/302s, federation and taxonomy redirects.
5. Tests first through HTTP (src/web/redirects.test.ts), then the README section.
6. Verify with pnpm build/test/typecheck/lint/format:check and curl a running site.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Location and format: content/_data/redirects.json, beside site.json and read the same way (per request, cached on the file's text), so it is content in git per decision-9 and needs no watcher or restart.
Ordering decision: a path-only source is checked after canonicalPath, not before, so a stale declaration of /about cannot beat the slash redirect to a live /about/. The slash-form fallback (/soon -> declared /soon/) keeps the declared status in one hop, which is why it lives in resolveRequest rather than in canonicalTarget (that one always answers 301).
Query sources: answered by a middleware at the top of mountPublicSite, because / is a route the not-found handler never sees. Registered after the admin, federation and health routes, so those still answer first (probed: /admin/?x=1, /healthz?x=1 and /_geekity/health?x=1 declared as sources are not redirected). A path source carries the request query to a target with none; a query source does not.
X-Redirect-By: middleware registered after baselineSecurityHeaders in createCms rather than touching each c.redirect call site.
Out of scope, unchanged: a moved post's comments feed (old URL + /feed/) is still not redirected.
Validation: failing-first run of src/web/redirects.test.ts showed 404 where 301 was expected and 200 for /?p=123; the shadow test was proved by temporarily moving the declared lookup ahead of the live lookups (2 tests failed), then reverted. pnpm build, pnpm test (2304 + 30 pass), pnpm typecheck, pnpm lint, pnpm format:check all pass. Curled geekity serve over a copy of the demo content: /?p=123 -> 301 to the post with X-Redirect-By: Geekity CMS; /?p=124 -> 200; /forum/?a=1 -> 308 to https://forum.example.com/?a=1; loops and a bad from were warned at boot and 404; /colophon and /admin redirects carry X-Redirect-By; after editing the file, /old-section/?x=1 -> 302 /colophon/?x=1, /old-section -> 302 /colophon/ in one hop, and a declared /colophon/ still serves the live page 200. Server stopped.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Sites can now declare redirects in content/_data/redirects.json, a JSON list of { from, to, status } where from is a site path (optionally with a query string such as WordPress's /?p=123), to is a site path or http(s) URL, and status is 301, 302, 307 or 308 (default 301). The file is read per request and cached on its text. Malformed entries, duplicate sources and every entry leading into a loop are logged at boot and skipped. Path sources are answered only after every live lookup, moved URL and canonical slash redirect, just before the 404; query sources are matched exactly (parameter order ignored) ahead of the routes, since no document is addressed by a query. A new app-level middleware stamps X-Redirect-By: Geekity CMS on every 3xx the CMS sends. README documents the format and the query-string rules. Verified by src/web/redirects.test.ts (failing first, shadow test mutation-checked), the full build/test/typecheck/lint/format gate, and curl against geekity serve.
<!-- SECTION:FINAL_SUMMARY:END -->
