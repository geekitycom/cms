---
id: doc-3
title: Content Negotiation
type: specification
created_date: '2026-09-02 13:21'
updated_date: '2026-09-04 03:12'
---
# Content Negotiation

Every public content URL serves one document in several representations. The representation is chosen from the `Accept` header, with a file-extension escape hatch for humans and tools that cannot set headers.

## Representations

| Media type | Body | Notes |
| --- | --- | --- |
| `text/html` | rendered through the theme | default when nothing else matches |
| `text/markdown` | the file as stored, front matter included | `Content-Disposition: inline`, charset utf-8 |
| `application/json` | `{ "frontMatter": {...}, "markdown": "...", "html": "...", "url": "..." }` | stable shape, versioned via `"schema": 1` |
| `application/activity+json` | ActivityStreams object | handled by Fedify, not by this layer |
| `application/ld+json; profile="https://www.w3.org/ns/activitystreams"` | same | same |

## Selection

1. If the path ends in `.md` or `.json` and the path without the extension resolves, use that representation and ignore `Accept`.
2. Otherwise run standard `Accept` matching with q-values against the list above. `*/*` and a missing header mean HTML.
3. ActivityStreams types are claimed by the Fedify middleware before this code runs, so they never reach the negotiator; the table lists them for completeness.
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

`/feed/` is RSS because that is the format nearly every existing subscriber holds. The site's three are registered routes; the per-archive ones are resolved in the not-found handler, because the two bases are a setting and a route table is fixed when the app is built.

WordPress's older spellings redirect 301 rather than 404: `/feed/rss/` at any of those roots to that root's RSS feed, `?feed=rss2`, `?feed=rss`, `?feed=atom` and `?feed=json` on any listing to that listing's feed, and `?feed=rss2` or `?feed=rss` on a post's permalink to that post's comments feed. A feed URL without its trailing slash redirects to the canonical one in a single hop, exactly as any other listing URL does.

## Comments

The two comments feeds carry the fediverse replies the inbox has logged: a `Create` of a `Note` whose `inReplyTo` names a post's ActivityStreams object id. They are RSS 2.0 and nothing else — `{permalink}feed/atom/` 404s — because a comments feed is what WordPress served in that one format and nothing subscribes to it in another.

A published post always has one, empty when nobody has answered: it exists, and a reader that subscribed early should keep polling. A permalink that is no published post 404s, and so does a page's, because only posts federate. A reply whose post is later unpublished or trashed leaves `/comments/feed/` with it.

Each RSS post item points at its own comments three ways: `<comments>` (the page), `<wfw:commentRss>` (the feed) and `<source:comments count feedUrl>` (the feed and how many). The reply HTML is sanitised against an allowlist before it is published: it is markup a stranger wrote.

## Caching

Responses carry `ETag` derived from the document's content hash and representation, and `Last-Modified` from `updated`. Conditional requests return 304.
