---
id: decision-37
title: >-
  Sites add markup to every page through two empty hook partials in the default
  theme
date: '2026-10-09 16:24'
status: accepted
---
## Context

TASK-298. andrewshell.org loads Umami and Google Analytics 4 in the head of every page, and most sites need something like it: analytics, a verification tag, a chat widget. Theme lookup is the site theme first and the packaged theme second, one file at a time, so a site theme's `layouts/base.njk` resolves to itself and cannot extend the packaged one. Adding two script tags meant copying the whole base layout, or overriding every layout, and the copy stopped receiving default theme updates.

Options weighed: a raw-HTML site setting with an admin textarea; extending a packaged template by an explicit name such as `default:layouts/base.njk`; a plugin hook; and an empty partial the default theme includes for the site to fill.

## Decision

**Two hook partials.** The default theme ships `partials/head-end.njk` and `partials/body-end.njk` empty. `layouts/base.njk` includes the first last in `<head>` and the second last in `<body>`, outside every block, so a layout that overrides `head` or `scripts` without `super()` keeps them. A site theme of `theme.json` plus one partial adds its markup to every public HTML page and inherits every other template.

**Not a setting.** A settings field holding raw HTML would be a new admin surface that lets whoever edits settings run script on the site's origin, which is the admin's origin too, and it would need storage, validation and a screen. The partial is a file in the site's own theme directory, uses the per-file override the theme system already has, and is reviewed like any template.

**Not in the editor preview.** The preview renders the post or page layout inside the admin. It puts `editorPreview: true` on the context and `layouts/base.njk` skips both partials when it is set, so no site markup reaches an admin response.

## Consequences

- The names `partials/head-end.njk` and `partials/body-end.njk`, their placement, and the `editorPreview` key are part of the theme contract. Renaming or moving them is a breaking change.
- A site needs a site theme, and on Docker the `./themes:/site/themes:ro` volume, to use them. No custom image is needed.
- A site theme that replaces `layouts/base.njk` owns the includes and the `editorPreview` test.
- The CMS still sets no content policy on public pages. A site that sets one with `securityHeaders` allows what its snippets load; the theme README lists what Umami and GA4 need.
