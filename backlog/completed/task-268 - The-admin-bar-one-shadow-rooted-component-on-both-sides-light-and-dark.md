---
id: TASK-268
title: 'The admin bar: one shadow-rooted component on both sides, light and dark'
status: Done
assignee:
  - '@claude'
created_date: '2026-10-04 11:12'
updated_date: '2026-10-05 01:23'
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
- [x] #1 Admin pages and public pages render the bar from one template in one declarative shadow root; admin.css no longer links or reads admin-bar.css, and the admin page is pushed down by the measured bar height as the public page is
- [x] #2 The bar has a light palette and a dark one: data-scheme=dark on the host draws dark, data-scheme=light draws light, no attribute follows prefers-color-scheme; the attribute is set from the user's theme choice by the code that renders the bar, on both sides
- [x] #3 The bar's script is a static file under admin/static/ loaded by <script src>; no inline script remains in the bar on either side
- [x] #4 On the admin the inlined bar stylesheet carries the CSP nonce and the admin's CSP is unchanged; the assets test that forbids inline <style> in the admin allows only the bar's nonced one
- [x] #5 keyboard.test.ts holds the focus ring and the bar text at their contrast ratios in both palettes; the skip link is reachable above the fixed bar
- [x] #6 admin-bar.test.ts and the existing admin tests that look for the bar links (View site, + New, View post) pass
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Data shape. One bar template, daisyui/components/admin-bar.njk, shadows the old one by name so the old shell's include picks it up with the switch on. It takes what the bar always took (site.title, siteHref, barLinks, me, logoutUrl, csrfToken) plus barScheme ('light' | 'dark' | 'auto', from adminColorScheme(user.adminTheme), which both render paths call; auto renders no data-scheme), cspNonce (on the admin: the <style> carries it, and the host carries no style attribute, which that CSP refuses) and assetPrefix (for <script src=admin-bar.js>). daisyui/components/public-admin-bar.njk is the public entry: the same include plus the unpublished notice, which only the public site prints.
2. daisyui/static/admin-bar.css: the bar's own plain CSS, a :host rule for the host's placement, every colour a --admin-bar-* token written as light-dark(light, dark), color-scheme light dark by default and pinned by :host([data-scheme]).
3. daisyui/static/admin-bar.js: the measuring and focus-return script moved out of the template, an ES5-shaped file under the admin-static lint block.
4. daisyui/src/admin.css: an authored rule that pushes the page down by --geekity-admin-bar-height when the bar is in <body>, as OFFSET_STYLE does on the public site. daisyui/layouts/base.njk: the skip link drawn over the fixed bar on focus.
5. render() in src/admin/routes.ts and renderBar in src/web/admin-bar.ts pass barScheme and assetPrefix.
6. Tests first: a switch-on child-process probe (admin dashboard, editor, public page, script, CSP) for AC1-4 and 6; styles.test.ts holds the bar template to admin-bar.css and leaves the public notice out by a documented exception; assets.test.ts allows only the bar's nonced <style>; keyboard.test.ts holds both palettes' focus ring and text to WCAG and the skip link over the bar.
7. Verify in Chrome over CDP with the switch on: data-scheme light/dark/none, measured height pushes the admin and public page, script runs, no CSP violations. Update doc-5 with the bar section.
8. pnpm build, test, typecheck, lint, format:check.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Data shape. One template, daisyui/components/admin-bar.njk, the only daisyui/ template with a shadow root. It shadows the old components/admin-bar.njk by name, so the old shell's include draws it with GEEKITY_ADMIN=daisyui; daisyui/components/public-admin-bar.njk (ADMIN_TEMPLATES.publicAdminBar) includes it and adds the unpublished notice, which only the public site prints. It takes what the bar took before plus barScheme (adminColorScheme(user.adminTheme), called by render() in src/admin/routes.ts and renderBar in src/web/admin-bar.ts; 'auto' renders no data-scheme), cspNonce (admin only: the <style> carries it and the host gets no style attribute) and assetPrefix (the <script src=admin-bar.js defer>). Switch off, the old admin's bar files are untouched and served as before.

Stylesheet daisyui/static/admin-bar.css: :host rule places the host (all: initial; fixed; z-index 99999); every colour is a --admin-bar-* token written light-dark(light, dark); .admin-bar has color-scheme: light dark, pinned by :host([data-scheme='light'|'dark']). color-scheme sits on .admin-bar, not :host, because the public host's inline all: initial would reset it there. Script daisyui/static/admin-bar.js (measure + focus return), linted under the admin-static block (eslint.config.js). Page offset on the admin: an authored rule in daisyui/src/admin.css on :root:has(> body > geekity-admin-bar), the same 40px/80px defaults as OFFSET_STYLE, overridden by the measured height. Skip link in daisyui/layouts/base.njk: fixed top-0, z-[100000], translated off-screen until focused.

Root cause fixed on the way: adminSecurityHeaders was registered on both /admin and /admin/*, and Hono's /admin/* also matches /admin, so /admin ran it twice. The page got the second nonce and the CSP header the first, which would have refused the dashboard bar's stylesheet. Now registered once under /admin/*; verified /admin still gets the CSP and its nonce matches.

Tests: src/admin/daisyui-bar.test.ts runs __testing__/bar-probe.ts with the switch on (admin dashboard, editor, public post page, for a user following the system, on dracula and on cupcake; the served script; the CSP). styles.test.ts holds components/admin-bar.njk's classes to static/admin-bar.css (OWN_STYLESHEET) and leaves components/public-admin-bar.njk out of both checks (ON_THE_PUBLIC_SITE), documented; a test fails if either names a template that is gone. assets.test.ts allows only the bar's nonced <style> (strayStyles), with unit cases for a stray, unnonced or wrong-nonce one. keyboard.test.ts reads both palettes from the light-dark() tokens, refuses any hex outside them, and holds text and hover at 4.5:1 and the focus ring at 3:1 on the bar and menu in each; and the skip link first, before the bar, fixed above the bar's z-index. Mutating the light focus colour or the bar z-index makes those fail.

Browser check: headless Chrome over CDP against the real app served by cms.serve() with GEEKITY_ADMIN=daisyui (sandbox site, signed-in cookie): for system/dracula/cupcake x prefers light/dark on /admin and a public post, data-scheme was none/dark/light, the bar background followed (#f0f0f1 light, #1d2327 dark; system choice followed the emulated preference), the shadow root attached, no securitypolicyviolation and no console errors. At 390px the admin's measured height was 40px against the 80px CSS default and <html> margin-top was 40px; the public page measured 80px. One Tab focused the skip link at top 0, and elementFromPoint at its centre returned the link itself, over the bar.

Validation: pnpm build, pnpm test (4208 + 30 pass), pnpm typecheck, pnpm lint, pnpm format:check all pass. doc-5 gains an Admin bar section (backlog doc update).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
The DaisyUI admin draws the admin bar from one shadow-rooted template on admin screens and public pages, in a light or dark palette chosen by the user's admin theme (data-scheme from adminColorScheme, none when following the system). Its stylesheet (daisyui/static/admin-bar.css, light-dark() tokens) is inlined with the CSP nonce on the admin, its script is daisyui/static/admin-bar.js, the host is placed by :host on the admin and keeps its style attribute on the public site, and admin.css pushes the page down by the measured height. Fixed a double registration of adminSecurityHeaders that gave /admin two nonces. Verified with a switch-on HTTP probe test, styles/assets/keyboard tests (both palettes' contrast, skip link over the bar), headless Chrome over CDP (schemes, measured offset, no CSP violations), and pnpm build/test/typecheck/lint/format:check.
<!-- SECTION:FINAL_SUMMARY:END -->
