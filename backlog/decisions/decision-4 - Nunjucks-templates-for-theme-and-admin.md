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
