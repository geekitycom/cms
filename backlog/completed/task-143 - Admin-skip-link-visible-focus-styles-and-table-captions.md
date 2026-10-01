---
id: TASK-143
title: 'Admin: skip link, visible focus styles and table captions'
status: Done
assignee:
  - '@claude'
created_date: '2026-09-28 23:36'
updated_date: '2026-09-30 04:10'
labels:
  - accessibility
  - admin
milestone: m-21
dependencies: []
references:
  - 'https://specification.website/spec/accessibility/skip-links/'
  - 'https://specification.website/spec/accessibility/focus-indicators/'
  - 'https://specification.website/spec/accessibility/focus-not-obscured/'
  - 'https://specification.website/spec/accessibility/data-tables/'
priority: medium
type: enhancement
ordinal: 167800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The public theme has a skip link and :focus-visible styles, but the admin does not. Keyboard users tab through the full admin menu on every screen, and focus indicators mostly depend on the browser default, which is weak against the admin's colours. Admin tables use th scope but have no caption.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Every admin screen has a skip-to-main link as its first focusable element
- [x] #2 Every interactive admin control shows a :focus-visible indicator that meets 3:1 contrast
- [x] #3 A focused control is never hidden under the sticky admin bar
- [x] #4 Every admin data table has a caption (visually hidden where the heading already says the same)
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Skip link: base.njk (every admin screen, signed in or not) opens <body> with <a class="admin-skip-link" href="#main">Skip to main content</a>; both <main> elements (base admin-plain and shell admin-main) get id="main". Hidden off-screen until focused, then drawn above the admin bar.
2. Focus: one --admin-focus token (#2271b1) and a global :focus-visible outline (2px, offset 2px) in admin.css for the light field and surfaces; a --admin-focus-on-dark token (#fff) in admin-bar.css for the bar, its account menu and the nav column (inset where the control fills its row). admin-bar.css keeps its own rule so the public shadow-root bar gets it too.
3. Sticky bar: the admin's bar is in normal flow, so it scrolls away; the public site's fixed bar already sets scroll-padding-top. Prove both in a real browser rather than change them.
4. Captions: every <table> in admin templates opens with <caption>; admin-visually-hidden where the heading above says the same, visible (styled) for the per-actor followers table.
5. Tests first (node:test): render every page template and assert the first focusable element is the skip link to an existing main#main; a source check that every admin <table> starts with a non-empty <caption>; a contrast check that each focus token meets 3:1 against every background it is drawn on; an HTTP check over /admin/login and /admin.
6. Prove in Chrome with a scratch Playwright script: tab through every admin screen and a public page as a signed-in user, checking first stop, computed outline and its contrast, and that no focused control sits under the bar.
7. pnpm build, test, typecheck, lint, format:check.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Skip link: layouts/base.njk opens <body> with a.admin-skip-link to #main; both <main> elements carry id="main". It sits under every screen, signed in or not. It sets no focus itself, so the error summary's autofocus (TASK-142) and the first-field autofocus on login, setup, settings and the editor still win on load; the skip link stays first in Tab order.
Focus: --admin-focus (#2271b1) drives a global :focus-visible outline (2px, offset 2px) in admin.css; --admin-focus-on-dark (#fff) in admin-bar.css rings the bar, its account menu and the nav column (inset -2px where the control fills its row). Nav literals #1d2327 and #32373c became --admin-nav-open and --admin-nav-children so the contrast test reads every background from tokens. .admin-nav a:focus became :focus-visible.
Sticky bar: the admin's bar is in normal flow and scrolls away; the only fixed bar is the public one, which already sets scroll-padding-top (src/web/admin-bar.ts OFFSET_STYLE). No code change was needed; proven in Chrome (below).
Captions: every admin <table> opens with a caption; admin-visually-hidden where the heading above says the same, visible for the per-actor followers table ("Followers of @handle"), styled by .admin-list caption:not(.admin-visually-hidden).
users.test.ts asserted no admin-visually-hidden anywhere on the users list, meaning no hidden form labels; narrowed it to <label class="admin-visually-hidden" since the list now has a hidden caption.
Tests: src/admin/keyboard.test.ts renders all 28 page templates and asserts the first focusable element is the skip link to a unique main#main; the same over HTTP for /admin/login and signed-in /admin; a source check that each of the 11 admin tables opens with a non-empty caption; token contrast >= 3:1 for each ring colour against every background it is drawn on.
Browser proof (scratch Playwright script with system Chrome, not committed): signed in on a sandbox site seeded with the demo posts and pages, it crawled 37 admin screens plus setup and login at 1280px and 375px, and tabbed forward and backward (Shift+Tab from the page bottom) through every stop: first Tab from the top is the skip link, Enter then Tab lands inside <main>, every stop has a >= 2px outline whose colour is >= 3:1 against the background it is drawn on, and elementFromPoint at every focused control is the control itself. It also tabbed both ways through two public pages as a signed-in user. 4856 stops, 0 failures. Injected defects were caught: a light --admin-focus (#9ec2e6, 1.86:1), a removed skip link, and the public scroll-padding-top removed (focus hidden under geekity-admin-bar on Shift+Tab).
Validation: pnpm build, pnpm test (2632 + 31 pass), pnpm typecheck, pnpm lint, pnpm format:check all pass.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Admin screens now open with a skip-to-main link, draw a 2px focus ring that holds 3:1 on every surface (blue on the light field, white on the dark bar, menu and nav), and caption every data table (visually hidden where a heading already names it). The admin bar is not sticky inside the admin and the public fixed bar already pads scrolling, so no focused control is hidden under it. Verified by src/admin/keyboard.test.ts (templates, HTTP, table sources, token contrast) and a Chrome tab-through of 37 admin screens and two public pages at 1280px and 375px (4856 focus stops, 0 failures, injected defects caught); build, test, typecheck, lint and format:check pass.
<!-- SECTION:FINAL_SUMMARY:END -->
