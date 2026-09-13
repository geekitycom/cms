---
id: TASK-77
title: >-
  Appearance > Themes: list the packaged default and the site themes, mark the
  active one, and activate another
status: Done
assignee:
  - '@claude'
created_date: '2026-09-13 12:49'
updated_date: '2026-09-13 16:03'
labels:
  - admin
milestone: m-13
dependencies:
  - TASK-76
references:
  - packages/cms/src/admin/menu.ts
  - packages/cms/src/admin/settings-page.ts
  - packages/cms/src/admin/settings-pages.ts
  - packages/cms/src/admin/settings.ts
  - >-
    backlog/decisions/decision-15 -
    Themes-are-named-and-site.json-chooses-one.md
documentation:
  - backlog/docs/doc-5 - Admin-UI.md
type: feature
ordinal: 102800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The theme setting (TASK-76) has no screen. Add an Appearance section to the admin menu, with Themes as its one child so the m-12 menu rule holds, at /admin/appearance/themes. The screen lists the packaged default first, then each folder under themesDir whose theme.json is valid, showing the display name and the description from the manifest with the folder name as the id. The active theme is marked; the packaged default is marked when the setting is absent. Each other theme has an Activate action that posts through updateSiteSettings, so the change lands in site.json and takes effect on the next request; activating the packaged default clears the setting. A folder under themesDir with a missing or broken manifest is listed once as unreadable with the reason rather than silently skipped, so a typo in theme.json is visible, but cannot be activated. Reference: the WordPress Appearance > Themes screen, one card per theme with the active one first.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The admin menu has an Appearance section whose child Themes lands at /admin/appearance/themes, expands when current and marks the child, like every other section
- [x] #2 The screen lists the packaged default first and every valid folder under themesDir after it, showing name, description and folder name from theme.json, with the active one marked
- [x] #3 Activate on a theme stores its folder name as theme in site.json through updateSiteSettings with CSRF, redirects back with a flash, and the next public request renders with it; activating the packaged default removes the key
- [x] #4 A folder with no valid manifest is listed as unreadable with the reason and cannot be activated; an activation naming it, forged in a POST, is refused with a message
- [x] #5 doc-5 Admin UI describes the Appearance section and the screen; tests cover the listing, activation, clearing to the packaged default and the refusal
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. themes.ts: add listSiteThemes(themesDir) — read the directory once, readTheme each subdirectory, and return { themes, unreadable } so the screen can draw both halves. A file, a dot entry and a missing directory are not themes and not problems.
2. New module src/admin/appearance.ts: APPEARANCE_SECTION, THEMES_PATH = /admin/appearance/themes, THEMES_ACTIVATE_PATH, THEME_FIELD (SETTINGS_FIELDS.theme), and mountAppearanceScreen(app, { render }). GET builds the rows: the packaged theme first from readTheme(PACKAGED_THEME_DIR) with the empty string as its value, then every valid site theme, each marked active against readSiteSettings(contentDir).theme, plus the unreadable folders with their reason. POST validates the submitted name with settingsProblems(form, ['theme'], { themesDir }) and, when it passes, writes it with updateSiteSettings; a refusal flashes the problem and writes nothing. Both redirect back with a flash. Not a SettingsPage: the theme is deliberately on no settings page, and this screen is a list of what is on disk rather than a form of fields.
3. templates.ts: ADMIN_TEMPLATES.themes = layouts/themes.njk. New template: one card per theme with its name, description and folder name, the active one marked, an Activate button with the CSRF field on every other, and the unreadable folders listed with their reason and no button.
4. menu.ts: an Appearance section with one child, Themes, in WordPress's place — after Messages, before Users.
5. routes.ts: mountAppearanceScreen beside the other screens, inside the guard so the POST carries CSRF like every admin form.
6. admin.css: the cards, reusing the settings and list styling where it fits.
7. Tests first, one per criterion, in src/admin/appearance.test.ts: the menu entry and the screen's section/child; the listing order, names, descriptions and the active mark; activation writing site.json and the public site rendering through it on the next request; activating the packaged default removing the key; an unreadable folder listed with its reason; a forged POST naming it refused with a message and nothing written. listSiteThemes unit tests in web/themes.test.ts.
8. doc-5: the Appearance section in the menu table, the screen in the Screens table, and a short section describing it.
9. Verify: pnpm build && pnpm test && pnpm typecheck && pnpm lint && pnpm format:check, plus a curl against the demo, which already carries themes/demo.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Built as planned, with two deviations worth recording.

The form posts to the screen's own URL rather than to a separate activate path. One screen with one action needs no second URL, and the redirect target is the same page either way; a settings page posts to itself for the same reason.

A refusal is a flash and a 303 back to the screen rather than a 400 render, which is what the media screen's delete refusal does. There is no edit in the body to preserve — the form is a hidden field and a button — so post/redirect/get is the right shape, and the message is on the page the button was pressed from.

listSiteThemes returns { themes, unreadable } so the screen can draw both halves. It is the only caller: rendering asks chooseTheme about one name and never reads the directory. Only a subdirectory is a candidate and a hidden one is not even that, so a themes/ holding a .DS_Store, a README.md or a .git is a site with no broken themes rather than one with three.

The refusal runs settingsProblems(form, ['theme'], { themesDir }) — the same check a settings page would have run — so the screen and the validator cannot come to disagree about what a theme is. A missing theme, a broken manifest and a name that is a path are one 'no'.

The flash reads 'Nothing was changed. <reason>' rather than the other way round: a JSON parser's complaint does not end in a full stop, and '…Unexpected end of JSON input Nothing was changed.' read badly in the manual check.

layouts/themes.njk was added to the list styles.test.ts walks, so a class this screen emits has to be styled before it can land.

Validation: pnpm build, pnpm test (1671 + 15 pass, 0 fail), pnpm typecheck, pnpm lint and pnpm format:check all clean.

Manual check over real HTTP, on a throwaway copy of the demo (its content, its themes/demo, plus a second theme 'midnight', a 'halfway' with a broken theme.json and a .DS_Store), served on :3999 and curled through the setup form and a session cookie:
- GET /admin/appearance/themes: 200, Appearance open with aria-current on Themes, cards in the order Default (marked 'the theme this package ships'), Geekity Demo (Active, no Activate), Midnight; 'Not themes' listing halfway with 'is not valid JSON: Unexpected end of JSON input'; .DS_Store nowhere.
- POST theme=midnight: 303 to the screen, site.json theme=midnight, and the very next GET of /2026/09/the-theme-is-just-templates/ came back '<h1>Midnight: The theme is just templates</h1>'; flash 'Midnight is now this site's theme.'
- POST theme=halfway: 303, site.json still midnight, flash 'Nothing was changed. There is no theme called "halfway": … is not valid JSON…'.
- POST theme=../demo: 303, site.json still midnight, flash '"../demo" is not a theme name: a theme is one directory inside the themes directory.'
- POST theme= (empty): 303, no theme key left in site.json at all, and the post came back through the packaged layout (class="post h-entry").
- POST with no csrf_token: 403, nothing written.
The server was stopped afterwards and apps/demo was never written to.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added Appearance > Themes, the screen where a site picks the theme decision-15 named.

web/themes.ts gained listSiteThemes(themesDir), which reads the directory once and returns both the themes and the folders that were meant to be themes with the reason each is not; a file, a hidden entry and a missing directory are not problems to report. src/admin/appearance.ts is the screen: THEMES_PATH = /admin/appearance/themes, themeCards() putting the packaged theme first as the floor the others are laid over, and one POST that validates through the settings validator's own theme check and writes the folder name with updateSiteSettings. admin/layouts/themes.njk draws one card per theme with its name, description, folder name and an Activate button, the active one marked and buttonless, and lists the unreadable folders under 'Not themes'. menu.ts gained an Appearance section with one child, Themes, in WordPress's place between Messages and Users; routes.ts mounts the screen inside the guard, so the POST carries CSRF like every admin form. Styles in admin/static/admin.css, and the template joined the set styles.test.ts guards.

Verified by src/admin/appearance.test.ts (12 tests over HTTP: the menu entry and the marked child, the listing order, names, descriptions and the active mark, activation writing site.json and the public site rendering through it on the next request, clearing back to the packaged theme removing the key, a missing CSRF token refused, an unreadable folder listed and unactivatable, and forged activations naming a broken folder, a path and a deleted theme all refused with nothing written) and by unit tests for listSiteThemes in src/web/themes.test.ts. pnpm build, test (1671 + 15 pass), typecheck, lint and format:check are clean, and the whole flow was curled by hand against a running server over a throwaway copy of the demo: see the implementation notes for each request and its answer. doc-5 carries the Appearance section in the menu table, the screen in the Screens table, and a section describing it.
<!-- SECTION:FINAL_SUMMARY:END -->
