---
id: TASK-352
title: 'The document write path lives in content, not admin'
status: Done
assignee:
  - '@claude'
created_date: '2026-10-11 17:01'
updated_date: '2026-10-11 22:39'
labels: []
milestone: m-33
dependencies:
  - TASK-351
type: chore
ordinal: 311800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Micropub imports writeDocument, formFor, blankForm, POST_KIND, moveDocumentFile and EditorForm from admin/documents.ts (2275 lines). The shared write path for every authoring input sits in an admin screen module. writeDocument (about 280 lines) mixes validation, slug and permalink resolution, conflict checks, file move, sidecar moves and announce.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 writeDocument, the document form type, form conversion, document kinds and move/trash live under content/; admin/documents.ts keeps routes and rendering
- [x] #2 writeDocument is split into validation, identity (slug and permalink) and persistence steps, and the rename-with-rollback stays one unit
- [x] #3 Existing admin and Micropub tests pass unchanged in behaviour
- [x] #4 No module under micropub/ imports the document write path, document kinds or editor form from admin/
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. content/document-kind.ts: DocumentKind (type, singular, dated, tagged, categorised, excludable, contactable), POST_KIND, PAGE_KIND. Admin keeps the screen knobs: DocumentScreens extends DocumentKind with section, basePath, plural; POST_SCREENS and PAGE_SCREENS. Admin callers (routes, menu, media, federation, comments, editor-actions, web/admin-bar) move to the screens.
2. content/form-error.ts: EditorField, Refusal, FieldError (the refusal shape the write path and the field resolvers return); editor-layout imports them.
3. git mv admin/{location,photo,read,event,enclosure}-field.ts to content/*-form.ts. Content keeps the form types, blank forms, document-to-form conversion and resolvers; the admin *-field.ts files keep only HTML field names, body readers and editor views.
4. content/document-form.ts: EditorForm, COMMENT_SETTINGS, EXCLUDE_KEY, CITATION_FIELDS, citationFields, blankForm, formFor, splitTags, ResolvedMedia, extraFromForm (was resolveExtra), formInReplyTo (was replyTo). The module TASK-353 builds its field table on.
5. content/write.ts: writeDocument split into checkForm (validation, refusal order unchanged), resolveIdentity (slug, filed day, permalink, target path) and persist (conflict check, occupied target, front matter, rename-with-rollback as one replaceFile unit, sidecar moves, announce). DocumentSite, DocumentWrite, WriteOutcome, Conflict, missingAltText exported. documentSite(c) stays in admin (it reads the request).
6. content/trash.ts: moveDocumentFile, MoveSite, MoveOutcome.
7. admin/documents.ts keeps routes, submittedForm, rendering, conflict view, author choices, listing.
8. micropub/create, update, endpoint and comments/reply-post import from content.
9. content/save.ts saveDocument writes through files/atomic writeFileAtomically (atomic, per-path queue, refused during a handover).
10. Public exports: index.ts re-exports the moved names from content/index.ts, adds POST_SCREENS, PAGE_SCREENS, DocumentScreens.
11. Tests for the new seams (write steps) where behaviour is not already covered; verify pnpm build/test/typecheck/lint/format:check.

12. Revision to step 3: the five slim admin *-field.ts files are merged into admin/editor-fields.ts (HTML field names, body readers, editor choices and row views), so their old paths are gone and git records admin/*-field.ts -> content/*-form.ts as five renames rather than copies.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Resumed after the previous agent stopped. State found: steps 1-10 done in the working tree; typecheck, 5537 cms tests, lint and format all green.

Finished:
- Step 3: git saw the moves as copies (C050-C079) because slim admin/*-field.ts files sat on the old paths. Merged the five into admin/editor-fields.ts with one trimmedField reader (util/forms stringOrEmpty) and one rowIndexes reader; documents.ts and preview.ts import it. git status after git add: R admin/{enclosure,event,location,photo,read}-field.ts -> content/*-form.ts.
- Step 11: write.test.ts gains a conflict test (the file changed after the form loaded: outcome conflict, file and index untouched, nothing announced) and an occupied-target test (rename onto another post's file: refused on editor-slug, both files and rows intact). The existing write tests cover checkForm refusal order, rename with rollback, and refusal during a handover.
- Sorted the preview.ts and editor-layout.test.ts imports.

Behaviour notes:
- persist runs learnHandles before taking the old index row out of the way. HEAD removed the row first, so a WebFinger failure during a rename left the old row missing from the index. Covered by 'keeps the old index row when a rename fails before its file is written'.
- saveDocument now writes through files/atomic writeFileAtomically: still atomic, now queued per path and refused under refuseWritesUnder during a handover (WritesRefusedError). writeDocument puts the renamed-from row back when that happens.
- Public API: POST_KIND and PAGE_KIND (still exported) lose section, basePath and plural. Those fields are now on POST_SCREENS and PAGE_SCREENS (DocumentScreens). No plugin, app or doc in the repo reads them.

AC #2 gap: grep -rn "admin/" packages/cms/src/micropub (non-test) still finds endpoint.ts -> admin/accounts (listUsers, User), admin/media (deleteUpload), admin/uploads (largestUploadLimit, refusedUpload, storeUpload, tooLargeMessage, UPLOAD_ENVELOPE_BYTES), admin/settings (readSiteSettings); media.ts -> admin/media (resolveUpload), admin/uploads (refusedUpload, storeUpload, UPLOAD_FIELD). These were all there at HEAD and are outside the plan, which moves only the document write path. All the document write path imports (documents, *-field) are gone from micropub/ and comments/reply-post. content/write.ts and content/enclosure-form.ts also still import admin/accounts and admin/settings. The micropub tests import the admin test harness by design. Needs a decision: widen this task, file a follow-up (overlaps TASK-354 and TASK-359), or reword AC #2.

Validation: pnpm build OK; pnpm test: cms 5539/5539, plugin-wordpress 106, plugin-llm 48, plugin-tag-suggest 31, plugin-post-summary 22, demo 32, 0 failures; pnpm typecheck OK; pnpm lint OK; pnpm format:check OK.

Orchestrator narrowed AC #4 to the document write path, kinds and editor form: grep for admin/documents and admin/*-field under micropub/ is empty. The remaining micropub and content imports of admin/accounts, admin/settings, admin/uploads and admin/media are filed as TASK-364.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Moved the document write path, document kinds, editor form conversion and move/trash from admin/documents.ts into content/ (document-kind, document-form, form-error, write, trash, and five *-form modules). writeDocument is checkForm, resolveIdentity, persist, with rename-with-rollback as one replaceFile unit; saveDocument writes through writeFileAtomically. POST_KIND/PAGE_KIND lose their screen fields, which moved to POST_SCREENS/PAGE_SCREENS. persist now learns handles before dropping the old index row. Verified with pnpm build, test (cms 5539), typecheck, lint and format:check.
<!-- SECTION:FINAL_SUMMARY:END -->
