---
id: TASK-141
title: Alt text as a first-class field in the media library
status: Done
assignee:
  - '@claude'
created_date: '2026-09-28 23:36'
updated_date: '2026-09-30 03:22'
labels:
  - accessibility
  - media
milestone: m-21
dependencies: []
references:
  - 'https://specification.website/spec/accessibility/image-alt-text/'
priority: high
type: feature
ordinal: 165800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The media library has no alt-text field. When an upload is inserted, the file name is offered as its label (src/admin/uploads.ts), so images end up with alt text such as IMG_2034.jpg or with none. Alt text should be stored with the media item, offered by default when the image is inserted, and checked before publishing. Its absence should be treated as a problem to fix, while decorative images remain possible.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Each media item has an alt-text field that is stored in its file (decision-9) and editable in the media library
- [x] #2 Inserting an image into a post uses the item's alt text, never the file name
- [x] #3 An image can be marked decorative, which renders alt=""
- [x] #4 Publishing a post with an image whose alt is missing shows a warning that names the image; a site can make this block publishing
- [x] #5 Federated attachments carry the alt text as their name
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Data shape: content/_data/media.json, one JSON object keyed by the upload's path under content/uploads/ (2026/09/a.jpg). An entry is {"alt": "text"} or {"decorative": true}; no entry means the item has no alt text. In memory it is a discriminated union AltText = {kind:'described', text} | {kind:'decorative'}. It lives under content/ because alt text is public, irreducible state (decision-9), mirroring replyContexts.json (decision-19); written with updateFileAtomically, read with a bytes-keyed cache.

1. src/images/alt-text.ts: read/parse/write the media file, plus imagesIn(html) (reusing markup.ts's tag parser) and missingAltText(html, library) that lists the images a reader is told nothing about. The post's own alt is the truth for that use; empty alt passes only when the library marks the upload decorative; an <img> with no alt attribute always fails.
2. Media screen (AC1, AC3): per image row, an alt-text field and a Decorative checkbox posting to /admin/media/alt; the row's Markdown uses the stored alt. Deleting an upload forgets its entry.
3. Insertion (AC2): uploadMarkdown embeds an image as ![alt](url) with the library alt, or ![](url) when there is none; never the file name. The editor's upload endpoint returns ![](url) for a fresh upload. Links to non-images keep their name as link text.
4. Publishing (AC4): on a non-draft save, missing images add a warning flash naming each file; config requireAltText (GEEKITY_REQUIRE_ALT_TEXT, default false) turns it into a refusal. New flash kind 'warning' with its own style.
5. Federation (AC5): postObject carries each uploaded image in the body as an Image attachment with url, mediaType and name = its alt; decorative images are left out.
6. Docs: README config table and media section.
Each step test-first; verify with pnpm build/test/typecheck/lint/format:check and curl against a running demo.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Storage: content/_data/media.json keyed by upload path, {"alt": "..."} or {"decorative": true}; no entry means missing. Public, irreducible, so a file under content/ (decision-9), same shape as replyContexts.json (decision-19). src/images/alt-text.ts reads it with a bytes-keyed cache and writes it with updateFileAtomically, keeping other entries; deleting an upload forgets its entry.

Decisions:
- The library's text is what an image is offered with on insertion (media screen Markdown). Once inserted, the post's own ![...](...) is the alt text for that use. The page is not rewritten from the library at render time.
- The editor's upload control now returns ![](url) for a fresh image (it has no library entry yet); links to non-images keep the file name as link text.
- Missing = an <img> with no alt attribute, or an empty alt on anything the library does not mark decorative. Checked on every non-draft save of a post or page. New flash kind 'warning' (store.ts, admin.css --admin-warning). Config requireAltText / GEEKITY_REQUIRE_ALT_TEXT (default false) turns the warning into a 400 refusal that writes nothing.
- Federation: postObject now carries attachments, one Image per picture from content/uploads in the body, mediaType from UPLOAD_MEDIA_TYPES, name = the post's alt. Decorative uploads and images from other hosts are left out. TASK-166 (photo posts) will add front-matter photos to the same attachments.

Validation: pnpm build, test (2548 pass), typecheck, lint, format:check all green. New tests in src/admin/alt-text.test.ts (AC1-4) and src/federation/article.test.ts (AC5), each seen failing first. Updated expectations in editor.test.ts and media.test.ts that asserted the file name as alt text. Curl against a served throwaway site: POST /admin/media/alt wrote media.json; media screen offered ![A red dog-shaped square](...) and ![](...) for the decorative one; editor upload of IMG_2034.png answered ![](/uploads/2026/09/img-2034.png); publishing flashed 'admin-flash-warning ... 1 image has no alt text: img-2034.png'; the page rendered alt="" for the decorative image; the ActivityStreams object carried Image attachments with name; with GEEKITY_REQUIRE_ALT_TEXT=true the publish answered 400 naming img-2034.png and the page stayed 404. Server stopped.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Alt text is now a stored field of each media library item. It lives in content/_data/media.json (decision-9), is edited per picture on /admin/media with a Decorative option, and is what the library's Markdown embeds; a file name is never used as alt text. Publishing a post or page with an undescribed image warns naming each file, and requireAltText makes it a refusal. Federated posts carry their uploaded pictures as Image attachments named with their alt text. Verified with new failing-first tests, the full gate run, and curl against a running site.
<!-- SECTION:FINAL_SUMMARY:END -->
