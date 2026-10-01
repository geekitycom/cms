---
id: TASK-146
title: 'Head metadata: theme-color, color-scheme and richer Open Graph'
status: Done
assignee: []
created_date: '2026-09-28 23:36'
updated_date: '2026-10-01 12:24'
labels:
  - seo
  - theme
milestone: m-22
dependencies: []
references:
  - 'https://specification.website/spec/foundations/theme-color/'
  - 'https://specification.website/spec/foundations/color-scheme/'
  - 'https://specification.website/spec/foundations/open-graph/'
priority: medium
type: enhancement
ordinal: 170800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The default theme emits Open Graph and a summary Twitter card. It has no theme-color, and it declares color-scheme only in CSS, so dark-mode readers see a white flash before the stylesheet loads. og:image:alt and the article:* times are missing.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 base.njk emits meta color-scheme matching the theme, and theme-color for light and dark from theme.json
- [x] #2 Posts emit article:published_time, article:modified_time, article:author and article:tag
- [x] #3 og:image:alt is emitted whenever og:image is, using the image's alt text
- [x] #4 Twitter card uses summary_large_image when the image is large enough
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Theme manifest: readTheme parses an optional colorScheme (one of the values the color-scheme meta allows) and themeColor {light, dark} (hex colours), tolerantly like areas. chooseTheme resolves each field against the packaged theme's manifest, so a site theme that declares none inherits the default's. The packaged theme.json declares light dark and its two paper colours (#faf7f2, #171412).
2. render() puts the resolved colours on every render as `theme`; base.njk prints meta color-scheme before the stylesheet and one theme-color per scheme with a prefers-color-scheme media query.
3. A share-image module resolves the head's picture (front matter image, else site avatar) into url, alt, size and card. Alt: front matter imageAlt, else the media library's described text, else the entry's title (front matter image) or the site author/title (avatar). Size from the variant sidecar (describeImage), never probed per request. Card is summary_large_image when the image is at least 1200 px wide and wider than tall, else summary.
4. base.njk emits og:image:alt, og:image:width/height when known, and the card from that object; article:published_time, article:modified_time, article:author (profile URL, else name) and one article:tag per tag on an article.
5. Tests first in page-shell.test.ts and themes.test.ts, then the code; update the theme README; verify with build/test/typecheck/lint/format and curl the demo.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Theme colours: theme.json takes colorScheme (one of normal, light, dark, light dark, dark light, only light) and themeColor {light, dark} as 3- or 6-digit hex. Invalid values are dropped, as areas are. chooseTheme resolves each one against the packaged manifest, so ChosenTheme.colors is always complete for a site theme that declares nothing. render() puts it on the context as `theme`. base.njk prints meta color-scheme before the stylesheet link and one theme-color per scheme with a prefers-color-scheme media query. The packaged theme declares light dark, #faf7f2 and #171412 (its --color-body in each scheme).

Share image: new src/web/share-image.ts builds `shareImage` {url, alt, size?, card} in render(), beside icons, because alt text (media.json) and size (variant sidecar) live in files a template cannot read. Alt order: front matter imageAlt (entry image only, new key), media library described text, then the entry title (entry image) or the site owner's name / site.author / site.title (avatar). Size comes from describeImage via a new siteImageRecord() extracted from siteImageMarkup, which also derives variants in the background when none exist, so the first render of a hand-dropped picture is a summary and the next is large. card is summary_large_image at >= 1200 px wide and wider than tall (LARGE_CARD_MIN_WIDTH). og:image:width/height and twitter:image:alt are printed too.

Article tags: on og:type article, article:published_time (date), article:modified_time (updated, else date), article:author (siteAuthor.url absolute, else the byline name), and one article:tag per tag.

Docs: themes/default/README.md covers the manifest keys, the head and the two new context keys.

Validation: pnpm build && pnpm test (2691 + 30 pass) && pnpm typecheck && pnpm lint && pnpm format:check all exit 0. Curled pnpm start: / carries color-scheme before the stylesheet and both theme-colors. /2026/09/the-theme-is-just-templates/ carries both article times, article:author and two article:tag. With a 1600x900 upload and a media.json entry dropped into the gitignored playground, the first request printed og:image:alt and a summary card, and the next request printed width 1600, height 900 and summary_large_image. Server stopped and playground reset afterwards.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
The default theme's head now declares meta color-scheme before the stylesheet, so dark-mode readers no longer get a white flash. It also declares a theme-color for light and for dark, both read from theme.json, and a site theme inherits any value it leaves out from the packaged one. Articles carry article:published_time, article:modified_time, article:author and article:tag. The share image always carries og:image:alt and twitter:image:alt, from imageAlt front matter or the media library, with a title or author fallback. When the variant sidecar knows the size, the head prints og:image:width and og:image:height, and a picture at least 1200 px wide and wider than tall gets summary_large_image. Verified with new tests in page-shell.test.ts and themes.test.ts, the full gate, and curl against the running demo.
<!-- SECTION:FINAL_SUMMARY:END -->
