# The public site

Booting mounts the public site on the app. The routes are:

| Route                                   | What it serves                                                                                                                           |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `/`                                     | Published posts, newest first.                                                                                                           |
| `/page/2/` and up                       | Later pages of the same archive.                                                                                                         |
| a document's permalink                  | The post or the page, through the theme.                                                                                                 |
| `/tag/{tag}/`                           | Everything published carrying that tag, paginated at `/tag/{tag}/page/2/`.                                                               |
| `/category/{name}/`                     | The second taxonomy, paginated the same way at `/category/{name}/page/2/`.                                                               |
| `/author/{username}/`                   | One user's published posts, headed by their profile, paginated at `/author/{username}/page/2/`.                                          |
| `/feed/`, `/feed/atom/`, `/feed/json/`  | The recent posts as RSS 2.0, Atom and JSON Feed.                                                                                         |
| `/tag/{tag}/feed/` and its two siblings | The same, for one tag, as in `/tag/{tag}/feed/atom/`; `/category/{name}/feed/` likewise.                                                 |
| `/author/{username}/feed/` and siblings | The same, for one person, as in `/author/ada/feed/atom/`.                                                                                |
| `/comments/feed/`                       | Every reply the inbox has been sent, as RSS 2.0.                                                                                         |
| `{permalink}feed/`                      | One post's replies, the same way.                                                                                                        |
| `/comment/{key}/`                       | One comment left through the form, on a page of its own: see [Comments](comments.md#comments). Noindex and on no list.                   |
| `/sitemap.xml`                          | Every public URL with its `lastmod`, for a search engine, split into an index past 50,000 of them.                                       |
| `/sitemap-{n}.xml`                      | One file of a sitemap too big to be a single one.                                                                                        |
| `/robots.txt`                           | What a crawler may have: everything but `/admin/`, the sitemap, and the site's AI-crawler rules.                                         |
| `/healthz`                              | 200 when the site can serve, 503 when it cannot. See [Health check](#health-check).                                                      |
| `/opensearch.xml`                       | The OpenSearch description, so a browser can offer the site's search from its address bar.                                               |
| `/_geekity/oembed?url=…`                | The oEmbed card of the post or page at `url`, as JSON or with `format=xml`; a 404 for anything else.                                     |
| `/_geekity/embed?url=…`                 | The same card as a page any site may frame, which the oEmbed `html` puts in an iframe; a 404 for anything else.                          |
| `/llms.txt`                             | Every page and post the site lists, for a language model, each linked to its Markdown. See [llms.txt](#llmstxt).                         |
| `/{key}.txt`                            | The IndexNow key, while the site has IndexNow on. See [IndexNow](#indexnow).                                                             |
| `/.well-known/security.txt`             | Where to report a vulnerability; a 404 until a security contact is set. See [security.txt](security.md#securitytxt-and-change-password). |
| `/.well-known/change-password`          | A redirect to the signed-in user's change-password form, or to the login form.                                                           |
| `/_geekity/comments`                    | `POST` only. Where the comment form under a post submits.                                                                                |
| `/_geekity/contact`                     | `POST` only. Where the contact form on a page submits.                                                                                   |
| `/_geekity/webmention`                  | `POST` only. Where a webmention is sent; advertised on every document.                                                                   |
| `/_geekity/moderate`                    | Where an approve, spam or delete link from a notification lands. `GET` shows a button; `POST` acts.                                      |
| `/_geekity/unsubscribe`                 | Where the unsubscribe link in a reply notice lands. Same two steps.                                                                      |
| `/theme/…`                              | The theme's own files, from its `static/` directory, cacheable and validated.                                                            |
| `/uploads/…`                            | A file from `content/uploads/`, byte for byte as it was stored, at the URL an Eleventy build copies it to.                               |
| `/uploads/_/…`                          | One derived copy of an uploaded image, generated on the spot if missing.                                                                 |
| anything else                           | The theme's 404.                                                                                                                         |

The federation routes go on before it, and answer only their own paths:

| Route                           | What it serves                                                                                                                               |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `/author/{username}/`           | The `Person` on an ActivityStreams request; the archive above to anything else.                                                              |
| `/author/{username}/inbox/`     | `POST` only. That user's inbox, signature-verified by Fedify.                                                                                |
| `/author/{username}/outbox/`    | Their published posts as `Create` activities, paged 20 at a time.                                                                            |
| `/author/{username}/followers/` | Who follows them, paged 20 at a time.                                                                                                        |
| `/author/{username}/following/` | Always empty. A relay is a subscription, not a following relationship.                                                                       |
| `/inbox/`                       | `POST` only. The instance-wide shared inbox; the addressee is read out of the body.                                                          |
| `/@{username}`                  | A 301 to their archive, the short URL WordPress publishes; a 404 for a handle that matches no user.                                          |
| `/.well-known/webfinger`        | `acct:{username}@{host}`, the author URL or `/@{username}`, all resolving to the same actor.                                                 |
| `/.well-known/nodeinfo`         | A link to the NodeInfo document.                                                                                                             |
| `/nodeinfo/2.1`                 | What software this is, how many users and how many posts.                                                                                    |
| a post's permalink              | The `Article` on an ActivityStreams request (decision-13), served for an `Accept` of `application/activity+json`; the page to anything else. |

`author` and `inbox` are reserved top-level paths. Every user is an ActivityPub
actor at their author URL. No setting can move these paths, because a changed
actor id is a different account to every follower.

Drafts, documents in the trash and posts whose date has not arrived are not on
the public site. Their URLs return 404, and they are in no listing. A future-dated
post is published on its date without a restart.

Trailing slashes are canonical. A request without one redirects 301 to the URL
with the slash, but only when that URL resolves. A missing URL returns 404 at
once, with no redirect first. `/page/1/` redirects to `/`, because the first
page of a listing is at the listing's own URL.

The server resolves a document only after no registered route matches. A route
a site adds always takes precedence over a permalink with the same path. The
taxonomy archives resolve at the same step, before the documents. The route
table is fixed when the app is built, but the archive bases are a setting. So
the server matches `/{tagBase}/{tag}/` against the current settings on each
request.

The default bases are `tag` and `category`. WordPress uses the same bases, so a
site imported from WordPress keeps every archive URL it published. To move them,
set `tagBase` and `categoryBase` on the Permalinks settings page. On the next
request, these all use the new bases:

- the routes
- the paging
- the canonical redirects
- the tag feeds
- the theme's links
- the ActivityStreams hashtags

The settings are stored as `tagBase` and `categoryBase` in
`content/_data/site.json`, so an Eleventy build of the same content directory
can put its archives at the same URLs. [The archive bases](settings.md#the-archive-bases) has the rules a base
is held to, and how an archive path matches its term.

`postsPerPage` in `content/_data/site.json` sets how many posts a listing page
holds. The default is 10. The same file is the `site` global in every
template.

## Health check

Point a Docker `HEALTHCHECK`, dockge or an uptime monitor at `GET /healthz`. It
runs two checks:

- one query against the content index in `data/geekity.db`
- opening the content directory for reading

When both pass, it answers 200:

```json
{
  "status": "ok",
  "maintenance": false,
  "checks": { "database": "ok", "content": "ok" }
}
```

When either fails, it answers 503, and both that check and `status` read
`"fail"`. A failure is never a 200, because a health checker reads only the
status code. The body names each check and its outcome, and nothing else. It
holds no paths, versions or error messages, because anyone can request it.

The route is registered before federation, the admin and the public site, so a
post or page with the permalink `/healthz/` cannot replace it. The response
carries `Cache-Control: no-store` and sets no cookie. The login throttle does
not count it. A probe every few seconds costs only the two checks. The older
`/_geekity/health` still answers `{ "status": "ok" }` and checks nothing.

`maintenance` says whether the site is in maintenance mode. It does not change
the status code. A site in maintenance mode is still healthy. A 503 would make a
container orchestrator restart a site that the operator took down on
purpose.

## Maintenance mode

Maintenance mode takes the public site down for an upgrade or a restore.
Browsers, crawlers and fediverse servers all treat the outage as temporary.

Turn it on and off at Tools > Maintenance in the admin, or from the command
line:

```
$ geekity maintenance on --until 2026-09-28T14:00:00Z
Maintenance mode is on (/srv/site/data/maintenance.json). Expected back by Mon, 28 Sep 2026 14:00:00 GMT.
$ geekity maintenance status
$ geekity maintenance off
```

The admin screen has a switch and an optional expected-back time, which is the
same time `--until` sets.

While it is on, every public page, feed, sitemap, `robots.txt` and ActivityPub
endpoint answers `503 Service Unavailable` with `Retry-After` and
`Cache-Control: no-store`. `Retry-After` is the `--until` time as an HTTP date
while that time is in the future, and 600 seconds otherwise. A page renders the
theme's `layouts/503.njk`. A `.json` or `.md` request gets the answer in that
format. A crawler keeps the page in its index. A server whose inbox delivery
was refused queues the delivery for a retry and does not drop it.

These requests are still served:

- `/healthz` and `/_geekity/health`, which report `"maintenance": true`.
- The admin, the login page included, so an admin can sign in and work.
- The theme's files under `/theme/`, so the maintenance page is styled.
- Every request from a signed-in user, so an admin can check the site before
  turning maintenance off. These responses carry `Cache-Control: private,
no-store`, so no shared cache keeps one and hands it to a stranger.

The switch is the setting `maintenance.on`, and the expected-back time is
`maintenance.until` (see [Runtime settings](settings.md#runtime-settings)). Both
are stored in `data/maintenance.json` as `{ "on": true, "until": "…" }`. The
running site reads them at most once a second, so a change needs no restart.
The file is in `data/`, not `content/`, because it is operational state.
`content/` is published and committed, and a flag in it would take down every
checkout of the site. A `data/maintenance.json` written by an older version,
where the file being there meant on, is still read as on. The next change
stores the new shape.

`GEEKITY_MAINTENANCE=on`, or `maintenance: true` in the config, puts the site in
maintenance from boot for the life of the process. Use it for a site that must
start in maintenance. While it is set, Tools > Maintenance says so and refuses
to save, and `geekity maintenance off` refuses with the same reason. Restart
without the setting to end it.

## Moved URLs

When you change the slug or the permalink of a published post or page in the
editor, the document moves. The editor writes the old URL into its file:

```yaml
permalink: /2026/01/new-name/
redirect_from:
  - /2026/01/first-name/
  - /2026/01/second-name/
```

Every URL in `redirect_from`, and its `.md` and `.json` spellings, answers
`301 Moved Permanently` with the current permalink. Each entry points to the
document itself, not to the next rename, so redirects never chain. The list is
in the file, so it keeps working after you delete `data/geekity.db`.

Rules for the list:

- A URL in the list redirects only while no other document has that URL. A new
  document at that URL takes it over.
- Moving a document back to a URL in its list removes that URL from the list.
- A draft that was never published and has no comments moves without adding a
  `redirect_from`. A draft with comments was read at its URL, so it keeps a
  `redirect_from` like a published document.
- Correcting a published post's date files it under the new day but keeps its
  URL.

A moved document keeps its conversation:

- Its comments and stored webmentions move to its new slug.
- A reply post that answers any URL in its `redirect_from` stays in its thread.
- Its feeds keep their guid. A post keeps its object id as its
  `activitypub.id`. A page keeps its old URL as its `guid`, so the `/replies/`
  feed a subscriber follows keeps working.
- The record of the webmentions a post has sent moves with it.

The server handles a move made by hand the same way, if the file names the old
URL in `redirect_from`. If you change a permalink by hand without a
`redirect_from`, the old URL returns 404 and its comments stay where they were,
until the file names the old URL.

## Declared redirects

When a site moves to this CMS or reorganises, list the old URLs that no
document owns in `content/_data/redirects.json`. The file is a JSON list:

```json
[
  { "from": "/?p=123", "to": "/2026/01/hello/" },
  { "from": "/old-section/", "to": "/new-section/", "status": 301 },
  { "from": "/sale/", "to": "/shop/", "status": 302 },
  { "from": "/forum/", "to": "https://forum.example.com/", "status": 308 }
]
```

- `from` is a path on this site. It starts with `/` and can carry a query
  string.
- `to` is a path on this site, or an absolute `http` or `https` URL.
- `status` is `301` or `308` for a permanent redirect, and `302` or `307` for a
  temporary one. It defaults to `301`.

A `from` without a query string matches that path with any query, or none. If
the `to` has no query of its own, the server adds the request's query to it, so
`/old-section/?page=2` redirects to `/new-section/?page=2`. The path must match
exactly. One exception: a `from` ending in `/` also matches the same path
without the slash, in one redirect.

A `from` with a query string matches only that query. The order of the
parameters does not matter, so `/archives/?cat=4&paged=2` also matches
`/archives/?paged=2&cat=4`. The request's query must have no other
parameters, so `/?p=123` does not match `/?p=123&replytocom=9`. Use this to send
old WordPress `?p=` links to their posts.

A declared redirect never replaces a real page. The server checks a path-only
`from` after every document, archive, feed and moved URL, just before the 404
page. A document that later gets that URL takes it over. The server checks a
`from` with a query string first, because no document has a query in its URL.
The admin, the federation endpoints and the health check answer before any
declared redirect.

An upload is a real page too. A `from` under `/uploads/` answers only when no
file is at that path, so you can send an old upload URL to where the file
lives now, such as `/uploads/2019/02/resume.pdf` to
`/uploads/2026/03/resume.pdf`. A `redirect_from` on a document can also name
an old upload URL. Paths under `/uploads/_/`, where the server keeps derived
images, never reach a declared redirect.

The server reads the file on the next request after it changes, with no
restart. The server skips an entry it cannot serve, and logs a warning at boot
and again on the first request after the file changes. It skips these
entries:

- An entry with a missing or malformed `from`, `to` or `status`.
- A second entry with the same `from`. The first entry wins.
- Every entry that leads into a loop, such as `/a/` to `/b/` and `/b/` back to
  `/a/`.

A file that is not a JSON list serves no redirects, and the server logs a
warning for it the same way.

### More than one file

The server reads every `*.json` file in `content/_data/redirects/` after
`redirects.json`, in name order, and serves them the same way. A tool that
generates redirects, such as an importer, writes its own file there and does
not edit the site owner's list. A file there, or `redirects.json` itself, can
also be an object that maps each `from` to its `to`, each one a `301`:

```json
{
  "/?p=123": "/2026/01/hello/",
  "/old-section/": "/new-section/"
}
```

If two files declare the same `from`, the file read first wins, so
`redirects.json` wins over every file in the folder. The server logs the other
declaration. The server finds and skips a loop across files the same way as a
loop within one file.

Every redirect the CMS sends carries `X-Redirect-By: Geekity CMS`. This
includes the declared redirects, moved URLs, trailing slashes, feed spellings
and the admin's redirects. When you trace a chain of redirects through a
proxy, the header shows which layer sent each one.

## Content negotiation

Every public URL is one resource with more than one body. A post, a page and
a listing each have three.

| Media type         | Extension | Body                                                                                |
| ------------------ | --------- | ----------------------------------------------------------------------------------- |
| `text/html`        | —         | The document through the theme. The default.                                        |
| `text/markdown`    | `.md`     | The document as Markdown for a Markdown browser. See [The Markdown](#the-markdown). |
| `application/json` | `.json`   | The document as data, see below.                                                    |

Listings are `/`, `/page/N/`, the posts page, the tag, category and author
archives, and their pages. The search at `/search/?q=…` has the same three,
with the query after the extension: `/search/index.md?q=otters` and
`/search/index.json?q=otters`. A comment's own page, `/comment/{key}/`, has
HTML and Markdown at `/comment/{key}/index.md`, and no JSON.

The server chooses the representation in this order:

1. A `.md` or `.json` suffix on the path decides, and the server ignores
   `Accept`. Both spellings work: `/2026/09/hello/index.md` (the one the `Link`
   header advertises) and the shorter `/2026/09/hello.md`.
2. Otherwise the server matches `Accept` with q-values. The highest q wins. A
   tie goes to the more specific range. A remaining tie goes to HTML.
3. No `Accept` header, an empty one, or `*/*` means HTML, so a browser and a
   `curl` with no arguments both get a page.
4. A request that accepts none of the representations gets `406` with a JSON
   body listing what it could have asked for.

A static homepage is served at `/` in every representation, at `/`,
`/index.md` and `/index.json`. Its Markdown front matter says `permalink: /`
and its JSON `url` is the site root, whatever permalink the page's file
carries. Each URL under that permalink answers one `301` to the root form of
the same representation:

| Request (homepage permalink `/about/`) | Answer                 |
| -------------------------------------- | ---------------------- |
| `/about/`                              | `301` to `/`           |
| `/about/index.md`, `/about.md`         | `301` to `/index.md`   |
| `/about/index.json`, `/about.json`     | `301` to `/index.json` |

A page that is not the homepage keeps its own URLs. The posts page's `index.md`
and `index.json` are its listing's.

The feeds are fixed routes and are not negotiated, because feed readers do not
send useful `Accept` headers. See [Feeds](feeds.md).

```sh
curl -H 'Accept: text/markdown' https://example.com/2026/09/hello/
curl https://example.com/2026/09/hello/index.json
curl 'https://example.com/index.json?full=1'
```

### The Markdown

The Markdown representation is written for a Markdown browser such as
[md.geekity.com](https://md.geekity.com/), which follows Dave Winer's
Markdown Browser spec, and for language models. A Markdown browser does no
content negotiation, so every link to a page of the site points at that
page's `.md` URL.

A document's Markdown has four parts:

| Part         | What it holds                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Front matter | The file's front matter, with navigation added. See the table below.                                                                                                                                                                                                                                                                                                                                           |
| Header       | The theme's `partials/markdown-header.md.njk`. The default theme writes the title as a heading, then what kind of post it is (what it replies to, likes, reposts, bookmarks or RSVPs to, an event's time and place, a review's item and rating, and the shared location), a post's recording with its transcript and other versions, its photos as images with their alt text, and the bio where there is one. |
| Body         | The stored body, with its links to the site's own pages pointing at their `.md` URLs.                                                                                                                                                                                                                                                                                                                          |
| Footer       | The theme's `partials/markdown-footer.md.njk`. The default theme writes an archive page's posts, a post's categories and tags, the posts and pages that link here, a post's previous and next posts, the likes, boosts, mentions and threaded replies the HTML shows, links to the comment and contact forms on the HTML page, the page's feeds, a heading, a post's byline and the site's menus.              |

The CMS adds these front matter keys:

| Key               | Value                                                                                                |
| ----------------- | ---------------------------------------------------------------------------------------------------- |
| `home`            | `/index.md`, on every document and listing.                                                          |
| `previous`        | A post's older neighbour, the same one the HTML post navigation links. On a listing, its newer page. |
| `next`            | A post's newer neighbour. On a listing, its older page.                                              |
| `author`          | The author's display name, when the post's `author` names a user.                                    |
| `author_username` | That user's username, beside `author`.                                                               |

Each of `previous` and `next` is absent when there is no neighbour on that
side. A page has neither. All three URLs are root-relative `.md` URLs.

A link in the body is rewritten when the site answers its target with a
document or a listing. The CMS follows the target the way it answers a
request: the homepage rule, `redirect_from`, the declared redirects and
`/?p=ID`. A fragment is kept. These stay as they are written:

- Links to other sites.
- Images.
- Code spans and code blocks.
- Raw HTML.
- Links to URLs with no Markdown, such as `/feed/`.

A link to the search keeps its query, so `/search/?q=otters` becomes
`/search/index.md?q=otters`. A link to a comment's own page points at its
`.md` while the comment is approved and its post is public.

An autolink or a bare URL to a page of the site becomes an inline link with
the URL as its text.

A listing's Markdown has the same front matter keys, the title as a heading,
the site's tagline or the posts page's description as a quote, then the posts
on that page, one line each. On the posts page and each of its later pages,
the page's own Markdown body comes between the quote and the posts, as its
HTML prints the body above the list. Its links to the site's own pages point
at their `.md` URLs, as a document's do:

```markdown
## Posts

- [2026-09-03 Third post](/third/index.md): The third post's description.
```

A page whose front matter says `archive: true` lists every published post
after its own Markdown, as its HTML does. The default theme's footer writes
one level-two heading per month, newest month first, and under each heading
the posts of that month, newest first, one line each in the shape a listing
uses:

```markdown
## September 2026

- [2026-09-03 Third post](/third/index.md): The third post's description.
- [2026-09-01 First post](/first/index.md)
```

On an author archive the header writes the author's bio under the heading.
On a site whose author is a user, a homepage that lists the latest posts
carries that bio too. A homepage that is a page shows only the page, as its
HTML does. A site theme can add the bio there.

The search's Markdown has the listing's shape. Its front matter has the
`title` its HTML page carries, the `permalink` with the query, the `query`
when there is one, and `previous` and `next` for the pages of results on
either side, each with the query kept. Under the heading is a line that says
how many results the query found, or how to search when there is no query.
Then come the results, best match first, each with the snippet that matched
and the matched words in bold, and links to the previous and next pages:

```markdown
---
title: Search results for “otters”
permalink: /search/?q=otters
query: otters
home: /index.md
next: /search/index.md?q=otters&page=2
---

# Search results for “otters”

12 results for “otters”.

## Results

- [2026-09-03 Otters](/otters/index.md): A post about **otters**.
- [About](/about/index.md): I like **otters**.

## More results

- [More results](/search/index.md?q=otters&page=2)
```

A comment's own page writes what its HTML shows. The front matter has the
`title`, the `permalink`, the comment's `author` and its `date`. The header
writes the post the comment is on, with its author, date and summary, then
each comment it answers from the top of the thread down, with its author,
date and words as a quote. A comment a visitor may not see is a line that
says it is no longer shown. Then come the comment's author and date, and the
comment's own words are the body. The footer lists the replies to it,
threaded as a post's are, and links the comment on the post's page:

```markdown
# Comment by Grace Hopper on Hello

On [Hello](/2026/09/hello/index.md), 10 September 2026

> Words.

In reply to [Ada Lovelace](https://ada.example/), [11 September 2026](/comment/0000000000000001/index.md)

> Approved _words_.

Grace Hopper, [11 September 2026](/comment/0000000000000002/index.md)

Answering Ada.

[The whole conversation on Hello](/2026/09/hello/index.md#comment-0000000000000002)
```

Both are `noindex` in every representation and advertise their other
representations in the `Link` header, the search's with the query kept:

```
Link: </search/index.md?q=otters>; rel="alternate"; type="text/markdown",
      </search/index.json?q=otters>; rel="alternate"; type="application/json"
```

A theme overrides either partial like any other template. See
[The Markdown representation](theme/markdown.md).

### The JSON shape

```json
{
  "schema": 1,
  "url": "https://example.com/2026/09/hello/",
  "frontMatter": {
    "title": "Hello, World!",
    "date": "2026-09-02T09:00:00Z",
    "permalink": "/2026/09/hello/",
    "tags": ["introductions"]
  },
  "markdown": "A *file-first* CMS.",
  "html": "<p>A <em>file-first</em> CMS.</p>\n"
}
```

| Key           | Value                                                                                                                                          |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `schema`      | The version of this shape. Within a version, keys are only added.                                                                              |
| `url`         | Absolute, built on the configured `baseUrl`.                                                                                                   |
| `frontMatter` | The document's front matter as the `.md` representation carries it. It is the block the writer emits, unknown keys included, so the two match. |
| `markdown`    | The body without the front matter.                                                                                                             |
| `html`        | The rendered body.                                                                                                                             |

A listing's JSON is a plain array of the same objects without `markdown` and
`html`, so an archive page does not carry every post in full. Add `?full=1` to
include them.

```json
[
  {
    "schema": 1,
    "url": "https://example.com/one/",
    "frontMatter": { "title": "One", "…": "…" }
  },
  {
    "schema": 1,
    "url": "https://example.com/two/",
    "frontMatter": { "title": "Two", "…": "…" }
  }
]
```

A 406 body names the alternates:

```json
{
  "error": "not_acceptable",
  "message": "This URL is not available in any of the media types you accept.",
  "alternates": [
    { "type": "text/html", "url": "/2026/09/hello/" },
    { "type": "text/markdown", "url": "/2026/09/hello/index.md" },
    { "type": "application/json", "url": "/2026/09/hello/index.json" }
  ]
}
```

### Headers

Every negotiated response carries `Vary: Accept` and a `Link` header that
points to the other representations:

```
Link: </2026/09/hello/index.md>; rel="alternate"; type="text/markdown",
      </2026/09/hello/index.json>; rel="alternate"; type="application/json"
```

It also carries these headers:

- `ETag`, derived from the representation and what it holds: the document's
  content hash for the JSON, and what was drawn for the HTML and the
  Markdown, which show the conversation too. A new reply changes the HTML's
  and the Markdown's ETag. A client that holds the JSON never gets a `304`
  for the Markdown.
- `Last-Modified`, on the JSON only, from the document's `updated`, or its
  `date` if it has no `updated`. The HTML and the Markdown show replies,
  which have no date that could agree with their ETag, so they carry none.
- `Cache-Control: no-cache`, so a client revalidates and does not guess how long
  the page stays fresh.

The server honours `If-None-Match` and `If-Modified-Since` and answers with
`304`.

While `watch` is on, the server sends the HTML representation without
validators. The hash covers only the document, and a template edit changes the
page without changing the document. With validators, a development server would
answer `304` for a page that had changed. The `.md` and `.json` representations
have validators either way.

Every representation except HTML carries `X-Robots-Tag: noindex`, whether the
request used an extension or `Accept`. They hold the same content as the page.
Without `noindex`, a search engine would list one page two or three times.

To add a representation, such as an ActivityStreams object, add it to
`Representation` in `src/web/negotiate.ts` with its media type and, optionally,
its extension. The selection, the `Link` alternates, the `ETag` and the 406
body all come from those two tables. The federation middleware handles
ActivityPub types before the negotiator sees them.

## Sitemap and robots.txt

The site serves two more fixed routes, at the two paths a crawler checks by
default.

`/sitemap.xml` is every URL the public site publishes, in the
[sitemap protocol's](https://www.sitemaps.org/protocol.html) `<urlset>`:

- the home archive and each of its pages: `/`, `/page/2/` and so on
- every published post and every page, at its permalink
- every tag archive and every category archive, with each of their pages,
  under the site's configured bases

Each `<loc>` is absolute, built on `baseUrl`. A document's `<lastmod>` is its
`updated`, or its `date` if it has no `updated`. A listing page's `<lastmod>` is
the newest of those dates among the documents on that page. A URL with no date,
such as a page with no date in its front matter, has no `<lastmod>`.

The sitemap holds no hidden URLs. It uses the same queries as the listings and
the same `isListed` check. Drafts, the trash and posts whose date has not
arrived are absent, as their permalinks return 404. An
[unlisted post](content.md#unlisted-posts) is absent, as it is absent from the
home page.

The protocol caps one file at 50,000 URLs. Past that, `/sitemap.xml` becomes a
`<sitemapindex>` naming `/sitemap-1.xml`, `/sitemap-2.xml` and so on, each
holding its own slice and dated by the newest URL in it. The index stays at
`/sitemap.xml`, so the URL a search engine has does not change. While the whole
sitemap fits in one file, the child files return 404.

`/robots.txt` starts short:

```
User-agent: *
Disallow: /admin/

Sitemap: https://example.com/sitemap.xml
```

Everything public is crawlable. Only the admin is not. The actors and their
collections are open on purpose. Other servers fetch actors and objects, and
they hold the same content as the pages that link to them. A crawler that
follows one gets JSON and ignores it.

The Crawlers section of Settings → Reading adds rules to it, and writes its
settings to `site.json`:

| Setting               | `site.json` key                                                       | What the file gains                                                                                                                                                                                                                                                                                                                                                                                             |
| --------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AI crawlers           | `aiCrawlers`                                                          | `allow` (the default) adds nothing. `block-training` adds a `Disallow: /` group for each training crawler: GPTBot, ClaudeBot, anthropic-ai, Google-Extended, Applebot-Extended, Bytespider, CCBot and meta-externalagent. `block-all` also blocks the retrieval crawlers: OAI-SearchBot, ChatGPT-User, PerplexityBot, Perplexity-User, Claude-SearchBot, Claude-User, meta-webindexer and meta-externalfetcher. |
| Content signals       | `contentSignalSearch`, `contentSignalAiInput`, `contentSignalAiTrain` | Each `yes`, `no` or empty. The ones set become one line, such as `Content-Signal: search=yes, ai-input=yes, ai-train=no`.                                                                                                                                                                                                                                                                                       |
| More robots.txt rules | `robotsRules`                                                         | Groups of the site's own, one line per array entry: `User-agent`, then `Allow`, `Disallow`, `Crawl-delay`, `Content-Signal` or `Sitemap` lines.                                                                                                                                                                                                                                                                 |

A crawler obeys only the one group that names it (RFC 9309). So the CMS adds
`Disallow: /admin/` and the content signal to every group, its own and the
site's. A group that already disallows everything gets neither. A group with
its own `Content-Signal` keeps it and gets no second one.

The form refuses these lines:

- a line that is not a robots.txt field
- a rule with no `User-agent` above it
- an `Allow` under `/admin/`

If a hand edit of `site.json` adds one of these, the server drops that line. The
site's own `Sitemap:` line is always present.

For example, `block-training`, `ai-train` set to `no` and a rule of
`User-agent: SlowBot` / `Crawl-delay: 10` serve:

```
User-agent: *
Disallow: /admin/
Content-Signal: ai-train=no

User-agent: GPTBot
Disallow: /

…one group per training crawler…

User-agent: SlowBot
Disallow: /admin/
Crawl-delay: 10
Content-Signal: ai-train=no

Sitemap: https://example.com/sitemap.xml
```

Both are registered routes, not resolved from the content index. A document
with the permalink `/sitemap.xml` cannot take the URL a search engine polls.
Both carry an `ETag` and answer a conditional request with 304, as the feeds
do. The sitemap also carries a `Last-Modified`. `robots.txt` does not, because
it has no date.

No page links to the sitemap. `robots.txt` names it, and crawlers look there.

## llms.txt

`/llms.txt` describes the site for a language model, in the
[llms.txt](https://llmstxt.org/) format. It holds the site's title as a heading
and its tagline as a quote. Three sections follow:

| Section    | What it lists                                                                                   |
| ---------- | ----------------------------------------------------------------------------------------------- |
| Navigation | Every item of the site's menus, each URL once, in the order the menus are stored.               |
| Pages      | Every listed page, sorted by name. A page's `description` follows its link.                     |
| Posts      | Every listed post, newest first. Each link is followed by the post's date and its feed summary. |

Each entry links to the document's Markdown, the format a model reads best.
A menu item that links to another site, or to a URL with no Markdown, keeps its
URL.
The file lists the same documents as the [sitemap](#sitemap-and-robotstxt).
Drafts, scheduled posts, unlisted and private documents and the trash stay
out. A post or page without a title is named by the same label the site gives
it everywhere else: its first words, else what it is, else `Untitled`.

A post's date is its calendar day in the site's timezone. Its summary is the
one the feeds carry: the post's `description`, else the first paragraph of its
body cut to 55 words.

```markdown
# Field Notes

> Notes from the field.

## Navigation

- [About](https://example.com/about/index.md)
- [Mastodon](https://mastodon.example/@me)

## Pages

- [About](https://example.com/about/index.md): Who writes this.

## Posts

- [Third post](https://example.com/third/index.md): 2026-03-01. The third post's first paragraph.
```

The file is one document however large the site is. The llms.txt format has
no pagination, so a site with thousands of posts serves a long file. The CMS
builds it from the index with the same few queries however many documents the
site has, and no lookup per document.

A static homepage is listed at `/index.md`, because `/` is where it is
published. The file is served as `text/markdown` and carries an `ETag` and a `Last-Modified`, the newest date
among its entries. It answers a conditional request with 304, as the sitemap
does.

The home page advertises the file twice. The response carries
`Link: </llms.txt>; rel="describedby"; type="text/markdown"`, for a tool that
reads no HTML. The default theme's head carries
`<link rel="describedby" type="text/markdown" href="/llms.txt">`. A theme
gets the path as `llmsTxt` while the site serves the file.

To write the file yourself, put it at `content/llms.txt`. The CMS serves it
as written, in place of the generated one, dated by the file. To serve
no file at all, clear **Serve /llms.txt** under Settings → Reading. This
writes `"llmsTxt": false` to `site.json`. `/llms.txt` then answers 404, even
when `content/llms.txt` exists, and the home page stops advertising it.

## IndexNow

[IndexNow](https://www.indexnow.org/) gets a changed URL recrawled by Bing,
Yandex, Naver, Seznam and the other engines that share it within minutes,
instead of on their next visit. It is off by default, because it sends the
site's URLs to a third party. To turn it on, select **Submit changes to
IndexNow** under Settings → Reading.

The first time you turn it on, the CMS generates a key of 32 hex digits and
writes it to `site.json` as `indexNowKey`, beside `"indexNow": true`. The site
then serves the key at `/{key}.txt` as plain text, which is how an engine
checks that the submissions are yours. Turning IndexNow off takes the file away
and keeps the key, so turning it back on reuses the key the engines already
checked. To change the key, write a new one of 8 to 128 letters, digits or
dashes to `indexNowKey`. A key that does not fit that pattern counts as none,
and the site sends nothing.

When a post or a page is published, changed, moved or deleted, the CMS submits
its URL. A move submits the old URL and the new one. Unpublishing, trashing and
deleting submit the URL that went away. The changes of the next ten seconds go
out together as one `POST` to `https://api.indexnow.org/indexnow`:

```json
{
  "host": "example.com",
  "key": "0123456789abcdef0123456789abcdef",
  "keyLocation": "https://example.com/0123456789abcdef0123456789abcdef.txt",
  "urlList": ["https://example.com/hello/"]
}
```

A network failure, a 429 or a 5xx answer is tried again after ten seconds, then
after forty. Any other refusal, such as a 403 for a key the engine could not
fetch, is not. A batch that still fails is logged as a warning, and the post
stays published.

Nothing is sent for a draft or a scheduled post, for the boot scan, or while
the base URL's host is local: `localhost`, a `.local` name, or a private IP
address.

A site can change how the CMS sends with `indexNow` in its config. Every field
is optional:

```ts
export default defineConfig({
  indexNow: {
    fetch, // what submits the URLs; a test names one
    endpoint: 'https://www.bing.com/indexnow',
    batchMs: 10_000,
    attempts: 3,
    backoffMs: (attempt) => attempt * attempt * 10_000,
    logger: console,
  },
});
```

## Compression

The server compresses text responses: HTML, CSS, JavaScript, feeds, JSON,
Markdown, SVG, sitemaps and any other media type that is `text/*`, `+json` or
`+xml`.

| Client accepts | Response                                                                |
| -------------- | ----------------------------------------------------------------------- |
| brotli (`br`)  | brotli, at quality 5, because the server builds every page per request. |
| gzip only      | gzip.                                                                   |
| neither        | The uncompressed bytes.                                                 |

The server does not compress these responses:

- Images, video, WOFF and WOFF2 fonts and other formats that carry their own
  compression. Encoding them again costs CPU and can make them bigger.
- Bodies under 1024 bytes, where the saving is smaller than the cost.
- A response that already has a `Content-Encoding`, or whose `Cache-Control`
  says `no-transform`.
- A response that may hold a secret. This covers every response whose
  `Cache-Control` says `private` or `no-store`, which includes every page
  rendered for a signed-in user. It also covers every admin screen under
  `/admin`, including the setup and login forms. These responses carry CSRF
  tokens next to text a visitor can influence. Compressed, they would let an
  attacker who watches response sizes recover the token one byte at a time (the
  BREACH attack). The server leaves their `Vary` unchanged. The admin's static
  files under `/admin/_static/` hold no secret, so the server compresses them.
  Error pages say `no-store`, so they are not compressed either.

Every other text response carries `Vary: Accept-Encoding`, compressed or not,
and so does every `304`. A cache in front of the site keeps one copy per
encoding and never sends brotli to a client that cannot decode it.

A compressed response's `ETag` is the uncompressed response's `ETag` with `W/`
in front. The bytes differ, but the representation is the same.
`If-None-Match` compares weakly. A browser that holds the brotli copy and a feed
reader that holds the gzip copy both revalidate to `304`, and each gets back the
validator it sent.

`compression: false`, or `GEEKITY_COMPRESSION=false`, turns all of this off.
Turn it off when a reverse proxy or CDN in front of the site compresses
responses (Caddy's `encode`, nginx's `gzip on`, Cloudflare). Then the work
happens once and the proxy's settings apply. Leave it on when nothing in front
of the site compresses, as in the Docker deployment the repository
documents.
