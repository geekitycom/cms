---
id: TASK-403
title: >-
  Data classes: every core data file is declared and its path is built through
  the declaration
status: Done
assignee:
  - '@claude'
created_date: '2026-10-14 16:25'
updated_date: '2026-10-14 17:08'
labels: []
milestone: m-38
dependencies: []
references:
  - >-
    backlog/decisions/decision-55 -
    Every-file-under-data-has-a-declared-class-and-a-site-export-follows-from-it.md
priority: medium
type: feature
ordinal: 359800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Replace `DataClass` with the tagged union of section 1. Add `files/data-files.ts` with one declaration per core row of the Context table, `queue.sqlite` as `pending` included, and `dataPath`. Move every `dataDir` join site onto it. Update the five settings namespaces and the folder storage. Change `dev_mode` to `kept`.

From decision-55 (accepted), proposed task 1. Read the decision first; it lists every data file, its class and the design this task builds.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 `DataClass` is the union of section 1, and every `switch` on it is exhaustive.
- [x] #2 Every core file and folder in the table has a declaration with its class and a `lost` sentence. `queue.sqlite` and its WAL files are `pending`.
- [x] #3 `data-files-boundary.test.ts` uses the TypeScript AST, fails on a `dataDir` join outside the allowed modules, and names the file, the line and the fix. It is shown to fail on a call added on purpose before that call is removed.
- [x] #4 A test pins the scratch patterns to `files/atomic.ts` `temporaryName` and `jobs/lock-file.ts`.
- [x] #5 A test asserts that every file `discardDatabase` removes is declared `rebuildable`.
- [x] #6 The settings registry writes mode 0600 exactly where it does today.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Add typescript-classic (npm:typescript@6) as a cms devDependency: TypeScript 7 ships no JS parser API, the boundary test needs one.
2. Write data-files-boundary.test.ts first (TS AST over packages/cms/src and packages/plugin-*/src, non-test files; flags join/resolve/path.join/path.resolve with 2+ args whose first is dataDir or *.dataDir; allowed: files/data-files.ts, settings/registry.ts, plugins/settings.ts where pluginFolderPath lives). Show it failing on the 23 current sites and on one call added on purpose.
3. Add files/data-files.ts: DataClass union (here rather than settings/types.ts because files/ sits below settings/ in the layer map), DataFileDeclaration, declareDataFile, dataPath (literal segments joined, each wildcard segment filled by one part checked against its glob, ** takes the rest, missing parts stop at the folder), dataFileMatches, dataFileFor, CORE_DATA_FILES and CONTENT_SCRATCH_FILES, one declaration per core row of decision-55's table.
4. files/data-files.test.ts: dataPath and matching; the class of every core row; scratch patterns pinned to the exported temporaryName and to lockFileFor/guardFileFor in jobs/lock-file.ts (the lock seen on disk while withLockFile holds it); every file discardDatabase removes is rebuildable.
5. Settings: a data file namespace carries a DataFileDeclaration, content storage only a path; folder files are kept (settings.json) and credential (secrets.json); registry writes 0600 when the class is credential via an exhaustive switch; registry.dataFiles() for TASK-404. maintenance rebuildable, dev_mode kept, mail and akismet credential.
6. Move every join site onto dataPath; leave supervisor/control.ts (one-argument resolve for a hash).
7. Docs: class table in docs/content.md.
8. pnpm build, test, typecheck, lint, format:check.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
- TypeScript 7 ships no JS parser API, so packages/cms gains the devDependency typescript-classic (npm:typescript@^6.0.3, the version the root already pins for typescript-eslint). data-files-boundary.test.ts parses with it.
- DataClass lives in files/data-files.ts, not settings/types.ts as decision-55 sketched: the layer map puts files/ below settings/, so the declarations module cannot import from settings/. settings imports it.
- Boundary allowed list: files/data-files.ts, settings/registry.ts and plugins/settings.ts (pluginFolderPath lives there, not in plugins/registry.ts). A one-argument path.resolve(dataDir) (supervisor/control.ts hashes the data dir for the socket name) is not a join and is not flagged.
- AC#3 proof: before migration the test listed 23 join sites. After migration it passed; a multi-line path.join(config.dataDir, 'planted.json') appended to site/users.ts made it fail with 'cms/src/site/users.ts:885 joins a path onto dataDir: build the path with `dataPath` and a declaration in files/data-files.ts (decision-55)'; the call was then removed and the test passed again.
- dataPath fills each wildcard segment with one part that must match it (** takes the rest) and stops at the folder when parts run out; it throws on a part outside the declaration, so every built path is covered.
- Settings storage: a data file namespace carries a DataFileDeclaration (MAINTENANCE_FILE rebuildable, DEV_MODE_FILE kept, MAIL_FILE and AKISMET_FILE credential); site.json under content/ carries only its path, since content/ is all kept. Folder storage: settings.json kept, secrets.json credential. The registry writes 0600 exactly when the class is credential (one exhaustive switch, writtenPrivately), which is mail.json, akismet.json and secrets.json, as before. registry.dataFiles() lists every registered namespace's data file declarations for TASK-404's siteDataFiles.
- images/derivedDir now returns undefined for a source outside content/uploads (it used to compute a path that could leave data/images); its four callers already returned early for such a source or now do.
- Removed unused path constants (DATABASE_FILE, IMAGE_DIRECTORY, AVATAR_DIRECTORY, COMMENT_EMAILS_DIRECTORY, CONTACT_DATA_DIRECTORY, TOKENS_FILE, USERS_FILE, LOCATIONS_FILE, KEPT_PROPERTIES_FILE, ADDRESS_SALT_FILE, COMMENT_SALT_FILE, and the notification/plugin-changes/queue/activity-log names). None is in the public API. Tests use the declarations.
- docs/content.md gains the class table.
- Validation: pnpm build, pnpm test (cms 6032 pass, plugins and demo pass), pnpm typecheck, pnpm lint, pnpm format:check all pass.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Replaced DataClass with decision-55's tagged union (kept | credential | rebuildable | pending | scratch) in the new files/data-files.ts, which declares every core data/ file with its class and a lost sentence (queue.sqlite and queue.sqlite-* pending; geekity.db and -* rebuildable; scratch **/*.tmp and **/*.lock*; content scratch incl. .geekity-watch-*), plus dataPath, dataFileFor and dataFileMatches. Moved all 23 dataDir join sites onto dataPath. Settings namespaces declare their files (dev_mode now kept, mail/akismet credential, maintenance rebuildable; folder settings.json kept, secrets.json credential) and the registry writes 0600 exactly for credentials, through one exhaustive switch; registry.dataFiles() lists them for TASK-404. Verified by data-files-boundary.test.ts (TS AST; shown failing on a planted multi-line join, then passing), files/data-files.test.ts (class of every core row, scratch patterns pinned to temporaryName and lockFileFor/guardFileFor, discardDatabase removes only rebuildable files), registry tests (dataFiles, 0600 for credentials and 0644 otherwise, existing credential mode tests), and pnpm build/test/typecheck/lint/format:check all green.
<!-- SECTION:FINAL_SUMMARY:END -->
