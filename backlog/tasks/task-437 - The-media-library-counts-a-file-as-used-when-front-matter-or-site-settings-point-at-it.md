---
id: TASK-437
title: >-
  The media library counts a file as used when front matter or site settings
  point at it
status: Done
assignee:
  - '@claude'
created_date: '2026-10-20 14:04'
updated_date: '2026-10-20 14:14'
labels:
  - admin
  - media
dependencies: []
references:
  - packages/cms/src/admin/media.ts
  - packages/cms/src/media/library.ts
priority: high
type: bug
ordinal: 374800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
On shll.me the media library badges every file "Unused", including a review poster and book covers that published reviews show, and the site icon. The library only counts a document whose body mentions the upload (`mentionsUpload(document.body, url)` in packages/cms/src/admin/media.ts). Front matter (photo posts' `photo` list, a review's `item.photo`, `featured`/cover images, any other front-matter value naming an upload) and site-level uses (the site icon, user avatars and any other setting that stores an upload path) are never looked at. So the "Unused" badge and filter are wrong. Worse, Delete skips its "this file is still used" confirmation for files that are in use.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A file named by any front-matter value of a live or trashed document (photo list, review item picture, cover, nested values) is listed as used by that document
- [x] #2 A file used by the site itself (the site icon, a user avatar, any setting that stores an upload) is listed as used, saying by what, with a link to where it is set
- [x] #3 The Unused badge and the Not used anywhere filter follow the same answer
- [x] #4 Deleting a file used only through front matter or a setting asks for confirmation as a body reference does
- [x] #5 A file that nothing uses is still Unused
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Failing tests in packages/cms/src/admin/media.test.ts for each AC: front matter (photo list, review item.photo.url nested, trashed doc), variant and absolute URL forms, the site icon and a user avatar named with a link to where they are set, the Unused badge and filter, Delete confirmation for front-matter-only and setting-only uses, and a file nothing uses staying Unused.
2. media/library.ts: replace mentionsUpload(body, url) with usesUpload(text, relative), which matches the upload URL, its percent-encoded spelling and its variant directory (/uploads/_/<path>), plus usageText(value) that flattens any value (strings, arrays, objects) into one searchable text.
3. admin/media.ts: one list of reference sources per request. Each document (live and trashed) contributes its body plus every front-matter value (modelled fields and extra, not the rendered html). Site-level sources: every non-secret setting in the settings registry (labelled by the settings page that carries it, the old site avatar under General, anything else linked to Settings) and every user profile (linked to that user's screen). Text is flattened once per source, so the library still computes references once per request over listAll.
4. MediaReference gains a where label (document path, or Settings > General, or the user screen); templates show it; the Delete confirmation says how many things use the file rather than documents.
5. Docs: docs/media.md (and doc-5 if it describes references).
6. Verify with the full check suite and a browser run against a scratch site with a review, a photo post, a site icon and an avatar.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Root cause: references came only from mentionsUpload(document.body, url). Now admin/media.ts gathers one list of ReferenceSource per request (referenceSources): each live and trashed document (body plus every front-matter value: modelled fields and extra, not html/hash/path), every non-secret setting in the settings registry whose value holds /uploads/, and each user's avatar and the rest of their profile. Each source's strings are flattened once (usageText), and every file is checked against that list with usesUpload(text, relative), which matches the upload URL, its percent-encoded spelling and its variant directory /uploads/_/<path>; an absolute URL contains the site-relative one. Library, details, Unused badge, unused=1 filter and the Delete confirmation all read the same referencesAmong(sources, path).
Labels: icon -> 'The site icon', Settings › General (/admin/settings); legacy site avatar -> filed under General; other site settings -> the settings page whose fields list them; non-site namespaces (plugins) -> /admin/settings with 'The <ns> setting <key>'. Users -> '<name>’s avatar' / '<name>’s profile', /admin/users/<id>.
MediaReference.path is replaced by where (document path or the screen that sets it); referencesTo removed from admin/index (no other callers). Template: 'Nothing links to it.' is now 'Nothing uses it.'; confirmation counts things, not documents.
Not covered: hand-written JSON data files under content/_data other than settings (redirects.json, syndication, comments) are not read; none of them is written with an upload path by the CMS.
Settings are read with registry.get per declared setting, once per request (sync reads of small JSON files).
Verified: pnpm build, pnpm test (cms 6317 pass), pnpm test:11ty, pnpm typecheck, pnpm lint, pnpm format:check all pass. New tests failed with the old admin/media.ts and pass now. Browser (Playwright, scratch site on :3437 with a review item.photo.url poster, a photo post, site.json icon, an avatar set through the user profile form, one unused file): only lonely.png badged Unused and only it in unused=1; Used by shows A Film, Beach, 'The site icon · Settings › General' -> /admin/settings, 'andrew’s avatar · Users' -> /admin/users/1; Delete on the icon and on the poster shows the confirmation.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
The media library now answers 'what uses this upload' in one place over documents (body and every front-matter value, live and trash), site settings (registry, secrets skipped) and user profiles, matching the URL, its percent-encoded form and its derived-image directory. Site-level uses are labelled and linked to where they are set (Settings › General for the icon, the user's screen for an avatar). The Unused badge, the unused filter and the Delete confirmation share that answer, still computed once per request. Verified with new tests in src/admin/media.test.ts, the full check suite, and a Playwright run against a scratch site with a review poster, a photo post, a site icon and an avatar.
<!-- SECTION:FINAL_SUMMARY:END -->
