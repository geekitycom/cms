---
id: TASK-199
title: 'Rich reply context from h-entry, ActivityPub, oEmbed, JSON-LD and Open Graph'
status: To Do
assignee: []
created_date: '2026-10-01 17:02'
updated_date: '2026-10-01 17:20'
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
IndieMark level 4 asks for full rich reply-contexts: author name, image and a content summary. readReplyContext (src/webmention/reply-context.ts, built in TASK-123) reads the target page once: the first h-entry's name, excerpt, author name and URL, and date; with no h-entry only <title>/og:title and description/og:description. It reads no author photo, no og:image, og:site_name, article:author or article:published_time, no Twitter card tags, no JSON-LD, no oEmbed, and treats a Mastodon status as an HTML page rather than asking for its ActivityPub object.

Build the reply context from an ordered chain of sources, each filling only fields the earlier ones left empty:
1. microformats2 h-entry (today's behaviour), including the author h-card's u-photo, falling back to the page's representative h-card;
2. the ActivityPub object, when the target answers application/activity+json (fediverse posts): attributedTo's name, preferredUsername@host, icon, the content as text, the first image attachment, published; signed fetch only if the server demands it (authorized fetch), using the site's existing federation keys;
3. oEmbed, discovered by <link rel="alternate" type="application/json+oembed">: title, author_name, author_url, provider_name, thumbnail_url only. Never use or store the html field: it is a stranger's markup;
4. JSON-LD on the page (Article/BlogPosting/NewsArticle/SocialMediaPosting): headline, author name/url/image, datePublished, image;
5. Open Graph and Twitter card tags: og:title, og:description, og:image, og:site_name, article:author, article:published_time, twitter:title, twitter:description, twitter:image, twitter:creator;
6. <title> and meta description.

ReplyContext gains photo (the author's), image (the post's lead image) and siteName. Images are fetched server-side through fetchPublic, bounded in bytes and image type like the IndieAuth consent logo (TASK-190), and stored locally or inlined, never hotlinked, so a reader's browser is not sent to the cited site. Every fetch stays within today's timeout and fails soft: a source that cannot be read is skipped, and a reply never fails to save. The default theme shows the author photo beside the name, the site name, and the lead image when there is no excerpt or as a small thumbnail.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A reply to an h-entry whose author h-card has a u-photo shows that photo beside the author's name (falling back to the page's representative h-card)
- [ ] #2 A reply to a Mastodon status shows the author's display name, @user@host handle, avatar, the status text, its first image and its date, taken from the ActivityPub object
- [ ] #3 A reply to a page with only oEmbed, JSON-LD or Open Graph/Twitter metadata shows its title, excerpt, author, site name and lead image, each from the first source in the chain that has it
- [ ] #4 oEmbed html is never stored or rendered; only its metadata fields are used
- [ ] #5 Author photos and lead images are served from the site (stored or inlined), never hotlinked, bounded in size and type; a missing or unusable image leaves the context without it
- [ ] #6 A target that offers nothing past <title>, or cannot be fetched, renders exactly as today, and saving the reply never fails
- [ ] #7 Each source has a test with a captured real-world page or object (an h-entry blog, a Mastodon status, a YouTube or news page with oEmbed/JSON-LD, an Open Graph-only page)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Shared code: TASK-175 (M27, MCP remote lookup) also fetches fediverse objects as the site, with signed fetch. Whichever lands second reuses the first's fetcher rather than writing another.
<!-- SECTION:NOTES:END -->
