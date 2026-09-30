---
id: TASK-139
title: Compress text responses (brotli and gzip)
status: Done
assignee:
  - '@claude'
created_date: '2026-09-28 23:36'
updated_date: '2026-09-30 00:09'
labels:
  - performance
milestone: m-20
dependencies: []
references:
  - 'https://specification.website/spec/performance/compression/'
  - 'https://specification.website/spec/performance/vary/'
priority: medium
type: feature
ordinal: 163800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Node sends every response uncompressed and leaves compression to a reverse proxy, but deploy/compose.yaml includes no proxy, so a site deployed as documented may serve raw HTML, CSS, feeds and JSON. The CMS should compress text responses itself, with a switch to turn it off for sites whose proxy already compresses.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 HTML, CSS, JS, feeds, JSON, Markdown, SVG and sitemaps are compressed with brotli when accepted, otherwise gzip
- [x] #2 Images, video and already-compressed types are never recompressed; very small responses are sent uncompressed
- [x] #3 Vary: Accept-Encoding is added, ETags stay correct across encodings, and 304s still work
- [x] #4 Compression can be disabled in config, and the Docker docs say when to do so
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Config: add compression (default true, env GEEKITY_COMPRESSION) to GeekityConfig/ResolvedConfig via resolveBoolean; config test first.
2. New middleware packages/cms/src/web/compression.ts: after next(), for a response whose media type is text/*, JSON/JS/XML/+json/+xml (so SVG, feeds, sitemaps, Markdown), with a body, no Content-Encoding, no Cache-Control no-transform, and not 206: add Vary: Accept-Encoding; pick br when accepted (q>0), else gzip, else identity; buffer the body and send it uncompressed under 1024 bytes; otherwise compress with node:zlib (brotli quality 5, gzip level 6), set Content-Encoding and Content-Length, and weaken a strong ETag to W/ so the one validator covers every encoding (If-None-Match already compares weakly via matchesEtag).
3. On a 304 whose client presented the weak form of the ETag, echo the weak ETag and add Vary: Accept-Encoding so the validator the client stored stays the one it sees.
4. Mount it in createCms right after the access log, outside everything else, only when config.compression is on.
5. Tests (compression.test.ts against a real sandbox CMS): br/gzip/identity choice over a page, feed, sitemap, JSON, CSS, Markdown and SVG; images and small bodies untouched; Vary present; weak ETag round-trips to 304 per encoding; compression:false leaves every response as before.
6. Docs: config tables in README.md and packages/cms/README.md, and a Docker note on turning it off behind a compressing proxy.
7. Verify: pnpm build/test/typecheck/lint/format:check and curl a running server on a spare port.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Built packages/cms/src/web/compression.ts, mounted in createCms just inside the access log so it sees every final body. Choices: brotli quality 5 and gzip level 6 for every body, since pages are built per request (no precompressed cache for static theme files; a possible follow-up). Threshold 1024 bytes, judged from Content-Length when present, else from the buffered body. Compressible = text/*, +json, +xml, application/json|javascript|xml, font/ttf|otf; everything else (images, video, woff/woff2, pdf) untouched. Skips Content-Encoding already set, Cache-Control no-transform, 204/206.
ETags: a compressed response's strong ETag becomes W/"..."; matchesEtag already strips W/, so every existing 304 path (negotiate, feeds, sitemap, robots, assets) revalidates unchanged. On a 304 the middleware echoes the weak form when the client presented it. Every 304 gets Vary: Accept-Encoding because a 304 has no media type to judge by and a cache copies its Vary over the stored one; over-stating is the safe direction.
BREACH: responses that may hold a secret are never compressed and keep their Vary as it was. Probed first: signed-in public pages (the only public pages with a CSRF token: the comment form and admin bar are drawn only for a signed-in viewer) say private, no-store; admin screens, including the anonymous /admin/setup and login forms with CSRF tokens, send no Cache-Control at all. So the rule is Cache-Control private or no-store, or a path at or under /admin, except /admin/_static/ (the editor bundle and admin CSS hold no secret and are compressed). Side effect: no-store error pages, the 503 and health/well-known responses also go out plain. Test: compression.test.ts "never compresses a page that holds a secret" covers /admin/setup anonymously, /admin/users signed in, a signed-in post page, the same post anonymously (br), and /admin/_static/editor.js (br).
Behaviour change: text responses now say Vary: Accept, Accept-Encoding (negotiated) or Vary: Accept-Encoding. Regenerated anonymous-pages.golden.json with GEEKITY_UPDATE_GOLDEN=1 (only vary lines moved) and updated the exact-Vary assertions in negotiation, search and signed-in tests.
Validation: pnpm build && pnpm test (2522 pass, 0 fail) && pnpm typecheck && pnpm lint && pnpm format:check exit 0. Curl against geekity serve on port 3917: / br 1010 B vs 3397 plain; /feed/ br and gzip with W/ etag, 304 to the W/ etag under br and gzip with Vary; /theme/style.css br 8493 vs 31344; 569-byte sitemap plain with Vary; HEAD carries br headers; GEEKITY_COMPRESSION=false sends style.css plain with a strong ETag and no Vary; /admin/setup plain with no Vary, /admin/_static/editor.js br. Servers stopped.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
The CMS now compresses text responses itself: brotli when accepted, gzip otherwise, plain for images, already-compressed types, bodies under 1 KiB, and anything that may hold a secret (Cache-Control private or no-store, or an /admin screen), which closes BREACH against CSRF tokens. Every compressed-eligible text response and every 304 carries Vary: Accept-Encoding; compressed responses weaken their ETag so one validator revalidates to 304 in every encoding. compression (GEEKITY_COMPRESSION) turns it off, documented in both config tables, a Compression section in the package README, and the Docker section. Verified by compression.test.ts, a config test, the full gate, and curl against a running geekity serve.
<!-- SECTION:FINAL_SUMMARY:END -->
