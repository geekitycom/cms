---
id: TASK-291
title: 'geekity import wordpress: a WXR export becomes a content directory'
status: In Progress
assignee:
  - '@claude'
created_date: '2026-10-08 10:59'
updated_date: '2026-10-09 18:06'
labels: []
milestone: m-31
dependencies:
  - TASK-295
  - TASK-282
references:
  - /Users/andrewshell/code/geekity/asdo_geekity/_local/PLAN.md
priority: high
ordinal: 247800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A WordPress site moves to Geekity from its WXR export (Tools > Export) with one command: `geekity import wordpress <export.xml>` writes the posts, pages, media, reactions and redirects into the content directory, so the site answers the same URLs it did under WordPress. Today the only importer is `geekity import wordpress-actor`, which carries the federation identity and none of the content, so every migration hand-writes a converter.

The import is rerunnable: running it again over the same export converges on the same files, so a site can import early, check the result, and import again just before cutover to pick up newer posts. It never overwrites a file it did not write, which lets a site layer its own fixes on top.

The subtasks split it by what is imported. This parent holds the command, the report and the rerun behaviour.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 geekity import wordpress <export.xml> runs against a content directory and exits non-zero, with each problem named, when the file is not a WXR export
- [x] #2 Running the import twice over the same export leaves the content directory byte-identical to one run
- [x] #3 A file the import did not write is never overwritten or deleted; the clash is listed in the report
- [x] #4 The import prints a report with one row per item imported, skipped or warned about, and why
- [x] #5 Items that have no Geekity counterpart (revisions, oembed_cache, nav menus, global styles, ActivityPub plugin internals such as ap_actor/ap_inbox/ap_outbox, contact form feedback) are skipped and counted in the report
- [x] #6 geekity sync over the imported directory exits 0
- [x] #7 packages/cms/README.md documents the command next to "Moving a site off the WordPress ActivityPub plugin", as one cutover
- [x] #8 With TASK-295 dev mode on, an import into a running site with followers makes no outbound request, as the suppression record shows
- [x] #9 The command and everything WordPress-specific in the subtasks ship in @geekity/plugin-wordpress, not in @geekity/cms (TASK-282 #7: nothing in core names WordPress); a generic piece a subtask needs (for example a redirect rule by path prefix) lands in core as the extension point the plugin uses (decision-33)
- [ ] #10 A rerun against a newer export picks up posts, pages, edits, media and reactions added on WordPress since the last run; a file the import wrote and that has since been edited on Geekity is not overwritten, and the report lists it as a conflict with both versions' dates
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Core extension point (decision-33): PluginSite gains contentDir, the absolute content directory, so a plugin command can write into it. Nothing in core names WordPress.
2. Plugin: src/wordpress/wxr.ts parses a WXR export with sax into a typed WordPressExport (site, authors, items with meta, terms and comments). A file that is not XML, not RSS, or carries no wp:wxr_version is refused with every problem named.
3. src/wordpress/importers.ts: the WordPressImporter seam. Each importer claims post types and turns the whole parsed export into file writes and per-item warnings. The list is empty in this task; 291.1-291.4 append theirs. A SKIPPED table names every post type with no Geekity counterpart and why.
4. src/wordpress/write.ts: the writer. A manifest of sha256 per written path in the plugin data folder (import.json) decides each write: new, changed on WordPress, unchanged, clash (a file the import never wrote) or conflict (a file the import wrote, edited or removed on Geekity since). Writes are atomic (.tmp + rename) and recorded one at a time; a file already holding exactly the bytes the import would write is adopted, so a crash between write and record converges.
5. src/wordpress/report.ts: one row per item imported, unchanged, skipped, warned, clash or conflict (with both dates), and counts per outcome and per skipped post type.
6. geekity import wordpress <export.xml> registered beside import wordpress-actor; non-zero exit when the export is refused.
7. Tests first for each AC through a test importer and the real CLI; README cutover section; decision-38 for the import's ownership rule.

Revised during build: a file missing on disk is always written (recorded or not), so removing a conflicted file and rerunning takes WordPress's side; a file edited here that WordPress has not changed is reported as kept, not as a conflict. writeOne delegates to a pure decide(current, recorded, next).
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Built the parent seam in @geekity/plugin-wordpress:
- src/wxr.ts parses a WXR export with sax (new dependency, zero deps, inlined into the bundle) into WordPressExport: site, authors, and items with terms, repeated meta and comments (dates as ISO instants, the zero date as undefined). Anything that is not well-formed XML, not <rss>, or carries no <wp:wxr_version>, or an item missing wp:post_id/wp:post_type, raises NotAWordPressExportError with every problem named.
- src/content-import.ts holds the WordPressImporter seam (it claims postTypes and returns files plus notes over the whole export), SKIPPED_POST_TYPES (revision, oembed_cache, menus, block-theme types, ap_* ActivityPub plugin internals, feedback and more, each with a reason), and the writer. The writer keeps data/plugins/@geekity/plugin-wordpress/import.json, a sha256 per path it wrote, and decides each file as written, unchanged (an unrecorded file already holding the new bytes is adopted, so a crash between write and record converges), kept, conflict (with the file's mtime and the item's post_modified_gmt), or clash. It never deletes and writes atomically (.tmp plus rename, which the watcher ignores). A path outside the content directory, or two importers writing one path, throws.
- src/content-command.ts adds geekity import wordpress <export.xml>: totals, skipped counts by post type, then one TSV row per item (outcome, type, id, title, path, why). IMPORTERS is empty; the subtasks append theirs.
- Core: PluginSite.contentDir (decision-33 extension point; nothing in core names WordPress, which plugin-boundary.test.ts still proves).
- decision-38 records the ownership rule.
Evidence: test/content-import.test.ts, 13 tests covering parsing, refusal with every problem named, byte-identical rerun, clash, the WordPress edit picked up, kept versus conflict with both dates, a removed file written again, crash adoption, the path guard and notes. The CLI tests cover exit 1 on a non-WXR file and on a missing file, and the skip counting. Real CLI over andrewshell.org's 466-item export (_local/, read only): exit 0, 466 rows, counts by type; the folder bundle gives the same result. Hand-made broken exports exit 1 and name each problem. pnpm build, test (cms 5145, plugin-wordpress 49, all pass), typecheck, lint and format:check all pass.
Left open:
- #6 (geekity sync exits 0 over the imported directory) passes today only because nothing is written, which proves nothing. TASK-291.1 proves it over real posts.
- #8 (dev mode, no outbound request) needs posts written into a running site. The parent itself makes no network call. TASK-291.1 proves it with migrated: true posts.
- #10: the conflict half is proved, the pickup half is not. A newer export picks up edits and new files for any importer, and a file edited here is kept and reported with both dates. Picking up posts, pages, media and reactions needs TASK-291.1, .2 and .3. Reactions merge into a shared comments file, so TASK-291.3 must add a merge write beside the whole-file one (decision-38 consequences).
Task stays In Progress until the subtasks land.

TASK-291.1 (posts and pages) landed:
- #6 checked: geekity sync over the real andrewshell.org import (161 posts, 17 pages) exits 0, 'Scanned 178: 178 created, 0 failed'.
- #8 checked: test/import-dev-mode.test.ts boots a site with GEEKITY dev mode on, a follower, webmentions, rssCloud and IndexNow, imports a federated post with a link, a never-federated post and a page while the watcher runs, and finds no outbound fetch and no held entry in data/dev-mode.jsonl; a post first published there afterwards is held as a Create. Real run: the full import into a running dev-mode site with a follower held nothing.
- #10 still open: the posts and pages half holds (posts-import.test.ts 'picks up the posts, pages and edits a newer export carries': an edited post is written as changed on WordPress, a new post and a new page are written new, an untouched page stays unchanged). Media and reactions wait on TASK-291.2 and TASK-291.3.
- ImporterOutput gained optional settings (site.json keys), decided per key like a file (decision-39); import.json now holds files and settings.

TASK-291.2 (media) landed. #10 media half holds: media-import.test.ts 'picks up media a newer export carries and leaves the rest byte-identical' (a new attachment and its alt are written, the old one unchanged, the new post points at the original). #10 stays open for reactions (TASK-291.3). ImporterOutput.settings is now entries (file, key, value) for any JSON object file the site also writes (decision-40); import.json holds them under entries by file.
<!-- SECTION:NOTES:END -->
