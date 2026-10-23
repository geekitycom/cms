---
id: TASK-494
title: >-
  The admin stores a per-user autosave copy of an editor form under
  data/autosave
status: Done
assignee:
  - '@claude'
created_date: '2026-10-23 10:49'
updated_date: '2026-10-23 11:03'
labels:
  - admin
  - editor
  - autosave
milestone: m-47
dependencies: []
references:
  - packages/cms/src/admin/uploads.ts
  - packages/cms/src/admin/preview.ts
  - packages/cms/src/admin/documents.ts
  - packages/cms/src/files/data-files.ts
  - packages/cms/src/files/atomic.ts
  - packages/cms/src/admin/routes.ts
ordinal: 419800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
decision-62: autosave needs a server-side home that is never the document. POST /admin/autosave takes the editor form (FormData with csrf_token) and writes its fields, the base hash, the document identity and a timestamp to data/autosave/<userId>/<key>.json atomically; it never writes the content file or any other store.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 POST /admin/autosave under the admin guard stores the submitted editor fields, base hash, document type/kind/path (or the minted id of a new document) and the save time for the signed-in user, atomically, and returns JSON with the saved time; the content file and every other store are untouched
- [x] #2 The key is the content path for an existing document and a validated minted id for a new one; a key that does not parse, or a path outside the content directory, is refused with 400
- [x] #3 POST /admin/autosave/discard deletes the user copy for a key; a user can never read, restore or discard another user copy
- [x] #4 A successful save, publish, update or trash of a document through the editor deletes the saving user copy for that key; a refused or conflicting save keeps it
- [x] #5 Copies older than 30 days are pruned at boot, and a user copies are deleted when the user is deleted
- [x] #6 data/autosave/** is declared pending under decision-55 with a lost sentence, and appears in geekity export --list and the data census
- [x] #7 Tests cover storing, overwriting, discard, ownership, clearing on save/trash, a refused key, pruning and the data class; docs/admin.md and docs/content.md describe the copy and where it lives
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. New unit src/autosave/ (services layer in layer-boundary.test.ts): key.ts with mintAutosaveId/isMintedAutosaveId and parseAutosaveKey(contentDir, raw) -> {kind:'new',id}|{kind:'existing',path}|undefined (path must be a relative .md path inside contentDir); store.ts with a synchronous autosaveCopies(dataDir) giving save/read/list/discard/discardAllFor/prune over data/autosave/<userId>/<sha256(key)>.json, written with writeFileAtomicallySync at 0600.
2. Declare AUTOSAVE (autosave/**, pending, lost sentence) in files/data-files.ts and CORE_DATA_FILES; classification test row; export --list assertion.
3. src/admin/autosave.ts: POST /admin/autosave (FormData/urlencoded with csrf_token under the guard) stores the string fields minus csrf_token, hash, type/kind/path or minted id and savedAt; returns JSON {key, savedAt}; 400 on a bad key; 404 when an existing key names no document of the type. POST /admin/autosave/discard deletes the caller's copy; JSON, or a 303 to a validated return path for a no-JS form.
4. documents.ts: after a successful save/publish/update (writeDocument saved) and after a trash, discard the saving user's copy for the old path, the saved path and a minted id carried in the autosave field; refused and conflicting saves keep it.
5. deleteUser removes data/autosave/<userId>/; boot() prunes copies older than 30 days.
6. Data census drives an autosave POST; tests in src/autosave/autosave.test.ts and src/admin/autosave.test.ts first (TDD); docs/admin.md and docs/content.md.
7. Verify: build, test, test:11ty, typecheck, lint, format:check, curl against a temp site.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Built src/autosave/ (services layer): key.ts (AUTOSAVE_FIELD='autosave', mintAutosaveId -> new-<32 hex>, isMintedAutosaveId, parseAutosaveKey(contentDir, raw) -> {kind:'new',key} | {kind:'existing',key,path} | undefined) and store.ts (synchronous autosaveCopies(dataDir): save/read/list/discard/discardUser/prune, AUTOSAVE_KEEP_DAYS=30). One file per user and key: data/autosave/<userId>/<sha256(key)>.json, mode 0600, written with writeFileAtomicallySync; the key is stored inside so list() can return it.
Declared AUTOSAVE (autosave/**, pending) in files/data-files.ts and CORE_DATA_FILES; data census drives POST /admin/autosave; export --list test asserts the row.
src/admin/autosave.ts mounts POST /admin/autosave and /admin/autosave/discard beside uploads and preview. An existing key must name a document in the store (404 otherwise); type and path come from the store, kind from the form. Discard answers JSON, or 303 to a returnPath()-checked 'return' field with a flash (for the no-JS Unsaved list).
documents.ts discards the saver's copy for the old path, the saved path and a minted id in the autosave field after a successful writeDocument, and for the path after a trash. deleteUser drops data/autosave/<userId>/; boot() prunes copies older than 30 days (savedAt, mtime if unreadable).
Verified: pnpm build, pnpm test (cms 7159 pass, plugin-wordpress census 123 pass, all packages 0 fail), pnpm test:11ty, typecheck, lint, format:check all exit 0. Curl against a temp site on port 3494: multipart autosave 200 {key,savedAt}, file at data/autosave/1/<hash>.json mode 0600, content file unchanged, bad keys 400, no CSRF 403, new-id save + discard {discarded:true}, an Update 303 left 0 copies. Server stopped.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added a per-user autosave store under data/autosave (pending class) and the POST /admin/autosave and /admin/autosave/discard endpoints under the admin guard. Copies are keyed by content path or a minted new-<hex> id, owned by the signing-in user, cleared on a successful save/publish/update/trash, deleted with the user and pruned after 30 days at boot. Tests: src/autosave/autosave.test.ts, src/admin/autosave.test.ts, data-files and export --list rows, the data census; docs in admin.md (Autosaved copies), content.md, personal-data.md and deploying.md. Full build/test/11ty/typecheck/lint/format pass and a curl run against a temp site confirmed the behaviour.
<!-- SECTION:FINAL_SUMMARY:END -->
