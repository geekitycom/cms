---
id: decision-61
title: >-
  A theme declares colour schemes and font roles; the site picks a scheme, a
  mode and two Google Fonts it hosts itself
date: '2026-10-23 02:11'
status: accepted
---
## Context

The default theme has one palette, Paper, whose `--color-*` tokens are the colour override contract (decision-22). `theme-colors.test.ts` holds every text pair to 7:1 and every relied-on border to 3:1 in light and dark. Dark mode follows `prefers-color-scheme` only. Its fonts are system stacks, and decision-22 and doc-9 say "no web font, no CDN". The only way for a site owner to change the look is to write a site theme.

On 2026-10-22 the user asked for a choice of colour schemes in the default theme that keeps the site readable and accessible, and for a choice of heading and body fonts from Google Fonts, with a custom field for any Google family. The user chose:

- to host the font files on the site, not link to Google;
- a mode setting (follow the system, always light, always dark);
- two font roles: headings and body.

## Decision

**A theme declares its colour schemes.** `theme.json` gains `schemes`, a list of `{ name, label }`, with the first entry as the default. The scheme's tokens live in the theme's stylesheet as `:root[data-scheme="<name>"]` blocks, with a light set and a dark set. The dark set applies under `prefers-color-scheme: dark` unless `data-mode="light"`, and always under `data-mode="dark"`. `themeColor` in the manifest becomes per scheme. A theme with no `schemes` behaves as today. The packaged theme ships Paper (unchanged values) and five more. The contrast test runs over every scheme the packaged theme declares, in both modes, at the same minimums. A scheme that fails cannot ship. The scheme list is fixed and tested; this decision gives no custom palettes, because a palette typed in by a user cannot be held to 7:1 before it ships.

**The site picks a scheme and a mode.** These are two `SITE` settings, `colorScheme` (one of the active theme's scheme names, empty for the theme's first) and `colorMode` (`system`, `light`, `dark`). The page shell prints `data-scheme` and `data-mode` on `<html>`, sets the `color-scheme` meta to `light dark`, `light` or `dark` to match, and prints the scheme's `theme-color` values. A scheme name the active theme no longer declares falls back to its first scheme, so switching themes never breaks a page.

**A theme declares font roles.** `theme.json` gains `fonts`: the roles a site may set (the packaged theme: `heading` and `body`), each with the system stack it falls back to. The stylesheet reads each role through a `--font-<role>` custom property on `:root` whose default is that stack. Labels (kickers, menus) and code keep their system stacks.

**The site picks a Google Font per role, and the CMS hosts it.** The settings are `headingFont` and `bodyFont`. Each takes a Google Fonts family name, or empty for the theme's stack. The admin offers a curated list per role plus a custom field. When a family is saved, the CMS fetches the CSS2 API stylesheet for the styles the role needs, downloads the WOFF2 files it lists into `data/fonts/` (a rebuildable class under decision-55), and writes a local `@font-face` stylesheet that points at them. The page then links that stylesheet as a fingerprinted same-origin asset and sets `--font-<role>` to the family followed by the theme's stack. Every face uses `font-display: swap`. A reader's browser never contacts Google, and no CSP has to allow a third party.

- **A body font must have regular, italic and bold** (400, 400 italic, 700), because prose uses all three; synthesised italics and bolds read badly. **A heading font must have bold** (700). The check is the fetch itself: a family or style Google does not have fails the save with a message, and the setting is not written.
- **When files are missing** (a fresh container, a deleted `data/fonts/`), the page falls back to the theme's stack and a job fetches them again. The setting stays.

This supersedes the "no web font" part of decision-22 for sites that choose a font. A site that chooses none still loads one stylesheet and nothing else. "No CDN" stands.

## Consequences

- Site themes may declare their own `schemes` and `fonts`. A site theme that replaces `static/style.css` has to supply the scheme blocks and `--font-*` properties for the names it declares. The docs say so.
- Saving a font needs outbound HTTPS to fonts.googleapis.com and fonts.gstatic.com from the server. Readers never need it.
- Google Fonts are OFL or Apache-licensed, so hosting the files is allowed.
- Font choice does not change contrast, but it changes legibility. The required styles and the curated lists are the guard rails. The custom field is the owner's choice.
