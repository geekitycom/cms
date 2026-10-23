---
id: TASK-488
title: 'The site chooses a colour scheme and a mode, and every page applies them'
status: Done
assignee:
  - '@claude'
created_date: '2026-10-23 02:12'
updated_date: '2026-10-23 03:13'
labels:
  - theme
  - appearance
  - settings
milestone: m-46
dependencies:
  - TASK-487
references:
  - packages/cms/src/site/namespace.ts
  - packages/cms/themes/default/layouts/base.njk
  - packages/cms/src/web/page-shell.test.ts
ordinal: 413800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
decision-61: two SITE settings, colorScheme and colorMode, pick one of the active theme schemes and whether it follows the system, is always light or always dark. The page shell prints them so the stylesheet applies them, and keeps the color-scheme and theme-color meta tags in step.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 `colorScheme` (optional text, empty means the active theme first scheme) and `colorMode` (one of system, light, dark; default system) are SITE settings with descriptions, env overrides and checks; colorScheme is checked against the active theme
- [x] #2 Every HTML page prints `data-scheme` and `data-mode` on `<html>`; a scheme the active theme does not declare falls back to its first, so switching themes never breaks a page
- [x] #3 The color-scheme meta is `light dark`, `light` or `dark` to match the mode, and theme-color meta tags print the chosen scheme values, one per mode that can show
- [x] #4 The embed view and the error pages apply the same scheme and mode
- [x] #5 Tests cover each mode, a fallback scheme, a theme without schemes, and the meta tags
- [x] #6 docs/settings.md and docs/theme/page-shell.md document both settings
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Declare site.color_scheme (file key colorScheme, optionalText, default empty) and site.color_mode (file key colorMode, oneOf system/light/dark, default system) in SITE. SettingsDirs gains themesDir so the colorScheme check can resolve the theme named in the same write (chooseTheme) and refuse a name it does not declare. Tests in namespace.test.ts: defaults, env overrides, refused scheme, accepted scheme, refused mode.
2. render.ts resolves the page scheme with themeScheme(chosen.schemes, site.colorScheme) and the mode from site.colorMode (anything else is system), and passes theme.scheme and theme.mode on the template context beside the existing colours.
3. base.njk: with a scheme, <html data-scheme data-mode>, color-scheme meta from the mode (light dark / light / dark), theme-color from the scheme: two media-queried tags for system, one bare tag for a fixed mode. Without a scheme (a site theme with its own stylesheet and no schemes) the head prints exactly what it does today. Error pages render through the same layout.
4. Embed view: move the cascade resolver that reads --color-* tokens for a scheme and mode out of theme-colors.test.ts into src/theme/scheme-tokens.ts, so the embed page (and TASK-489 swatches) can read a scheme's tokens from the theme's compiled stylesheet. The embed page prints data-scheme/data-mode and an inline style drawn from the scheme's body, text, muted, primary and edge tokens for the mode(s) it can show; CSP hash follows the style. A theme without schemes keeps today's embed.
5. Tests in page-shell.test.ts and oembed tests: each mode, a fallback scheme, a theme without schemes, the meta tags, error pages, embed view.
6. Docs: docs/settings.md and docs/theme/page-shell.md (head, colours) describe both settings.
7. Verify: pnpm build, test, test:11ty, typecheck, lint, format:check; boot a temp site and curl a page, a 404 and the embed view.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Settings: site.color_scheme (file key colorScheme, optionalText, default empty) and site.color_mode (file key colorMode, oneOf system/light/dark, default system) in packages/cms/src/site/namespace.ts. SettingsDirs gained themesDir so the colorScheme check resolves the theme named in the same save with chooseTheme and refuses a name it does not declare (colorSchemeProblem in theme/themes.ts lists the accepted names). Both keys are OffTheForm in admin/settings-fields.ts for now; TASK-489 puts them on the Look page.
Render: siteColors(site, chosen.schemes) in theme/site-data.ts gives { scheme, mode } (unknown scheme -> theme first, unknown mode -> system, undefined when the theme has no schemes); render.ts passes theme.scheme and theme.mode beside the manifest colours. base.njk prints data-scheme and data-mode (always, system included, per AC #2) and the color-scheme and theme-color metas per mode; a theme with no schemes prints exactly what it did before. 404 and 503 go through the same layout.
Embed view: the cascade resolver moved out of theme-colors.test.ts into src/theme/scheme-tokens.ts (stylesheetRules, computedTokens, colorTokens, stylesheetProblems, schemeTokens(file, name) cached by stat). Renderer.siteColors() returns the scheme, mode and tokens; embedPage draws the card in body/text/muted/primary/edge for the mode, CSP hash follows the style. No schemes -> the old style byte for byte.
Pre-existing limitation found: GEEKITY_SITE__* overrides reach the registry (CLI, admin) but not rendered pages, which read site.json; true of tagline too. Documented in docs/settings.md, not changed.
Verification: pnpm build, pnpm test (cms 7055 pass, 0 fail; plugins and demo pass), pnpm test:11ty, pnpm typecheck, pnpm lint, pnpm format:check all exit 0. Live: geekity init temp site, settings set site.color_scheme neon refused with the list; forest + dark saved; curl on port 3488: / and a 404 print <html lang=en data-scheme=forest data-mode=dark>, color-scheme dark, one theme-color #0f1912; embed view prints the same attributes, forest dark tokens, CSP style hash matches the inline style (openssl).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Two SITE settings, colorScheme and colorMode, choose a scheme of the active theme and a mode. Every page and error page prints data-scheme and data-mode on <html> with color-scheme and theme-color metas to match (two media-queried tags for system, one bare tag for a fixed mode); an undeclared scheme falls back to the theme's first; a theme with no schemes keeps today's head. The embed view draws its card in the scheme's tokens, read from the theme's compiled stylesheet by the new src/theme/scheme-tokens.ts (the contrast test's resolver, moved). Docs: settings.md and theme/page-shell.md. Verified with tests per mode, fallback, no-schemes theme, metas, error pages and embed, the full build/test/11ty/typecheck/lint/format run, and a live temp site curled on port 3488.
<!-- SECTION:FINAL_SUMMARY:END -->
