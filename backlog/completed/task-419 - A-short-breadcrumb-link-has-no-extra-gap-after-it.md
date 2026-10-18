---
id: TASK-419
title: A short breadcrumb link has no extra gap after it
status: Done
assignee:
  - '@claude'
created_date: '2026-10-16 03:28'
updated_date: '2026-10-16 12:33'
labels:
  - bug
milestone: m-31
dependencies: []
references:
  - packages/cms/themes/default/src/style.css
priority: low
ordinal: 374800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
On a post filed under a short category such as AI, the breadcrumb reads 'Home > AI    > Post title…': the gap after AI is about twice the gap after Home. The default theme gives .breadcrumbs a links min-inline-size: 24px (a target-size minimum) and display: inline-flex, and the link text starts at the left of that box. 'AI' is narrower than 24px, so the rest of the box shows as extra space before the next separator. Any term or page name narrower than 24px does the same. Proposal: keep the 24px target, and centre the text in it (justify-content: center), or reach the size with padding split evenly on both sides, so the gaps between crumbs look the same.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 On a post whose breadcrumb has a two-letter category, the space on either side of each separator looks the same as it does after Home
- [x] #2 Every breadcrumb link is still at least 24 by 24 CSS pixels
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Give breadcrumb links a new target-hit-area utility in place of target: the link box hugs its text (min-block-size 24px only) and a ::before with inset min(0px, (100% - 24px) / 2) widens the hit area to 24px, centred and RTL-safe.
2. Verify in a browser: equal gaps around separators after a two-letter category, every crumb link's hit area at least 24x24.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Centring the text (the task's first proposal) only halved the gap: measured 9|13.9 and 13.9|9 around the separators, against 9|9 and 18.8|9 before. Padding split evenly gives the same result. So the box now hugs its text and a pseudo-element carries the 24px hit area into the 8px gaps. A ::before inset of min(0px, (100% - 24px)/2) is symmetric, so it needs no left/translate and the no-physical-sides stylesheet test still passes.
Verified on the demo with a post in category AI (Playwright, Chromium). Gaps around both separators measured 9px|9px. AI box 14.25x24 with a 24x24 hit area measured by elementFromPoint. Home hit area 44x24. page-shell and theme-stylesheet tests: 100 pass.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Breadcrumb links use a new target-hit-area utility. The link box is as wide as its text, so a short crumb such as AI leaves no extra gap before the next separator. A centred ::before keeps the hit area at least 24x24. Verified in Chromium on the demo: 9px on each side of every separator, AI hit area 24x24.
<!-- SECTION:FINAL_SUMMARY:END -->
