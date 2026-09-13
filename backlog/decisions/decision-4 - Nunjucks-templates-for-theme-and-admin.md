---
id: decision-4
title: Nunjucks templates for theme and admin
date: '2026-09-02 13:21'
status: accepted
---
## Context

The public site needs a theme layer, and the admin needs templates. Eleventy's default template language is Nunjucks, and the existing Geekity site's layouts are Nunjucks. Using one engine for both keeps the codebase small.

## Decision

Nunjucks for public theme templates and for admin screens. The default theme ships inside the package at `themes/default/` with `layouts/`, `partials/`, and `static/`. A site may add a `theme/` directory with the same structure; lookup checks the site directory first and falls back to the package default one file at a time (decision-6). The template context for a post mirrors the data an Eleventy layout would receive (`title`, `date`, `tags`, `content`, `page.url`) so an Eleventy layout can be ported with minimal edits. Admin templates are internal and not overridable in phase one.

## Consequences

- No JSX or client-side framework in phase one. The editor's CodeMirror enhancement is plain script.
- Nunjucks autoescaping is on; rendered Markdown is passed through `safe` explicitly at one call site.
- Filters and shortcodes that 11ty provides (`date` formatting, `url`) are re-implemented as a small set of Nunjucks filters and documented.
- The template context and filter set are part of the semver contract because site overrides depend on them.

## Note, 2026-09-13

[decision-15](decision-15%20-%20Themes-are-named-and-site.json-chooses-one.md) supersedes the single `theme/` directory above. A site no longer adds one directory that is always on the search path: it keeps named themes under `themesDir` (`themes/` by default), one folder per theme with a `theme.json` declaring a `name` and a `kind`, and chooses one with the `theme` setting in `content/_data/site.json` — on **Appearance > Themes** in the admin, or by editing the file. The chosen theme is layered over the packaged one file by file, which is exactly the override model decided here; only the directory and the choice are new. `themeDir` and `GEEKITY_THEME_DIR` are gone rather than aliased.

The rest of this decision stands unchanged. Nunjucks is still the engine for both trees, the template context is still the Eleventy-shaped one, and **admin templates are still internal and not overridable**: they live at `admin/` with a loader of their own, off the theme search path, so no theme can shadow the login form or the CSRF field inside it. decision-15 leaves a second manifest `kind` as the way to revisit that, and does not revisit it.
