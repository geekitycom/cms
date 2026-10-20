---
id: TASK-431
title: Read posts are removed from the CMS
status: Done
assignee:
  - '@claude'
created_date: '2026-10-20 01:15'
updated_date: '2026-10-20 01:32'
labels:
  - content
  - micropub
milestone: m-40
dependencies: []
references:
  - packages/cms/src/content/read.ts
  - packages/cms/src/content/read-form.ts
  - packages/cms/src/micropub/indiebookclub.test.ts
  - docs/micropub.md
priority: medium
ordinal: 368800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Read posts (`read-of`, `read-status`) are being replaced by reviews: logging a book through Want to read, Reading and Finished as linked posts was judged too complicated, and a Book review covers what the site needs. No production site has read posts and indiebookclub is not in use, so remove the support outright instead of hiding it. This is a breaking change; the package is 0.x, so it lands as a `feat!` commit.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The editor has no Read section and no read fields
- [x] #2 Post type discovery no longer reports a read; a post with `read-of` is discovered as whatever its other properties make it
- [x] #3 A Micropub create or update with `read-of` or `read-status` treats them like any other property the CMS does not recognize, and `q=source` and the fields list no longer describe them
- [x] #4 Templates, the read summary line, feeds and federation no longer render read-specific output
- [x] #5 The read code, its form handling and its tests (including the indiebookclub replay) are deleted, not left unused
- [x] #6 docs/micropub.md and any other docs no longer describe read posts
- [x] #7 The commit that removes them is marked breaking (`feat!` or a BREAKING CHANGE footer)
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Tests first for the new behaviour: post type discovery reports a post with read-of/read-status as a note (or whatever else it is); a Micropub create with read-of/read-status keeps them as unrecognized properties and q=config no longer lists a read type; the editor renders no Read section.
2. Delete content/read.ts, content/read-form.ts and their tests, micropub/indiebookclub.test.ts, web/read-cover.test.ts and web/read-listing.test.ts.
3. Remove every caller: READ_FIELD in post-fields, the read form fields in document-form, write.ts resolveRead and the slug fallback, preview.ts, admin documents/editor-actions/editor-layout and the editor.njk Read section, post-type ('read' type and the read line in summaries), excerpt, web/context (read context), feed-item, federation/article (read line, cover attachment, note heading special case, OBJECT_TYPE_OF), webmention/service (read-of url target), micropub create/endpoint (property names, q=config post type), plugin.ts PostType union, plugin-post-summary's read skip, default theme post.njk/post-list.njk/style.css.
4. Delete helpers left with no caller or one caller after the removal (e.g. photo-form helpers used only by read-form).
5. Update fields-golden.json and other tests that used reads; update docs/micropub.md, docs/theme/page-shell.md, docs/theme/template-context.md and any other docs.
6. Verify: pnpm build, test, test:11ty, typecheck, lint, format:check; curl a Micropub create with read-of on the running demo.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Removed read posts outright.
- Deleted content/read.ts, content/read-form.ts and their tests, micropub/indiebookclub.test.ts, web/read-cover.test.ts, web/read-listing.test.ts and themes/default/partials/read.njk.
- Removed READ_FIELD from post-fields, readStatus/readOf from EditorForm, ResolvedMedia.read, resolveRead and the read-of slug fallback and the read-description refusal in write.ts, the read preview, the editor's Read section and its open-group rule, 'read' from PostType/PluginPostType/DRAFT_NOUNS/OBJECT_TYPE_OF, the read q=config entry, read-of/read-status from micropub Property, the read-of webmention target, the read line in post labels, feeds, excerpts and federated content, the cover attachment, the titled-read Note heading special case, and the theme's read partial, CSS and listing placement.
- Dead code left by the removal and also deleted: postExcerpt and the template context's excerpt key (it existed only to leave out the read line; the default listing prints summary again), withoutClientReadSummary in the Micropub endpoint, sameWords in federation/article, and plugin-post-summary's offersDescription (its only rule was no description on a read). isLibraryImage and photoOf lost their outside callers and are no longer exported.
- FEED_ITEM_REVISION left at 14: no deployed site has a read post, so no feed's bytes change and a bump would move every site's ETag for nothing.
- read-of/read-status are now kept like any unrecognized Micropub property (data/kept-properties.json, answered as sent by q=source). A form create with only summary + read-of + read-status is refused with 'does not understand read-status, read-of, and the post has nothing else to publish', the same answer as for any other unknown property.
- New tests: post-type.test (read-of is a note/bookmark/article by its other properties), kept-properties.test (create, update and q=config), posts.test (no read fields; an editor save keeps read-of/read-status in the file untouched), editor-layout.test (no read fields), feed-item.test and article.test (no read line, no cover attachment). Golden fields file regenerated; its diff only removes the read frames.
- Docs: micropub.md (properties table, read paragraph, q=config list), theme/page-shell.md, theme/template-context.md (read and excerpt keys), theme/README.md, federation.md, media.md, plugin-post-summary README.
- Verified: pnpm build, pnpm test (cms 6215 pass), pnpm test:11ty, pnpm typecheck, pnpm lint, pnpm format:check all pass. Curled a served site: JSON Micropub create with read-of/read-status -> 201, post file holds only content, kept-properties.json holds both, q=source returns them as sent, update -> 204 and changes only the kept copy, q=config lists note..bookmark, event with no read, page/RSS/Atom/JSON feeds carry no read markup, AS2 object is a Note with content <p>Loved it.</p> and no attachment.
- AC #7 is proven by the orchestrator's commit, which lands this as feat(cms)!.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Removed read posts (read-of/read-status) from the CMS: the read modules, form handling, editor section, post type, Micropub mapping and q=config entry, read line in pages/listings/feeds/federation, read cover attachment, theme partial and CSS, and their tests including the indiebookclub replay. read-of and read-status are now kept like any other unrecognized Micropub property. Also deleted code that existed only for reads (postExcerpt and the excerpt template key, the endpoint's read-summary strip, plugin-post-summary's offersDescription). Docs updated. Verified with the full build/test/11ty/typecheck/lint/format gate and by curling a served site's Micropub endpoint, page, feeds and AS2 object. Breaking change; lands as feat(cms)!.
<!-- SECTION:FINAL_SUMMARY:END -->
