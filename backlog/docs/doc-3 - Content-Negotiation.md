---
id: doc-3
title: Content Negotiation
type: specification
created_date: '2026-09-02 13:21'
updated_date: '2026-09-13 02:03'
---
# Content Negotiation

Every public content URL serves one document in several representations. The representation is chosen from the `Accept` header, with a file-extension escape hatch for humans and tools that cannot set headers.

## Representations

| Media type | Body | Notes |
| --- | --- | --- |
| `text/html` | rendered through the theme | default when nothing else matches |
| `text/markdown` | the file as stored, front matter included | `Content-Disposition: inline`, charset utf-8 |
| `application/json` | `{ "frontMatter": {...}, "markdown": "...", "html": "...", "url": "..." }` | stable shape, versioned via `"schema": 1` |
| `application/activity+json` | the post's ActivityStreams `Article` | a published post only; its `id` is this URL (decision-13) |
| `application/ld+json; profile="https://www.w3.org/ns/activitystreams"` | same | same |

## Selection

1. If the path ends in `.md` or `.json` and the path without the extension resolves, use that representation and ignore `Accept`.
2. Otherwise run standard `Accept` matching with q-values against the list above. `*/*` and a missing header mean HTML.
3. ActivityStreams types are claimed before this code runs, so they never reach the negotiator. A post's object id is its permalink, so the permalink itself answers them with the `Article`: one URL, a browser and a peer, decided by `Accept`. A page and a listing federate nothing and fall through to the negotiator, which answers 406 to a request that will take nothing else.
4. A request whose only acceptable types are unsupported returns 406 with a short JSON body listing the options.

Every response includes `Vary: Accept` and a `Link` header advertising the alternates:

```
Link: </2026/09/hello-world/index.md>; rel="alternate"; type="text/markdown",
      </2026/09/hello-world/index.json>; rel="alternate"; type="application/json"
```

## Collections

Listing URLs (home, tag archives, paginated archives) negotiate too. HTML renders the theme's list template. JSON returns an array of the same document shape with `markdown` and `html` omitted unless `?full=1`. Markdown is not offered for listings.

## Feeds

Feeds are routes, not representations, because feed readers do not send useful `Accept` headers. They follow WordPress's layout so a migrated site keeps its subscribers:

| URL | Format |
| --- | --- |
| `/feed/` | RSS 2.0 (`application/rss+xml`) |
| `/feed/atom/` | Atom 1.0 (`application/atom+xml`) |
| `/feed/json/` | JSON Feed 1.1 (`application/feed+json`) |
| `/{tagBase}/{tag}/feed/`, `/{categoryBase}/{name}/feed/` | The same three over one archive |
| `/comments/feed/` | Every reply the inbox has been sent, as RSS 2.0 |
| `{permalink}feed/` | One post's replies, the same way |

Every format renders the same **feed item**: one shape derived once per post and site, carrying the post's name — its ActivityStreams object id — beside its permalink, and its title, published and updated instants, author, terms, summary and rendered body. The RSS, Atom and JSON Feed serialisers write that item rather than reading the document again, so what a feed says about a post is decided in one place; decision-12 is what it decides, and the item carries one of each thing so no format can print a second-best version of it.

The three answers, on the wire. **Identity**: the object id is RSS's `guid`, Atom's `<id>` and JSON Feed's `id`, and the permalink is always the link — RSS's `<link>`, Atom's `rel="alternate"` and JSON Feed's `url`. The two are the same URL for a post born here and differ only for one carrying a stored id, which is what `guid`'s `isPermaLink` reports: `true` for the permalink, `false` for a stored id such as `https://example.com/?p=813`. **Terms**: the post's categories and then its tags, in file order, as one flat list in all three — no feed format can say which vocabulary a term came from, and neither does WordPress. **Summary**: the document's `description` when it has one, else an excerpt of the rendered HTML cut at 55 words, printed by all three and left out only when there is nothing to summarise.

`/feed/` is RSS because that is the format nearly every existing subscriber holds. The site's three are registered routes; the per-archive ones are resolved in the not-found handler, because the two bases are a setting and a route table is fixed when the app is built.

WordPress's older spellings redirect 301 rather than 404: `/feed/rss/` at any of those roots to that root's RSS feed, `?feed=rss2`, `?feed=rss`, `?feed=atom` and `?feed=json` on any listing to that listing's feed, and `?feed=rss2` or `?feed=rss` on a post's permalink to that post's comments feed. A feed URL without its trailing slash redirects to the canonical one in a single hop, exactly as any other listing URL does.

## Real-time notification

One setting, `notifyServer`, decides it: an rssCloud and WebSub server, `https://rpc.rsscloud.io` by default and empty for none. Every feed advertises it and the site pings it, so a subscriber hears about a post at once rather than on its next poll.

An RSS channel carries all three spellings — the legacy `<cloud domain port="80" path="/pleaseNotify" registerProcedure="" protocol="http-post">`, `<source:cloud>` holding `{notifyServer}/pleaseNotify`, and `<atom:link rel="hub">` holding `{notifyServer}/websub` — beside the existing `rel="self"`. An Atom feed carries the `source:cloud` and the hub link but no `<cloud>`, which has no namespace. A JSON Feed carries `hubs: [{ type: "WebSub", url }]`. Every feed response in every format, the comments feeds included, carries `Link: <hub>; rel="hub", <self>; rel="self"`, on a 304 as well as on a body: a poller mostly gets the 304, and that is the response that should tell it to stop polling.

Pinging is a form POST of `url={feed}` to `{notifyServer}/ping`, one per feed whose contents moved, when a post is published, edited or withdrawn — the index changes that drive ActivityPub delivery, and never a full scan. The feeds that moved are the site's three plus the three of every tag and category the post carried before and after the change. Pings are serialised, deduplicated, time-limited and best effort: a failure is logged and the save stands.

## Comments

The two comments feeds carry the fediverse replies the inbox has logged: a `Create` of a `Note` whose `inReplyTo` names a post's ActivityStreams object id — its permalink, or the id its file stores. They are RSS 2.0 and nothing else — `{permalink}feed/atom/` 404s — because a comments feed is what WordPress served in that one format and nothing subscribes to it in another.

A published post always has one, empty when nobody has answered: it exists, and a reader that subscribed early should keep polling. A permalink that is no published post 404s, and so does a page's, because only posts federate. A reply whose post is later unpublished or trashed leaves `/comments/feed/` with it.

Each RSS post item points at its own comments three ways: `<comments>` (the page), `<wfw:commentRss>` (the feed) and `<source:comments count feedUrl>` (the feed and how many). The reply HTML is sanitised against an allowlist before it is published: it is markup a stranger wrote.

## Crawlers

Two more fixed routes, at the only paths a crawler looks for them:

| URL | Body |
| --- | --- |
| `/sitemap.xml` | Every public URL as a `<urlset>`, or a `<sitemapindex>` once there are more than 50,000 |
| `/sitemap-{n}.xml` | One file of an index, numbered from one; 404 while the whole sitemap fits in one |
| `/robots.txt` | `User-agent: *`, `Disallow: /admin/`, and an absolute `Sitemap:` line |

The sitemap lists the home archive and each of its pages, every public post and page, and every tag and category archive with each of its pages, under the bases the site holds at that moment. `<lastmod>` is `updated` else `date` for a document, and the newest of those on a listing page; something nothing dates carries no `<lastmod>` rather than an invented one. Drafts, the trash and posts whose date has not arrived are absent, because the sitemap is drawn from the same queries and the same `isPublicDocument` the listings use.

Nothing else is disallowed in `robots.txt`. `/ap/` is left open on purpose: the actor and its collections are documents meant to be fetched, and a crawler that follows one gets JSON it will ignore.

Both are registered routes rather than anything resolved from the index, so a document permalinked at `/sitemap.xml` cannot take the URL a search engine polls, and both carry `ETag` and `Last-Modified` and answer conditional requests with 304 the way the feeds do.

## Caching

Responses carry `ETag` derived from the document's content hash and representation, and `Last-Modified` from `updated`. Conditional requests return 304.

A feed's `ETag` covers the revision of the item format as well as the documents and the site's metadata. A release that changes what a feed says about a post — decision-12's was one — therefore moves every post feed's validator exactly once, rather than handing a polling reader a 304 that hides the new bytes. The comments feeds do not carry the revision, because a comment is not a feed item.

## A stored object id

A post migrated from elsewhere carries an `activitypub.id` in its front matter, which stays its object id for the life of the post (decision-13). That URL is negotiated too, and it is the one place the two audiences are sent different ways: an ActivityStreams request is answered with the post's `Article`, and anything else — a browser following an old link — is redirected 301 to the permalink. The match is on the whole URL, so `https://example.com/?p=813` is served exactly as a path-shaped id is. A post born on the CMS has no stored id and never sees this path.
