---
id: TASK-489
title: >-
  Appearance has a Look page that shows each scheme as swatches and sets the
  scheme and mode
status: Done
assignee:
  - '@claude'
created_date: '2026-10-23 02:12'
updated_date: '2026-10-23 03:35'
labels:
  - admin
  - appearance
milestone: m-46
dependencies:
  - TASK-488
references:
  - packages/cms/admin/pages/appearance/themes.njk
  - packages/cms/admin/components/theme-choice.njk
  - packages/cms/admin/components/setting-fields.njk
ordinal: 414800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
decision-61: the owner picks a scheme and a mode from the admin. The page draws each scheme the active theme declares as swatches of its own tokens, light and dark, so the choice is seen rather than named, and saves only its own keys.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Appearance > Look lists every scheme of the active theme as a radio card with its label and swatches (page, text, accent, secondary) for light and dark, drawn with the scheme colours and readable in both admin themes
- [x] #2 A mode control offers Follow the system, Always light and Always dark; saving writes colorScheme and colorMode and nothing else, and the public site shows the change on the next request
- [x] #3 A theme with no schemes shows the mode control and a line saying the theme has one palette
- [x] #4 The page meets the admin keyboard and labelling rules: radios are native, grouped in fieldsets with legends, and the selected card is marked by more than colour
- [x] #5 Tests cover rendering, saving, a refused value and a theme with no schemes; docs/admin pages that list Appearance mention Look
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Add Appearance > Look at /admin/appearance/look (menu child 'look' after Themes, ADMIN_TEMPLATES.look, pages/appearance/look.njk) in src/admin/appearance.ts beside Themes.
2. GET: chooseTheme({themesDir, name: site.theme}) gives the schemes; for each, schemeTokens(findThemeFile(dirs,'static/style.css'), name) gives light and dark body/text/primary/secondary; the checked card is themeScheme(schemes, stored colorScheme). Mode radios: system/light/dark labelled Follow the system, Always light, Always dark.
3. Template: one form, sections as fieldsets with legends (Colour scheme, Mode), so TASK-492 adds a Fonts fieldset/section. Cards are labels wrapping a native radio; swatches are SVG with fill attributes (admin CSP blocks inline style attributes); the saved card gets an 'In use' badge and a thicker border on :checked, so selection is not colour alone. No schemes: the mode fieldset and a line that the theme has one palette.
4. POST: settings.set('site', {color_scheme, color_mode}) with only those keys (only color_mode when the theme has no schemes); a refused value renders 400 with the problem and writes nothing; success flashes and 303s back.
5. Tests in src/admin/appearance-look.test.ts over HTTP: rendering, saving + public page data-scheme/data-mode, refused scheme and mode, no-schemes theme, menu. Update the Appearance menu test.
6. Docs: docs/admin.md route table, docs/settings.md, docs/themes.md mention Look.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Built as src/admin/look.ts (mountLookScreen, LOOK_PATH /admin/appearance/look, LOOK_COLOURS_PATH /admin/appearance/look/colours) and admin/pages/appearance/look.njk; Appearance menu gains Look after Themes.
- Saves with c.var.settings.set('site', {color_scheme, color_mode}); under a theme with no schemes only color_mode. color_scheme/color_mode stay on the OffTheForm list. A refused value renders the page with 400, an error alert and the submitted choices, and writes nothing.
- Swatches are SVG with fill attributes (the admin CSP has no unsafe-inline for style, so style attributes are out); tokens come from schemeTokens(findThemeFile(chosen.dirs,'static/style.css'), name): body, text, primary, secondary. Each frame has a currentColor stroke so a white or black page swatch reads on either admin theme.
- Selection: native radio dot, has-checked:border-2 border-primary on the card, and an 'In use' badge on the saved scheme.
- Each section is a card with its own form and POST path, so TASK-492's font section is a second card posting to its own path.
Validation: appearance-look.test.ts (15 tests: menu, cards in theme order with labels, light and dark swatch fills from the stylesheet, no style attribute, fieldsets+legends with 6/3 native radios, checked/In use, mode labels, save writes only the two settings and the public page shows data-scheme=plum data-mode=dark, refused scheme and mode 400 with nothing written, CSRF 403, no-schemes theme). pnpm build, test (cms 7077 pass), test:11ty, typecheck, lint, format:check all pass. Booted a temp site on :3047, screenshotted the Look page in light and dark admin themes (/tmp/look-run/look-light.png, look-dark.png), ArrowRight moved the checked radio Paper to Slate, no console/CSP errors; saved Ocean + Always dark in the browser and / served data-scheme=ocean data-mode=dark (/tmp/look-run/public-ocean-dark.png).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added Appearance > Look: the active theme's colour schemes as radio cards with light and dark SVG swatches (page, text, accent, secondary) read from the theme stylesheet, and a mode control (Follow the system, Always light, Always dark). Saving writes only site.color_scheme and site.color_mode (mode alone under a theme with no schemes, which shows a one-palette line); refused values return 400 and write nothing. Docs list Look in admin.md, settings.md, themes.md and theme/manifest.md. Verified by appearance-look.test.ts, the full suite, and a live boot with Playwright screenshots in light and dark admin themes and a browser save that changed the public page.
<!-- SECTION:FINAL_SUMMARY:END -->
