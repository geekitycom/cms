---
id: TASK-199
title: 'Rich reply context from h-entry, ActivityPub, oEmbed, JSON-LD and Open Graph'
status: To Do
assignee: []
created_date: '2026-10-01 17:02'
updated_date: '2026-10-04 00:35'
labels:
  - indieweb
  - webmention
  - federation
  - theme
milestone: m-28
dependencies: []
references:
  - packages/cms/src/webmention/reply-contexts.ts
  - packages/cms/src/webmention/fetch-public.ts
  - 'https://oembed.com/#section4'
  - 'https://ogp.me/'
priority: medium
type: feature
ordinal: 215800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
IndieMark level 4 asks for full rich reply-contexts: author name, image and a content summary. TASK-244, 246, 247, 250, 251, 252 and 253 (2026-10-03) built most of the chain for every citation, not only replies: oEmbed metadata (title, author, thumbnail; html never read), a table of known oEmbed providers asked before their pages (YouTube, TikTok, Reddit, Giphy), og:title ahead of <title> with suffix-only titles dropped, og:site_name as the source when there is no author, a lead picture from oEmbed photo/thumbnail, og:image or twitter:image copied into uploads/cited/ through fetchPublic and the upload pipeline (never hotlinked, capped at uploadMaxBytes), bidi controls stripped, and fail-soft fetching within one deadline. See decision-19's amendments.

What remains, each source filling only fields the earlier ones left empty:
1. The author's photo: the h-entry author h-card's u-photo, falling back to the page's representative h-card, copied like lead pictures (reuse cited-picture.ts).
2. The ActivityPub object, when the target answers application/activity+json (fediverse posts): attributedTo's name, preferredUsername@host, icon (as the author photo), the content as text, the first image attachment, published; signed fetch only if the server demands it (authorized fetch), using the site's federation keys. Share the fetcher with TASK-175, whichever lands second.
3. JSON-LD on the page (Article/BlogPosting/NewsArticle/SocialMediaPosting): headline, author name/url/image, datePublished, image.
4. The tags not yet read: article:author, article:published_time, twitter:title, twitter:description, twitter:creator. og:description stays off likes and bookmarks (many sites put a site-wide bio there); use it only as a reply's excerpt.
The default theme shows the author photo beside the name.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A reply to an h-entry whose author h-card has a u-photo shows that photo beside the author's name (falling back to the page's representative h-card)
- [ ] #2 A reply to a Mastodon status shows the author's display name, @user@host handle, avatar, the status text, its first image and its date, taken from the ActivityPub object
- [ ] #3 A reply to a page with only oEmbed, JSON-LD or Open Graph/Twitter metadata shows its title, excerpt, author, site name and lead image, each from the first source in the chain that has it
- [x] #4 oEmbed html is never stored or rendered; only its metadata fields are used
- [ ] #5 Author photos and lead images are served from the site (stored or inlined), never hotlinked, bounded in size and type; a missing or unusable image leaves the context without it
- [ ] #6 A target that offers nothing past <title>, or cannot be fetched, renders exactly as today, and saving the reply never fails
- [ ] #7 Each source has a test with a captured real-world page or object (an h-entry blog, a Mastodon status, a YouTube or news page with oEmbed/JSON-LD, an Open Graph-only page)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Shared code: TASK-175 (M27, MCP remote lookup) also fetches fediverse objects as the site, with signed fetch. Whichever lands second reuses the first's fetcher rather than writing another.

2026-10-03 rescoped after TASK-244..253. Already met: AC#4 (oEmbed html never stored or rendered; TASK-244 tests assert no iframe and no html in replyContexts.json). Partly met: AC#3 (oEmbed and Open Graph/Twitter title, site name and lead image done; JSON-LD, author and date tags not), AC#5 (lead images copied and capped; author photos not yet), AC#6 (fail-soft holds). Open: AC#1 (author photo), AC#2 (ActivityPub object), AC#7 (captured real-world fixtures for the remaining sources).
<!-- SECTION:NOTES:END -->
