---
id: TASK-369
title: The root package export is a deliberate public API
status: Done
assignee:
  - '@claude'
created_date: '2026-10-12 11:31'
updated_date: '2026-10-12 15:04'
labels: []
milestone: m-36
dependencies: []
references:
  - packages/cms/src/exports.ts
priority: low
type: chore
ordinal: 328800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
packages/cms/src/exports.ts re-exports about 1,200 symbols from about 20 directories, including internals such as NOTIFY_TIMEOUT_MS, INDEXNOW_ENDPOINT and defaultIndexNowBackoffMs. Every one of them is semver-protected, so internal renames become breaking changes. @geekity/cms/plugin already shows the target shape: a small, versioned surface. Decide what sites, the CLI, plugins and the demo actually need from the root entry and export only that. This is a breaking change and lands as feat! or with a BREAKING CHANGE footer.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The root entry exports only symbols used by apps/demo, the published plugins, the CLI, or documented in docs/
- [x] #2 docs/ lists the root entry public API, or each exported symbol has a doc comment
- [x] #3 The commit that removes exports is marked breaking so release-please takes a major
- [x] #4 apps/demo, every packages/plugin-* package and pnpm test pass
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Script the consumer list (scratchpad consumers.mjs): every named import from '@geekity/cms' in apps/demo, packages/plugin-*, templates, scripts, and docs code blocks, plus names docs prose presents as code API (media image functions, sanitizeCommentHtml, spokenIn, DuplicatePermalinkError). The CLI imports internal modules directly and needs nothing from the root entry.
2. Close the list over signatures with the TypeScript checker (scratchpad closure.mjs): every type a kept export's signature reaches that the root entry exports today stays.
3. Test first: src/public-api.test.ts reads the export statements of index.ts and exports.ts, checks them against the runtime module, and fails when they differ from the list in docs/public-api.md, naming the doc to update.
4. Write docs/public-api.md (one line per export, grouped by area), link it from docs/README.md.
5. Regenerate exports.ts with only the kept names; drop SCHEDULE_* keys from index.ts.
6. Point internal tests that imported removed names from index.ts at the real modules (admin/tools.test.ts, cli-user.test.ts, test/eleventy.test.ts).
7. Verify: pnpm build, test, typecheck, lint, format:check, test:11ty; script that every kept value is exercised by a test or a documented use.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Consumer list built by a script (TypeScript parser over every named import from '@geekity/cms' in apps/demo, packages/plugin-* src/tests/scripts/READMEs, templates/site, scripts, and docs code blocks), plus names docs prose presents as callable API: the image helpers table in docs/media.md, sanitizeCommentHtml and spokenIn in docs/feeds.md, DuplicatePermalinkError in docs/content.md (thrown by cms.store). The CLI imports internal modules directly and uses only createCms from index.ts. Plugin sources import only @geekity/cms/plugin; plugin tests import host functions (openAdminStore, addComment, intakeComment, updateComment, deleteComment, pluginSite, pluginDataFolder, documentContent, listUsers, resolveConfig) from the root, so those stay.
51 seed names, then a TypeScript checker walk over their signatures (parameter, return and member types, transitively) kept 155 types the root already exported. Root entry: 1,208 names before, 206 after. A rerun of the walk after the cut finds no reachable type that was exported before and is not now. 79 reachable types were never exported (AdminStore, the ContentStore reader interfaces, and others); that is unchanged by this task.
Tests that imported removed names from index.ts now import the real modules: admin/tools.test.ts (SCHEDULE_WATERMARK_KEY), cli-user.test.ts (MINIMUM_PASSWORD_LENGTH), test/eleventy.test.ts (categoryHref, DEFAULT_TAXONOMY_BASES, isTrashedPath, siteAuthorName). index.ts no longer exports SCHEDULE_FIRST_RUN_KEY/SCHEDULE_WATERMARK_KEY.
src/public-api.test.ts: parses the export statements of index.ts and exports.ts (any other export form fails), checks them against the runtime module, and fails with the names when they differ from the tables in docs/public-api.md. A mutation check (adding NOTIFY_TIMEOUT_MS back) failed with 'undocumented: [NOTIFY_TIMEOUT_MS]'.
src/documented-uses.test.ts runs the docs/feeds.md examples and the media image helpers through the root entry. It showed the feeds.md examples were out of date (FeedSource needs users, ConversationContext needs contentDir and users, feedComments needs cited), so docs/feeds.md now has the current signatures.

Validation: pnpm build, pnpm test (cms 5753, demo 32, plugin-llm 48, post-summary 22, tag-suggest 31, wordpress 106, 0 failures), pnpm typecheck (cms, demo, all four plugins against the built dist), pnpm lint (doc links included), pnpm format:check, pnpm test:11ty (23 + 8) all pass. AC #3 (breaking marker) is left to the orchestrator's commit: feat(cms)! with a BREAKING CHANGE footer.

Orchestrator: committed as feat(cms)! with a BREAKING CHANGE footer on branch m37-public-api, so release-please takes a major. Gate re-run before commit: build, test (cms 5753), typecheck, lint, format:check, test:11ty all pass.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
The root entry of @geekity/cms goes from 1,208 exports to 206. The kept names are what apps/demo, the published plugins (source and tests), the site template and the docs import, plus every type their signatures reach (found with the TypeScript checker). docs/public-api.md lists each export with one line and is linked from docs/README.md. src/public-api.test.ts fails when the entry and that page differ, and src/documented-uses.test.ts runs the feed and image examples through the root entry. Tests that imported removed names now import the real modules. Every gate passes, including test:11ty. Landed as feat(cms)! with a BREAKING CHANGE footer, so release-please takes a major.
<!-- SECTION:FINAL_SUMMARY:END -->
