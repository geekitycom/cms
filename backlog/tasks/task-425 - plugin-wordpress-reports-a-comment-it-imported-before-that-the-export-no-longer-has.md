---
id: TASK-425
title: >-
  plugin-wordpress reports a comment it imported before that the export no
  longer has
status: Done
assignee:
  - '@claude'
created_date: '2026-10-19 01:14'
updated_date: '2026-10-19 01:57'
labels:
  - bug
milestone: m-31
dependencies: []
references:
  - packages/plugin-wordpress/src/comments-import.ts
  - packages/plugin-wordpress/src/content-import.ts
priority: medium
ordinal: 362800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
geekity import wordpress merges comments by id and never deletes, so a rerun keeps every comment an earlier run imported. When a comment leaves WordPress between two imports, the Geekity copy stays with no sign that anything changed. This happens without anyone deleting by hand: a fediverse boost or like that is undone (an Undo Announce or Undo Like) makes the WordPress ActivityPub plugin delete the comment. Example: a hashtag relay boosts a post, the author retags the post, the relay undoes its boost and boosts under the new tag. WordPress then shows one boost, and Geekity shows two after the rerun. The same goes for a comment moved to spam or trash, or unapproved, after it was imported. A site that reruns the import to catch up before switching over (the documented migration path) carries these stale reactions forward. Proposal: when a comment the import recorded in its state is missing from the export, or is now spam, trash or unapproved there, report it as a row (for example 'gone') naming the post and the comment. Remove it by default when the Geekity copy is still migrated and untouched (its canonical hash matches the one the import recorded), so the rerun converges on WordPress. An edited copy stays and is reported. A comment Geekity received itself is never touched.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A rerun after a previously imported comment left the export (deleted, spam, trash or unapproved) reports that comment in its own row, naming the post and the WordPress comment id
- [x] #2 Such a comment is removed by default, with no flag, when the Geekity copy is still migrated and its canonical hash matches the one the import recorded; it leaves the post's comments file, its record entry goes, and the totals line counts it
- [x] #3 Comments Geekity received itself, and imported comments edited on the site (hash differs from the record), are never removed; an edited one is reported as kept
- [x] #4 A test covers an undone boost: two imports, the second export lacking the comment
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. feat(cms): add PluginSite.removeComment(id) wired to the core deleteComment (plugin.ts, plugins/site.ts), with a test in plugins/site.test.ts and a line in docs where PluginSite methods are documented.
2. plugin-wordpress record: alongside record.comments (file -> key -> sha256), record commentPermalinks (file -> permalink) and commentWordPressIds (file -> key -> WordPress comment id) for every comment the import writes or adopts. Both are optional in import.json, so older records still read.
3. ImportedComment carries its WordPress id. The comments importer also reports every post placement with a permalink, so a post with no comments left still maps to its comments file and item.
4. After the per-post writes (which run the 0.2.0 carry-over), a pruning pass goes over every file in record.comments. For each recorded entry not imported this run (a former-id entry is matched as repliesKey(formerId)): if the Geekity copy is missing, drop the entry; if it is migrated and its canonical sha256 equals the recorded one (with the 0.2.0 id and reply mapping for former entries), removeComment, drop the entry, row 'removed'; otherwise row 'kept' and leave it. Rows name the WordPress comment id, or the comment key for records without one.
5. New outcome 'removed' in the totals line and README outcome table; ReportRow.item becomes optional for a post missing from the export; formatter prints empty type/id and the permalink as title.
6. Tests first: undone boost across two imports, spam/trash, edited copy kept, native comment untouched, post now with zero comments, post gone from the export, 0.2.0 carried keys.
7. Update README rerun prose; run the full check set.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Decision (user, 2026-10-18): remove by default, no --prune flag. 'Untouched' means the comment's canonical sha256 still equals the one content-import.ts records per comment (record.comments).

Blocked (2026-10-18): PluginSite (packages/cms/src/plugin.ts) has no way to remove a comment: only comments(), putComments() (upsert, never drops) and renameComments(). The core has deleteComment(records, id) in packages/cms/src/comments/records.ts:492 (drops it from the file under the file lock and from the admin index), but it is not exposed to plugins. Per instructions, stopped before adding new plugin API surface. Other gaps found: (1) record.comments is keyed by comments file and comment key (a 16-hex repliesKey), so a gone comment's WordPress comment id cannot be named in its row without recording it (e.g. a new record map key -> WP id; older records would fall back to the key); (2) ReportRow.item is a WordPressItem, so a post absent from the export has no item for its rows; (3) writeComments runs only for permalinks with comments in this export, so pruning needs a pass over every record.comments file, mapping the file back to a permalink (or a removal call keyed by id alone, as deleteComment is).

Unblocked by coordinator 2026-10-18: added PluginSite.removeComment(id) wired to core deleteComment (feat(cms) part: packages/cms/src/plugin.ts, plugins/site.ts, plugins/site.test.ts). docs/ lists no PluginSite methods individually (only the type row in docs/public-api.md), so the TSDoc in plugin.ts is its documentation.
Built: import.json gains optional commentPosts (file -> permalink) and commentWordPressIds (file -> key -> WordPress id), written for every recorded comment; older records still read. The comments importer reports every post placement (ImporterOutput.posts) so a post with no comments left still maps file -> permalink -> item. pruneComments runs after the per-post writes and carry-over, over every file in record.comments: an entry not imported this run whose copy still hashes to the record is removed via site.removeComment (row 'removed'); one that differs is 'kept' and stays recorded, so each rerun reports it; one already gone here just leaves the record. 0.2.0 former-id entries are matched as repliesKey(formerId), hashed with the 0.2.0 id and reply mapping, and their WordPress id is read from the former id. New 'removed' outcome in totals and README; ReportRow.item optional for a post no longer imported (row names the permalink, sorted last).
Fallbacks: records written before this version have no WordPress id, so a row names 'comment with key K'; AC#1 holds for records written by this version (and 0.2.0 records, whose former id carries it). A pre-this-version record for a post the export no longer has at all has no recorded permalink, so its comments are not checked. The untouched test is the hash alone: the import writes every comment migrated, so a match means still migrated; a 0.2.0 comment (written without migrated) matching its 0.2.0 hash is removed too.
Verified: pnpm build, test (cms 6252, plugin-wordpress 122 pass), test:11ty, typecheck, lint, format:check all green.

On 'unapproved': the import maps WordPress approved=0 to a pending comment (unchanged behaviour), so a comment unapproved on WordPress is not gone from the import. A rerun rewrites an untouched copy as pending ('written'), which moves it back into moderation; it is not removed.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
A rerun of geekity import wordpress now removes an imported comment that left WordPress (deleted, spam or trash) when the Geekity copy still hashes to what the import recorded, reports it as a 'removed' row naming the post and WordPress comment id, and counts it in the totals; an edited copy is reported 'kept' and stays; comments the site received are never in the record and never touched. Adds PluginSite.removeComment(id) in @geekity/cms. Covers posts with no comments left, posts no longer in the export, and 0.2.0 former-id records. Verified by new tests in packages/plugin-wordpress/test/comments-import.test.ts (undone boost over two imports, spam/trash, edited/native, empty post, gone post, 0.2.0) and packages/cms/src/plugins/site.test.ts, plus the full check set.
<!-- SECTION:FINAL_SUMMARY:END -->
