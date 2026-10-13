---
id: TASK-267
title: 'Per-user admin theme: any built-in DaisyUI theme, or follow the system'
status: Done
assignee:
  - '@claude'
created_date: '2026-10-04 11:12'
updated_date: '2026-10-05 01:05'
labels:
  - admin
  - daisyui
milestone: m-29
dependencies:
  - TASK-265
references:
  - >-
    backlog/decisions/decision-30 -
    The-admin-is-DaisyUI-on-Tailwind-compiled-at-build-time-in-DaisyUIs-own-themes-chosen-per-user-drawn-from-Nunjucks-component-macros-under-one-shadow-rooted-admin-bar-on-both-sides.md
documentation:
  - backlog/docs/doc-5 - Admin-UI.md
priority: medium
type: feature
ordinal: 226800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
decision-30: each user picks the admin's theme for themselves, any of DaisyUI's built-in themes or Follow the system, on their own screen under Users, stored in data/users.json beside their notification preferences. The server renders the choice as data-theme on <html> on every admin page for that user and renders nothing when they follow the system, where the light and dark defaults from TASK-265 follow prefers-color-scheme. There is no client-side theme switch. The same choice decides whether the admin bar is drawn light or dark (the admin bar task consumes it): one table says which built-in theme is light and which is dark, and the choice reduces to light, dark or auto for whatever renders the bar.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The user's own edit screen has a select listing Follow the system and every built-in DaisyUI theme by name; saving stores the choice in data/users.json and a user with no choice follows the system
- [x] #2 Every admin page rendered for a signed-in user carries data-theme on <html> with their chosen theme, and no data-theme when they follow the system; the login, setup, forgot and reset screens carry none
- [x] #3 A function reduces a theme choice to light, dark or auto from a table of the built-in themes, with a test that every theme the select offers is in the table
- [x] #4 Choosing a dark theme and loading the dashboard renders the DaisyUI dark palette (checked over HTTP in a test by the data-theme attribute and by the compiled stylesheet carrying that theme)
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Name the data shape in src/admin/admin-theme.ts: ADMIN_THEMES, one table of every built-in DaisyUI theme (label and light/dark scheme) in daisyui's own order; AdminTheme = its keys; adminTheme(value) parses an unknown into a theme or undefined; adminColorScheme(theme | undefined) reduces a choice to light, dark or auto. Absence is Follow the system.
2. Store it: User.adminTheme in data/users.json beside the notification maps, read through adminTheme() so an unknown name is dropped, written by setUserAdminTheme(), which removes the key for Follow the system.
3. Form boundary: POST /admin/users/theme (USER_THEME_PATH) sets the signed-in user's own choice only; an empty value is Follow the system, a name outside the table is refused with a flash and nothing written.
4. The panel: daisyui/components/theme-choice.njk, a card with a select of Follow the system and every theme in the table, included from admin/pages/users/edit.njk on your own screen with ignore missing, so the old admin (switch off) draws nothing new.
5. render() in src/admin/routes.ts puts dataTheme (the signed-in user's choice) on every context except the four account screens; daisyui/layouts/base.njk renders data-theme on <html> from it. admin/layouts/base.njk is untouched.
6. Tests first: the table against daisyui's themeOrder and the compiled sheet's color-scheme per theme; the reducer; the parser; the store; the route; and an HTTP probe under GEEKITY_ADMIN=daisyui (child process) for the select, saving, data-theme on every menu screen, none on login/setup/forgot/reset, and the dark palette on the dashboard.
7. doc-5 gains the theme paragraph; full verification from the repo root.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Data shape: src/admin/admin-theme.ts. ADMIN_THEMES is the one table of the 35 built-in DaisyUI themes in DaisyUI's order, each { label, scheme: 'light' | 'dark' }; AdminTheme is its keys; adminTheme(unknown) parses a name or returns undefined; adminColorScheme(AdminTheme | undefined) returns 'light' | 'dark' | 'auto'. Absence of a choice is Follow the system everywhere (type, file, context).

Storage: User.adminTheme in data/users.json beside the notification maps, read through adminTheme() so an unknown name is dropped; setUserAdminTheme() in accounts.ts removes the key for Follow the system.

Form: POST /admin/users/theme (USER_THEME_PATH, field admin_theme) sets the signed-in user's own theme only and ignores any user_id; '' is Follow the system; a name outside the table is refused with a flash and nothing written.

Panel: daisyui/components/theme-choice.njk (card, the old field.select macro, the button macro), included from admin/pages/users/edit.njk on your own screen with ignore missing. With GEEKITY_ADMIN unset the include finds nothing, so the old admin renders exactly as before; the route exists either way.

Pages: render() in src/admin/routes.ts sets dataTheme to the signed-in user's adminTheme on every context except the four account templates (ACCOUNT_TEMPLATES: login, setup, forgot, reset), which carry none even for somebody signed in. daisyui/layouts/base.njk renders data-theme on <html> from it. admin/layouts/base.njk is untouched: with the switch on every page extends the daisyui base (it wins the overlay), and with it off the old admin has no themes. The admin error page (src/web/errors.ts) renders outside render() and knows no user, so it follows the system; TASK-274 owns that screen.

Tests: src/admin/admin-theme.test.ts. Unit: table names equal daisyui themeOrder; each scheme equals the compiled sheet's color-scheme for that [data-theme]; reducer; parser; store. In-process (switch off): no panel and no data-theme on the old admin; the route sets only the signed-in user's theme. HTTP with GEEKITY_ADMIN=daisyui through src/admin/__testing__/theme-probe.ts in a child process: the select (Follow the system then every theme, selected state), none on another user's screen, saving and refusing, data-theme=dracula on every menu screen and the edit screen, none on setup/login/forgot/reset, the dashboard's dracula attribute plus the served sheet's dracula rule with color-scheme: dark and its base colours, and Follow the system removing the key and the attribute. Mutations checked: dropping the ACCOUNT_TEMPLATES guard fails the account-screens test; dropping the account.you guard fails the other-user test.

Docs: doc-5 gains an Admin theme section (backlog doc update); packages/cms/README.md's DaisyUI admin section gains a paragraph.

Validation from the repo root: pnpm build, pnpm test (4175 + 30 pass, 0 fail), pnpm typecheck, pnpm lint, pnpm format:check all pass.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Each user picks the DaisyUI admin's theme on their own Users screen: any of the 35 built-in DaisyUI themes, or Follow the system (the default). The choice is adminTheme in data/users.json, set through POST /admin/users/theme for the signed-in user only, and drawn as data-theme on <html> by daisyui/layouts/base.njk from a dataTheme value render() puts on every admin context except login, setup, forgot and reset. ADMIN_THEMES and adminColorScheme in src/admin/admin-theme.ts are the one light/dark table and the reducer to light, dark or auto that the admin bar (TASK-268) consumes. The old admin, with the switch unset, renders exactly as before. Verified by src/admin/admin-theme.test.ts, including an HTTP walk under GEEKITY_ADMIN=daisyui in a child process, and by pnpm build, test, typecheck, lint and format:check from the repo root.
<!-- SECTION:FINAL_SUMMARY:END -->
