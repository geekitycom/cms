---
id: TASK-182
title: Keep commenter emails out of content files (git history)
status: Done
assignee:
  - '@claude'
created_date: '2026-09-29 03:47'
updated_date: '2026-09-29 23:16'
labels:
  - privacy
  - comments
dependencies: []
references:
  - backlog/decisions/decision-9
documentation:
  - doc-6
priority: medium
type: feature
ordinal: 206800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Commenter emails are stored in plain text in content/_data/comments/{slug}.json (author.email, with notify beside it). content/ is in git and is copied into Eleventy builds, so every email a commenter types is committed to the site's repository. The TASK-135 retention sweep and the Tools > Personal data erasure only change the working tree: an email removed from a comment file stays in git history until that history is rewritten, which few site owners will do. The email is private data used only by moderators, the auto-approval rule (name + email), reply notifications and the spam checker, so it does not belong in a published directory. The likely direction is to keep each comment's email in a private file under data/ (mode 0600), keyed by comment id, and leave only public fields in the content file, with retention, erasure, notifications and auto-approval reading from there. decision-9 (files are the source of truth, data/ is private) and doc-6 (Native Comments) describe the current format.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A comment submitted through the form has no email in any file under content/; the email is stored only under data/ with mode 0600
- [x] #2 Existing comment files that carry author.email are migrated on boot: the email moves to data/, the content file no longer contains it, and the migration is idempotent
- [x] #3 Auto-approval by name and email, reply notifications with their unsubscribe link, and the spam checker behave as before, proven by tests
- [x] #4 The retention sweep and Tools > Personal data remove the email from its data/ location and keep the redacted marker behaviour
- [x] #5 Deleting data/geekity.db and rebuilding restores the same emails in the index
- [x] #6 README's personal data table and doc-6 describe where the email now lives, and say that emails committed before the change remain in git history until it is rewritten
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Data shape: the in-memory CommentRecord and the SQLite index keep author.email and notify (the index is private, in data/geekity.db). Only the file serialisation changes. A comment file entry under content/_data/comments/{slug}.json carries no author.email and no notify. A private file data/comments/{slug}.json (mode 0600) holds { comments: { <id>: { email, notify } } } for the entries that have an email.
2. CommentRecords gains a required dataDir; every caller and test passes it (typecheck finds them).
3. records.ts reads a post as content entries merged with the private map (private wins, a legacy email still in the content file is read so nothing is lost before migration), and writes a post by writing the private file first and the content file second, both inside the content file's lock. Private first so a crash between the two leaves the email in one place or both, never in neither.
4. migrateCommentEmails(records) at boot, before rebuildCommentIndexes: for every content file whose raw entries carry author.email or notify, move them into the private file (an entry already there wins) and strip them from the content file, editing the raw JSON so no other key or unparseable entry is lost. A second run writes nothing.
5. Tests first (records.test.ts and friends): form comment leaves no email under content/ and a 0600 private file; migration moves, strips, is idempotent; auto-approval, reply notice with unsubscribe and checker still see the email after the index is rebuilt from files; retention and erasure clear the private entry and keep redacted; deleting the db and booting restores emails in the index.
6. README personal data table and doc-6 describe the new location and that emails committed before the change stay in git history until rewritten.
7. pnpm build, test, typecheck, lint, format:check; curl a running demo to submit a comment and inspect files.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Data shape: CommentRecord and the SQLite index are unchanged and still carry author.email and notify. Only the files changed. content/_data/comments/{slug}.json entries carry neither; data/comments/{slug}.json (0600) holds { comments: { <id>: { email, notify } } } for entries with an email, and is removed when none are left. records.ts is the only reader and writer of both (readPost merges, writePost splits, data/ written first inside the content file's lock).

CommentRecords now requires dataDir, and readComments takes the records (contentDir + dataDir) instead of a content directory. Both are public exports, so this is a breaking API change. Every caller in src passes config.dataDir; RebuildContentIndexOptions gained dataDir.

migrateCommentEmails runs at boot before rebuildCommentIndexes (and so in geekity rebuild). It edits each file's raw JSON, stripping author.email and notify and nothing else; unknown keys and unreadable entries survive. An email with no usable id is dropped rather than kept, since nothing could ever use it. data/ wins on conflict. A second run writes nothing (tested).

Verification: pnpm build, pnpm test (2486 + 31 pass), pnpm typecheck, pnpm lint, pnpm format:check all pass. Mutating readPost to ignore data/ fails 10 tests across records, site and notification suites. Live: served a scratch site on :3917 with a legacy comment file; boot moved grace@legacy.example to data/comments/older.json (-rw-------) and stripped it from content. A curl POST to /_geekity/comments returned 303 ?comment=pending; grep -r of content/ found no email; data/comments/hello.json was 0600 with the email. After stopping the server and deleting data/geekity.db*, a fresh createCms listed both comments with their emails and notify flags.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Commenter emails and the notify flag no longer go into content/_data/comments/{slug}.json. They live in data/comments/{slug}.json (mode 0600), keyed by comment id, and records.ts merges them on read and splits them on write, so the index, auto-approval, reply notices, the spam checker, retention and erasure see the same records as before. Boot migrates legacy comment files idempotently. README (root and package) and doc-6 describe the new location and say that emails committed before the change stay in git history until it is rewritten. Breaking API: CommentRecords requires dataDir and readComments takes the records. Verified with new and updated tests (records, site, notifications, retention, personal data, signed-in), the full build/test/typecheck/lint/format gate, and a live curl submission plus a delete-the-db rebuild on a scratch site.
<!-- SECTION:FINAL_SUMMARY:END -->
