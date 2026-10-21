---
id: TASK-443
title: 'Plugins add script, link and meta tags to every public page'
status: Done
assignee:
  - '@claude'
created_date: '2026-10-20 21:10'
updated_date: '2026-10-20 22:23'
labels:
  - plugins
  - themes
milestone: m-41
dependencies: []
references:
  - >-
    backlog/decisions/decision-59 -
    Plugins-add-tags-to-public-pages-and-widgets-to-the-dashboard-through-declarative-contributions-the-core-draws.md
  - packages/cms/src/plugin.ts
  - packages/cms/themes/default/layouts/base.njk
priority: medium
ordinal: 380800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Per decision-59, a plugin can declare tags for the end of <head> or the end of <body> on public pages: a script with a src and attributes, a link, or a meta. This replaces the need for a site theme override (decision-37 hook partials) to add an analytics snippet. Tags are read when the page is drawn so they can follow the plugin settings.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A plugin declares head-end and body-end tags in register, and an enabled plugin tags appear on every public page
- [x] #2 Every attribute value is escaped, and a plugin cannot hand over raw HTML or an inline script
- [x] #3 Plugin tags draw before the site own head-end and body-end partials, in enabled-plugin order, and the partials keep working
- [x] #4 Tags are left out of the editor preview, and a disabled plugin adds none
- [x] #5 A tag function can read the plugin settings and declare no tags while they are unset
- [x] #6 HOST_API_VERSION goes up, plugins built against the previous version still load, and docs/plugins.md documents page tags with an example
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. plugin.ts: add PluginPageTag (script with src, link, meta; attributes string|boolean), PluginPageTags {headEnd, bodyEnd}, and host.pageTags(read) declared at most once in register; read() may be async and runs per page.
2. src/plugins/page-tags.ts: validate and draw tags to markup. Attribute names are plain names, never on*; src and href are http(s) URLs or root paths; every value escaped with escapeAttribute. A tag set that breaks a rule is dropped with a warning, so a plugin cannot hand over raw HTML or an inline script.
3. registry.ts: keep the declared read function on the contributions. Accept plugins whose hostApi is between OLDEST_HOST_API_VERSION (2) and HOST_API_VERSION; raise HOST_API_VERSION to 3. Same range in install.ts (geekity plugin add).
4. src/web/page-tags.ts middleware (outside /admin): for each active plugin in running order, await its read(), draw it, and put the drawn head-end/body-end markup on the request (AsyncLocalStorage for the renderer, c.var for the listing ETag). A read that throws is logged and that plugin adds nothing.
5. render.ts puts pluginTags on every page's context after the caller's context, so front matter cannot set it. base.njk draws pluginTags.headEnd/bodyEnd just before the head-end/body-end partials inside the editorPreview guard.
6. Listing fingerprint includes the drawn tags so a settings change reaches a revalidating browser.
7. Tests first (src/web/plugin-page-tags.test.ts): every public page, escaping and refusals, order with partials, preview and disabled plugin, settings-driven tags, old hostApi still loads.
8. Docs: docs/plugins.md page tags section with an example; docs/development.md and plugin.ts comments on the host API range; theme docs note; Eleventy builds run no plugins, so a static build carries the partials only.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Built host.pageTags(read) in plugin.ts (PluginPageTag: script with src, link, meta; PluginPageTags {headEnd, bodyEnd}). src/plugins/page-tags.ts draws them: every value escaped with escapeAttribute, names must match /^[a-zA-Z][a-zA-Z0-9_:.-]*$/ and not start with on, src/href must be http(s) or a root path (not // or /\), script src given once outside attributes. A broken tag set or a throwing read drops that plugin's tags and logs a warning; the page still draws.
src/web/page-tags.ts middleware (registered in cms/app.ts before mountPublicSite, skips /admin) awaits each running plugin's read in c.var.activePlugins order (dependency order, then install order) and runs the rest of the request under an AsyncLocalStorage; render.ts puts pluginTags {headEnd, bodyEnd} (nunjucks SafeString) on every page context after the caller's context, so front matter cannot set it. base.njk prints them just before the head-end/body-end partials inside the editorPreview guard. The listing ETag fingerprint includes the drawn tags so a settings change is not hidden by a 304 (verified: the AC #5 test fails when that line is removed).
HOST_API_VERSION is 3. New src/plugins/host-api.ts: OLDEST_HOST_API_VERSION = 2 and hostApiProblem(); registry.ts and install.ts (geekity plugin add) accept 2..3. docs/development.md now describes the range: additions raise HOST_API_VERSION, breaks also raise the oldest version. The bundled plugins and demo plugins still target 2 and load unchanged.
Eleventy: the static build runs no plugins, so pluginTags is undefined there and prints nothing (pnpm test:11ty passes, demo build:11ty output has no stray text). Documented in docs/plugins.md: a tag a static build must carry goes in the partials.
Plugin tags are drawn for signed-in readers and in dev mode too; read() gets no context. A theme partial can test devMode/signedIn; an analytics plugin cannot yet. Left for the Umami plugin task to decide.
Validation: pnpm build, pnpm test (cms 6391 pass; one run hit the cli-jobs killed-worker timeout flake, which passed alone and on the full rerun), pnpm test:11ty, pnpm typecheck, pnpm lint, pnpm format:check all pass. Curled a running server (createCms + serve on :4567) with a settings-driven tag plugin: no tag while unset, the escaped script/meta tags after writing settings.json, none after disabling in site.json, with no restart.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Plugins add script, link and meta tags to the end of <head> and <body> on every public page through host.pageTags(read). The core draws and escapes them, refuses event-handler attributes and non-http(s) script/link URLs, and prints them before the site's head-end/body-end partials in plugin run order. They are left out of the editor preview and the admin, and a disabled plugin adds none. read() runs per page so tags follow settings, and listing ETags include the tags. HOST_API_VERSION is now 3, the core runs plugins targeting 2..3, and docs/plugins.md, development.md and the theme docs describe page tags and the version range. Verified with src/web/plugin-page-tags.test.ts (12 tests), updated registry/plugin-add/demo tests, the full build/test/test:11ty/typecheck/lint/format run, and curl against a running server.
<!-- SECTION:FINAL_SUMMARY:END -->
