---
id: TASK-147
title: Complete favicon set and a web app manifest
status: Done
assignee:
  - '@claude'
created_date: '2026-09-28 23:36'
updated_date: '2026-10-01 12:32'
labels:
  - seo
  - theme
milestone: m-22
dependencies: []
references:
  - 'https://specification.website/spec/foundations/favicons/'
  - 'https://specification.website/spec/resilience/pwa-manifest/'
priority: low
type: feature
ordinal: 171800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Icons are generated from the avatar as 16 and 32 PNGs and a 180 apple-touch-icon (src/images/icons.ts). There is no SVG icon, no /favicon.ico (which browsers and crawlers request anyway, producing 404s), no maskable icon and no manifest.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 /favicon.ico is served (generated from the icon source)
- [x] #2 An SVG icon is used when the site provides one; a site can set an icon separate from the avatar
- [x] #3 A 512 maskable PNG is generated with safe-zone padding
- [x] #4 /manifest.webmanifest is served with name, short_name, icons, start_url, theme_color and display, and linked from the head
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Data shape: one table of derived icons in images/icons.ts keyed by file name (icon-16/32/180/192/512.png, maskable-512.png, favicon.ico), each with its size(s) and kind (square, maskable, ico); the head list and the manifest list are views of it. iconSize() becomes a lookup in that table.
2. Icon source: new site.json setting `icon` (an upload path) wins over `avatar`; one function picks it so the head, the manifest and /favicon.ico agree.
3. SVG: when the source is .svg the head links the upload itself as type image/svg+xml first, and the manifest lists it with sizes any; PNGs are still rasterised from it. SiteIcon gains `type`.
4. Maskable 512: cover-crop to 80% (410px) and extend to 512 on the image's dominant colour, flattened opaque.
5. /favicon.ico: an ICO container holding 16, 32, 48 PNG frames, derived lazily beside the other icons and served at the root with the upload max-age; 404 when the site has no icon source.
6. /manifest.webmanifest: name/short_name from site.title, start_url /, display minimal-ui, theme_color and background_color from the chosen theme's light themeColor, icons 192/512 any + 512 maskable (+ svg); application/manifest+json with an ETag. Renderer exposes the chosen theme colours. base.njk links it.
7. Tests first in page-shell.test.ts for each AC over HTTP; docs in the theme README and SiteData.
8. Verify: build, test, typecheck, lint, format:check, curl a running demo.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Data shape: DERIVED_ICONS in images/icons.ts maps each served file name (icon-16/32/180/192/512.png, maskable-512.png, favicon.ico) to a shape (square | maskable | ico); the head list (HEAD_ICONS) and manifest list (MANIFEST_ICONS) are views of it, and the request path is checked against it, so no arbitrary sizes can be encoded. iconSize() is gone; isDerivedIcon() replaces it.
Icon source: new site.json key `icon` wins over `avatar` via iconSetting(site); the head, the manifest and /favicon.ico all go through it. Not added to the admin General screen (the avatar is site.json-only too); a follow-up could add a picker.
SVG: linked first as the upload itself (type image/svg+xml, no sizes) and listed in the manifest with sizes any; PNGs still rasterised from it. SiteIcon gained `type`; base.njk prints icon.type and omits empty sizes.
Maskable: cover crop to round(512*0.8)=410 px, flattened onto and extended with the picture's sharp dominant colour, so it is opaque.
favicon.ico: hand-built ICO container with PNG frames 16/32/48, derived lazily beside the other icons; served at the root with max-age 86400 (unversioned URL); 404 with no icon source.
Manifest: web/manifest.ts, route /manifest.webmanifest, application/manifest+json, ETag + no-cache like robots.txt. display minimal-ui (a blog keeps back/reload); theme_color and background_color are the chosen theme's light themeColor (Renderer.themeColors() added); URLs carry the base path of a subdirectory site. Served with icons [] when there is no source.
Not done, out of scope: apple-touch-icon is still not flattened (spec says no transparency).
Validation: new src/web/site-icons.test.ts (11 tests) failed first for the intended reasons (404s, avatar href instead of icon, no SVG link), then passed. pnpm build, test (2702 + 30 pass), typecheck, lint, format:check all clean. Curled a scratch site served from dist with an SVG icon: head links svg + 3 PNGs + manifest; /manifest.webmanifest 200 application/manifest+json with the fields; /favicon.ico 200 image/x-icon, `file` reports 3 PNG frames; maskable 512x512 opaque RGB with the logo inside the zone. Server stopped.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Completed the icon set and added a web app manifest. A site can set `icon` in site.json apart from its avatar; an SVG icon is linked as itself ahead of the rasterised PNGs. /favicon.ico serves an ICO of 16/32/48 PNG frames, a 512 maskable PNG is derived with the picture in the middle 80% on opaque padding, and /manifest.webmanifest serves name, short_name, start_url, display, theme/background colour from the theme and 192/512/maskable icons, linked from the default theme's head. Verified with 11 new HTTP tests (failing first), the full build/test/typecheck/lint/format suite, and curl against a running scratch site.
<!-- SECTION:FINAL_SUMMARY:END -->
