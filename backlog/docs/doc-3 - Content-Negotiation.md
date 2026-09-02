---
id: doc-3
title: Content Negotiation
type: specification
created_date: '2026-09-02 13:21'
updated_date: '2026-09-02 13:23'
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

`/feed.xml` (Atom) and `/feed.json` (JSON Feed 1.1) are fixed routes, not negotiated, because feed readers do not send useful `Accept` headers.

## Caching

Responses carry `ETag` derived from the document's content hash and representation, and `Last-Modified` from `updated`. Conditional requests return 304.
