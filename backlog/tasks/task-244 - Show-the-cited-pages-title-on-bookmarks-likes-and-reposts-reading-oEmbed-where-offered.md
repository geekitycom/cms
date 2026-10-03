---
id: TASK-244
title: >-
  Show the cited page's title on bookmarks, likes and reposts, reading oEmbed
  where offered
status: Done
assignee:
  - '@claude'
created_date: '2026-10-03 16:47'
updated_date: '2026-10-03 18:05'
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
- [x] #1 A bookmark, like or repost whose target has an h-entry name, a <title> or an oEmbed title prints that title in its citation, linking the target URL, on its page and in listings; the URL shows only when no title is found
- [x] #2 The target's author shows when known (h-card, oEmbed author_name and author_url)
- [x] #3 oEmbed is discovered from the page's link rel alternate (JSON) and its title and author are preferred over <title> and og:title when the page has no h-entry name; a failed or absent oEmbed falls back without error
- [x] #4 The fetch keeps the reply-context fetch's limits and guards, and oEmbed html is never printed
- [x] #5 Contexts are kept the way reply contexts are (decision-19) and refetched on the same rules; tests cover h-entry, <title>, og:title and oEmbed targets with stubbed hosts
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Fetch (webmention/reply-context.ts): when the page has no h-entry, discover <link rel=alternate type=application/json+oembed>, fetch it through fetchPublic within the same deadline and byte limit, read only title, author_name and author_url; prefer those over <title> and og:title; any oEmbed failure falls back to the page metadata. oEmbed html is never read or stored.
2. Store (webmention/reply-contexts.ts): a post's cited targets are its in-reply-to plus its like-of, repost-of and bookmark-of URLs; handle, forget and catchUp work over that set with the same rules (decision-19). Same file, same shape.
3. Render (web/render.ts): each entry of citations carries the stored context as citation.context, on a post's page and in listings.
4. Theme (partials/citations.njk): 'Bookmarked <a class=u-url p-name>Title</a> by <h-card>'; 'a post' with only an author; the bare URL with neither.
5. Tests first for each: readReplyContext/fetchReplyContext oEmbed cases (stubbed hosts), service fetching citation targets, HTTP tests of the citation line on the page and in the listing for h-entry, <title>, og:title and oEmbed targets.
6. Amend decision-19 and the theme README; verify with build, test, typecheck, lint, format:check and curl.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Built on the reply-context fetch and store rather than a second fetcher. webmention/reply-context.ts: a page with no h-entry has its JSON oEmbed endpoint discovered (link rel alternate, also Flickr's 'alternative' and SoundCloud's text/json+oembed) and fetched through fetchPublic with the same lookup guard, byte limit and what is left of the page's one timeout; only title, author_name and author_url are read, oEmbed title is preferred over <title>/og:title, and any failure falls back silently. webmention/reply-contexts.ts: a post's targets are its in-reply-to plus like-of, repost-of and bookmark-of; handle, forget and catchUp run over that set on decision-19's rules. web/render.ts: citations carry citation.context on the page and in listings. partials/citations.njk: name as the link with p-name, author as a p-author h-card, 'a post' with only an author, the bare URL with neither. decision-19 amended; theme README updated.

Choice: an h-entry wins wholesale, so oEmbed is asked only when the page has no h-entry (an unnamed h-entry is a note whose words are its context, as for replies).

Validation: pnpm build, test (3773 pass), typecheck, lint, format:check all pass. New tests: src/web/citation-context.test.ts (h-entry, <title>, og:title, oEmbed, bare URL, hostile markup, no iframe, storage, refetch/forget, catchUp, rebuild) and oEmbed cases in src/webmention/reply-context.test.ts (preference, fallback on 404/throw/bad JSON/wrong type, byte limit, shared timeout, private endpoint, XML ignored, h-entry pages not asked). Live check: a scratch site served on :3123 fetched real targets; curl showed 'Bookmarked Scripting News' (http://scripting.com/, <title>), 'Liked Flickermood by Forss by Forss' (SoundCloud oEmbed), Flickr oEmbed title and author, Vimeo og/title, on each page and on /, with no iframe on any page and no html in replyContexts.json. Server stopped.

Found: a YouTube watch page is about 1.3 MB, over the 1,000,000-byte limit, so it is refused whole and cites by bare URL. Keeping the limit was this task's rule; reading only the first part of an over-size page for discovery would fix it and is a separate decision. Flickr's oEmbed author_name carries Unicode bidi controls; they are printed escaped but unstripped, as h-card names already are.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Likes, reposts and bookmarks now name what they cite. The reply-context fetch and its file (decision-19, content/_data/replyContexts.json) cover like-of, repost-of and bookmark-of targets on the same refetch and forget rules, and a page without an h-entry is also described by its JSON oEmbed title and author ahead of <title> and og:title, fetched under the same SSRF guard, byte limit and single timeout; oEmbed html is never read or stored. partials/citations.njk prints 'Bookmarked <name>' linking the target, with the author's h-card, and the bare URL only when nothing was found. Verified with new HTTP tests over stubbed hosts, the full build/test/typecheck/lint/format run, and curl against a scratch site citing real pages.
<!-- SECTION:FINAL_SUMMARY:END -->
