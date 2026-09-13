---
id: TASK-76
title: >-
  Named site themes: themesDir holds one folder per theme, site.json chooses
  one, and only the chosen theme is layered over the packaged default
status: To Do
assignee: []
created_date: '2026-09-13 12:48'
updated_date: '2026-09-13 12:56'
labels:
  - web
  - content
milestone: m-13
dependencies:
  - TASK-75
references:
  - packages/cms/src/config.ts
  - packages/cms/src/admin/settings.ts
  - packages/cms/src/web/context.ts
  - packages/cms/src/web/render.ts
  - packages/cms/src/index.ts
  - packages/cms/src/admin/routes.ts
  - packages/cms/templates/site/geekity.config.ts
  - scripts/pack-install-smoke.sh
  - >-
    backlog/decisions/decision-15 -
    Themes-are-named-and-site.json-chooses-one.md
type: feature
ordinal: 101800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A site has one theme/ directory, named by themeDir, and it is always on the search path. Replace it with a themes directory, themesDir (themes/ by default, GEEKITY_THEMES_DIR at boot), holding one folder per theme, each with a theme.json (TASK-75) and only the files it overrides. One setting in site.json, theme, names the folder in use and is absent when the packaged default is in use. The resolver puts the chosen theme first and the packaged default second, file by file as today; an unchosen theme is never on the search path and the packaged default is never on it twice. A chosen theme that is missing or has no valid manifest falls back to the packaged default with one logged warning at boot and at each change, never a 500, and the settings validator refuses to save such a choice. Because the renderer and the mail environment are built once per process with a fixed loader, changing the choice has to rebuild or re-key them so the next request renders with the new theme, as every other site.json setting takes effect without a restart, whether the change came from the admin or from an edit to the file. The admin is not themed and has no setting. themeDir and GEEKITY_THEME_DIR are removed rather than aliased, which makes this feat(cms)!; the pack-install scratch site and the init template config name themesDir instead. The Appearance screen that exposes the choice is TASK-77; this task lands the setting, the resolver and the config, and proves them through site.json edits.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 themesDir replaces themeDir in GeekityConfig, ResolvedConfig, the env table and the init template config, defaulting to themes/ and overridden by GEEKITY_THEMES_DIR; a config naming themeDir is a type error and GEEKITY_THEME_DIR is ignored; config tests cover the default, relative resolution and the env override
- [ ] #2 The site.json setting theme names a folder under themesDir, is absent when the packaged default is in use, and is read, written, validated and round-tripped by the settings module; a name that is not a theme directory or has no valid manifest is refused with a message
- [ ] #3 With theme set, public pages, /theme/ assets, the editor preview and mail templates resolve from themes/<name>/ then the packaged default; with it absent, only the packaged default is used and a themes/ folder full of themes changes nothing
- [ ] #4 Changing theme in site.json takes effect on the next request without a restart, with watch on and off, and a chosen theme that has gone missing falls back to the packaged default with a logged warning and no 500
- [ ] #5 The admin renders from its own tree whatever theme is chosen, proven by a test that puts an admin layout in a chosen site theme and shows the login page ignores it
- [ ] #6 A themes directory that does not exist is fine, as a missing theme/ was; the commit is feat(cms)! and its footer names the themeDir removal and the theme/ to themes/<name>/ move
<!-- AC:END -->
