---
id: TASK-147
title: Complete favicon set and a web app manifest
status: To Do
assignee: []
created_date: '2026-09-28 23:36'
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
- [ ] #1 /favicon.ico is served (generated from the icon source)
- [ ] #2 An SVG icon is used when the site provides one; a site can set an icon separate from the avatar
- [ ] #3 A 512 maskable PNG is generated with safe-zone padding
- [ ] #4 /manifest.webmanifest is served with name, short_name, icons, start_url, theme_color and display, and linked from the head
<!-- AC:END -->
