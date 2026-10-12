---
id: TASK-372
title: A @geekity/cms/testing entry for the host internals plugin tests use
status: Done
assignee:
  - '@claude'
created_date: '2026-10-12 16:29'
updated_date: '2026-10-12 18:18'
labels: []
milestone: m-37
dependencies: []
priority: low
type: feature
ordinal: 331800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
After TASK-369 the root entry of @geekity/cms exports only its documented API, but eight host internals stay in it only because packages/plugin-wordpress tests import them: openAdminStore, intakeComment, addComment, updateComment, deleteComment, pluginSite, pluginDataFolder and documentContent (see docs/public-api.md). Give plugin authors a separate @geekity/cms/testing entry point for building a host in tests, and take those names out of the root entry. The root entry is semver-protected, so removing them is a breaking change; @geekity/cms/testing can be documented as test-only.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 packages/cms/package.json exports a ./testing entry, and the eight names are importable from @geekity/cms/testing
- [x] #2 The eight names are no longer exported from the root entry, and docs/public-api.md and src/public-api.test.ts agree
- [x] #3 Every packages/plugin-* test imports host helpers from @geekity/cms/testing or @geekity/cms/plugin, never from the root, and a check fails if a plugin test imports a name the root does not document
- [x] #4 docs/plugins.md describes the testing entry and that it is for tests only
- [x] #5 The removal from the root entry lands as a breaking commit; plugin, demo and core test suites pass
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Tests first (packages/cms/src/public-api.test.ts): generalise the export parser to any entry; add checks that src/testing.ts exports at runtime exactly what its statements name and exactly the names in the Testing a plugin table of docs/plugins.md; that every testing value is imported from @geekity/cms/testing by some packages/plugin-* test; that every name a plugin test or script imports from the root is documented in docs/public-api.md; and that plugin src/ imports @geekity/cms only through /plugin (the bundle never carries testing). Watch them fail.
2. Add src/testing.ts with openAdminStore, intakeComment, addComment, updateComment, deleteComment, pluginSite, pluginDataFolder, documentContent, plus the types only their signatures use (OpenAdminStoreOptions, IntakeCommentOptions, CommentIntakeOutcome, CommentOrigin, ProposedComment, NewComment). Add ./testing to package.json exports (dist/testing.js, dist/testing.d.ts). Place testing.ts in the public API layer in layer-boundary.test.ts and docs/development.md.
3. Remove those names from src/exports.ts and their rows from docs/public-api.md; name the third entry point there.
4. Move plugin-wordpress tests and scripts/fed-smoke.ts to import them from @geekity/cms/testing.
5. docs/plugins.md: a Testing a plugin section with the table, test-only.
6. Prove the plugin-import check fails on a planted root import of an undocumented name, revert. Run pnpm build, test, typecheck, lint, format:check, test:11ty.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Built src/testing.ts (public API layer) and the ./testing export (dist/testing.js, dist/testing.d.ts; published with dist). It exports the eight values and the six types only their signatures use: OpenAdminStoreOptions, IntakeCommentOptions, CommentIntakeOutcome, CommentOrigin, ProposedComment, NewComment. Those 14 names left src/exports.ts and docs/public-api.md; root entry went from 206 names (44 values) to 192 (36 values). CommentRecords and CommentNotices stay in the root.
Plugin-wordpress tests and scripts/fed-smoke.ts import the eight from @geekity/cms/testing; core src/documented-uses.test.ts takes addComment from ./testing.ts for its fixture.
Checks in packages/cms/src/public-api.test.ts (run in pnpm test): testing.ts runtime values = its statements; its names = the Testing a plugin table in docs/plugins.md; every testing value is imported by some packages/plugin-* test; every name a plugin test/script imports from @geekity/cms is listed in docs/public-api.md; plugin src/ imports core only through @geekity/cms/plugin (so a bundle never carries testing helpers). Each scanned file must reach core only through named imports, so the parse cannot miss one.
Proofs: removing the names from the root before migrating failed the plugin check with 19 offences (e.g. 'addComment: plugin-wordpress/test/comments-import.test.ts'); a planted NewComment root import in plugin-tag-suggest/test/bundle.test.ts failed it with 'NewComment: plugin-tag-suggest/test/bundle.test.ts'; a planted @geekity/cms/testing import in plugin-llm/src/index.ts failed the src check; a planted slugify export in testing.ts failed the doc and used-by-a-plugin-test checks. All reverted.
Validation: pnpm build, pnpm test (cms 5781, demo 32, plugin-llm 48, post-summary 22, tag-suggest 31, wordpress 106, 0 fail), typecheck, lint, format:check, test:11ty all pass. Wordpress bundle has no testing helpers.
AC #5 left unchecked: the breaking commit is the orchestrator's. Not done here: plugin-wordpress/test/import-dev-mode.test.ts still polls with a Date.now() deadline and setTimeout; cms.onSettled would replace it.

Orchestrator: committed as feat(cms)! with a BREAKING CHANGE footer on m38-test-seams. Gate re-run before commit: build, test (cms 5781), typecheck, lint, format:check, test:11ty pass.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added the @geekity/cms/testing entry (src/testing.ts, ./testing in package.json exports) with openAdminStore, intakeComment, addComment, updateComment, deleteComment, pluginSite, pluginDataFolder, documentContent and the six types only they use; removed all 14 from the root entry and docs/public-api.md; moved plugin-wordpress tests and fed-smoke to the new entry; documented it as test-only in docs/plugins.md (Testing a plugin). public-api.test.ts now checks the testing entry against its docs table, that each testing value is used by a plugin test, that plugin tests import only documented root names, and that plugin src/ reaches core only via /plugin; each check was shown to fail on a plant. Full build, test, typecheck, lint, format:check and test:11ty pass. AC #5 awaits the breaking commit.
<!-- SECTION:FINAL_SUMMARY:END -->
