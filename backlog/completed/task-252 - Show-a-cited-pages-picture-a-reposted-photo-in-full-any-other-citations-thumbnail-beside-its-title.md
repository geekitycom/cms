---
id: TASK-252
title: >-
  Show a cited page's picture: a reposted photo in full, any other citation's
  thumbnail beside its title
status: Done
assignee:
  - '@claude'
created_date: '2026-10-03 23:56'
updated_date: '2026-10-04 00:28'
labels:
  - theme
  - webmention
  - indieweb
dependencies:
  - TASK-253
priority: medium
type: feature
ordinal: 267800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A Giphy repost on shll.me (0.19.0, /2026/10/reposted-giphy-com-gifs-theinnernette/) shows only a link. TASK-244 kept oEmbed's html (iframes, scripts) out on purpose; this uses the plain media oEmbed and Open Graph already offer instead.

When the cited page's context is fetched (reply contexts, decision-19), also keep its picture: an oEmbed answer of type photo gives the image itself (Giphy: url, width, height); otherwise oEmbed's thumbnail_url, else og:image, gives a thumbnail (YouTube: i.ytimg.com hqdefault.jpg). Copy the picture into the site rather than hotlinking, so readers' browsers never ask the third party and the post survives the original going away: through the same guarded fetch (SSRF guard, size cap, timeout), then the media pipeline's metadata stripping and variants, under a path of its own (e.g. uploads/cited/), recorded in the context entry. A picture that fails or is too big is simply not shown.

Rendering (theme partials for citations and reply context, page and listings): a repost of a photo shows the image in full; every other citation with a picture (likes, bookmarks, replies, a repost of a video or a page) shows the thumbnail beside the title, and both link to the cited URL. A video thumbnail carries a play mark. No iframe and no third-party request from the page. Keep mf2 sensible (u-photo inside the h-cite). Feeds carry the same markup. Decide and record how a picture is forgotten when no post cites its page any more.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A repost of a Giphy GIF shows the GIF from the site's own uploads inside the citation, on its page and in listings
- [x] #2 A like, bookmark, reply or repost of a page with an oEmbed thumbnail or og:image shows the copied thumbnail beside the title, both linking to the cited URL; a video's thumbnail has a play mark
- [x] #3 No page makes a request to the cited site or its CDN; pictures are fetched through the guarded fetch with a size cap and stored under their own uploads path with metadata stripped
- [x] #4 A picture that fails, is too big or is absent leaves the citation as it is today; tests use stubbed hosts
- [x] #5 decision-19 records where pictures are kept and when they are forgotten; theme README describes the rendering
- [x] #6 The editor shows a cited page's preview card with a remove control (keyboard operable, named, works without JavaScript); removing it is saved in front matter and the page, listings and feeds show the plain citation; it can be shown again
- [x] #7 A provider row in KNOWN_OEMBED_PROVIDERS can name a title suffix its endpoint appends, and Giphy's ' - Find & Share on GIPHY' is stripped (TASK-253 found the endpoint keeps it)
- [x] #8 A cited page's picture is taken in the order oEmbed photo url, oEmbed thumbnail_url, og:image, then twitter:image (or twitter:image:src), so a page with only Twitter card tags still has one; tests use stubbed hosts
- [x] #9 A cited page with no author (no h-card, no oEmbed author_name) is labelled with its og:site_name as plain text, not a p-author h-card, so a bookmark of a Scripting News post reads 'RSS tip #2 · Scripting News'; a like's or bookmark's citation never prints the page's og:description or description; tests use stubbed hosts
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Data shape: a stored context gains picture {src (/uploads/cited/<sha256-16>.<ext>), width, height, kind photo|thumbnail, video?}. fetchReplyContext returns the remote candidate beside the context: oEmbed type photo url -> photo; else oEmbed thumbnail_url, else the page's og:image -> thumbnail; video from oEmbed type video or og:type video.*.
2. Known provider rows gain an optional titleSuffix; Giphy's ' - Find & Share on GIPHY' is cut from the endpoint's title.
3. New webmention/cited-picture.ts: copy a candidate through fetchPublic (image content types, the site's uploadMaxBytes as the cap, its own timeout), sniff the format by signature (UPLOAD_MEDIA_TYPES), stripMetadata, write content/uploads/cited/<hash><ext> (content-addressed, so a re-copy converges), read the size with sharp, generateImageVariants. A sweep deletes every file under uploads/cited that no entry names, with its variants.
4. reply-contexts.ts: refresh copies the picture and stores it with the entry; describe() (save-time) stores the context at once and queues the picture copy; forget/refresh/catchUp sweep orphaned pictures. parseContexts reads the picture.
5. Per-post opt-out: front matter preview: false, absent = shown (Micropub default). render.ts citedBy drops the picture when hidden and builds picture.html through siteImageMarkup; themes: citations.njk shows a photo repost in full (u-photo inside h-cite), every other citation a thumbnail link beside the line, play mark for video; reply-context.njk the thumbnail. CSS + README.
6. Feeds: each item opens with its citation lines (verb, name, author) and the picture with an absolute src; the fingerprint carries the stored contexts; FEED_ITEM_REVISION 10.
7. Editor: Responding to shows a card (picture + title) under each cited URL with a picture, with a native checkbox 'Remove the preview of <title>' styled as an X; checked writes preview: false, unchecked removes the key. Media library skips uploads/cited.
8. decision-19 amendment, theme README; verify with build/test/typecheck/lint/format and a JS-off Chromium run with screenshots.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
2026-10-03, site owner: likes and bookmarks get the preview too, not just reposts. Like Slack's link unfurl: the preview shows by default and the author can remove it per post with an X. Design: the editor's Responding to group shows the stored preview card (picture and title) under each cited URL once a context exists, with an X control that removes it. It must work without JavaScript, so a native control (a checkbox or a submit button) styled as an X with an accessible name such as 'Remove the preview of <title>'. Removing it writes a front matter key (e.g. preview: false) and the page, listings and feeds then show the plain citation line. A Micropub post shows the preview until the author removes it in the editor. A new post has no preview until its first save fetches the context (TASK-250); live fetching while typing is out of scope.

Built: fetchReplyContext returns a picture source beside the context (oEmbed photo url, else thumbnail_url, else og:image, else twitter:image / twitter:image:src; video from oEmbed type video, og:type video.*, or twitter:card player). Known provider rows take an optional titleSuffix; Giphy's ' - Find & Share on GIPHY' is cut. A page with no author keeps og:site_name as context.site, printed as plain span.cite-site after a middle dot; likes, reposts and bookmarks never print the description.

New src/webmention/cited-picture.ts: copyCitedPicture goes through fetchPublic (public hosts, redirects checked, 10 s timeout, the site's uploadMaxBytes as the cap: the limit an author's own upload has, 10 MiB by default, which a Giphy GIF fits), sniffs PNG/JPEG/GIF/WebP/AVIF by signature (UPLOAD_MEDIA_TYPES), stripMetadata, writes content/uploads/cited/<sha256-16><ext> (content-addressed, wx so a repeat converges), reads the size with sharp, generateImageVariants. sweepCitedPictures deletes every copy no entry names, with its variants. Stored entry: picture {src, width, height, kind photo|thumbnail, video?}.

reply-contexts.ts: refresh copies the picture with the context; describe() (save-time, 3 s) writes the context at once and queues the picture copy; forget, refresh and catchUp sweep, so a picture goes with the last entry naming it and a crash leftover goes at the next start. Service takes config (CitedPictureConfig) instead of contentDir. Media library skips uploads/cited.

Rendering: citedPictureContext (web/context.ts) gives the theme picture {.., full, html}; full = repost-of + photo (shownInFull). citations.njk prints a.cite-photo under the line for full, else cited.thumb (a.cite-thumb, tabindex -1, aria-hidden, alt empty) beside the line in a cite-with-thumb grid; cite-video draws a CSS play mark. Feeds open each citing item with p.cite-line and the picture with an absolute src; fingerprint carries the stored contexts; FEED_ITEM_REVISION 10 (fixtures refreshed: bytes unchanged, only ETags moved). preview: false (front matter, PREVIEW_FRONT_MATTER_KEY) hides the picture on page, listing and feed; absent = shown, so Micropub posts show it.

Editor: under each cited URL whose context has a picture, .admin-cited-card with the picture, the title and a native checkbox (id editor-preview-<property>, name preview) whose label is an X with the hidden name 'Remove the preview of <title>'; checked writes preview: false, cleared removes the key; with no card shown a hidden input keeps a removed preview removed. openGroups unchanged (Responding to already opens when a URL is filled).

Validation: pnpm build && pnpm test (3909 + 30 pass) && pnpm typecheck && pnpm lint && pnpm format:check all pass. New tests: webmention/cited-picture.test.ts (copy, strip, cap, non-image, private host, timeout, sweep, parse), reply-context.test.ts (picture order, twitter, site, suffix), web/cited-picture.test.ts (page/listing/mf2/feeds/no foreign src/forget/sweep/opt-out), citation-context.test.ts (site label), admin/cited-preview.test.ts (card, remove, show again, keep, new post via save-time path). Mutation checks: dropping stripMetadata, the sweep's keep test and the save-time attach each fail a test.

Live run (scratch site, real network, server stopped after): Giphy repost stored a 320x320 GIF (1.5 MB) as /uploads/cited/c67ec09686bf1c1d.gif with the clean title; YouTube like stored hqdefault 480x360 as a video thumbnail; scripting.com bookmark reads 'Bookmarked RSS tip #2 · Scripting News'. Chromium 1234 with JavaScript off: Tab from Repost of reaches the X (getByRole checkbox name 'Remove the preview of Neil Degrasse Tyson Wow GIF by New York Comic Con'), Space checks it, Enter on Update saves, the page shows the plain citation, Space again and Update brings the GIF back; no request left localhost on any page. Screenshots in the session scratchpad: editor-card.png, editor-card-focus.png, editor-card-removed.png, giphy-repost.png, giphy-repost-removed.png, youtube-like.png, front-listing.png.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
A citation now shows the cited page's picture, copied into the site: a repost of a photo (a Giphy GIF) in full inside the h-cite, any other citation (like, bookmark, reply, repost of a video or page) a thumbnail beside its title, with a play mark for a video, on the page, in listings and in the feeds. Pictures come from oEmbed photo, thumbnail_url, og:image or twitter:image, go through the guarded fetch with the site's upload limit, are stripped and stored under uploads/cited/ by content hash, recorded in replyContexts.json, and swept when no entry names them. The editor shows the card with a keyboard-operable, named X that writes preview: false and can be cleared to show it again. Giphy's title suffix is cut, and a page with no author is labelled by its og:site_name. Verified by new stubbed-host tests, the full build/test/typecheck/lint/format chain, a live Giphy/YouTube/Scripting News run, and a JavaScript-off Chromium run of the remove and show-again flow.
<!-- SECTION:FINAL_SUMMARY:END -->
