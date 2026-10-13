---
id: TASK-291.4
title: 'WordPress import: redirects for every URL shape WordPress answered'
status: Done
assignee:
  - '@claude'
created_date: '2026-10-08 11:00'
updated_date: '2026-10-09 18:55'
labels: []
milestone: m-31
dependencies:
  - TASK-282
parent_task_id: TASK-291
ordinal: 251800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Links from elsewhere use URL forms WordPress answers and Geekity does not: /?p=ID, /?page_id=ID, a post's old slug, and an attachment page. The import declares redirects for each, so none of those links breaks.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 /?p=ID and /?page_id=ID answer 301 at the permalink for every imported post and page
- [x] #2 Each _wp_old_slug becomes a redirect_from entry on its post
- [x] #3 An attachment page URL answers 301 at its file under /uploads/
- [x] #4 Redirects the import writes are kept apart from ones the site declared by hand, so a rerun never drops a hand-written one
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Core (decision-33 extension point, nothing names WordPress): the redirect source reads content/_data/redirects.json and then every *.json in content/_data/redirects/, in name order, into one table; the site's own file is read first, so on a duplicate source its entry wins. A redirect file may also be a JSON object mapping each source to its target (301), which is what lets a tool own one key at a time. Tests in packages/cms/src/web/redirects.test.ts.
2. Plugin, posts and pages (AC#1, AC#2): postsAndPages emits entries into _data/redirects/wordpress.json: /?p=ID for every post and page WordPress served publicly (status publish, no password), and /?page_id=ID for every such page, each at the permalink from placements(). Drafts, private, password-protected and scheduled items get none, so a withheld post's ?p= stays indistinguishable from an unknown id (TASK-297). Each _wp_old_slug (and _wp_old_date) becomes a redirect_from entry in the post's front matter, built by replacing the slug (and date) segments of its permalink.
3. Plugin, attachments (AC#3): the attachments importer emits entries for each copied attachment: its attachment page path (item link), /?attachment_id=ID and /?p=ID, each at /uploads/<original>. An attachment whose file was not copied gets no redirect (a redirect to a 404 is worse than the 404).
4. AC#4: the import's redirects live in their own file, owned key by key through the existing entries writer, so _data/redirects.json is never touched and a key the site added or changed in wordpress.json is kept. Test: a rerun leaves a hand-written redirects.json and a hand-added key byte-identical.
5. Served-site tests through createCms for each URL shape; README (core: Declared redirects; cutover); decision-42.
6. Verify: pnpm build/test/typecheck/lint/format:check; real CLI over the andrewshell.org export into a scratch site, serve it, curl ?p=, ?page_id=, old slug, old date, attachment page, ?attachment_id=, and a draft's ?p=.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Built:
- Core (decision-33 extension point, names no WordPress): packages/cms/src/web/redirects.ts reads _data/redirects.json and then every *.json in _data/redirects/ in name order into one table. The first declaration of a source wins (so the site's own file wins), the later one is reported with its file, and loops are found across files. A redirect file may be a list or an object mapping from to to (301), which is what lets a tool own one key at a time. The parse is cached until any file's text changes.
- Plugin: postsAndPages writes /?p=ID for every post and page with status publish and no password, and /?page_id=ID for every such page, into _data/redirects/wordpress.json through the existing entries writer (decision-40), each at its permalink from placements(). Drafts, pending, private, password-protected and scheduled items get none (TASK-297). Each _wp_old_slug and _wp_old_date becomes a redirect_from entry: the permalink's date and slug segments replaced by the old ones, and both together. The attachments importer writes the attachment page link, /?attachment_id=ID and /?p=ID at /uploads/<original>, only for a file it copied.
- decision-42 records the shape. READMEs: core Declared redirects gains 'More than one file'; plugin README gains a Redirects section and a redirect_from row.
- A published post's ?p= is also its activitypub.id, which the federation mount answers before any declared redirect, so a hand-written redirects.json entry for a post's ?p= does not win there (existing core precedence, now in decision-42 consequences). #comment-N fragments cannot be redirected; ?p=ID#comment-N lands on the post and the browser keeps the fragment.
Evidence: test/redirects-import.test.ts (5 tests through createCms: ?p=/?page_id= 301s, withheld ids answer exactly as an unknown id and are absent from the file, redirect_from from old slugs and dates served as 301, attachment page/attachment_id/?p= 301 at /uploads/ and none for an uncopied file, and a rerun leaving a hand-written redirects.json and a hand-changed and a hand-added key in wordpress.json byte-identical, with the changed key reported kept). Core redirects.test.ts gains 4 tests (folder plus map form, redirects.json wins with a warning naming the file, a new file read on the next request, a bad map entry reported).
Real run over andrewshell.org's export (_local, read-only) into a scratch site: exit 0, 267 redirect keys, which a separate Python reading of the export matches exactly (no missing, no extra; drafts 123 and 283 absent). A rerun is byte-identical (540 unchanged) and leaves a hand-written redirects.json untouched; geekity sync exits 0 (178 created). Served with geekity serve and curl: /?p=379 (federated) and /?p=8 (not) 301 at their permalinks; /?page_id=143 and /?p=143 301 at /notes/javascript-object-references/; /?p=522 and the old slug /2026/05/522/ 301 at /2026/05/google-api-wordpress-reader/; the old date /2026/03/symfony-forms-and-radar-part-1/ 301 at /2016/09/...; /rtproxy-jpg/, /?attachment_id=155, /?p=155 301 at /uploads/2012/03/rtproxy.jpg (200); a nested attachment page 301 at its screenshot; /?p=123, /?p=283, /?page_id=283 give the same 200 body hash as /?p=99999. Server stopped, scratch site removed.

Gates on the final tree: pnpm build, typecheck, lint and format:check pass; pnpm test passes (cms 5158, plugin-wordpress 90, plugin-llm 48, plugin-post-summary 17, plugin-tag-suggest 31). AC#1 is read as every post and page WordPress served publicly; withheld ones get no redirect by design (TASK-297).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
geekity import wordpress now declares a redirect for every URL shape WordPress answered. /?p=ID for each published post and page and /?page_id=ID for each published page lead to the permalink, and a page's attachment link, ?attachment_id=ID and ?p=ID lead to its file under /uploads/. These go into _data/redirects/wordpress.json, which the import owns key by key and which sits beside the site's own _data/redirects.json. The import never touches that file. Old slugs and dates become redirect_from on the post. Core gained the generic piece: it reads every file in _data/redirects/ after redirects.json, and accepts a from-to object form (decision-42). Drafts and other withheld items get no redirect, so their ?p= reads as an unknown id. Verified by 5 plugin and 4 core tests through the served app, and by the real andrewshell.org export: 267 keys matching an independent read of it, a byte-identical rerun, sync exit 0, and curl of every shape against geekity serve.
<!-- SECTION:FINAL_SUMMARY:END -->
