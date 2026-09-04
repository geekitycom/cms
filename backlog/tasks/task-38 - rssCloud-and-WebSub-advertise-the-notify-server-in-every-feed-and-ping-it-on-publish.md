---
id: TASK-38
title: >-
  rssCloud and WebSub: advertise the notify server in every feed and ping it on
  publish
status: Done
assignee:
  - '@claude'
created_date: '2026-09-04 00:38'
updated_date: '2026-09-04 03:43'
labels:
  - web
  - federation
milestone: m-5
dependencies:
  - TASK-37
  - TASK-19
references:
  - 'https://rpc.rsscloud.io/docs/quick-start'
  - 'https://rpc.rsscloud.io/docs'
  - 'https://www.jsonfeed.org/version/1.1/'
  - 'https://www.w3.org/TR/websub/'
type: feature
ordinal: 27500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The user operates https://rpc.rsscloud.io/, which speaks both rssCloud and WebSub, so real-time notification is advertising that server from every feed and telling it when a feed changes. Add one setting, `notifyServer`, an https URL defaulting to `https://rpc.rsscloud.io` and empty to turn the feature off, on the settings screen and mirrored to `site.json`. From it derive everything the quick-start asks for.

Advertising. RSS 2.0 (`/feed/` and every taxonomy RSS feed) carries all three in `<channel>`: the legacy `<cloud domain="rpc.rsscloud.io" port="80" path="/pleaseNotify" registerProcedure="" protocol="http-post"/>` (host from the setting, port 80 and http-post as the quick-start prescribes for the legacy element), `<source:cloud>https://rpc.rsscloud.io/pleaseNotify</source:cloud>` under `xmlns:source="https://source.scripting.com/"`, and `<atom:link rel="hub" href="https://rpc.rsscloud.io/websub"/>` next to the existing `rel="self"`. Atom feeds carry `<source:cloud>` (it is namespaced) and the `rel="hub"` link but no `<cloud>`. JSON Feed carries `"hubs": [{ "type": "WebSub", "url": "https://rpc.rsscloud.io/websub" }]` per JSON Feed 1.1. Every feed response, all formats and all taxonomy variants, sends the WebSub discovery header `Link: <https://rpc.rsscloud.io/websub>; rel="hub", <absolute feed url>; rel="self"`.

Pinging. The server notifies nobody until it hears the feed changed, so after a post is published, updated or withdrawn (the same index changes that drive ActivityPub delivery, and never for a full scan) the CMS POSTs `https://rpc.rsscloud.io/ping` with `url=<feed url>` for every feed whose contents changed: the three site feeds and the three feeds of each tag and category the post carries, before and after the change. Pings are best effort, serialised, logged on failure, and never block the request or the save; they run through a hook a site can also call. See "rssCloud over REST" in the docs for the response shape and "WebSub → Publishing" for the equivalent; either reaches every subscriber.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 With the default setting, /feed/ contains the cloud element with port 80 and http-post, the source:cloud element and the hub link, alongside rel=self
- [x] #2 Atom feeds contain source:cloud and the hub link and no cloud element; JSON feeds contain a hubs array with the WebSub hub
- [x] #3 Every feed response in every format, site-wide and per taxonomy, carries a Link header with rel=hub and rel=self, self being the feed's absolute URL
- [x] #4 Publishing, editing or unpublishing a post pings the notify server once per affected feed URL, proved by a test that stubs the server and records the ping bodies; a full scan pings nothing
- [x] #5 An empty notifyServer removes every element, header and ping; a different URL moves all of them
- [x] #6 A failed ping is logged and the publish still succeeds
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Setting. Add `notifyServer` to `SiteSettings` (default `https://rpc.rsscloud.io`, empty = off) along the exact path `language` took: DEFAULT_SITE_SETTINGS, SETTINGS_FIELDS (`notify_server`), readSiteSettings, writeSiteSettings, settingsProblems (empty, or an absolute http(s) URL, normalised like baseUrl), settingsFromForm, formFromSettings, settingsSiteData, siteJsonFor, seedSiteSettings, SiteData, and a field on the settings screen under a new "Notifications" heading.
2. Endpoints. In `src/web/feeds.ts`, derive everything from the one setting: `DEFAULT_NOTIFY_SERVER`, `NOTIFY_PATHS` (`/pleaseNotify`, `/websub`, `/ping`), `notifyEndpoints(url)` -> `{ base, pleaseNotify, hub, ping, cloud: { domain, port: 80, path, registerProcedure: '', protocol: 'http-post' } }` or undefined, and `notifyServerOf(site)` reading `site.notifyServer`. Empty or unparseable is undefined, which is what turns the whole feature off.
3. Advertising. `rssFeed` gains `<cloud>`, `<source:cloud>` and `<atom:link rel="hub">` right after `rel="self"`; `atomFeed` gains `<source:cloud>` and the hub link (and `xmlns:source` on `<feed>`); `jsonFeed` gains `hubs: [{ type: 'WebSub', url }]` (new `JsonFeedHub`); `commentsRssFeed` gains the same three as RSS plus `xmlns:source`. `link()` takes an optional `type` so the hub link carries none.
4. Headers. Lift the etag/last-modified Headers construction shared by `feedResponse` and `commentsFeedResponse` into one helper that also writes `Link: <hub>; rel="hub", <self>; rel="self"`, built before the 304 early return so a 304 carries it too. Both fingerprints take the notify server in, so changing the setting changes every validator.
5. Pinging. New `src/notify.ts`: `createFeedNotifier({ admin, config, fetch?, logger? })` -> `FeedNotifier { notify(urls), handle(change), settled() }`. `handle` ignores `origin === 'scan'` and anything neither before nor after `isFederatedDocument`, then collects the three site feeds plus the three feeds of every tag and category on the public before and after (via `feedHref` and the stored bases), absolutised against baseUrl, deduped. Pings are serialised on a chain, POST form-encoded `url=` to the ping endpoint with a timeout, never throw, and log a failure through the logger.
6. Wiring. Build the notifier beside the delivery service in `src/index.ts`, subscribe it to `change`, await `settled()` in `close()`, and expose `cms.notifier` plus `cms.notifyFeeds(urls)`; export the types from the package root.
7. Docs: doc-3's Feeds section, packages/cms/README.md (feeds and settings), themes/default/README.md, root README's site.json key list.
8. Verify: pnpm build, test, typecheck, lint, format:check from the root, then the running demo over curl — the three site feeds and the taxonomy feeds with the default setting, with it emptied and pointed at a local stub, xmllint on the XML, and a stub server that records the ping bodies to prove a publish, an edit and an unpublish each ping the right URLs and a full scan pings nothing. The real rpc.rsscloud.io is never pinged from the demo.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## What was built

One setting, `notifyServer`, and everything an rssCloud and WebSub server needs derived from it.

- **`src/web/feeds.ts`** — `DEFAULT_NOTIFY_SERVER` (`https://rpc.rsscloud.io`), `NOTIFY_PATHS` (`pleaseNotify`, `websub`, `ping`), `NOTIFY_CLOUD_PORT` (80), `NOTIFY_CLOUD_PROTOCOL` (`http-post`), `JSON_FEED_HUB_TYPE` (`WebSub`), the `NotifyServer` shape, `notifyEndpoints(url)` and `notifyServerOf(site)`. `rssFeed` writes `<cloud>`, `<source:cloud>` and `<atom:link rel="hub">` straight after the `rel="self"`; `atomFeed` writes `<source:cloud>` and `<link rel="hub">` and declares `xmlns:source` on `<feed>`; `jsonFeed` writes `hubs`; `commentsRssFeed` writes the same three as RSS and gained `xmlns:source` for them. `link()` now takes an optional `type`, because a hub link declares none.
- **Headers.** `feedResponse` and `commentsFeedResponse` duplicated the validator headers; both now build them through one `feedHeaders(source, etag, lastModified)` over a new `FeedIdentity` (`site`, `feedHref`, `baseUrl`), which also writes `feedLinkHeader(source)` — `<hub>; rel="hub", <self>; rel="self"` — *before* the 304 early return. Both fingerprints take the notify server in, so moving it moves every ETag.
- **`src/notify.ts`** (new) — `createFeedNotifier({ admin, config, logger? })` giving a `FeedNotifier`: `notify(urls)`, `feedsFor(change)`, `handle(change)` and `settled()`, plus `NotifyPing`, `NotifyReport`, `NotifyLogger` and `NOTIFY_TIMEOUT_MS` (10s). `feedsFor` drops `origin === 'scan'` and anything neither before nor after `isFederatedDocument`, then collects the three site feeds and the three feeds of every tag and category on the public before *and* after, absolutised and deduplicated. A ping is a form POST of `url=` to `{server}/ping`, chained behind the last one, timed out, never thrown, and logged on failure.
- **Settings.** `notifyServer` follows the path `language` took, through `SiteSettings`, `DEFAULT_SITE_SETTINGS`, `SETTINGS_FIELDS` (`notify_server`), the reader, the writer, `settingsProblems`, `settingsFromForm`, `formFromSettings`, `settingsSiteData`, `siteJsonFor`, `seedSiteSettings`, `SiteData` and a Notifications section on the settings screen.
- **Wiring.** `createCms` builds the notifier beside the delivery service, subscribes it to `change`, awaits `settled()` in `close()`, and exposes `cms.notifier` and `cms.notifyFeeds(urls)`. Everything new is exported from the package root.
- **Docs.** doc-3 gained a "Real-time notification" section; `packages/cms/README.md` gained one too, and its RSS, comments, Atom and JSON paragraphs name the new elements; the root README's settings section, field table and `site.json` key list; the theme README's site-data paragraph.

## Decisions

- **Empty is a value, so the mirror has to carry it.** `settingsSiteData` drops empty strings on purpose, so a key a site keeps in `site.json` by hand is overlaid rather than blanked. `notifyServer` is written even when empty — empty is how the feature is turned off, and an absence would be filled back in by the default — and `seedSiteSettings` accepts an empty string from the file for the same reason. Correspondingly `notifyServerOf` reads a *missing* key as no server rather than as the default: the default lives in the settings, and the file is a faithful mirror of them.
- **http as well as https.** The task says an https URL. The validator takes any absolute `http://` or `https://` one, normalised by the same function `baseUrl` uses, because a notify server on a private network or a loopback port is a real one — and because that is what made the live proof below possible without pinging the real server from localhost.
- **Comments feeds advertise the cloud too.** The task says every feed response, and a comments feed is a feed: it is polled, it can be registered with `pleaseNotify`, and an rssCloud server polls what it has subscribers for. So the header and the three channel elements are on both comments feeds. What is *not* there yet is a ping when a reply arrives — replies are TASK-50's — so a comments-feed subscriber is served by the server's own polling until then.
- **The `Link` header is built before the conditional is decided.** A poller mostly gets the 304, and a 304 that dropped the hub would hide the one thing that would stop it polling. That is what forced the two response builders onto one header helper.
- **`handle` returns `void`, not a promise.** Delivery's `handle` is awaited because it stamps the file before it queues; a ping has nothing to write, so it queues and returns. The save is already done and the editor's redirect should not wait on a notification about it. `settled()` is how a test or a shutdown waits.
- **The affected feeds are the union of before and after.** A post that left a tag changed that tag's feed exactly as much as the one it joined, and a withdrawn post changed every feed it was in.
- **Same predicate as delivery.** `isFederatedDocument` — a published post, not a page and not a draft — is reused rather than re-derived: it is the same question, and a document that goes to the followers is a document that goes in the feeds.

## Verification

Tests at the existing seams: `cms.app.request` through the public site and the admin, the bytes of `content/_data/site.json`, and a stubbed `globalThis.fetch` recording the ping bodies, which is how `delivery.test.ts` already records deliveries. 15 new cases — 8 in the new `src/notify.test.ts`, 4 in `src/web/feeds.test.ts` (7 counting the ones split out of the existing describe), 3 in `src/admin/settings.test.ts`. `feeds.test.ts` gained an `atomLinkWithRel` helper because a channel now holds two `atom:link` elements.

From the repository root: `pnpm build` clean; `pnpm test` 696 pass / 0 fail (`@geekity/cms`) and 11 pass / 0 fail (demo); `pnpm test:11ty` 9 and 5; `pnpm typecheck`, `pnpm lint` and `pnpm format:check` all clean.

Live, against the demo on port 3000 signed in as `ada`, with a Node stub cloud on 127.0.0.1:3456 recording every POST body. The real rpc.rsscloud.io was never pinged: nothing was published while the setting held it.

- **AC #1.** `/feed/` carries `<cloud domain="rpc.rsscloud.io" port="80" path="/pleaseNotify" registerProcedure="" protocol="http-post"/>`, `<source:cloud>https://rpc.rsscloud.io/pleaseNotify</source:cloud>` and `<atom:link rel="hub" href="https://rpc.rsscloud.io/websub"/>` beside the `rel="self"`; the same three on `/tag/web/feed/`, `/category/engineering/feed/`, `/comments/feed/` and a post's `{permalink}feed/`. `xmllint --noout` clean on all six.
- **AC #2.** `/feed/atom/` carries `<source:cloud>` and `<link rel="hub" href="https://rpc.rsscloud.io/websub"/>` and `grep -c '<cloud'` is 0. `/feed/json/` and `/tag/web/feed/json/` both carry `"hubs": [{"type": "WebSub", "url": "https://rpc.rsscloud.io/websub"}]`.
- **AC #3.** All six feed URLs above, in all three formats where they have three, answered `Link: <https://rpc.rsscloud.io/websub>; rel="hub", <{that feed's absolute URL}>; rel="self"` — the self being the URL requested, not the site's. A conditional request with the feed's own ETag answered `304` carrying the identical header.
- **AC #4.** With the setting pointed at the stub: publishing a post tagged `web, testing` in `engineering` produced exactly 12 pings, all `POST /ping` with `content-type: application/x-www-form-urlencoded` and `url=` the feed — the three site feeds and the three of each of `tag/web`, `tag/testing` and `category/engineering`. Retagging it to `notes` with no category produced 15: the site's three, the three old tag feeds, the old category's three, and the new tag's three. Unpublishing it produced 6: the site's three and `tag/notes`'s three. A full scan pinged nothing: a second instance booted on port 3199 over a *fresh* data directory — a cold index, so every one of the 5 posts was reported as created — wrote zero lines to the stub's log, and so did a restart over the warm index.
- **AC #5.** Saving `http://127.0.0.1:3456` moved everything at once on the next request: the `<cloud domain="127.0.0.1" path="/pleaseNotify" port="80">`, the `source:cloud`, the hub link, the JSON `hubs` and the `Link` header. Saving an empty value removed the `Link` header, the `<cloud>`, the `source:cloud` and the hub link from `/feed/`, `/feed/atom/`, `/feed/json/`, `/tag/web/feed/` and `/comments/feed/`, left `hubs` out of the JSON feed, and made a republish ping nothing at all. `rpc.rsscloud.io` with no scheme was a 400 with "A notify server is an absolute http:// or https:// URL, or empty for none." under the field, and the stored value was untouched.
- **AC #6.** With the setting on a dead port, publishing answered 303 and the post was in `/feed/` on the next request, while the log carried one `Could not ping http://127.0.0.1:3457/ping about {feed}: fetch failed` per affected feed.

The demo was put back: the test post was trashed through the admin and its file deleted, `notifyServer` returned to `https://rpc.rsscloud.io`, and `git diff apps/demo/content/_data/site.json` shows the pre-existing `timezone` and `avatar` lines plus the keys the mirror writes (`language`, `tagBase`, `categoryBase`, `notifyServer`). `pgrep -fl "tsx watch"`, `pgrep -fl server.ts` and `lsof -nP -iTCP:3000` all report nothing, and the stub is stopped.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Feeds now say where to be told they changed, and the site says it. One setting, `notifyServer` — an absolute http(s) URL, `https://rpc.rsscloud.io` by default and empty for none — is the whole of the feature; the three endpoints are derived from it, so there is one thing to move and one thing to turn off.

Every RSS channel carries all three spellings of the same server — the legacy `<cloud>` with port 80 and `http-post` as rpc.rsscloud.io's quick start prescribes, `<source:cloud>` under Dave Winer's namespace, and `<atom:link rel="hub">` — beside the `rel="self"` TASK-37 put there. Atom carries the namespaced two and no `<cloud>`; JSON Feed carries `hubs` per 1.1; and every feed response in every format, the two comments feeds included, carries `Link: <hub>; rel="hub", <self>; rel="self"`. That header is built before the conditional is decided, so a 304 carries it too — which is the point, because a poller mostly gets the 304 and that is the response that should tell it to stop polling. Getting there meant lifting the validator headers the two response builders had each been writing into one helper.

Advertising a cloud that is never told anything would leave the subscribers polling, so the other half is `src/notify.ts`: a `FeedNotifier` subscribed to the same index changes that drive ActivityPub delivery, which posts `url={feed}` to `{server}/ping` for the three site feeds and the three feeds of every tag and category the post carried before *and* after the change — a post that left a tag changed that tag's feed as much as the one it joined. Never for a full scan, never for a draft or a page. Pings are serialised, deduplicated, given ten seconds, and best effort: a refusal is a line in the log, never a lost save. A site can call it directly as `cms.notifyFeeds(urls)`.

Verified by 15 new node:test cases — 8 in `src/notify.test.ts` recording ping bodies through a stubbed `fetch`, the way `delivery.test.ts` records deliveries — and by a live pass against the running demo: the elements and the `Link` header on eleven feed URLs with `xmllint` clean, the header identical on a 304, 12 pings for a publish, 15 for a retag and 6 for an unpublish with exactly the right URLs, zero for a cold boot scan over a fresh index, everything gone when the setting is emptied and moved when it names another server, a malformed value refused with the stored one intact, and a publish against a dead server logged once per feed with the post still in the feed. `pnpm build`, `test` (696 + 11), `test:11ty` (9 + 5), `typecheck`, `lint` and `format:check` all pass. The real rpc.rsscloud.io was never pinged from the demo; the demo was restored and port 3000 released.
<!-- SECTION:FINAL_SUMMARY:END -->
