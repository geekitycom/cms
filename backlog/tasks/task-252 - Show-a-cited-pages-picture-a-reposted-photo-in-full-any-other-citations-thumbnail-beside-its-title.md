---
id: TASK-252
title: >-
  Show a cited page's picture: a reposted photo in full, any other citation's
  thumbnail beside its title
status: To Do
assignee: []
created_date: '2026-10-03 23:56'
updated_date: '2026-10-04 00:04'
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
- [ ] #1 A repost of a Giphy GIF shows the GIF from the site's own uploads inside the citation, on its page and in listings
- [ ] #2 A like, bookmark, reply or repost of a page with an oEmbed thumbnail or og:image shows the copied thumbnail beside the title, both linking to the cited URL; a video's thumbnail has a play mark
- [ ] #3 No page makes a request to the cited site or its CDN; pictures are fetched through the guarded fetch with a size cap and stored under their own uploads path with metadata stripped
- [ ] #4 A picture that fails, is too big or is absent leaves the citation as it is today; tests use stubbed hosts
- [ ] #5 decision-19 records where pictures are kept and when they are forgotten; theme README describes the rendering
- [ ] #6 The editor shows a cited page's preview card with a remove control (keyboard operable, named, works without JavaScript); removing it is saved in front matter and the page, listings and feeds show the plain citation; it can be shown again
- [ ] #7 A provider row in KNOWN_OEMBED_PROVIDERS can name a title suffix its endpoint appends, and Giphy's ' - Find & Share on GIPHY' is stripped (TASK-253 found the endpoint keeps it)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
2026-10-03, site owner: likes and bookmarks get the preview too, not just reposts. Like Slack's link unfurl: the preview shows by default and the author can remove it per post with an X. Design: the editor's Responding to group shows the stored preview card (picture and title) under each cited URL once a context exists, with an X control that removes it. It must work without JavaScript, so a native control (a checkbox or a submit button) styled as an X with an accessible name such as 'Remove the preview of <title>'. Removing it writes a front matter key (e.g. preview: false) and the page, listings and feeds then show the plain citation line. A Micropub post shows the preview until the author removes it in the editor. A new post has no preview until its first save fetches the context (TASK-250); live fetching while typing is out of scope.
<!-- SECTION:NOTES:END -->
