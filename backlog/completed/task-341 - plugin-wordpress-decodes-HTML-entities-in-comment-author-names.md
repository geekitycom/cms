---
id: TASK-341
title: plugin-wordpress decodes HTML entities in comment author names
status: Done
assignee:
  - '@claude'
created_date: '2026-10-11 02:31'
updated_date: '2026-10-11 03:16'
labels:
  - bug
milestone: m-31
dependencies: []
priority: low
ordinal: 300800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Seen on the andrewshell.org import with plugin-wordpress 0.3.0. WordPress stores comment_author with HTML entities when it came from a webmention or pingback title, e.g. 'Cry me a river &#8211; Andy Sylvester&#039;s Web' and 'Wait, you can use WordLand &#8211; daveverse' (6 records on that import). WordPress prints the field as HTML, so a reader sees an en dash and an apostrophe. The importer copies it as plain text, and the theme escapes it again, so the page shows '&#8211;' and '&#039;' literally (title attribute and link text both). Proposal: decode HTML entities in comment_author (and any other WXR comment field copied as text, such as the author URL) when importing, so the stored name is the text WordPress displayed. A rerun picks up the decoded name in place, as it does for other fields of an imported comment.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 An imported comment's author name holds the decoded text (an en dash, an apostrophe), never an HTML entity
- [x] #2 On the andrewshell.org import, post 501 shows 'Cry me a river – Andy Sylvester's Web' as the author, with no literal &#8211; or &#039; in the page
- [x] #3 A rerun over a site imported with 0.3.0 rewrites the six names in place
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Data shape: the parsed WordPressExport holds text as WordPress displayed it. Fields WordPress stores as escaped HTML text (comment_author, post title, term name, author display name) are decoded once at the WXR boundary (wxr.ts FieldReader), with entities' decodeHTML (already in the tree via markdown-it; added as a direct dependency, bundled). URLs (comment_author_url, link) are not decoded: WordPress stores them raw via esc_url_raw, and decoding would break a query such as ?a=1&copy=2.
2. Failing tests first: comment author with &#8211;/&#039; stored decoded and shown on the post page without literal entities; post title and term names with &amp; decoded in front matter; a rerun over a site holding the entity-laden name (as 0.3.0 wrote it, record and all) rewrites it in place, while a comment the site edited is kept.
3. Rerun: content-import's decide() already treats held === recorded hash as the import's own earlier write and rewrites it; no change expected there, proven by test and by a v0.3.0 worktree import then a re-import with the new code.
4. AC#2: scratch import of the andrewshell.org WXR, serve, curl post 501.
5. pnpm build/test/typecheck/lint/format:check.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Decoded at the WXR boundary (wxr.ts): FieldReader.displayed() runs entities' decodeHTML (v8, already in the tree through markdown-it, now a direct dependency of plugin-wordpress and inlined in the bundle) over the fields WordPress stores as HTML and prints unescaped: comment_author, post title, term (tag/category) names, author display name. Not decoded: comment_author_url and link, which WordPress stores raw (esc_url_raw); decoding a URL would turn ?a=1&copy=2 into a ©. On the andrewshell.org export only the six comment author names carry entities (no imported post title or term name does; the entity-laden titles are ap_inbox items the import skips), so titles and terms change nothing there.
Rerun: no change to content-import.ts was needed. decide() sees the held comment equal to the hash the 0.3.0 import recorded, so it is the import's own earlier write and is rewritten ('changed on WordPress since the last import'); a comment the site edited no longer matches its record and is kept as a conflict.
Tests: comments-import.test.ts 'a name WordPress stored as HTML (TASK-341)' (decoded name incl. en dash, ’, &#039;, &#x1fa77;; post page holds no entity; rerun over a 0.3.0-shaped name rewrites it, a site-edited one is a conflict and stays), posts-import.test.ts title and term names. All three red before the change.
Real WXR: scratchpad/site341a fresh import served on dist/cli.js: /2026/04/blurt-marketing-gone-wrong/ shows 'Cry me a river – Andy Sylvester&#39;s Web' (the theme's escape of the apostrophe) as link text and title attribute, and no &#8211;, &#039; or &amp;# anywhere in the page. scratchpad/site341b: plugin-wordpress 0.3.0 (git worktree at plugin-wordpress-v0.3.0, its own core) imported the WXR (six entity names stored); one name edited on the site by hand; the new code re-imported: 5 written (the five unedited names, now decoded), 1 conflict (the edited one, kept), 433 unchanged; the comment files then match the fresh import byte for byte except the edited name; a third run 0 written. Server stopped, worktree removed.
Checks: pnpm build, pnpm test (cms 5429, plugin-wordpress 104, all packages 0 fail), pnpm typecheck, pnpm lint, pnpm format:check pass.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
plugin-wordpress now stores every WXR field WordPress keeps as HTML text (comment author, post title, tag and category names, author display name) as the text WordPress displayed, decoding entities once at the WXR boundary with the entities package's decodeHTML; URLs stay as stored. A rerun over a 0.3.0 import rewrites the entity-laden names in place through the existing hash record, and keeps a name the site edited. Verified by new tests (red before), the full pnpm build/test/typecheck/lint/format:check, a fresh import of the andrewshell.org WXR served and curled (post 501 shows the decoded name, no entity), and a real 0.3.0 import re-imported with the new code (5 written, 1 site-edited conflict kept, then 0 written).
<!-- SECTION:FINAL_SUMMARY:END -->
