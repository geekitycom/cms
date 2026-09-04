---
id: doc-3
title: Content Negotiation
type: specification
created_date: '2026-09-02 13:21'
updated_date: '2026-09-04 02:43'
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

`/feed/` is RSS because that is the format nearly every existing subscriber holds. The site's three are registered routes; the per-archive ones are resolved in the not-found handler, because the two bases are a setting and a route table is fixed when the app is built.

WordPress's older spellings redirect 301 rather than 404: `/feed/rss/` to `/feed/`, and `?feed=rss2`, `?feed=rss`, `?feed=atom` and `?feed=json` on any listing to that listing's feed. A feed URL without its trailing slash redirects to the canonical one in a single hop, exactly as any other listing URL does.

## Caching

Responses carry `ETag` derived from the document's content hash and representation, and `Last-Modified` from `updated`. Conditional requests return 304.
