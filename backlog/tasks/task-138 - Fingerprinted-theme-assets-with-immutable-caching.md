---
id: TASK-138
title: Fingerprinted theme assets with immutable caching
status: Done
assignee:
  - '@claude'
created_date: '2026-09-28 23:36'
updated_date: '2026-09-29 23:55'
labels:
  - performance
milestone: m-20
dependencies: []
references:
  - 'https://specification.website/spec/performance/cache-control/'
priority: medium
type: enhancement
ordinal: 162800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Theme assets are served with max-age=3600 and uploads and image variants with max-age=86400, none of them immutable, and style.css has no version in its URL. Readers re-validate assets they already have, and a theme change can take up to an hour to show. Content-hashed URLs let every asset be cached for a year and still update the moment it changes.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Theme templates can reference an asset through a helper that returns a URL containing a content hash
- [x] #2 Hashed asset URLs are served with Cache-Control: public, max-age=31536000, immutable; the unhashed URL keeps working with a short max-age
- [x] #3 Image variants, whose names never change content, are served immutable
- [x] #4 The default theme uses the helper for every stylesheet and script
- [x] #5 Editing a theme file in development changes its URL without a restart
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. assets.ts: themeAssetVersion(asset) returns a short sha256 of the file bytes, memoised per path by size+mtime so an edit in place changes it without a restart; themeAssetUrl(relative, themeDirs) returns /theme/<relative>?v=<hash> (unhashed path when no theme has the file).
2. templates.ts: an 'asset' filter that resolves through the environment's live search path (so useThemeDirs and theme switches apply) and applies the base path, like url.
3. routes.ts themeAsset: when ?v= equals the current file's hash, Cache-Control: public, max-age=31536000, immutable; otherwise the existing one-hour max-age. A stale v gets the current bytes at the short lifetime so no URL pins the wrong content.
4. routes.ts imageVariant: served immutable at a year.
5. Default theme base.njk: style.css and highlight.js through the asset filter.
6. Document the filter in the theme README filter table and the root README filter list; update the tests pinning the old head markup.
Tests first for each AC in site.test.ts / page-shell.test.ts / images tests.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Design: a hash in the query (/theme/style.css?v=<12 hex of sha256>) rather than in the filename, so the one /theme/* route and the theme search path stay as they were and a theme file can never collide with a hashed name. The route marks a response immutable only when v equals the hash of the bytes it is about to send; a stale or missing v gets the old one-hour lifetime, so a cached page's old URL still loads and the new bytes are never pinned under an old name.
The hash is memoised per file on the size+mtime ETag, so a render pays a stat per asset and an edit is picked up on the next render in any mode, watch or not.
The filter is 'asset' and reads the FileSystemLoader's live searchPaths (same undeclared field useThemeDirs already writes), so switching theme moves layouts and asset hashes together. It applies the base path itself. Documented in the theme README filter table and the root README; the filter set is semver contract, so this is additive.
themeAssetResponse/themeAssetNotModified stay exported unchanged (public API) though the route no longer calls them.
Known edge: deleting an upload frees its name, so re-uploading different bytes under the same name in the same month reuses the variant URLs, which are now immutable for a year. Before this change the exposure was one day. Not fixed here; a follow-up could put the source's hash in the variant path.
Validation: pnpm build, pnpm test (cms 2514 pass, demo 31 pass), typecheck, lint, format:check all green. Curled a scratch copy of the demo (watch on, port 3917): page links /theme/style.css?v=0db10ea6f3bd and /theme/highlight.js?v=42b0427a40a8, both 'public, max-age=31536000, immutable'; /theme/style.css and ?v=000000000000 give 'public, max-age=3600'; /uploads/_/2026/09/geekity-icon.png/300.webp gives immutable; appending to the theme's style.css changed the link to ?v=b32d0b386ac2 without a restart.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Theme files are now linked through a new 'asset' filter ({{ "style.css" | asset }}) that writes /theme/style.css?v=<content hash> with the base path applied. A request whose v matches the current bytes is served 'public, max-age=31536000, immutable'; the plain URL and stale hashes keep the one-hour lifetime. Image variants under /uploads/_/ are served immutable. The default base layout uses the filter for style.css and highlight.js. The hash is memoised on size+mtime, so an edit changes the URL on the next render with no restart. Verified by new tests in web/site.test.ts and images/site.test.ts, the full build/test/typecheck/lint/format gates, and curl against a running copy of the demo.
<!-- SECTION:FINAL_SUMMARY:END -->
