---
id: TASK-493
title: The web manifest uses the chosen colour scheme
status: Done
assignee:
  - '@claude'
created_date: '2026-10-23 03:22'
updated_date: '2026-10-23 03:35'
labels:
  - theme
  - appearance
milestone: m-46
dependencies:
  - TASK-488
ordinal: 418800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TASK-488 made pages print the chosen scheme theme-color, but the web app manifest still reads the theme top-level light themeColor, so an installed site shows the wrong colour after a scheme change.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The web manifest theme_color and background_color come from the chosen scheme (its light value under system or light mode, its dark value under dark mode), falling back to the top-level themeColor for a theme with no schemes
- [x] #2 Tests cover a non-default scheme in each mode and a theme with no schemes
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. webManifest takes the site's SiteColors (Renderer.siteColors()) beside the theme colours: with a scheme, theme_color and background_color are the scheme's themeColor.dark under colorMode dark and .light otherwise; with no schemes, the top-level light themeColor as before.
2. The /manifest.webmanifest route passes c.var.renderer.siteColors().
3. Tests in src/web/site-icons.test.ts: a non-default scheme under system, light and dark, and a site theme with no schemes.
4. Docs: docs/theme/page-shell.md manifest paragraph.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
webManifest takes scheme: SiteColors | undefined (route passes c.var.renderer.siteColors()); theme_color and background_color are scheme.themeColor.dark under colorMode dark and .light under system or light, else the top-level light themeColor. Failing first: the three scheme tests got #faf7f2 (Paper light) before the change. site-icons.test.ts covers slate in system, light and dark and a site theme with its own stylesheet and no schemes (top-level light even with colorMode dark). Full suite, typecheck, lint, format:check pass. Live: after saving Ocean + Always dark, /manifest.webmanifest on the temp site served #08191f (Ocean dark). docs/theme/page-shell.md updated.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
The web manifest now takes theme_color and background_color from the chosen scheme (dark value under dark mode, light otherwise), falling back to the theme's top-level light themeColor when the theme has no schemes. Verified with new site-icons.test.ts cases (each mode plus a no-schemes theme), the full suite, and a live manifest request on a booted site.
<!-- SECTION:FINAL_SUMMARY:END -->
