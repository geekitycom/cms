---
id: TASK-199
title: 'Rich reply context from h-entry, ActivityPub, oEmbed, JSON-LD and Open Graph'
status: Done
assignee:
  - '@claude'
created_date: '2026-10-01 17:02'
updated_date: '2026-10-06 02:56'
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
- [x] #1 A reply to an h-entry whose author h-card has a u-photo shows that photo beside the author's name (falling back to the page's representative h-card)
- [x] #2 A reply to a Mastodon status shows the author's display name, @user@host handle, avatar, the status text, its first image and its date, taken from the ActivityPub object
- [x] #3 A reply to a page with only oEmbed, JSON-LD or Open Graph/Twitter metadata shows its title, excerpt, author, site name and lead image, each from the first source in the chain that has it
- [x] #4 oEmbed html is never stored or rendered; only its metadata fields are used
- [x] #5 Author photos and lead images are served from the site (stored or inlined), never hotlinked, bounded in size and type; a missing or unusable image leaves the context without it
- [x] #6 A target that offers nothing past <title>, or cannot be fetched, renders exactly as today, and saving the reply never fails
- [x] #7 Each source has a test with a captured real-world page or object (an h-entry blog, a Mastodon status, a YouTube or news page with oEmbed/JSON-LD, an Open Graph-only page)
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Capture real-world fixtures (aaronparecki.com checkin h-entry, a mastodon.social status page + its Note + actor, an Ars Technica NewsArticle page, a GitHub Open Graph page) under packages/cms/test/fixtures/reply-context/, trimmed to the parts the reader looks at.
2. Model the chain in reply-context.ts as an ordered list of sources (h-entry, ActivityPub object, oEmbed, JSON-LD, Open Graph/Twitter/<title>), each giving a partial description; merge them field by field, first source wins. An h-entry or a fediverse object that has text decides the name (a note has none); an empty WordPress h-entry decides nothing.
3. h-entry: read the author h-card's u-photo, falling back to the page's h-card for the same person (same url, or same name when the entry's author has no url).
4. ActivityPub: when the page links rel=alternate application/activity+json, ask an injected FediverseLookup within the same deadline. The federation side (federation/cited-post.ts) uses Fedify lookupObject signed as the site's first account, reading attributedTo's name, preferredUsername@host, icon, content as text, first image attachment, published. Extract the signed-loader setup shared with handles.ts and profiles.ts.
5. JSON-LD (Article/BlogPosting/NewsArticle/SocialMediaPosting): headline, author name/url/image, datePublished, image. Meta: article:author, article:published_time, twitter:title, twitter:description, twitter:creator.
6. ReplyContext.author gains handle and photo (a copied picture under /uploads/cited/, via cited-picture.ts); the service copies it with the lead picture, parseContexts reads it, the sweep keeps it.
7. Theme: cited-page.njk prints the photo (img.u-photo) and the handle (p-nickname) inside the author h-card; render.ts builds the photo's imgHtml; CSS sizes it.
8. Amend decision-19; verify with the full check suite and a curl run against a scratch site with stubbed sources.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Shared code: TASK-175 (M27, MCP remote lookup) also fetches fediverse objects as the site, with signed fetch. Whichever lands second reuses the first's fetcher rather than writing another.

2026-10-03 rescoped after TASK-244..253. Already met: AC#4 (oEmbed html never stored or rendered; TASK-244 tests assert no iframe and no html in replyContexts.json). Partly met: AC#3 (oEmbed and Open Graph/Twitter title, site name and lead image done; JSON-LD, author and date tags not), AC#5 (lead images copied and capped; author photos not yet), AC#6 (fail-soft holds). Open: AC#1 (author photo), AC#2 (ActivityPub object), AC#7 (captured real-world fixtures for the remaining sources).

2026-10-05 built.
- Source chain: reply-context.ts now folds ordered sources (h-entry, ActivityPub object, oEmbed, JSON-LD, page metadata) field by field, first wins. An h-entry or fediverse object with words decides the name (a note keeps none); an h-entry with no name and no words decides nothing, so an empty WordPress h-entry (Ars Technica's, whose only nested 'roots' are Tailwind h-auto/h-full classes) no longer hides the JSON-LD headline. A later source adds to the author (url, handle, photo) only when it names the same person.
- Author photo: citedEntry reads the author h-card's u-photo, else the photo of an h-card on the page that is the same person (same url, or same name when the author has no url). Copied by cited-picture.ts copyCitedImage (split out of copyCitedPicture): fetchPublic guards, uploadMaxBytes, signature check, metadata stripped, under uploads/cited/, kept by the sweep, parsed back by parseCitedImage. Stored as author.photo {src,width,height}; author.handle is user@host.
- ActivityPub: asked only for a page with no h-entry, at the URL its <link rel=alternate type=application/activity+json> names, after a publicHost check, within the page's one deadline (AbortSignal plus a race). federation/cited-post.ts citedPostReader reads Note/Article/Page/Question with Fedify lookupObject, getAttribution + profileFrom, first image attachment; a post with a content warning or marked sensitive shows the warning and no image. Fetches are signed as the site's first account via the new federation/site-loaders.ts siteLoaders, which handles.ts and profiles.ts now use too (TASK-175 should reuse it). Deviation: signed always, as profiles.ts and handles.ts already do, rather than only after a 401.
- parseHtml keeps application/ld+json scripts as elements with a data field (out of the text); every other script is still dropped.
- Meta: twitter:title, twitter:description, twitter:creator, article:author (a name, or the author's url when it is a URL), article:published_time. og:description is still read as the excerpt, and only the reply context prints an excerpt; likes, bookmarks, reposts, feeds and the AP Note never print it.
- Theme: cited-page.njk card() prints author.photo.imgHtml (img.u-photo.cite-avatar, alt empty) before the name and the handle as span.p-nickname.cite-handle; render.ts builds it via citedPhotoContext and hides it with preview: false. README documents it.
- Fixtures: packages/cms/test/fixtures/reply-context/ captured 2026-10-05 from aaronparecki.com (checkin, whole), mastodon.social (status page head, Note JSON, actor JSON fetched with authorized fetch), arstechnica.com (head, h-entry emptied), github.com (head). Tests: webmention/reply-context-sources.test.ts, web/cited-author.test.ts (whole app, stubbed fetch; the stub actor answers 401 unsigned like mastodon.social).
- Not done here: decision-19 needs an amendment for TASK-199 (source chain, author.photo/handle, ActivityPub alternate, JSON-LD); the backlog CLI has no decision update command and backlog files may not be edited by hand, so the orchestrator should add it.
- Observed, not changed: at boot each new target is fetched twice (the scan's handle() and catchUp() both queue it before the first write lands). Pre-existing in reply-contexts.ts.
- Validation: pnpm build, pnpm test (4709 + 30 pass), pnpm typecheck, pnpm lint, pnpm format:check all pass. Mutations checked: unsigned loader fails 3 cited-author tests; dropping the same-person h-card fallback fails 2 source tests. Live: scratch site via tsx with stubbed remote hosts on :4199, curl of /2026/10/{aaron,mastodon,ars,github,plain,down}/ showed the avatar from /uploads/cited/ beside Aaron Parecki; Eugen Rochko @Gargron@mastodon.social with avatar, #SilentSunday, 4 October 2026 and the thumbnail; the Ars headline, Scharon Harding and 5 October 2026; GitHub's og:title · GitHub; the title-only and unreachable pages unchanged. Server stopped.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
A citation now describes the cited page from an ordered chain of sources (h-entry, ActivityPub object, oEmbed, JSON-LD, Open Graph/Twitter/article tags), each filling only what the earlier ones left empty. The author's photo (h-entry u-photo or the page's h-card for the same person, the fediverse actor's icon, or the JSON-LD author image) is copied under uploads/cited/ like a picture and shown before the name; a Mastodon status is read from the Note its page links, signed as the site, giving display name, @user@host handle, avatar, text, first image and date. Verified with captured real-world fixtures (aaronparecki.com, mastodon.social, arstechnica.com, github.com) in reply-context-sources.test.ts and cited-author.test.ts, the full build/test/typecheck/lint/format suite, and curl against a scratch site with stubbed remote hosts. decision-19 still needs a TASK-199 amendment, which the CLI cannot write.
<!-- SECTION:FINAL_SUMMARY:END -->
