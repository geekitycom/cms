---
id: TASK-255
title: 'Show a reposted image URL as the image, credited to its host'
status: Done
assignee:
  - '@claude'
created_date: '2026-10-04 00:20'
updated_date: '2026-10-04 00:58'
labels:
  - theme
  - webmention
  - accessibility
dependencies:
  - TASK-252
priority: medium
type: feature
ordinal: 270800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A repost on shll.me (0.19.0, /2026/10/scientific-calculator/) cites a bare PNG on edu.casio.com, and the citation prints the whole ~300-character URL as its link text. When a cited URL answers with an image/* content type, keep it as the context's picture of kind photo, through TASK-252's copy path (guarded fetch, size cap, metadata stripped, its own uploads path), and show it in full like a reposted Giphy GIF. The citation line reads 'Reposted an image from <host>' linking to the original instead of printing the URL. The editor's preview card for an image gets an alt text field, defaulting to the post's title; with requireAltText on, a save with no alt text for it is refused like a photo without alt.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A repost of a URL that answers image/* shows the copied image in full with 'Reposted an image from <host>' linking to the original, on its page and in listings
- [x] #2 The editor's card for an image has an alt text field, defaulting to the post's title, written to the post; requireAltText refuses a save without it
- [x] #3 An image over the size cap or a failed fetch leaves the citation as a link showing the host, not the full URL; tests use stubbed hosts
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Recognise an image by the page fetch's own Content-Type: the cited-page fetch accepts image/* beside HTML, and fetchPublic gains an option to answer a matching type from its headers without reading the body. fetchReplyContext then returns a context {url} with a photo-kind picture source at the final URL, so the copy (TASK-252's copyCitedPicture: guarded fetch, uploadMaxBytes cap, strip, uploads/cited/) is the only download, with its own timeout. No HEAD: one request per URL inside the one deadline.
2. A context that shows nothing without its picture (no name, text, author or site) is not stored when the picture cannot be copied, so a failed or oversized image leaves no entry and the next save or boot tries again. describe() (save-time, 3 s) copies an image within what is left of its deadline, since there is no title to spend it on; failing that it stores nothing and the save's change fetches as usual.
3. citesAnImage(context): a photo-kind picture with no name and no author. Render passes image: true; cited-page.njk prints 'an image from <host>' as the link, and the no-context fallback becomes 'a page on <host>' instead of the bare URL (new host filter, mirrored in the Eleventy example). Feeds use the same words. Repost shows it in full (shownInFull unchanged); like/bookmark show the thumbnail.
4. Alt text: front matter cited-alt, EditorForm.citedAlt. The editor card of an image shown in full gets an Alt text input, value cited-alt else the post's title; a hidden input keeps it when no card shows. Render alt = cited-alt, else title, else empty. requireAltText refuses a published save whose shown-in-full cited image has neither (a new post asks describe(), an edit reads the stored context).
5. Tests first per criterion with stubbed hosts; decision-19 amendment; theme README; verify chain; Chromium check + live Casio PNG run.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented: fetchPublic headersOnly option; fetchReplyContext answers image/* with {url} + photo picture source at the final URL without reading the body; reply-contexts keeps an entry with nothing but a picture only when the picture copies (refresh and describe, describe copies within its 3 s); citesAnImage in cited-picture.ts; host filter, cited-page.njk 'an image from'/'a page on'; feed lines match (FEED_ITEM_REVISION 11, ETag fixtures refreshed, bytes unchanged); cited-alt front matter (CITED_ALT_FRONT_MATTER_KEY, citedImageAlt = cited-alt || title || ''), EditorForm.citedAlt, alt input on the card of an image shown in full (repost), hidden input keeps it when no such card shows, requireAltText refusal at editor-cited-alt (new post via describe, edit via stored read; DocumentSite.storedContext). Decision: the alt field appears only where the alt is printed: a like or bookmark of an image draws a decorative aria-hidden thumbnail beside 'Liked an image from host', so it has no field. Tests: webmention/reply-context.test.ts (3), web/cited-image.test.ts (13), admin/cited-image-alt.test.ts (10); three existing bare-URL assertions updated. Mutations: dropping the showsNothing guard and the hidden cited-alt input each fail a test.

Editor label is 'Alt text of the reposted image' (the Photos group's field is already named 'Alt text'); the field uses the invalid() macro so a refusal describes it by the error then the hint. Refusal message: 'This site publishes no image without alt text. Describe the image this post reposts in its alt text field.'

Validation: pnpm build && pnpm test (3940 + 30 pass) && pnpm typecheck && pnpm lint && pnpm format:check all pass.

Live run (scratch site, real DNS and network, requireAltText on, server stopped after): the Casio fx-991ES PNG URL from shll.me answered image/* and was copied as /uploads/cited/16e1ca377fc44d32.avif, 500x726, kind photo (Casio negotiates AVIF from the Accept header; the signature check took it). Chromium 1234 with JavaScript off: a new untitled repost of it was refused with the error under 'Alt text of the reposted image' (aria-invalid, card titled 'An image from edu.casio.com'); typing alt and Publish saved cited-alt to the front matter; the page reads 'Reposted an image from edu.casio.com' with the calculator in full and that alt; the like reads 'Liked an image from edu.casio.com' beside its thumbnail; a 404 image reads 'Bookmarked a page on edu.casio.com'; JSON Feed lines match; no request left localhost. Screenshots in the session scratchpad: t255-editor-refused.png, t255-editor-alt-filled.png, t255-editor-card.png, t255-repost-page.png, t255-like-page.png, t255-gone-page.png, t255-front.png.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
A cited URL that answers image/* is now recognised from the page fetch's own Content-Type (headers only, body cancelled), stored as a context with a photo picture and no name, and copied through TASK-252's pipeline as the only download. A repost shows it in full under 'Reposted an image from <host>' (likes and bookmarks say 'Liked/Bookmarked an image from <host>' beside a thumbnail), and a citation with nothing stored says 'a page on <host>': the bare URL is never link text on pages, listings or feeds (FEED_ITEM_REVISION 11). An image that fails or is over uploadMaxBytes keeps no entry and is retried. The editor's card for a reposted image has an alt text field writing cited-alt, defaulting to the post's title; render uses cited-alt, else title; requireAltText refuses a published save with neither, including a new untitled post (the save copies the image within its 3 s). decision-19 amended, theme README updated. Verified by new stubbed-host tests (reply-context, web/cited-image, admin/cited-image-alt), the full build/test/typecheck/lint/format chain, and a live Casio PNG run driven in Chromium with JavaScript off.
<!-- SECTION:FINAL_SUMMARY:END -->
