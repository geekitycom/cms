---
id: TASK-8
title: Eleventy compatibility test and example config
status: Done
assignee:
  - '@andrewshell'
created_date: '2026-09-02 13:25'
updated_date: '2026-09-02 21:16'
labels:
  - content
milestone: m-0
dependencies:
  - TASK-2
references:
  - backlog/decisions/decision-3 - Content-files-follow-Eleventy-conventions.md
type: chore
ordinal: 8000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Prove the compatibility promise in decision-3. Add a fixtures content directory and a test that runs Eleventy 3 against it (dev dependency) and checks that every fixture document is emitted at the URL the CMS computes from its permalink. Ship docs/eleventy.config.example.js with the draft preprocessor and passthrough copy for uploads.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 npm run test:11ty builds the fixtures directory with Eleventy without errors
- [x] #2 For every fixture document, the Eleventy output path equals the CMS permalink plus index.html
- [x] #3 Fixture documents with draft: true are absent from the Eleventy output
- [x] #4 The example Eleventy config is documented in the README
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Add @11ty/eleventy ^3 as a devDependency of packages/cms; confirm whether it ships types and add a local ambient declaration under test/types/ if not.
2. Write packages/cms/docs/eleventy.config.example.js (ESM, dependency-free): dir input content / output _site / includes _includes / data _data; addPreprocessor that drops draft: true documents; addPreprocessor that fills in the CMS default permalink (/{yyyy}/{mm}/{slug}/ for posts, /{slug}/ for pages) when front matter has none, deriving yyyy/mm from the written date string exactly as src/content/slug.ts does; addPassthroughCopy for content/uploads; ignores.add for content/_trash (Eleventy only ignores _includes/_data by default).
3. Expand test/fixtures/content so the comparison is meaningful, without reformatting the existing files: a post with an accented title and no explicit permalink, a page with no explicit permalink, a trashed post under _trash/posts/, an uploads file, and minimal _includes/post.njk + page.njk layouts that emit content only. New .md files are written in canonical writer form so the existing round-trip test keeps passing.
4. Test-first (tdd skill, node:test): packages/cms/test/eleventy.test.ts runs Eleventy programmatically (new Eleventy(input, output, { configPath })) against the fixtures with the example config, into a temp output dir; for every fixture document the CMS parses, assert the Eleventy output path equals permalink + index.html; assert drafts and _trash are absent; assert uploads are copied; exclude /feed.* (feeds are generated in code).
5. Wire scripts: packages/cms test:11ty runs tsx --test on test/*.test.ts; root test:11ty fans out with pnpm -r. pnpm test keeps running only src/**/*.test.ts so the unit suite stays fast and Eleventy-free; document that choice. Add test/**/*.ts to packages/cms/tsconfig.json include and pin tsconfig.build.json to src only so typecheck covers the test but the build does not emit it.
6. Document the example config, the layouts requirement, the _trash ignore and test:11ty in packages/cms/README.md, linking to docs/eleventy.config.example.js. Keep docs/ and test/ out of the files whitelist.
7. Verify: pnpm install, pnpm --filter @geekity/cms test:11ty, pnpm test:11ty, pnpm test, pnpm typecheck, pnpm build, pnpm pack (tarball has no docs/ or test/).
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Added @11ty/eleventy ^3.1.6 as a devDependency of packages/cms and shipped packages/cms/docs/eleventy.config.example.js: a dependency-free ESM Eleventy 3 config with a draft preprocessor (addPreprocessor returning false for draft: true, with a BUILD_DRAFTS escape hatch), a permalink preprocessor that fills in the CMS defaults (/{yyyy}/{mm}/{slug}/ for posts, /{slug}/ for pages) with the same slugify and same read of the written date as src/content/slug.ts, passthrough copy for content/uploads, and ignores for content/_trash and content/uploads.

Two design decisions worth recording. First, markdownTemplateEngine is false: the CMS renders Markdown with markdown-it and no template engine, so leaving Liquid on would make {{ ... }} in a post mean one thing live and another in the build. Second, content/uploads needs an ignores entry as well as the passthrough copy — the compatibility test caught Eleventy rendering an uploaded .md file as a page at its own URL, which the CMS would never serve, so a Markdown upload is now a fixture.

Fixtures expanded without touching the existing three files: posts/2026-05-20-renamed-in-the-admin.md (explicit permalink that is not the default), posts/2026-07-04-cafe-au-lait.md (accented title, no permalink), pages/colophon.md (no permalink), _trash/posts/2026-04-01-thrown-away.md, uploads/2026/09/note.txt and uploads/2026/09/attached-notes.md, and minimal _includes/post.njk and _includes/page.njk.

test/eleventy.test.ts copies test/fixtures to a temp directory, chdirs there (Eleventy resolves both the config's relative paths and dir.output against the working directory, so the constructor's output argument is ignored when the config returns one) and runs Eleventy programmatically, then compares the written files with what parseDocument computes for the same files. Feeds are excluded from the comparison because the CMS generates them in code.

The suite was mutation-checked: removing the trash ignore, disabling the permalink preprocessor and setting BUILD_DRAFTS=1 each turn the relevant assertions red.

Scripts: packages/cms test:11ty (tsx --test test/*.test.ts) with a root fan-out pnpm test:11ty. pnpm test still runs only src/**/*.test.ts, so the unit suite stays fast and Eleventy-free; the split is documented in the README. tsconfig.json now includes test/**/*.ts and rootDir/outDir moved to tsconfig.build.json so the test typechecks without being emitted.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Proved decision-3's compatibility promise with a real Eleventy 3 build. packages/cms/docs/eleventy.config.example.js builds a Geekity content directory at the CMS's own URLs — draft preprocessor, CMS permalink defaults, uploads passthrough plus ignore, _trash ignore — and packages/cms/test/eleventy.test.ts builds the expanded fixtures with it and compares every output path with the permalink parseDocument computes for the same file. Verified with: pnpm --filter @geekity/cms test:11ty and pnpm test:11ty (6/6 pass), pnpm test (245/245 pass), pnpm typecheck (clean), pnpm build (clean), pnpm pack (105 entries, none under docs/ or test/). The suite was mutation-checked three ways to confirm the assertions bite. Documented in packages/cms/README.md under 'Building the same content with Eleventy'.
<!-- SECTION:FINAL_SUMMARY:END -->
