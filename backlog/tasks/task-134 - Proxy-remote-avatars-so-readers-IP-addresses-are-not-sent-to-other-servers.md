---
id: TASK-134
title: Proxy remote avatars so readers' IP addresses are not sent to other servers
status: Done
assignee:
  - '@claude'
created_date: '2026-09-28 23:36'
updated_date: '2026-09-29 03:26'
labels:
  - privacy
  - federation
milestone: m-19
dependencies: []
references:
  - 'https://specification.website/spec/privacy/third-party-scripts/'
  - 'https://specification.website/spec/privacy/data-minimization/'
priority: medium
type: enhancement
ordinal: 158800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Avatars of fediverse and webmention participants are hotlinked from remote servers (themes/default partials/conversation.njk). Every reader who opens a post with replies sends their IP address and user agent to each of those servers. The site ships no other third-party requests, so this is the one leak. Fetching, resizing and caching avatars locally closes it and also makes pages faster.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Public pages reference remote avatars only through a same-origin URL
- [x] #2 The proxy fetches only avatar URLs the site has recorded (it is not an open proxy), limits size and content type, and resizes to the size the theme displays
- [x] #3 Cached avatars are refreshed on a schedule and a failed fetch falls back to a local placeholder
- [x] #4 The cache is disposable: deleting it loses nothing that cannot be refetched (decision-9)
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Data shape: an avatar is identified by its recorded source URL. Public markup carries /_geekity/avatars/<base64url(source)>; the route decodes the key and asks the SQLite index whether the URL is recorded (an icon_url of a follower whose actor has something in the inbox log, or the author_avatar of an approved comment/webmention). Anything else is 404, so it is not an open proxy and needs no registry or secret. Cache: <dataDir>/avatars/<sha256(source)>.webp (80x80, 2x the 40px the theme shows) plus a <hash>.failed marker for negative caching; freshness by mtime, disposable per decision-9.

1. Extract the SSRF-checked, redirect-checked, byte-capped fetch from webmention/reply-context.ts into webmention/fetch-public.ts (bytes, content-type check); reply context uses it unchanged in behaviour.
2. AdminStore: isAvatarSource(url) and listAvatarSources(); migration 19 indexes followers.icon_url and comments.author_avatar.
3. src/avatars/: avatarHref/avatarSourceOf (key codec); createAvatarService: serve(source) returns cached image, or joins/starts a bounded fetch (2 s wait on first view, 10 s fetch timeout, 2 MB cap, jpeg/png/gif/webp/avif only, checked by header and by sharp) and falls back to a local SVG placeholder; sweep() fetches missing/stale (7 days) recorded avatars and prunes files no longer recorded; start()/stop()/settled() on a 6 h unref'd timer like the digests.
4. Route GET /_geekity/avatars/:key (image/webp with ETag and a day's max-age; placeholder with a short max-age; 404 when not recorded). Not exempt from maintenance mode: the pages that show avatars are 503 then.
5. conversation.ts hands themes the same-origin href for follower and webmention avatars, so every theme and quote mention gets it.
6. Wire in index.ts (c.var.avatars, sweep on serve, stop/settle on close); document in the theme README.
Feeds and JSON/Markdown representations carry no avatars (checked), reply contexts store no photo, comment HTML unwraps img: nothing to change there.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Audit of remote images on public surfaces: the only hotlinks were author.avatar in partials/conversation.njk (fediverse followers via authorNaming, which also covers approved quote mentions, and webmention h-card photos via comment files). Reply contexts store no photo (decision-19 shape has author name/url only), comment HTML unwraps <img> in sanitize.ts, and the RSS/Atom/JSON feeds and the post's JSON/Markdown representations carry no avatars, so feeds needed no change.

Design: the key is base64url(source URL); AdminStore.isAvatarSource answers with one indexed query (migration 19 indexes followers.icon_url and comments.author_avatar). Recorded = icon_url of a follower whose actor appears in ap_inbox, or author_avatar of an approved comment. No registry or secret, so a restart or a cached page never breaks a URL. The avatar is rewritten in conversation.ts, so every theme (and the fixture layout) gets the same-origin path without template changes.

Fetching reuses the webmention guards: the redirect-checked, publicHost-checked, byte-capped fetch was extracted from reply-context.ts into webmention/fetch-public.ts and both use it. Pictures are decoded and re-encoded by sharp (limitInputPixels 4096^2, format must be jpeg/png/gif/webp/heif) to an 80x80 WebP, 2x the 40px the default theme shows.

Off the request path: avatars.start() in serve() sweeps now and every 6 h (missing or older than 7 days are fetched; files no recorded URL names are deleted). A first view with nothing cached waits at most 2 s for the fetch, then gets the placeholder SVG (max-age 300); a failure writes a .failed marker and is not retried for an hour.

Not exempt from maintenance mode: the pages that show avatars are 503 then.

Verification: src/avatars/avatars.test.ts (14 tests) plus updated conversation/site/markup tests. Each guard was mutated to confirm a test fails (dropping avatarHref in conversation.ts, dropping isAvatarSource, ignoring age in the sweep, inverting the prune). Live: served a scratch site with dist, curl showed page <img src=/_geekity/avatars/...>, 200 image/webp 80x80 max-age=86400 for a real gravatar, 200 image/svg+xml max-age=300 for a 404 source, 404 for an unrecorded URL, and after rm -r data/avatars the next request refetched a WebP. Server stopped. pnpm build, test (2400 + 30), typecheck, lint, format:check all pass.

Known gaps, not in this task's criteria: the copyable Eleventy example config (docs/eleventy.config.example.js) still hands static builds the remote avatar URL, since a static site has no proxy; the site owner's own profile avatar may be a full URL they typed (bio.njk, jsonld); the admin followers screen hotlinks follower icons (admin only). Process note: the code was written before its tests in this run; the tests were then checked against mutations instead.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Remote avatars are now served from /_geekity/avatars/<base64url of the source>. The conversation reader hands themes that path in place of the remote URL. The route answers only URLs the index records (an interacting follower's icon, or an approved comment's or webmention's photo) and returns 404 for anything else without fetching it. It fetches through the shared SSRF-guarded fetch (public hosts only, every redirect hop checked, 10 s, 2 MB, raster types only) and re-encodes the picture with sharp to an 80x80 WebP under data/avatars/, a disposable cache. A background sweep on serve and every 6 h refetches pictures older than 7 days and prunes ones nothing shows. A failed fetch serves a local SVG placeholder, and a first view waits at most 2 s. Feeds, JSON/Markdown representations and reply contexts carried no remote images, so they did not change. Verified with 14 new tests (mutation-checked), the full suite, typecheck, lint, format and a live curl against a served scratch site.
<!-- SECTION:FINAL_SUMMARY:END -->
