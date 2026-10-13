---
id: TASK-278
title: Reach a trashed post in the editor when a live post shares its slug
status: Done
assignee:
  - '@claude'
created_date: '2026-10-06 02:35'
updated_date: '2026-10-06 04:18'
labels:
  - admin
  - trash
milestone: m-28
dependencies:
  - TASK-195
references:
  - packages/cms/src/admin/documents.ts
  - packages/cms/src/content/store.ts
priority: low
type: feature
ordinal: 237800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Since TASK-195 a live post can take the permalink and slug of a trashed one. The editor finds a document by slug, newest first (getBySlug), so a trashed post that shares its slug with a newer live post cannot be opened, restored or deleted from the trash list. Micropub undelete by URL resolves to the live post for the same reason. The trash list should address a trashed document by something unique, such as its path.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 From the trash list, a trashed post whose slug a live post also uses opens in the editor and can be restored or deleted
- [x] #2 Restoring it while the live post holds its URL is refused with the existing message, not a crash
- [x] #3 Editing the live post is unaffected
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Failing tests in web/gone.test.ts: open a trashed post from the trash list while a newer live post shares its slug; restore it from the list when its URL is free; refuse the restore with the TASK-195 message when the live post holds the URL; save it from the trash and keep the file in _trash; open and save the live post at its slug while a later-dated trashed post shares it.
2. Add documentEditorPath(kind, document): the slug URL for a live document, plus ?path=<content path> for a trashed one. Route GET and POST /admin/<kind>/:slug through findEdited, which resolves ?path by getByPath (same kind and slug) and otherwise uses findBySlug.
3. findBySlug prefers a live document over a trashed one.
4. Use documentEditorPath wherever a document is in hand: list rows, editor saveUrl, conflict screen, save and move redirects, and the federation, comments and media screens' edit links. editorPath(kind, slug) stays as the public, live-only address.
5. Leave Micropub undelete by URL as is.
6. Verify with pnpm build/test/typecheck/lint/format:check and curl against a scratch site.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Address: a trashed document's editor URL is /admin/posts/<slug>?path=_trash%2Fposts%2F<file>.md; live documents keep /admin/posts/<slug>. The query is checked against the kind and the slug so it names only that document. The path is unique, so the trash list, the editor form, the refusal redirect and a save of a trashed post all reach the same file. findBySlug now prefers a live document, so a later-dated trashed post with the same slug no longer shadows the live one at /admin/posts/<slug> (AC#3). editorPath(kind, slug) is unchanged because it is exported from @geekity/cms; documentEditorPath is internal.

Micropub undelete by URL is unchanged: the URL names the live post, as TASK-195 recorded. A path address does not fall out of Micropub's URL addressing.

The TASK-195 refusal test in gone.test.ts posted restore to /admin/posts/gone and only reached the trashed post because it was dated later than the live one. It now posts to the trashed post's path address, since the slug URL now opens the live post.

There is no permanent delete in the editor; the trash list's only action on a trashed post is Restore. AC#1's 'deleted' is covered only in that sense.

Restoring a trashed post whose slug a live post shares, at a different URL, leaves two live posts with one slug. The editor opens the newer at /admin/posts/<slug>; the older is then reachable from the listing only through its slug, which names the newer. This is the existing non-unique live slug behaviour, not changed here.

Validation: gone.test.ts 5 new cases, each red before the change (the editor opened the live post, the restore said 'It is not in the trash.', the live-slug edit opened the trashed post). pnpm build, pnpm test (4791 cms + 30 demo pass), typecheck, lint, format:check all pass. Curl against a scratch site served from dist with host lookups failing: the trash list linked both trashed 'gone' posts by path; the path link opened the trashed 'Gone' (in the trash, its own words); restore was refused with 'posts/2026-09-10-gone.md now holds /2026/09/gone/, so this cannot go back there. Change one of their permalinks first.' and the file stayed in _trash; the other trashed post, at a free URL, restored and served 200; /admin/posts/gone still opened the live post. Server stopped afterwards.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
A trashed post whose slug a live post also uses can now be opened, saved and restored from the trash list. The editor addresses a trashed document by its file (/admin/posts/<slug>?path=_trash%2F...), while live documents keep their slug URL; the trash list, the editor's form, the conflict screen, redirects and the federation, comments and media edit links all use the new address. A restore over a live holder is refused with the TASK-195 message. The slug URL now prefers a live document, so a trashed post can no longer shadow the live one there. Micropub undelete by URL is unchanged. Verified by five new cases in web/gone.test.ts (red first), the full build/test/typecheck/lint/format:check run, and curl of the trash flow against a scratch site.
<!-- SECTION:FINAL_SUMMARY:END -->
