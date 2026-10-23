---
id: TASK-492
title: >-
  The site chooses a heading and a body Google Font from Appearance, and every
  page uses the hosted files
status: Done
assignee:
  - '@claude'
created_date: '2026-10-23 02:13'
updated_date: '2026-10-23 05:23'
labels:
  - fonts
  - appearance
  - admin
  - settings
milestone: m-46
dependencies:
  - TASK-489
  - TASK-490
  - TASK-491
references:
  - packages/cms/src/site/namespace.ts
  - packages/cms/themes/default/layouts/base.njk
  - packages/cms/src/admin/headers.ts
ordinal: 417800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
decision-61: two SITE settings, headingFont and bodyFont, pick a Google Fonts family per font role or empty for the theme stack. Saving downloads the family through the font store first and is refused if the family lacks the styles the role needs (body: 400, 400 italic, 700; heading: 700). Pages link the hosted stylesheet and set --font-<role> to the family followed by the theme fallback.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 `headingFont` and `bodyFont` are SITE settings (optional text, empty means the theme stack) with descriptions and env overrides; a role the active theme does not declare is ignored
- [x] #2 The Look page has a font section per declared role: a curated list (body: Atkinson Hyperlegible, Source Serif 4, Literata, Merriweather, Lora, Source Sans 3, IBM Plex Serif, IBM Plex Sans, plus the theme default; heading adds Fraunces and Playfair Display), a Custom option with a text field for any Google family, and a sample line set in the saved font
- [x] #3 Saving downloads the family first; a refusal (unknown family, missing style, no network) shows the reason beside the field and writes nothing
- [x] #4 Every HTML page with a chosen font links the hosted @font-face stylesheet as a fingerprinted same-origin asset and prints `--font-<role>: "<family>", <fallback>`; with no font chosen the page loads nothing extra
- [x] #5 When a chosen font files are missing at render time the page falls back to the stack and a refetch job is queued once
- [x] #6 The admin CSP needs no third-party font host for the sample (the sample uses the hosted files)
- [x] #7 Tests cover settings, the save path with a stubbed font store, the page head with and without fonts, and the missing-files fallback; docs/settings.md and the Appearance docs describe the font choice and the required styles
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Move isFontFamilyName to src/theme/font-family.ts so the site namespace (below the fonts layer) can use it as a check; fonts/ imports it from there.
2. SITE.heading_font (headingFont) and SITE.body_font (bodyFont): optionalText, check isFontFamilyName or empty, descriptions; on the OffTheForm list; regenerate the settings golden file.
3. src/fonts/roles.ts: the role table (heading -> 700; body -> 400, 400 italic, 700, with setting and file keys) and createFontChoices({ store, refetch }): for the theme's declared roles, the hosted stylesheet and family of each chosen font; a missing stylesheet falls back and queues a fetch-font job once per process (guard cleared when the files are back).
4. Renderer option fonts; render puts { stylesheets, properties } on the context when any font is in use; services wires the store and queueFontFetch. base.njk links each stylesheet (| url) and prints an unlayered :root { --font-<role>: "Family", fallback } style (nonce when cspNonce is on the context; the editor preview passes it). The embed view keeps its system stack (it loads nothing by design).
5. Look page: a Fonts card per declared role (select of curated families + theme default + Custom..., a custom text field used when Custom... is chosen, a sample line in the saved font via the hosted stylesheet link and a nonce'd style), posting to /admin/appearance/look/fonts: ensure each choice first, refusal -> 400 with the message beside its field and nothing written; success -> write the keys for declared roles with Google's casing.
6. Tests first for each: namespace settings, look save path with stubbed Google, page head with/without fonts, missing-files fallback + single refetch.
7. Docs: docs/settings.md, docs/admin.md (Look), docs/theme/page-shell.md.
8. Verify: build, test, test:11ty, typecheck, lint, format:check; live run with Playwright and screenshots in /tmp/fonts-run/.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Built: SITE.heading_font/body_font (headingFont/bodyFont, optionalText, check isFontFamilyName; isFontFamilyName moved to src/theme/font-family.ts because the site layer sits below fonts/). src/fonts/roles.ts holds FONT_ROLES (heading 700; body 400, 400i, 700), declaredFontRoles, chosenFonts and createPageFonts (missing files -> fallback + one fetch-font job; the guard clears once the files are back, so a later loss queues again). The renderer takes a fonts option (wired in services with queueFontFetch) and puts { stylesheets, properties } on the context only when a font is in use; base.njk links each hosted stylesheet after style.css and prints an unlayered :root style, with the nonce when cspNonce is on the context (the editor preview now passes it, since the admin CSP would refuse it otherwise). The embed view keeps its system stack: it loads nothing beyond its HTML by design. Look page: a Fonts card per declared role with a select (theme default, curated, Custom...) and a custom text box used when Custom... is chosen (works without JS), and a sample line linked to the hosted stylesheet and styled by a nonce'd style block. POST /admin/appearance/look/fonts ensures every family before writing; a refusal is a 400 with an error summary and the message on the field, and nothing is written; success writes Google's spelling. form-errors.test.ts gains a Fonts variant for look.njk.

Verification: pnpm build, pnpm test (cms 7129 pass, 0 fail; every plugin suite passes), pnpm test:11ty, pnpm typecheck, pnpm lint and pnpm format:check all exit 0. Live on port 3492 in Chromium (playwright-core): saved Atkinson Hyperlegible + Fraunces on the Look page (303, 'The fonts are saved.'); the sample lines computed to those families with no CSP console errors; the public post linked /_geekity/fonts/fraunces/700.css?v=... and /_geekity/fonts/atkinson-hyperlegible/400-700-400i.css?v=...; the h1 computed Fraunces, body and prose paragraphs computed Atkinson Hyperlegible, and document.fonts loaded Fraunces 700 and Atkinson 400 and 400 italic. Custom 'Nosuch Family Here' gave 400 with 'Google Fonts has no family called Nosuch Family Here.' beside the field. After deleting data/fonts the page had no font link or style and the h1 fell back to the Iowan stack; one fetch-font job per family ran (2 finished in jobs.json) and the next page linked both again. The no-network refusal is covered by the stubbed test only. Screenshots: /tmp/fonts-run/look-fonts.png, look-fonts-refused.png, public-page.png.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Sites can set a Google Fonts family for headings and body text on Appearance > Look. headingFont and bodyFont are SITE settings checked as family names. Saving downloads each family through the font store first. It refuses an unknown family, a family missing a role's styles, or no network with a 400, the message beside the field, and nothing written. Every page with a chosen font links the hosted fingerprinted stylesheet and prints --font-<role>: "Family", <theme fallback> in an unlayered :root rule. With no font chosen it prints nothing extra. Missing files fall back to the stack and queue one fetch-font job. The Look sample uses the hosted files and a nonce'd style, so the admin CSP needs no Google host. Verified by new tests (namespace.test.ts, appearance-look-fonts.test.ts, page-fonts.test.ts, a form-errors variant), the full build/test/test:11ty/typecheck/lint/format run, and a live Chromium run with real Google fonts. Docs: settings.md, admin.md, theme/page-shell.md, themes.md.
<!-- SECTION:FINAL_SUMMARY:END -->
