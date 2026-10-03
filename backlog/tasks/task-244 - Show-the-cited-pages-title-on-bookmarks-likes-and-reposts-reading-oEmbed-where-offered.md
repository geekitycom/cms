---
id: TASK-244
title: >-
  Show the cited page's title on bookmarks, likes and reposts, reading oEmbed
  where offered
status: To Do
assignee: []
created_date: '2026-10-03 16:47'
labels:
  - theme
  - webmention
  - indieweb
dependencies: []
references:
  - packages/cms/src/webmention/reply-context.ts
  - packages/cms/src/webmention/reply-contexts.ts
  - 'https://oembed.com/'
priority: medium
type: feature
ordinal: 259800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A bookmark on shll.me (https://shll.me/2026/10/scripting-news/, 0.18.0) prints 'Bookmarked http://scripting.com/': likes, reposts and bookmarks show their target's bare URL. Replies already get a context: the site fetches the target after save and keeps its name, author and words in content/_data/replyContexts.json (decision-19), read from the first h-entry, else the page's <title> and og:title (packages/cms/src/webmention/reply-context.ts). The same fetch should describe a like-of, repost-of or bookmark-of target, so the citation line reads 'Bookmarked Scripting News' linking the URL, with the author when known.

oEmbed: many pages without microformats publish an oEmbed endpoint (<link rel="alternate" type="application/json+oembed">; YouTube, Vimeo, Mastodon). The fetch discovers it and uses its title, author_name and author_url when the page has no h-entry name, ahead of <title> and og:title, which are often generic or filled by JavaScript on those sites. The fetch follows the same rules as today's reply-context fetch (timeouts, size limits, SSRF guards, signed as the site where it already is). oEmbed's html is not rendered: third-party markup (iframes, scripts) on the page and in feeds is its own decision and is out of scope.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A bookmark, like or repost whose target has an h-entry name, a <title> or an oEmbed title prints that title in its citation, linking the target URL, on its page and in listings; the URL shows only when no title is found
- [ ] #2 The target's author shows when known (h-card, oEmbed author_name and author_url)
- [ ] #3 oEmbed is discovered from the page's link rel alternate (JSON) and its title and author are preferred over <title> and og:title when the page has no h-entry name; a failed or absent oEmbed falls back without error
- [ ] #4 The fetch keeps the reply-context fetch's limits and guards, and oEmbed html is never printed
- [ ] #5 Contexts are kept the way reply contexts are (decision-19) and refetched on the same rules; tests cover h-entry, <title>, og:title and oEmbed targets with stubbed hosts
<!-- AC:END -->
