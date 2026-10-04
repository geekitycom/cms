---
id: TASK-268
title: 'The admin bar: one shadow-rooted component on both sides, light and dark'
status: To Do
assignee: []
created_date: '2026-10-04 11:12'
labels:
  - admin
  - daisyui
milestone: m-29
dependencies:
  - TASK-267
references:
  - >-
    backlog/decisions/decision-30 -
    The-admin-is-DaisyUI-on-Tailwind-compiled-at-build-time-in-DaisyUIs-own-themes-chosen-per-user-drawn-from-Nunjucks-component-macros-under-one-shadow-rooted-admin-bar-on-both-sides.md
documentation:
  - backlog/docs/doc-5 - Admin-UI.md
priority: medium
type: feature
ordinal: 227800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
decision-30: the admin draws the bar the way the public site already does (TASK-183): one template in a declarative shadow root with its own plain stylesheet inlined, fixed to the top, the page pushed down by its measured height. The stylesheet gains a light palette beside the dark one. The host carries data-scheme, light or dark, from the signed-in user's theme choice (TASK-267), and nothing when they follow the system, where the bar follows prefers-color-scheme; the one piece of code that renders the bar sets it, so an admin page and a public page agree. The bar cannot use DaisyUI classes (the theme stops at the shadow boundary), so its design is its own plain CSS and may change to sit well beside DaisyUI; its focus ring and text keep their WCAG contrast in both palettes by test. The admin's CSP shapes three details: the inline stylesheet takes the per-response nonce, the bar's script becomes a static file, and the host's positioning moves into a :host rule (the public page keeps its inline style attribute, which has a job there).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Admin pages and public pages render the bar from one template in one declarative shadow root; admin.css no longer links or reads admin-bar.css, and the admin page is pushed down by the measured bar height as the public page is
- [ ] #2 The bar has a light palette and a dark one: data-scheme=dark on the host draws dark, data-scheme=light draws light, no attribute follows prefers-color-scheme; the attribute is set from the user's theme choice by the code that renders the bar, on both sides
- [ ] #3 The bar's script is a static file under admin/static/ loaded by <script src>; no inline script remains in the bar on either side
- [ ] #4 On the admin the inlined bar stylesheet carries the CSP nonce and the admin's CSP is unchanged; the assets test that forbids inline <style> in the admin allows only the bar's nonced one
- [ ] #5 keyboard.test.ts holds the focus ring and the bar text at their contrast ratios in both palettes; the skip link is reachable above the fixed bar
- [ ] #6 admin-bar.test.ts and the existing admin tests that look for the bar links (View site, + New, View post) pass
<!-- AC:END -->
