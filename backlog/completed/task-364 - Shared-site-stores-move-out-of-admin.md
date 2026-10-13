---
id: TASK-364
title: Shared site stores move out of admin
status: Done
assignee:
  - '@claude'
created_date: '2026-10-11 22:39'
updated_date: '2026-10-11 23:34'
labels: []
milestone: m-33
dependencies:
  - TASK-355
type: chore
ordinal: 323800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
After TASK-352, micropub/ and content/ still import users (admin/accounts), site settings (admin/settings), uploads (admin/uploads) and media resolution (admin/media). These are site data and storage used by every authoring input, not admin screens, so the layering points the wrong way: content and micropub depend on the admin UI package.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 No non-test module under content/ or micropub/ imports from admin/
- [x] #2 Users, site settings and uploads live in modules outside admin/; admin keeps their screens and routes
- [x] #3 Public exports from the package index keep working
- [x] #4 Existing tests pass unchanged in behaviour
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Add src/admin-boundary.test.ts: fails when a non-test module under content/ or micropub/ imports admin/; see it fail (10 offending lines).
2. Users: git mv admin/accounts.ts -> site/users.ts and admin/passwords.ts -> site/passwords.ts (with their tests). migrateUsersToFile reads the admin store, so it moves to admin/users-migration.ts beside settings-migration.ts.
3. Settings: point every importer of admin/settings.ts at site/* (and migrateSettingsToFile at admin/settings-migration.ts); admin/settings.ts keeps only SETTINGS_PATH.
4. Uploads: git mv admin/uploads.ts -> media/uploads.ts keeping storage (storeUpload, acceptUpload, limits, uploadMarkdown, tooLargeMessage); admin/uploads.ts keeps UPLOADS_PATH, refuseOversizedUpload and mountUploads. Library storage (listUploads, describeUpload, mentionsUpload, deleteUpload, resolveUpload) moves to media/library.ts; admin/media.ts keeps the screen and referencesTo (needs admin editor paths).
5. Rewrite imports with a script, keep index.ts export names, run pnpm build/test/typecheck/lint/format:check.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Moves: admin/accounts.ts -> site/users.ts (git mv, with its test); admin/passwords.ts -> site/passwords.ts (git mv, with its test); migrateUsersToFile -> admin/users-migration.ts (reads the admin store; usersJsonText and UsersFileContents now exported from site/users.ts for it). admin/uploads.ts -> media/uploads.ts (git mv) keeping storage (storeUpload, acceptUpload, limits, UPLOAD_FIELD, UPLOAD_ENVELOPE_BYTES, uploadMarkdown, tooLargeMessage); admin/uploads.ts now holds only UPLOADS_PATH, UploadResult, refuseOversizedUpload, mountUploads. Library storage (MediaFile, listUploads, describeUpload, mentionsUpload, deleteUpload, resolveUpload, DeleteUploadOptions, RemoveDerived) -> media/library.ts; admin/media.ts keeps the screen and referencesTo (needs admin editor paths). admin/settings.ts is SETTINGS_PATH only; re-exports dropped, importers point at site/* and admin/settings-migration.ts.
Imports rewritten with a codemod across src/, scripts/ and test/ (166 files). site/users.ts still imports admin/admin-theme.ts (pure theme list + validator, no imports) for the stored adminTheme field; content/micropub reach it only transitively.
Boundary test src/admin-boundary.test.ts failed before the move with 10 offending lines, passes after. admin/index.ts exports the same 322 names as HEAD; src/index.ts unchanged.
Validation: pnpm build, typecheck, lint, format:check clean; pnpm test 5558/5558 in packages/cms, plugins all pass.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Moved users (site/users.ts, site/passwords.ts), upload storage (media/uploads.ts) and upload library storage (media/library.ts) out of admin/, and pointed settings importers at site/* directly. Admin keeps screens, routes and the store-reading migrations (admin/users-migration.ts, admin/settings-migration.ts). New src/admin-boundary.test.ts fails if a non-test module under content/ or micropub/ imports admin/; it failed on 10 lines before and passes now. Public names unchanged (admin/index.ts export set identical to HEAD, src/index.ts untouched, dist exports probed). Verified with pnpm build, test (5558 pass), typecheck, lint, format:check.
<!-- SECTION:FINAL_SUMMARY:END -->
