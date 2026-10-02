---
id: TASK-166
title: 'Photo posts: a photo property from Micropub, rendered and federated'
status: Done
assignee:
  - '@claude'
created_date: '2026-09-29 01:55'
updated_date: '2026-10-02 16:21'
labels:
  - micropub
  - content
  - theme
milestone: m-25
dependencies:
  - TASK-164
  - TASK-165
references:
  - packages/cms/themes/default/partials/jsonld.njk
priority: medium
type: feature
ordinal: 190800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Most mobile Micropub clients post photos. A post can carry one or more photos, each a URL with optional alt text; Micropub supplies them as a URL, as {value, alt}, or as a file part in the create request itself, which is stored through the media endpoint's path. Photos live in front matter, the admin editor shows and edits them, the default theme renders them as u-photo inside the h-entry with their alt text, Post Type Discovery gains its photo branch in spec order, and the ActivityStreams object carries them as image attachments.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A Micropub create with photo as a URL, as {value, alt} and as a multipart file each produce a post whose photos are stored in front matter with their alt text
- [x] #2 The default theme renders each photo as an img.u-photo with its alt inside the h-entry
- [x] #3 A post with photos and no name is typed photo by Post Type Discovery, and a reply with a photo is still a reply, proven by tests
- [x] #4 The federated object carries each photo as an Image attachment with its alt as name
- [x] #5 The admin editor lists a post's photos and can add, remove and edit their alt text
- [x] #6 doc-2 documents the photo key
- [x] #7 A photo that is a media library item takes its default alt text from that item (TASK-141), so alt text is kept in one place rather than copied per post
- [x] #8 A photo post's JSON-LD BlogPosting carries image with the photo's absolute URL (and alt as its caption), and a post with several photos lists each
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Content model: src/content/photo.ts. Front matter key `photo`, a list of {url, alt?} (a bare URL string also reads). photosOf(extra) is the one reading; url is an /uploads/ path or an absolute http(s) URL. photoAlt resolves a photo's alt: its own, else the media library's (TASK-141, AC #7).
2. Post Type Discovery: PostType gains photo, checked after reply and before the note/article tail, per spec order (AC #3). Micropub q=config offers it; federation maps it to Note.
3. Editor: EditorForm.photos (rows of url + alt, numbered photo-url-N / photo-alt-N fields, empty url removes a row, blank row adds one). writeDocument resolves rows (upload that is an image in the library, or https URL) and writes the photo key through resolveExtra; undescribed photos join the alt-text warning/refusal (AC #5).
4. Micropub: createForm maps photo as URL, {value, alt} and multipart File; site-absolute upload URLs are stripped to /uploads/... File parts are stored with storeUpload(imagesOnly) only after the form validates, then removed if the write is refused (AC #1).
5. Theme: DocumentContext.photos [{url, alt, html}] where html is img.u-photo with alt, run through the responsive markup; post.njk prints them inside the h-entry (AC #2). jsonld.njk lists each as an ImageObject with absolute url and caption (AC #8). First photo becomes the share image fallback.
6. Federation: each photo becomes an Image attachment named by its alt, after the recording and before body images (AC #4).
7. Docs: doc-2 photo key (AC #6), README Micropub section, theme README photos variable.
8. Verify: pnpm build, test, typecheck, lint, format:check; curl a running site with a Micropub photo post.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Built as planned. Photos live in front matter under `photo` (Micropub's name), a list of {url, alt?}; src/content/photo.ts is the one reading (photosOf), and photoAlt falls back to the media library's alt text (TASK-141), so an upload described in the library is stored without an alt per post.

Decisions:
- Post Type Discovery puts photo after reply and before the note/article tail, as the spec orders it. A titled post with a photo is therefore a photo post, not an article (spec behaviour; only posts carrying the new key are affected). Photo federates as Note, like reply.
- Micropub create maps photo as a URL, {value, alt} and a multipart file part. A URL under the site's own /uploads/ is written as the /uploads/... path so the theme's responsive variants apply. File parts are stored with storeUpload(imagesOnly) only after createForm validates, and are deleted (with variants) if writeDocument then refuses, so a refused create leaves nothing behind.
- The editor shows numbered photo rows (photo-url-N, photo-alt-N) plus a blank row; an emptied address removes a row; the library alt shows as the placeholder. A save refuses an /uploads/ address that is not an image in the library, or anything that is not an upload or an http(s) URL. writeDocument resolves photos next to the recording (ResolvedMedia replaces the recording-only parameter), and a photo with no alt anywhere joins the missing-alt warning and the requireAltText refusal.
- DocumentContext.photos gives each photo {url, alt, html}; html is img.u-photo run through the same responsive rewrite as content. partials/photos.njk prints them in the h-entry after the recording, and listings print them above each entry. JSON-LD lists each photo as an ImageObject with absolute url and caption. The first photo is the share image fallback when the front matter names no image.
- Federation attaches each photo as an Image named by its alt (mediaType only for uploads), after the recording and before body images; a body image that repeats a photo is not attached twice.

Docs: doc-2 (photo key and Micropub mapping row), README Micropub section, theme README (photos variable and partial). decision-27's table still lists photo among refused properties; the backlog CLI has no decision update command, so it is left as the historical record.

Verified live: scratch site on :8787. Multipart create with a JPEG part -> 201, file stored at /uploads/2026/10/sunset.jpg and front matter photo url; JSON create with {value: <media endpoint URL>, alt} -> 201, front matter /uploads/2026/10/sunset-2.jpg with alt; q=config lists Photo; post page has picture > img.u-photo with srcset and the library alt; JSON-LD BlogPosting image [ImageObject url caption]; AS2 object type Note with Image attachment named by the library alt.

Follow-ups worth filing (not done): feeds (RSS/Atom/JSON) do not carry photos, so a photo-only post reads empty in a feed reader; the admin preview does not show photos; the Micropub create endpoint reads a multipart body without the media endpoint's declared-length guard.

Root cause found during the full run: src/webmention/reply-context.test.ts never exited once content/photo.ts imported images/markup (and so the image encoder) through post-type.ts; the same file passed with post-type.ts at HEAD. photo.ts now imports alt-text types only and reads upload paths itself, and undescribedPhotos lives in images/alt-text.ts. The file then passes (24/24) and the suite exits.

Validation: pnpm build && pnpm test (3312 cms + 30 demo, 0 fail) && pnpm typecheck && pnpm lint && pnpm format:check all passed. New tests: src/content/photo.test.ts, post-type photo branch, src/web/photo.test.ts (mf2 u-photo with alt, responsive picture, JSON-LD ImageObjects, share image), federation photo attachments, editor photo rows in posts.test.ts, Micropub photo creates in create.test.ts (URL, {value, alt}, photo[], multipart file, non-image refused, stored file removed when the write is refused, editor and Micropub write identical bytes). The cleanup test was checked by removing the cleanup call: it then failed with sunset.jpg left behind.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Photo posts. A post's front matter carries `photo`, a list of {url, alt?}; content/photo.ts reads it, and an entry without alt takes the media library's alt text (TASK-141). Micropub create accepts photo as a URL (own uploads written as /uploads/ paths), as {value, alt}, and as a multipart file part stored through storeUpload and removed again if the write is refused. Post Type Discovery gains photo after reply, the q=config post types list it, and it federates as a Note with each photo as an Image attachment named by its alt. The default theme prints each photo as a responsive img.u-photo in the h-entry and in listings, JSON-LD lists each as an ImageObject with caption, and the first photo is the share image fallback. The admin editor has numbered photo rows with a blank row to add one, library alt as placeholder, and refuses non-image or non-web addresses; undescribed photos join the alt-text warning and requireAltText refusal. Docs: doc-2, README Micropub, theme README. Verified with the full gate (3312 + 30 tests, typecheck, lint, format) and curl against a running site (multipart and JSON creates, rendered page, JSON-LD, AS2 object, q=config). Follow-ups not filed: feeds do not carry photos, admin preview omits them, Micropub create lacks the media endpoint's declared-length guard.
<!-- SECTION:FINAL_SUMMARY:END -->
