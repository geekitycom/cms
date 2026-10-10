---
id: TASK-329
title: A post whose slug changes may lose its comments
status: Done
assignee:
  - '@claude'
created_date: '2026-10-10 16:57'
updated_date: '2026-10-10 18:23'
labels:
  - comments
dependencies: []
references:
  - packages/cms/src/web/conversation.ts
  - packages/cms/src/admin/store.ts
priority: medium
type: bug
ordinal: 288800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Seen while building TASK-327, not yet reproduced on purpose: after a post on a scratch site was moved, its comments dropped out of the thread and /replies/{commentId}/ 404ed. Threads read comments by slug (listCommentsFor(document.slug), web/conversation.ts; comments are stored per slug in content/_data/comments/{slug}.json), so a permalink change alone should keep them, but renaming the file (which changes the slug) would leave the comments under the old slug. Webmentions, reply posts and fediverse replies are keyed differently (target URL, in-reply-to, object id) and may or may not follow.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The behaviour is reproduced or ruled out for each of: a permalink change, a file rename that changes the slug, and a move to another directory; findings recorded in the notes
- [x] #2 If comments are lost on any of them, they follow the post: native comments, webmentions, reply posts and fediverse replies stay in its thread, its feeds and their /comment/ and /replies/ pages, without a manual step
- [x] #3 A test covers each case that was broken
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Reproduce each case in a test that boots a real site (web/moved-post-thread.test.ts): native comments, a reply to one, a webmention, a fediverse reply and two reply posts (one to the post, one to a comment page); move the post by the editor's permalink field (slug kept, then last segment changed), the editor's slug field, a hand rename of the file, a hand move to another directory, and a rebuild after a rename.
2. Record per case and per surface (page, {permalink}feed/, /comments/feed/, /comment/{id}/, /replies/{id}/, /replies/{key}/) what survives.
3. Where the slug changes, restore the invariant records.ts assumes (a document's comments live in _data/comments/{its slug}.json): move a comment file to the document that owns the permalink the file records. The owner rule is the redirect rule: the document at that permalink, else the one whose redirect_from names it (getByFormerPermalink). Merge by id, content and data halves, remove the old files, reindex the moved rows.
4. Run it on every non-scan content change (editor announce, watcher) for that document's redirect_from slugs, registered before the other change listeners; and sweep every comment file after each full scan (boot start, Cms.sync, admin rescan), which covers rebuilds, offline hand moves and a move cut short between its writes. Scan-origin changes are skipped because a post taking an old URL over may not be indexed yet mid-scan.
5. Correct the records.ts docstring that claimed a slug never changes. Verify with the full suite and a scratch site over HTTP.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Reproduction (web/moved-post-thread.test.ts against the code before the fix, plus a per-surface probe):
- The slug is the permalink's last segment (content/parser.ts slugForPermalink), not the filename. So the cases split by whether the last segment changes, not by whether the file moves.
- (a) Permalink change keeping the slug (editor permalink field /2026/09/hello/ -> /writing/hello/): everything kept. Permalink change of the last segment (-> /writing/greetings/): BROKEN.
- (b) Editor slug change (renames the file and the permalink): BROKEN. Hand rename of the file with the permalink kept: everything kept (slug unchanged).
- (c) Hand move to posts/archive/ with the permalink kept: everything kept.
- In the two broken cases, native comments and stored webmentions vanished from the page, {permalink}feed/, /comments/feed/ and /replies/{postKey}/; /comment/{id}/ and /replies/{id}/ answered 404; a reply post answering a comment page dropped out with its comment. The fediverse reply and a reply post answering the post's old URL survived, because the editor pins activitypub.id to the old URL (keptIdentity) and namesIn matches the root. The editor already writes redirect_from on a move.
- Root cause: comments are filed and indexed by slug (_data/comments/{slug}.json, data/comments/{slug}.json, comments.slug), and records.ts documented the editor as never changing a slug, which it does.

Fix: comments/records.ts followMovedComments (per document, locked on both files in path order) and followAllMovedComments (every file, synchronous). Both use followFile, which merges by id into the owner's file with post set to the owner's permalink, removes the old content and data files, and reindexes only the moved rows. The owner is the document at the file's post permalink, else getByFormerPermalink(post). So a new post that takes the old URL over keeps the file. index.ts subscribes the per-document follow to non-scan changes before the other listeners, and wraps content.start(), Cms.sync() and the admin rescan in scan(), which sweeps after the walk.

Verified: the 13 tests in moved-post-thread.test.ts. Removing the scan guard fails the takeover-through-rebuild test, and removing the post-scan sweep fails the offline-hand-move and cut-short-move tests. pnpm build, test (cms 5359 pass), typecheck, lint and format:check are all clean. On a scratch site under geekity serve (dist/cli.js) I moved the post by hand while it ran (watcher) and again while it was stopped (boot scan). Each time the new URL, its feed/, /comments/feed/, /comment/{id}/ and /replies/{id}/ answered 200 with Ada, Bob and Grace. The old URL answered 301, and _data/comments held only the new slug's file with the new post permalink.

Not covered, out of scope (inferred from code, not reproduced): a hand permalink change with no redirect_from cannot be linked back to its comments. A page that moves keeps its comments with this fix, but a reply post to a page's old URL, and the page's /replies/{key}/, follow the permalink because pages get no pinned id. webmentions_sent rows stay keyed by the old slug. A post that moves while unpublished gets no redirect_from from the editor, so its comments do not follow.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Reproduced: a post whose permalink's last segment changes, by the editor's permalink field or its slug field, lost its native comments and webmentions from the page, its feeds, /comments/feed/ and /replies/, and its /comment/{id}/ and /replies/{id}/ pages answered 404. A permalink change that kept the slug, a hand file rename and a move to another directory lost nothing, and fediverse replies and reply posts to the post's URL survived through the pinned activitypub.id. Fixed by moving a comment file to the document that owns its recorded permalink by the redirect rule (followMovedComments on non-scan changes, followAllMovedComments after every full scan), merged by id, emails included. Verified with 13 tests in web/moved-post-thread.test.ts, the full pnpm build/test/typecheck/lint/format:check, and a scratch site served by geekity serve and moved live and offline.
<!-- SECTION:FINAL_SUMMARY:END -->
