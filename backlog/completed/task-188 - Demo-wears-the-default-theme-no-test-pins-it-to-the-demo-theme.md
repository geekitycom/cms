---
id: TASK-188
title: Demo wears the default theme; no test pins it to the demo theme
status: Done
assignee:
  - '@claude'
created_date: '2026-10-01 11:58'
updated_date: '2026-10-01 12:07'
labels:
  - theme
  - testing
  - demo
dependencies: []
priority: medium
type: chore
ordinal: 207800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Running `pnpm dev` serves apps/demo, and apps/demo/content/_data/site.json says "theme": "demo". So the default (Paper) theme, the one every new site gets, is not what a developer sees. Switching the theme in Appearance rewrites that tracked site.json and breaks tests, so the demo is pinned to its own theme by its tests.

Two places hold the pin:
- packages/cms/src/web/reply-context.test.ts ("a reply's preview in the demo theme") reads apps/demo/themes/demo directly. It is the only packages/cms test that reads anything from apps/demo. The release, npm-publish and docker-build-push tests only mkdir a fake apps/demo inside a temp repo, which is no dependency.
- apps/demo/test/site.test.ts asserts the demo theme is the chosen one ("the theme the demo chose"), and its "unchosen" block asserts settings.theme === 'demo' before removing it.

The override mechanism itself is already covered in packages/cms by src/web/theme-choice.test.ts and src/web/themes.test.ts against temp theme dirs. The demo's theme tests mostly repeat that coverage through the workspace build.

Desired outcome: the demo serves the default theme by default, apps/demo/themes/demo stays on disk as the worked example a person can activate in Appearance, and no packages/cms test reads files under apps/demo.

Local playground: `pnpm dev` should run against an untracked copy of the demo content, so editing posts, settings, comments or uploads in the admin never shows up in git. A .gitignore cannot do this alone, because the posts, pages and site.json the admin rewrites are tracked, and ignore rules do not apply to tracked files. The checked-in apps/demo/content becomes the seed: tests and the Eleventy check read it, and dev copies it to a gitignored directory the first time it runs. The partial ignores already in the root .gitignore (the demo's federation, comments and _trash) then have no job left and can go.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 apps/demo/content/_data/site.json chooses no theme, so pnpm dev serves the packaged default theme
- [x] #2 packages/cms/src/web/reply-context.test.ts builds its site theme in a temp dir and reads nothing under apps/demo
- [x] #3 No file under packages/cms/src or packages/cms/test reads a path inside apps/demo (checked by grep in the final summary)
- [x] #4 apps/demo/test/site.test.ts runs the demo as shipped against the packaged theme, and covers the demo theme by choosing it on a temp copy of the content
- [x] #5 README theme section (around 'apps/demo/themes/demo/ is the worked example') and the README tree line for themes/demo/ describe the demo theme as available, not chosen
- [x] #6 pnpm test, pnpm test:11ty, pnpm lint and pnpm typecheck pass
- [x] #7 pnpm dev serves a gitignored working copy of apps/demo/content, created from the tracked content when it is missing and left alone when it exists
- [x] #8 Changing a post, a setting, the theme, a comment or an upload through the admin while running pnpm dev leaves git status clean
- [x] #9 A demo script (for example pnpm --filter demo reset) replaces the working copy with a fresh copy of the tracked content
- [x] #10 The root .gitignore drops the apps/demo/content/_data/federation, _data/comments and _trash entries that the working copy makes redundant
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. reply-context.test.ts builds its own minimal site theme in a temp dir.
2. Demo seed site.json chooses no theme; site.test.ts boots every site on a temp copy of the seed, packaged theme as shipped, demo theme chosen on a second copy.
3. playground.ts copies content/ to gitignored playground/ before dev/start, with --reset; geekity.config.ts serves playground/.
4. Drop the demo residue ignores; README and scripts.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Verification: grep of packages/cms/src and packages/cms/test for apps/demo finds only the release/npm/docker tests that mkdir a fake apps/demo in a temp repo. With "theme": "demo" put back in the seed, 4 demo tests fail (including the new 'chooses no theme' check). The reply-context test fails when its layout drops the reply-context include. pnpm dev printed 'copied content/ to playground/' and served the packaged post layout. Editing a post, writing theme demo into site.json (served the demo byline live), adding a comments file and an upload under playground/ left git status clean. pnpm demo:reset produced a fresh copy. pnpm test (2671 + 30), pnpm test:11ty, lint, typecheck and format:check pass. Every demo test site now runs on a temp copy of the seed, so test runs leave no residue in content/. Added a root pnpm demo:reset script so the README command table keeps its widths.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
pnpm dev now serves the packaged default theme from apps/demo/playground/, a gitignored copy of the tracked content made by playground.ts (pnpm demo:reset remakes it). The demo seed chooses no theme; site.test.ts tests the demo as shipped on the packaged theme and the demo theme on a temp copy with it chosen. reply-context.test.ts uses an inline theme, so packages/cms reads nothing from apps/demo. Verified by running pnpm dev, writing to the playground with git status staying clean, regression checks on both tests, and the full suites.
<!-- SECTION:FINAL_SUMMARY:END -->
