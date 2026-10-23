---
id: TASK-494
title: >-
  The admin stores a per-user autosave copy of an editor form under
  data/autosave
status: To Do
assignee: []
created_date: '2026-10-23 10:49'
updated_date: '2026-10-23 10:50'
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
- [ ] #1 POST /admin/autosave under the admin guard stores the submitted editor fields, base hash, document type/kind/path (or the minted id of a new document) and the save time for the signed-in user, atomically, and returns JSON with the saved time; the content file and every other store are untouched
- [ ] #2 The key is the content path for an existing document and a validated minted id for a new one; a key that does not parse, or a path outside the content directory, is refused with 400
- [ ] #3 POST /admin/autosave/discard deletes the user copy for a key; a user can never read, restore or discard another user copy
- [ ] #4 A successful save, publish, update or trash of a document through the editor deletes the saving user copy for that key; a refused or conflicting save keeps it
- [ ] #5 Copies older than 30 days are pruned at boot, and a user copies are deleted when the user is deleted
- [ ] #6 data/autosave/** is declared pending under decision-55 with a lost sentence, and appears in geekity export --list and the data census
- [ ] #7 Tests cover storing, overwriting, discard, ownership, clearing on save/trash, a refused key, pruning and the data class; docs/admin.md and docs/content.md describe the copy and where it lives
<!-- AC:END -->
