---
id: TASK-76
title: >-
  Named site themes: themesDir holds one folder per theme, site.json chooses
  one, and only the chosen theme is layered over the packaged default
status: Done
assignee:
  - '@claude'
created_date: '2026-09-13 12:48'
updated_date: '2026-09-13 15:50'
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
- [x] #1 themesDir replaces themeDir in GeekityConfig, ResolvedConfig, the env table and the init template config, defaulting to themes/ and overridden by GEEKITY_THEMES_DIR; a config naming themeDir is a type error and GEEKITY_THEME_DIR is ignored; config tests cover the default, relative resolution and the env override
- [x] #2 The site.json setting theme names a folder under themesDir, is absent when the packaged default is in use, and is read, written, validated and round-tripped by the settings module; a name that is not a theme directory or has no valid manifest is refused with a message
- [x] #3 With theme set, public pages, /theme/ assets, the editor preview and mail templates resolve from themes/<name>/ then the packaged default; with it absent, only the packaged default is used and a themes/ folder full of themes changes nothing
- [x] #4 Changing theme in site.json takes effect on the next request without a restart, with watch on and off, and a chosen theme that has gone missing falls back to the packaged default with a logged warning and no 500
- [x] #5 The admin renders from its own tree whatever theme is chosen, proven by a test that puts an admin layout in a chosen site theme and shows the login page ignores it
- [x] #6 A themes directory that does not exist is fine, as a missing theme/ was; the commit is feat(cms)! and its footer names the themeDir removal and the theme/ to themes/<name>/ move
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. config.ts: rename themeDir to themesDir (GeekityConfig, ResolvedConfig, resolveDir call), DEFAULT_THEME_DIR 'theme' to DEFAULT_THEMES_DIR 'themes', GEEKITY_THEME_DIR to GEEKITY_THEMES_DIR. Tests: default, relative resolution, env override, and a ts-expect-error proving themeDir is a type error.
2. web/themes.ts: themeSearchPath takes an optional chosen directory (none means the packaged theme alone). Add themeNameProblem (one safe path segment), themeAt(themesDir, name), chooseTheme({themesDir, name}) returning { theme, dirs, problem }, and createThemeSource({ themesDir, chosen, logger }) — the one object that answers 'which theme is this render reading from', stat-cached on the manifest and logging one warning each time the answer changes for a bad reason.
3. web/templates.ts: createTemplateEnvironment takes the theme directories (optional) and gains useThemeDirs(environment, dirs), which re-points the Nunjucks FileSystemLoader searchPaths and invalidates its cache only when they actually change. That is how one long-lived environment follows a change of theme with watch on or off, keeping any filters a site added.
4. web/render.ts: createRenderer takes an optional ThemeSource (default built from config and its own site data source), points the environment at the current theme before every render, asks themeTemplate against the current dirs, and exposes themeDirs() on Renderer.
5. web/routes.ts: the /theme/ asset handler reads c.var.renderer.themeDirs() instead of config.themeDir.
6. mail: createMailTemplates takes a ThemeSource instead of a themeDir and re-points both environments per render; createMailService builds one from config when it is not given one.
7. admin/settings.ts: add the theme setting — SiteSettings.theme, default '', read from site.json, written only when non-empty (as homepage is), a form field, and a FIELD_CHECK that refuses a name that is not a theme directory with a valid manifest. settingsProblems gains an optional context carrying themesDir; settings-page.ts passes it from the config.
8. index.ts: build the one ThemeSource, hand it to the renderer and the mail service, and call it once at boot so a bad choice warns there.
9. Demo: move apps/demo/theme to apps/demo/themes/demo with a theme.json, set theme in content/_data/site.json, themesDir in geekity.config.ts.
10. Prose that must be truthful for the code: templates/site/geekity.config.ts, cli.ts env list, the config table rows in both READMEs, themes/default/README.md. The long-form theming sections and the demo's own docs are TASK-78.
11. Verify: pnpm build, test, typecheck, lint, format:check, plus a curl run over a booted site proving a theme change takes effect without a restart.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## What was built

**The resolver.** `src/web/themes.ts` gained the half TASK-75 left out: `themeNameProblem` (a theme name is one directory, never a path), `chooseTheme({ themesDir, name })` returning `{ theme, dirs, problem }`, and `createThemeSource({ themesDir, chosen, logger })` — a `ThemeSource` whose `current()` is the one answer to 'which theme is this render reading from'. It caches against the name and the stat of that theme's `theme.json`, so an ordinary render pays one stat, and a theme replaced or deleted under the running process is noticed on the next one. A choice that cannot be honoured is the packaged theme plus a sentence, logged once when the answer changes rather than once per render. `themeSearchPath()` with no argument is now the packaged theme alone, so an unchosen theme is never on the path and the packaged one is never on it twice.

**One environment that follows the choice.** Rather than a second Nunjucks environment per theme — which would lose any filters a site added and hand two objects to something promised one — `useThemeDirs(environment, dirs)` in `web/templates.ts` re-points the loader's `searchPaths` and invalidates the compiled templates, and only when the directories actually differ. The renderer calls it before every render, the mail templates before every message. That is what makes a change of theme take effect on the next request with watch on or off. Proved by breaking it: with the loop stubbed out, the three change-of-theme tests fail and the rest pass.

**Where the choice is read.** `site.json`'s `theme` key, through `themeName(site)` in `web/context.ts` and the stat-cached site data source, so it costs what every other setting costs. `createCms` builds the one `ThemeSource` and hands it to the renderer and the mail service; the `/theme/` asset route reads `renderer.themeDirs()`, so a page and the stylesheet it links can never come from two different themes. It is asked once at boot so a bad choice warns there rather than at whatever request arrives first.

**The setting.** `SiteSettings.theme`, read tolerantly from the file, written only when it is not empty (the rule `homepage` and `postsPage` already had: running what the package ships is not a choice to write down), on the form, and with a field check that refuses a name that is not a theme directory with a valid manifest. `settingsProblems` gained an optional `SettingsContext` carrying `themesDir`, which `mountSettingsPage` passes from the config — whether a name is a theme is a question about the file system, and only the config knows where a site's themes are.

**Config.** `themeDir` -> `themesDir`, `GEEKITY_THEME_DIR` -> `GEEKITY_THEMES_DIR`, default `theme/` -> `themes/`. Removed rather than aliased: a config naming `themeDir` is a type error and the old environment variable is ignored.

**Demo.** `apps/demo/theme/` moved to `apps/demo/themes/demo/` with a `theme.json`, `theme: \"demo\"` in its `site.json`, `themesDir` in its config. Its own tests are unchanged in substance and still pass over HTTP, so the demo now proves the choice rather than the old single directory.

## Decisions worth recording

- The theme is not on a settings page. It is the one setting in `SETTINGS_FIELDS` that no `SettingsPage` carries, because Appearance > Themes is where it is chosen (decision-15); `settings-pages.test.ts` now states that exception rather than asserting every field is on a page.
- `useThemeDirs` reaches through a cast for `loaders[].searchPaths` and `invalidateCache()`, neither of which is in the published Nunjucks types though both are documented API.
- The warning is logged by the source rather than by its callers, so a site with three consumers of the theme says it once.

## Verification

`pnpm build && pnpm test && pnpm typecheck && pnpm lint && pnpm format:check` all clean: 1654 package tests, 15 demo tests, 16 + 5 in the Eleventy suites. `scripts/pack-install-smoke.sh` passes, which type checks the scaffolded site against the published declarations — so `themesDir` in the init template is the published name.

Over HTTP, against the booted demo (`GEEKITY_PORT=3789`, temporary data directory, server stopped afterwards):

- with `theme: demo`, `/2026/08/markdown-on-disk/` carries the demo layout's reading time and `/theme/style.css` is the demo stylesheet;
- with the key removed from `site.json` and no restart, the same URLs answer from the packaged theme;
- with `theme: nothing-like-this`, both answer 200 and the log says `The theme \"nothing-like-this\" is not there: ... The packaged theme is being used instead.`;
- with the key put back, the demo layout returns.

## Acceptance criteria, and what proves each

1. `src/config.test.ts`: the `themes/` default, relative resolution, `GEEKITY_THEMES_DIR`, `GEEKITY_THEME_DIR` ignored, and a `@ts-expect-error` that fails the build if `themeDir` is ever accepted again. The init template and the env table in `cli.ts` and both READMEs name `themesDir`.
2. `src/admin/settings.test.ts`, 'the theme setting': read from and written to `site.json`, absent when empty, round-tripped through the form, kept by a save of a page that does not carry it, and refused with a message for a missing theme, a broken manifest and a name that is a path.
3. `src/web/theme-choice.test.ts`: pages and `/theme/` assets out of the chosen theme with the packaged one behind it, the editor preview through it too, and a themes directory full of unchosen themes changing nothing. Mail: `src/mail/templates.test.ts` and the 'puts the data and the site settings in front of the template' case in `src/mail/service.test.ts`, both through a chosen theme. And the demo's own suite over HTTP.
4. `src/web/theme-choice.test.ts`: 'takes effect on the next request' runs twice, with watch off and on; the theme deleted under the running process falls back with exactly one warning over three requests and no 500; and the boot warning has a case of its own. Confirmed again by hand with curl against the running demo, recorded above.
5. `src/web/theme-choice.test.ts`: 'renders the admin out of the admin, whatever the site is wearing' — the chosen theme ships `layouts/login.njk` and `layouts/dashboard.njk`, and `/admin/login` is still the real form with its CSRF field.
6. `src/web/site.test.ts` 'is fine with a themes directory that does not exist' and `src/index.test.ts`, which asserts the configured directory is absent and then serves the home page, a document and the stylesheet. The second half of this criterion is the commit message, which this task cannot make: the commit is `feat(cms)!` with the footer `BREAKING CHANGE: themeDir and GEEKITY_THEME_DIR are gone; a site's theme/ becomes themes/<name>/ with a theme.json, chosen by the theme setting in content/_data/site.json.`

## Left for TASK-78

The long-form theming narrative in both READMEs — writing a theme, the manifest, listing what a site has — is still the old shape beyond the paragraphs that had become false. What I changed is what the code made untrue: the config tables and their example configs, the `Theme overrides` section, `themes/default/README.md`'s resolution order, the demo's directory in the tree diagram, the init template's tsconfig include and its hello-world post, and the demo test's header comment.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Replaced the single theme/ directory with named themes. Config names themesDir (GEEKITY_THEMES_DIR, themes/ by default) and themeDir is removed rather than aliased; site.json's theme setting names one directory under it and is absent for the theme the package ships. web/themes.ts gained chooseTheme and createThemeSource — one object that answers which theme a render reads from, stat-cached and warning once per change — and web/templates.ts gained useThemeDirs, which re-points the long-lived Nunjucks loader so a change of theme reaches the next request with watch on or off. The renderer, the /theme/ assets, the editor preview and the mail templates all read that one source; the admin is untouched and still unthemable. A chosen theme that is missing falls back to the packaged one with a logged warning and no 500, and the settings module refuses such a name with a message. The demo's theme/ is now themes/demo/ with a theme.json its site.json chooses. Verified with pnpm build, test (1654 package, 15 demo, 21 Eleventy), typecheck, lint and format:check, with scripts/pack-install-smoke.sh, and by curl against the booted demo: choosing, unchoosing and breaking the theme in site.json each took effect on the next request without a restart.
<!-- SECTION:FINAL_SUMMARY:END -->
