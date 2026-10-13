---
id: TASK-291.2
title: >-
  WordPress import: media moves to /uploads/ and every old media URL still
  answers
status: Done
assignee:
  - '@claude'
created_date: '2026-10-08 11:00'
updated_date: '2026-10-09 18:06'
labels: []
milestone: m-31
dependencies:
  - TASK-282
parent_task_id: TASK-291
ordinal: 249800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A WordPress export lists attachments but carries none of the files, and post bodies point at https://<site>/wp-content/uploads/... (often on a staging host the site was built on, and often at a -1024x575 size variant). The import copies the original of each attachment from a local copy of wp-content/uploads into content/uploads/, points every body at the original, keeps alt text, and keeps old media URLs answering for links from elsewhere.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 geekity import wordpress takes an uploads directory option; each attachment original is copied to content/uploads/ at its YYYY/MM/ path
- [x] #2 WordPress size variants (-WxH, -scaled) are not copied; a body or link that points at a variant is pointed at the original, since Geekity makes its own variants
- [x] #3 Body URLs on the site origin or on any extra origin given as an option (a staging host) are rewritten to /uploads/... root-relative paths
- [x] #4 _wp_attachment_image_alt is written to _data/media.json
- [x] #5 A request for /wp-content/uploads/<path> answers 301 at the /uploads/ URL of the same file, or of its original for a size variant, without one redirects.json entry per file
- [x] #6 A referenced file missing from the uploads directory, or one over the upload limits or of a refused type, is named in the report
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Core extension point (decision-33), its own feat(cms) commit: PluginSite.checkUpload(name, bytes) holds a file to the editor's upload rules (the site's allowed types, size limits, the format's leading bytes, metadata stripped) and answers the bytes to store or why the site refuses it. storeUpload and checkUpload share one acceptUpload so the two cannot disagree.
2. src/media.ts: a WordPress media library built from the export and the command options. Each attachment's original is its _wp_attached_file with any -scaled removed. originalOf(uploads path) maps an exact attachment, or a -WxH / -scaled variant of one, to the original. rewriteUploads(text) rewrites absolute, scheme-relative and root-relative /wp-content/uploads/ URLs on the site's origin or any --origins host to root-relative /uploads/<original>.
3. Media importer claims attachment: copies each original from --uploads <dir> to uploads/<path>, through site.checkUpload; a missing, refused or uncopied (no --uploads) file is a warned note. An upload a post body references that is no attachment is copied too when present, else named missing. _wp_attachment_image_alt goes to _data/media.json.
4. Writer: ImporterOutput.settings generalises to entries (file, key, JSON value), so site.json homepage and media.json alt text are both owned per key (decision-39 rule); import.json records entries per file.
5. posts-import rewrites the converted body with rewriteUploads just after convertBody.
6. Plugin route GET /wp-content/uploads/* answers 301 at /uploads/<same path>, or at the original when the import record holds an original for a variant; query kept. No redirects.json entry.
7. Tests first per AC; real CLI over the real export and uploads snapshot into a scratch site, curl old media URLs; README; decision-40.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Built:
- Core (decision-33 extension point, commit separately as feat(cms)): PluginSite.checkUpload(name, bytes) answers { accepted, bytes } with metadata stripped, or { accepted: false, why }. It runs acceptUpload, extracted from storeUpload in admin/uploads.ts, so the editor and a plugin cannot disagree about what the site takes. Test: packages/cms/src/plugins/site.test.ts.
- src/media.ts: wordPressMedia(export, --origins) knows each attachment original (_wp_attached_file minus -scaled), maps an attachment or its -WxH / -scaled variant to the original, and rewrites absolute, scheme-relative and root-relative /wp-content/uploads/ URLs on the export's hosts or an --origins host to /uploads/<original>. Other hosts are left alone.
- src/media-import.ts: the attachments importer. Copies each original from --uploads through site.checkUpload to uploads/<path>; an upload a post shows that is no attachment is copied for that post. Missing, refused or no --uploads: a warned row naming the file and why. Alt text goes to _data/media.json.
- content-import.ts: ImporterOutput.settings became entries (file, key, JSON value), so site.json homepage and media.json alt keys share the per-key ownership rule; import.json keeps them under entries by file.
- posts-import.ts rewrites the converted body with media.rewrite, so Markdown images and kept HTML both change.
- src/media-redirect.ts: plugin route GET /wp-content/uploads/* answers 301 at /uploads/<path>, or at the original import.json records for a variant; query kept; no redirects.json entries.
- decision-40 records the choices. READMEs updated, including the cutover's step 6: disabling the plugin ends the media redirects.

Evidence:
- test/media-import.test.ts (9 tests): originals copied and variants not (#1, #2), body rewrite on site, --origins staging, root- and scheme-relative, foreign host untouched (#2, #3), media.json alt kept beside a site's own key and unchanged on rerun (#4), missing file and no --uploads named (#6), CLI with real core rules refusing an over-limit PNG and an .svg (#6), 301s on a booted site incl. variant, -scaled-WxH, an original named like a variant, unrecorded path, query (#5), no redirects.json (#5).
- Real CLI over andrewshell.org's export with --uploads _local/snapshot/wp-content/uploads --origins https://staging.andrewshell.org: exit 0, all 25 attachments written, alt text for screenshot-1.png in media.json, no /wp-content/uploads URL left in posts or pages, all 22 distinct /uploads/ references resolve to a file; posts 461, 475, 813 point at the originals. Second run: 205 unchanged and the content tree byte-identical. geekity sync exits 0. 6 files differ from WordPress's bytes because metadata was stripped (the phone photo img_8587 and the 2026/04 screenshots); the rest are identical.
- Served the scratch site with the plugin enabled; curl: /wp-content/uploads/2026/04/max-headroom-1024x575.jpg, ...-8.51.29-AM-1024x690.png, img_8587-1-768x1024.jpg, screenshot-1-300x218.png and rtproxy.jpg each answer 301 at the /uploads/ original, which answers 200 with the image; a ?ver=3 query is kept. Server stopped, scratch sites deleted.
- pnpm build, test (cms 5149, plugin-wordpress 74, all pass), typecheck, lint, format:check pass. One full-suite run hit a timing failure in migrated-site.test.ts ('the watcher indexed already-announced'); it passed 3 of 3 alone and on the full rerun.

Seen, not mine: the first geekity sync over a site with no accounts prints 'A delivery failed ... the site has no accounts' for federated imported posts, and exits 0.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Media now moves with geekity import wordpress. --uploads copies each attachment's original to content/uploads/YYYY/MM/ through a new core PluginSite.checkUpload, so the site's types, limits and metadata stripping apply. Body URLs on the site, an --origins host or root-relative point at /uploads/<original>, variants included. Alt text goes to _data/media.json, owned per key. Missing or refused files are named in the report. A plugin route 301s /wp-content/uploads/* to the /uploads/ original. Verified with test/media-import.test.ts, src/plugins/site.test.ts, the real andrewshell.org export and uploads (25 attachments, a byte-identical rerun, sync exits 0) and curl against the served site; every gate passes. decision-40.
<!-- SECTION:FINAL_SUMMARY:END -->
