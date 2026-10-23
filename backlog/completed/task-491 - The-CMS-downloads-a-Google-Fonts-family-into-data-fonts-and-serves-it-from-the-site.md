---
id: TASK-491
title: >-
  The CMS downloads a Google Fonts family into data/fonts and serves it from the
  site
status: Done
assignee:
  - '@claude'
created_date: '2026-10-23 02:13'
updated_date: '2026-10-23 04:28'
labels:
  - fonts
  - privacy
milestone: m-46
dependencies: []
references:
  - packages/cms/src/files/data-files.ts
  - packages/cms/src/web/asset-routes.ts
  - packages/cms/src/theme/assets.ts
  - 'https://developers.google.com/fonts/docs/css2'
ordinal: 416800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
decision-61: a chosen Google Font is hosted by the site so a reader never contacts Google. Given a family and the styles a role needs, the CMS fetches the CSS2 API stylesheet with a WOFF2 user agent, downloads every file it lists (all unicode-range subsets), and writes a local @font-face stylesheet that points at same-origin URLs. A family or style Google does not have is refused with a message.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A font store fetches `https://fonts.googleapis.com/css2?family=<family>:ital,wght@<styles>&display=swap`, downloads the listed WOFF2 files from fonts.gstatic.com through the CMS fetch helper (timeouts, size cap, https only), and writes them with a generated stylesheet under data/fonts/<family-slug>/ atomically
- [x] #2 Only fonts.googleapis.com and fonts.gstatic.com are contacted; URLs in the returned CSS on any other host are refused
- [x] #3 A family Google does not have, or a requested style it lacks, yields a typed refusal naming what is missing; nothing is written
- [x] #4 data/fonts/** is declared rebuildable under decision-55 with a lost sentence, so exports skip it
- [x] #5 The files are served at a same-origin path with the fingerprinted, immutable caching other assets get, the right content types, and a 404 for anything not in the store
- [x] #6 Fetching the same family and styles again is a no-op when the files are present; a job can refetch a family whose files are missing
- [x] #7 Tests run against a stubbed Google (no network) and cover success, an unknown family, a missing style, a foreign host in the CSS and a refetch; docs/public-site.md or docs/settings.md notes that saving a font needs outbound HTTPS from the server
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Extend webmention/fetch-public.ts with an optional userAgent (Google sends WOFF2 only to a browser UA) and an optional allowed(url) predicate checked on every hop, so redirects cannot leave Google's hosts or https.
2. New unit packages/cms/src/fonts/ (services layer): family.ts (isFontFamilyName, fontFamilySlug, FontStyle, canonical styles, css2Url), css.ts (parse the CSS2 stylesheet into faces, refuse any url() not https://fonts.gstatic.com, write the site's own @font-face rules), store.ts (createFontStore: ensure, stylesheet, file, settled), job.ts (fetch-font job + queueFontFetch).
3. ensure: no-op when the stylesheet and every file it names exist; else fetch the CSS with a browser UA; on HTTP 400 probe each style and then the family alone to name what is missing; download every WOFF2 into memory (caps, magic check); write <sha12>.woff2 files and last <styles>.css atomically under data/fonts/<slug>/. Nothing is written on a refusal.
4. data-files.ts: FONTS = fonts/** rebuildable, in CORE_DATA_FILES; docs/content.md tables.
5. Route /_geekity/fonts/<slug>/<file>: only the store's file names; immutable when the name or v is the content hash; exempt from maintenance like /theme/.
6. Wire into Services, Cms.fonts, c.var.fonts, the fetch-font job, lifecycle settled.
7. Tests against a stubbed Google; docs/settings.md section on hosted fonts and outbound HTTPS; configuration.md job list.
8. Verify with the full pnpm suite and a live fetch served from a temp site on port 3491.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Built packages/cms/src/fonts/ (family.ts, css.ts, store.ts, job.ts, index.ts, __testing__/google.ts), web/font-routes.ts, FONTS declaration, wiring in cms/services.ts, cms/create.ts (Cms.fonts), cms/app.ts and web/env.ts (c.var.fonts), maintenance exemption, docs.

Decisions:
- Served under /_geekity/fonts/ rather than /fonts/ so no permalink can shadow it, like /_geekity/avatars/.
- fetchPublic gained userAgent and allowed(url) options; the font store passes a Chrome UA and allows only https://fonts.googleapis.com for the CSS and https://fonts.gstatic.com for files, checked on every redirect hop, on top of the public-address check. Size caps: CSS 1 MB, file 5 MB, family 64 MB, 1000 files; 15 s timeout per request; six downloads at once.
- The served stylesheet is regenerated from parsed values (family, style, weight, unicode-range), not rewritten from Google's text, so nothing Google sends besides those values reaches the page.
- Family names: letters and digits in words separated by single spaces, at most 64 characters (isFontFamilyName). Slug: lower case, hyphens for spaces.
- Files are <first 12 hex of sha256>.woff2, which equals assetVersion, so a font file URL needs no v parameter and is immutable by name. Stylesheet is <styles>.css (for example 400-700-400i.css) linked with ?v=<assetVersion>.
- stylesheet() is synchronous for page renders (decision-52 asks for async interfaces on foundational systems; this is a rebuildable cache read by a sync renderer). It memoises on the stylesheet's size and mtime; ensure() always checks every file afresh.
- Missing-style detection: on 400 for the combined request, each style is asked alone; if none answer, the family is asked alone to tell an unknown family from one lacking all requested styles.
- The plugin-wordpress data census needed a writer for fonts/**; it now calls cms.fonts.ensure against its stubbed web.

Validation: pnpm build, pnpm test (cms 7104 pass, all packages pass), pnpm test:11ty, pnpm typecheck, pnpm lint, pnpm format:check all exit 0. Live: Atkinson Hyperlegible 400/400i/700 fetched from Google into a temp data dir: 6 faces, 6 files all WOFF2 (file(1): Web Open Font Format Version 2), CSS has 0 http(s) URLs; second ensure fetched=false; 300 italic gave missing-styles; 'Nosuch Familyxyz' gave unknown-family. Served on port 3491: stylesheet 200 text/css; charset=utf-8 with public, max-age=31536000, immutable; without v max-age=3600; woff2 200 font/woff2 immutable; unknown name 404. Server stopped.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added a font store (packages/cms/src/fonts/) that fetches a Google Fonts family from the CSS2 API with a browser user agent, downloads every WOFF2 subset from fonts.gstatic.com through fetchPublic (timeouts, size caps, https only, host allow-list on every hop), and writes content-hashed files plus a generated @font-face stylesheet under data/fonts/<slug>/ atomically. Unknown families, missing styles, invalid names and foreign hosts are typed refusals with a message, and nothing is written. data/fonts/** is declared rebuildable. Files are served at /_geekity/fonts/<slug>/<file> with immutable caching when fingerprinted, the right content types, and 404 for anything else. A second ensure is a no-op; the fetch-font job (queueFontFetch) refetches missing files. Wired as Cms.fonts / c.var.fonts. Verified by src/fonts/fonts.test.ts and src/web/font-routes.test.ts against a stubbed Google, the full pnpm suite, and a live fetch of Atkinson Hyperlegible served and curled on port 3491.
<!-- SECTION:FINAL_SUMMARY:END -->
