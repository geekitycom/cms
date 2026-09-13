---
id: decision-15
title: 'Themes are named and site.json chooses one'
date: '2026-09-13 12:47'
status: accepted
---
## Context

decision-4 put the public templates in the package at `themes/default/` and let a site add one `theme/` directory whose files win, one file at a time. The admin templates live in a separate tree, `admin/`, deliberately outside that search path so a site theme could never shadow the login form or the CSRF field inside it. The name `default` is a directory, not a choice: `PACKAGED_THEME_DIR` is the only literal, and three places build the same two-element search path from it, for templates, for `/theme/` assets and for mail.

On 2026-09-13 the user said this gets in the way of a distribution: a site can carry only one look and cannot switch between looks. They asked for named themes, a `themes/` directory in a site with one folder per theme, and a choice in the admin that defaults to the packaged theme and only loads a site theme when one is chosen. Asked whether the admin should become a theme too, they said to leave it as its own structure and not let it be overridden for now, which keeps the change small.

## Decision

**A theme is a named directory with a manifest.** `theme.json` carries a display `name`, a `kind` and an optional `description`. The directory name is the theme's id. A directory without a parseable manifest is not a theme and is not listed. The only kind is `site`; the field exists so another kind can be added later without changing the format, and a manifest naming any other kind is not a theme today.

**The package ships one theme, `themes/default`**: the public templates, partials, mail templates and stylesheet as today, with a manifest. The admin stays at `admin/` with its own loader and its own assets, and is not overridable; decision-4 stands on that point.

**A site keeps its themes under one directory, `themesDir`, `themes/` by default, one folder per theme.** `themeDir` and `GEEKITY_THEME_DIR` are removed rather than aliased; `themesDir` and `GEEKITY_THEMES_DIR` replace them. Nothing is scaffolded: `themes/` exists once a site writes a theme, as `theme/` did.

**site.json chooses the theme** with one setting, `theme`, absent when the packaged default is in use. A chosen theme is layered over the packaged default, file by file, exactly the override model of decision-4, so a site theme ships only what it changes. The packaged default is never on the search path twice and an unchosen site theme is never on it at all. A chosen theme that is missing or unreadable falls back to the packaged default with a logged warning rather than a broken site, and the admin refuses to save such a choice. Changing the choice takes effect on the next request without a restart, as every other site.json setting does.

**Appearance > Themes** is where the choice is made, a new top-level admin section with one child, as the menu rule of m-12 requires. It lists the packaged default and the site's themes with their name and description, marks the active one and activates another.

**Mail templates stay in the theme.** They are the site's voice to its readers and admins, so `mail/` is a directory of a site theme, as it is now.

## Consequences

- `feat(cms)!`: a config that names `themeDir`, or an environment that sets `GEEKITY_THEME_DIR`, no longer does anything, and a site's `theme/` directory is no longer read. A site moves it to `themes/<name>/`, adds a `theme.json` and picks it in the admin.
- decision-4's single `theme/` directory is superseded; its "admin templates are internal and not overridable" is unchanged, and the guard it gives the login form and the CSRF field is untouched.
- The three search-path constructions collapse into one resolver, and `themeTemplate`'s per-render probe and the mail `present` check use it.
- The editor preview renders through the site theme, so it follows the chosen theme, as it does today.
- The Eleventy compatibility build is untouched; it reads `content/_includes/`, never the theme directory.
- The demo's `theme/` becomes a named theme under `themes/` that its site.json selects, so the demo proves the choice rather than the default.
- Theming the admin, if ever wanted, is a second kind in the manifest and a second setting; nothing here forecloses it.
