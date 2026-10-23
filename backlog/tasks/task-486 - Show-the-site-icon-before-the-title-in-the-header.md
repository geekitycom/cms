---
id: TASK-486
title: Show the site icon before the title in the header
status: Done
assignee:
  - '@claude'
created_date: '2026-10-23 01:47'
updated_date: '2026-10-23 02:02'
labels: []
dependencies: []
references:
  - packages/cms/themes/default/layouts/base.njk
  - packages/cms/src/web/render.ts
  - packages/cms/src/admin/settings-general.ts
ordinal: 411800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A General setting that puts the site's icon in front of the site title in the default theme's global header. Off by default, so existing sites look the same. Follows the llms_txt pattern: a boolean in the site namespace, a checkbox on the settings page, and a value render.ts gives the theme only when the setting is on and the site actually has an icon to show.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 General settings has a checkbox, off by default, that turns the header icon on and off and keeps its value after a save
- [x] #2 When it is on and the site has an icon, the default theme's header shows the icon inside the home link before the title, on the homepage h1 and on every other page
- [x] #3 The theme gets the icon as one ready-to-print URL (the SVG itself for an SVG icon, otherwise the derived 180px PNG), so it never builds icon paths itself
- [x] #4 When it is off, or the site has no icon, or image optimization is off, the header prints no img
- [x] #5 The img has empty alt, because the title text next to it already names the link
- [x] #6 The theme context docs and the settings docs describe the new setting and context value
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Site namespace: header_icon boolean (fileKey headerIcon, default false) in src/site/namespace.ts, plus SiteSettings type/defaults wherever llms_txt is declared.
2. Admin: flag row in settings-fields.ts, add to GENERAL_SETTINGS.fields, checkbox beside the icon field in admin/pages/settings/general.njk, admin test fixture.
3. render.ts: headerIcon context value = SVG href when the icon is an SVG, else the icon-180 PNG href, from siteIcons(); present only when site.headerIcon and icons are non-empty.
4. base.njk: img.site-icon alt="" inside the home link before the title, in both the atRoot h1 and header-link-home; CSS in themes/default/src/style.css then rebuild static/style.css.
5. Tests: render context on/off/no icon; header markup; settings save round-trip.
6. Docs: theme context docs (docs/theme/page-shell.md) and settings docs.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Built on branch header-site-icon. svgElseTouchIconHref in render.ts picks from siteIcons(), so no-icon and image-optimization-off fall out of the empty list. Checkbox sits after the icon preview so the field stays next to what it shows. .site-icon uses me- (logical margin) because the RTL stylesheet test rejects physical margins.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added a header_icon site setting (headerIcon in site.json, default false) with a checkbox on Settings > General. When on and the site has an icon, render.ts hands the theme headerIcon (the SVG upload, else the versioned 180px PNG) and the default theme prints it with alt="" inside the home link before the title, on the homepage h1 and inner-page link. Verified by header-icon.test.ts (on, SVG, off, no icon, optimization off, URL answers 200), a save round trip in settings-general.test.ts, the full @geekity/cms suite (6623 pass), lint/typecheck/format, and demo screenshots of / and /posts/. Docs: settings.md, theme/page-shell.md, theme/template-context.md.
<!-- SECTION:FINAL_SUMMARY:END -->
