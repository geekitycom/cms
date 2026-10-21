---
id: TASK-453
title: Create @geekity/plugin-umami and add the Umami tracker to every public page
status: Done
assignee:
  - '@claude'
created_date: '2026-10-20 21:11'
updated_date: '2026-10-21 03:24'
labels:
  - plugins
  - umami
milestone: m-42
dependencies:
  - TASK-443
references:
  - docs/plugins.md
priority: medium
ordinal: 390800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A new published package, @geekity/plugin-umami, alongside the other plugin-* packages. Its settings: the Umami URL, the website ID, and tracker options (data-domains, data-do-not-track, exclude search and hash). It adds the Umami script tag through the page-tags hook, which replaces the theme-override snippet sites use today (decision-37 hook partials).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The package builds, tests and publishes with the others: workspace, release-please config, commitlint scope plugin-umami, and the Docker plugin add path
- [x] #2 With the URL and website ID set, every public page carries one Umami script tag with the configured data attributes; with either unset, none
- [x] #3 The tag is not drawn in the editor preview
- [x] #4 The README and docs explain installing the plugin and removing an existing head-end snippet so the tracker is not counted twice
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Register the package: assert in packages/cms/src/release.test.ts that the workspace has five plugin packages (fails), then add packages/plugin-umami (package.json at 0.0.0 like earlier first releases, repository field, hostApi 3, peer @geekity/cms workspace:^ which .pnpmfile.mjs publishes as >=<core version at release> <1.0.0, so the first release requires the core release that ships host.fetch POST and widgets), tsconfig, LICENSE, version.ts; add it to release-please-config.json, .release-please-manifest.json, commitlint.config.js, CLAUDE.md scopes, README package table, scripts/pack-install-smoke.sh.
2. Tests first (packages/plugin-umami/test): a site with the plugin enabled and settings in data/plugins/@geekity/plugin-umami/settings.json; anonymous public pages carry one script tag with src <umami url>/script.js, data-website-id and the configured data-domains, data-do-not-track, data-exclude-search, data-exclude-hash; none with URL or website ID unset; none for a signed-in reader unless Count signed-in visits is on; none in dev mode; none in the editor preview; bundle test loads dist/bundle and draws the tag.
3. Implement src/index.ts: settings umami_url (url), website_id (text), domains (text), do_not_track, exclude_search, exclude_hash, count_signed_in (checkboxes); a pure trackerTag(settings, context) and host.pageTags calling it.
4. Docs: package README (install with npm and Docker/admin, settings, removing a head-end snippet), a section in docs/plugins.md listing the official plugins with Umami, docs link check.
5. Verify: pnpm install, build, test, test:11ty, typecheck, lint, format:check; run a site with the plugin and curl anonymous, signed-in, unset settings and preview.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Built packages/plugin-umami: src/settings.ts (SETTINGS field list + UmamiSettings type), src/tracker.ts (pure trackerTags(settings, page)), src/index.ts (definePlugin, hostApi 3, host.settings + host.pageTags). Settings: umami_url (url, no default, so unset means no tag), website_id, domains (comma list, trimmed, data-domains), do_not_track / exclude_search / exclude_hash (checkboxes -> data-*="true"), count_signed_in (off by default). Always skipped in dev mode. Left out data-host-url, data-tag, data-auto-track, data-performance: nothing asked for them; each would be one more field.
Version 0.0.0 in package.json and the manifest, as plugin-tag-suggest started; release-please makes the first feat 0.1.0. Peer @geekity/cms is workspace:^, which .pnpmfile.mjs publishes as >=<core version at pack time> <1.0.0; the release that first ships this package also bumps core past 0.36.1, so the range starts at the core release with host.fetch POST and widgets. Today's pack shows >=0.36.1 because core is not bumped yet.
Registered in release-please-config.json, .release-please-manifest.json, commitlint.config.js and CLAUDE.md (scope plugin-umami), README package table, docs/plugins.md (new table of this repository's plugins + Umami move note), docs/theme/adding-to-every-page.md (pointer above the Umami snippet example), scripts/pack-install-smoke.sh (packs, installs, loads the bundle alone, and checks the tag on /). The Dockerfile copies only cms and plugin-wordpress manifests, so it needs no change; docker build was not run.
Validation: pnpm build && pnpm test (cms 6503, umami 9, all packages 0 fail), pnpm test:11ty, typecheck, lint (incl. doc links), format:check all pass. commitlint accepts feat(plugin-umami). node scripts/release.ts --dry-run lists @geekity/plugin-umami@0.0.0 as the release to publish (refused only because tag plugin-umami-v0.0.0 does not exist yet, which release-please creates). pnpm pack tarball holds dist, dist/bundle/{index.js,plugin.json}, README, LICENSE, repository field. bash scripts/pack-install-smoke.sh passed with the new Umami check. Manual: packed tarball served by the fake npm registry, geekity plugin add installed it into a plugins folder; geekity serve on that folder: unset settings 0 tags; settings set -> one tag on /, a post and a 404 with data-domains and data-do-not-track; signed in 0; count_signed_in on -> 1; editor preview 0 (also with count_signed_in on); URL unset 0; plugin screen shows the fields and GEEKITY_PLUGIN_UMAMI__WEBSITE_ID. Server stopped by PID.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
New package @geekity/plugin-umami (hostApi 3) adds one deferred Umami script tag at the end of <head> on every public page through host.pageTags, from settings for the Umami URL, website ID, domains, Do Not Track, excluding search and hash, and counting signed-in visits (off by default). No tag while the URL or website ID is unset, in dev mode, for signed-in readers by default, or in the editor preview. Registered with release-please, commitlint/CLAUDE.md scopes, README, docs and the pack-install smoke. README and docs/plugins.md cover npm, Docker and admin installs and removing an existing head-end snippet. Verified with the package tests (incl. the bundle), the full gate set, release dry-run, pack-install smoke, and curl against geekity serve on a folder installed by geekity plugin add.
<!-- SECTION:FINAL_SUMMARY:END -->
