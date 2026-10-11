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
| `/llms.txt`                             | The site's pages and recent posts for a language model, each linked to its Markdown. See [llms.txt](#llmstxt).                           |
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
| `/author/{username}/following/` | Always empty: a relay is a subscription rather than a relationship.                                                                          |
| `/inbox/`                       | `POST` only. The instance-wide shared inbox; the addressee is read out of the body.                                                          |
| `/@{username}`                  | A 301 to their archive, the short URL WordPress publishes; a 404 for a handle nobody answers to.                                             |
| `/.well-known/webfinger`        | `acct:{username}@{host}`, the author URL or `/@{username}`, all resolving to the same actor.                                                 |
| `/.well-known/nodeinfo`         | A link to the NodeInfo document.                                                                                                             |
| `/nodeinfo/2.1`                 | What software this is, how many users and how many posts.                                                                                    |
| a post's permalink              | The `Article` on an ActivityStreams request (decision-13), served for an `Accept` of `application/activity+json`; the page to anything else. |

`author` and `inbox` are reserved top-level paths: every user is an ActivityPub
actor at their author URL, and an id a settings field could move would be a
different account to everybody following it.

Drafts, documents in the trash and posts whose date has not arrived are not on
the public site: their URLs 404, and they are in no listing. A future-dated
post is published on its date without a restart.

Trailing slashes are canonical. A request that arrives without one redirects
301 to the URL with it, but only when that URL resolves — a genuinely missing
address 404s straight away rather than bouncing first. `/page/1/` redirects to
`/`, because the first page of a listing lives at the listing's own URL.

A document is resolved after every registered route has failed to match, so
routes a site adds always win over a permalink that happens to collide with
them. The taxonomy archives are resolved there too, ahead of the documents: a
route table is fixed when the app is built and the archive bases are a setting,
so `/{tagBase}/{tag}/` is matched against whatever the site holds at the moment
of the request.

`tag` and `category` are the bases a site has until it says otherwise —
WordPress's own, so a site imported from it keeps every archive URL it
published. `tagBase` and `categoryBase` on the Permalinks settings page move
them, and the routes, the paging, the canonical redirects, the tag feeds, the
theme's links and the ActivityStreams hashtags all follow on the next request.
Both are `tagBase` and `categoryBase` in `content/_data/site.json`, so an
Eleventy build of the same content directory can put its archives at the same
URLs. [The archive bases](settings.md#the-archive-bases) has the rules a base
is held to, and how an archive path matches its term.

How many posts a listing page holds comes from `postsPerPage` in
`content/_data/site.json`, and defaults to 10. The same file is the `site`
global in every template.

## Health check

`GET /healthz` is the one URL a Docker `HEALTHCHECK`, dockge or an uptime
monitor needs. It runs two checks: one query against the content index in
`data/geekity.db`, and opening the content directory for reading. When both
pass it answers 200:

```json
{
  "status": "ok",
  "maintenance": false,
  "checks": { "database": "ok", "content": "ok" }
}
```

When either fails it answers 503, with that check reading `"fail"` and
`status` reading `"fail"`. A checker looks only at the status code, which is
why a failure is never a 200 carrying `"fail"`. The body names each check and
its outcome and nothing else: no paths, versions or error messages, since
anybody can request it.

The route is registered before federation, the admin and the public site, so a
post or page whose permalink is `/healthz/` cannot shadow it. The response
carries `Cache-Control: no-store`, sets no cookie, and the login throttle does
not count it, so probing it every few seconds costs nothing but the two checks.
The older `/_geekity/health` still answers `{ "status": "ok" }` without
checking anything.

`maintenance` says whether the site is in maintenance mode. It does not change
the status code: a site that is down on purpose is still healthy, and a
container orchestrator that restarted it would be fighting the operator.

## Maintenance mode

Maintenance mode takes the public site down on purpose, for an upgrade or a
restore, in a way browsers, crawlers and fediverse servers all read as
temporary.

```
$ geekity maintenance on --until 2026-09-28T14:00:00Z
Maintenance mode is on (/srv/site/data/maintenance.json). Expected back by Mon, 28 Sep 2026 14:00:00 GMT.
$ geekity maintenance status
$ geekity maintenance off
```

While it is on, every public page, feed, sitemap, `robots.txt` and ActivityPub
endpoint answers `503 Service Unavailable` with `Retry-After` and
`Cache-Control: no-store`. `Retry-After` is the `--until` time as an HTTP date
while that time is ahead, and 600 seconds otherwise. A page answers with the
theme's `layouts/503.njk`, and a `.json` or `.md` request answers in that
format. A crawler keeps the page in its index, and a server whose inbox delivery
was refused queues it for a retry instead of dropping it.

Some requests are let through:

- `/healthz` and `/_geekity/health`, which report `"maintenance": true`.
- The admin, the login page included, so an admin can sign in and work.
- The theme's files under `/theme/`, so the maintenance page is styled.
- Every request from a signed-in user, so an admin can check the site before
  turning maintenance off. These responses carry `Cache-Control: private,
no-store`, so no shared cache keeps one and hands it to a stranger.

The switch is the file `data/maintenance.json`. `on` writes it and `off`
removes it, and the running site looks at it at most once a second, so neither
needs a restart. It lives in `data/` and not in `content/` because it is
operational state: `content/` is published and committed, and a flag that
travelled with it would take down every checkout of the site.

`GEEKITY_MAINTENANCE=on`, or `maintenance: true` in the config, keeps the site
in maintenance from boot for the life of the process, for a site that must come
up already down. Removing the file does not lift it; restarting without the
setting does.

## Moved URLs

Changing the slug or the permalink of a published post or page in the editor
moves it, and the URL it leaves is written into its file:

```yaml
permalink: /2026/01/new-name/
redirect_from:
  - /2026/01/first-name/
  - /2026/01/second-name/
```

Every URL in `redirect_from` answers `301 Moved Permanently` with the current
permalink, and so do its `.md` and `.json` spellings. Each entry points at the
document itself, not at the next rename, so no chain of redirects builds up.
The list is in the file, so deleting `data/geekity.db` keeps it working.

A URL in the list only redirects while nothing else lives there: a new document
given that URL takes it over. Moving a document back to a URL in its list takes
that URL off the list. A draft that was never published and has no comments
moves without leaving anything behind; one with comments was read at its URL,
so it keeps a `redirect_from` like a published one. Correcting a published
post's date files it under the new day but keeps its URL.

A moved document keeps its conversation. Its comments and stored webmentions
move to its new slug, a reply post answering any URL in its `redirect_from`
stays in its thread, and its feeds keep their guid: a post keeps its object id
as its `activitypub.id`, and a page keeps the URL it left as its `guid`, so the
`/replies/` feed a reader subscribed to keeps answering. The record of the
webmentions a post has sent moves with it too. A move made by hand is followed
the same way when the file names the old URL in `redirect_from`; a permalink
changed by hand with no `redirect_from` leaves the old URL answering 404 and its
comments where they were, until the file names it.

## Declared redirects

A site that moves to this CMS, or reorganises, lists the old URLs that no
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

A `from` without a query string matches that path with any query, or none. The
request's query goes on to a `to` that has no query of its own, so
`/old-section/?page=2` lands on `/new-section/?page=2`. The path must match
exactly, except that a `from` ending in `/` also answers the same path without
the slash, in one hop.

A `from` with a query string matches only that query. The order of the
parameters does not matter, so `/archives/?cat=4&paged=2` also matches
`/archives/?paged=2&cat=4`. Nothing else in the request's query may differ:
`/?p=123` does not match `/?p=123&replytocom=9`. This is how old WordPress
`?p=` links reach their posts.

A declared redirect never hides something real. A path-only `from` is answered
only after every document, archive, feed and moved URL has had its turn, and
just before the 404 page, so a document given that URL later takes it over. A
`from` with a query string is answered first, because no document is addressed
by its query. The admin, the federation endpoints and the health check answer
before any declared redirect.

The file is read on the next request after it changes, with no restart. An
entry that cannot be served is logged as a warning at boot, and again on the
first request after the file changes, and it is skipped. The following entries are skipped:

- An entry with a missing or malformed `from`, `to` or `status`.
- A second entry with the same `from`. The first entry wins.
- Every entry that leads into a loop, such as `/a/` to `/b/` and `/b/` back to
  `/a/`.

A file that is not a JSON list serves no redirects and is reported the same
way.

### More than one file

Every `*.json` file in `content/_data/redirects/` is read after
`redirects.json`, in name order, and served the same way. A tool that generates
redirects, such as an import, writes a file of its own there and never touches
the list a person keeps. A file there, or `redirects.json` itself, may also be
an object that maps each `from` to its `to`, every one a `301`:

```json
{
  "/?p=123": "/2026/01/hello/",
  "/old-section/": "/new-section/"
}
```

Where two files declare the same `from`, the one read first wins, so
`redirects.json` wins over every file in the folder, and the other declaration
is reported. A loop across files is found and skipped as within one.

Every redirect the CMS sends carries `X-Redirect-By: Geekity CMS`. This
includes the declared redirects, moved URLs, trailing slashes, feed spellings
and the admin's redirects. Someone who traces a chain of redirects through a
proxy can see which layer sent each one.

## Content negotiation

Every public URL is one resource with more than one body. A post or a page has
three; a listing has two.

| Media type         | Extension | Body                                                     |
| ------------------ | --------- | -------------------------------------------------------- |
| `text/html`        | —         | The document through the theme. The default.             |
| `text/markdown`    | `.md`     | The file exactly as it is stored, front matter included. |
| `application/json` | `.json`   | The document as data, see below.                         |

Listings — `/`, `/page/N/`, `/tag/{tag}/` and `/tag/{tag}/page/N/` — offer
HTML and JSON only. There is no Markdown file behind a listing to serve.

The representation is chosen like this:

1. A `.md` or `.json` suffix on the path wins outright and `Accept` is ignored.
   Both spellings work: `/2026/09/hello/index.md` (what the `Link` header
   advertises) and the shorter `/2026/09/hello.md`.
2. Otherwise `Accept` is matched with q-values. The highest q wins; a tie goes
   to the more specific range; what is still tied goes to HTML.
3. No `Accept` header, an empty one, or `*/*` means HTML, so a browser and a
   `curl` with no arguments both get a page.
4. A request that accepts none of the representations gets `406` with a JSON
   body listing what it could have asked for.

The feeds are fixed routes and are not negotiated: feed readers do not send
useful `Accept` headers. See [Feeds](feeds.md).

```sh
curl -H 'Accept: text/markdown' https://example.com/2026/09/hello/
curl https://example.com/2026/09/hello/index.json
curl 'https://example.com/index.json?full=1'
```

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

`schema` is the version of this shape; keys are only added within a version.
`url` is absolute, built on the configured `baseUrl`. `frontMatter` is the
document's front matter exactly as the `.md` representation carries it — the
same block the writer emits, unknown keys included — so the two cannot drift.
`markdown` is the body without the front matter, and `html` is that body
rendered.

A listing's JSON is a plain array of the same objects with `markdown` and
`html` left out, because an archive page should not carry every post in full.
`?full=1` puts them back.

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

Every negotiated response carries `Vary: Accept` and a `Link` header pointing
at the representations it is not:

```
Link: </2026/09/hello/index.md>; rel="alternate"; type="text/markdown",
      </2026/09/hello/index.json>; rel="alternate"; type="application/json"
```

It also carries `ETag` — derived from the document's content hash and the
representation, so a client holding the JSON is never told its Markdown is
unchanged — plus `Last-Modified` from the document's `updated`, falling back to
its `date`, and `Cache-Control: no-cache` so a client revalidates rather than
guessing how long the page stays fresh. `If-None-Match` and `If-Modified-Since`
are honoured and answered with `304`.

One exception: while `watch` is on, the HTML representation is served without
validators. Only the document is hashed, and a template edit changes the page
without changing the document, so a development server would otherwise answer
`304` with a page that had already moved on. The `.md` and `.json`
representations are validated either way.

Every representation but the HTML carries `X-Robots-Tag: noindex`, whether it
was asked for by extension or by `Accept`. They say what the page says, and a
search engine that indexed them would list one page two or three times.

Adding a representation — an ActivityStreams object, say — means adding it to
`Representation` in `src/web/negotiate.ts` with its media type and, if it wants
one, its extension. The selection, the `Link` alternates, the `ETag` and the
406 body all follow from those two tables. ActivityPub types are claimed by the
federation middleware before the negotiator sees them.

## Sitemap and robots.txt

Two more fixed routes, at the two paths a crawler goes looking for on its own.

`/sitemap.xml` is every URL the public site publishes, in the
[sitemap protocol's](https://www.sitemaps.org/protocol.html) `<urlset>`:

- the home archive and each of its pages, `/`, `/page/2/` and so on;
- every published post and every page, at its permalink;
- every tag archive and every category archive, with each of their pages,
  under whatever bases the site is configured with.

Each `<loc>` is absolute, built on `baseUrl`. `<lastmod>` is a document's
`updated` when it has one and its `date` otherwise, and for a listing page it
is the newest of those among the documents on that page. Something nothing
dates — a page with no date in its front matter — carries no `<lastmod>`
rather than an invented one.

Nothing hidden reaches it. The sitemap is drawn from the same queries the
listings are and checked against the same `isListed`, so drafts, the trash and
posts whose date has not arrived are absent for the same reason their
permalinks 404, and an [unlisted post](content.md#unlisted-posts) is absent for the same
reason it is off the home page.

The protocol caps one file at 50,000 URLs. Past that, `/sitemap.xml` becomes a
`<sitemapindex>` naming `/sitemap-1.xml`, `/sitemap-2.xml` and so on, each
holding its own slice and dated by the newest URL in it. The address a search
engine holds does not change, which is the point of the index living there.
While the whole sitemap fits in one file the children name nothing and 404.

`/robots.txt` starts short:

```
User-agent: *
Disallow: /admin/

Sitemap: https://example.com/sitemap.xml
```

Everything public is crawlable; only the admin is not. The actors and their
collections are deliberately left open — an actor and an object exist to be
fetched, they carry the same
content as the pages that link to them, and a crawler that follows one gets
JSON it will ignore.

The Crawlers section of Settings → Reading adds to it, and writes what it sets
to `site.json`:

| Setting               | `site.json` key                                                       | What the file gains                                                                                                                                                                                                                                                                                                                                                                                             |
| --------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AI crawlers           | `aiCrawlers`                                                          | `allow` (the default) adds nothing. `block-training` adds a `Disallow: /` group for each training crawler: GPTBot, ClaudeBot, anthropic-ai, Google-Extended, Applebot-Extended, Bytespider, CCBot and meta-externalagent. `block-all` also blocks the retrieval crawlers: OAI-SearchBot, ChatGPT-User, PerplexityBot, Perplexity-User, Claude-SearchBot, Claude-User, meta-webindexer and meta-externalfetcher. |
| Content signals       | `contentSignalSearch`, `contentSignalAiInput`, `contentSignalAiTrain` | Each `yes`, `no` or empty. The ones set become one line, such as `Content-Signal: search=yes, ai-input=yes, ai-train=no`.                                                                                                                                                                                                                                                                                       |
| More robots.txt rules | `robotsRules`                                                         | Groups of the site's own, one line per array entry: `User-agent`, then `Allow`, `Disallow`, `Crawl-delay`, `Content-Signal` or `Sitemap` lines.                                                                                                                                                                                                                                                                 |

A crawler obeys only the one group that names it (RFC 9309), so the CMS puts
`Disallow: /admin/` and the content signal into every group, its own and the
site's, unless the group already disallows everything or carries a signal of
its own. The form refuses a line that is not a robots.txt field, a rule with no
`User-agent` above it, and an `Allow` under `/admin/`; a hand edit of
`site.json` that does any of these loses that line. The site's own `Sitemap:`
line is always there.

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

Both are registered routes rather than anything resolved from the content
index, so a document permalinked at `/sitemap.xml` cannot take the URL a
search engine polls, and both carry an `ETag` and answer a conditional request
with 304 the way the feeds do — the sitemap with a `Last-Modified` as well,
robots without one, because nothing dates it.

Nothing links the sitemap from a page: `robots.txt` names it, which is where a
crawler looks.

## llms.txt

`/llms.txt` describes the site for a language model, in the
[llms.txt](https://llmstxt.org/) format. It holds the site's title as a heading
and its tagline as a quote. Then it lists every public page by title and the
posts the feeds carry, newest first. Each entry links to the document's
Markdown, which is what a model reads best:

```markdown
# Field Notes

> Notes from the field.

## Pages

- [About](https://example.com/about/index.md): Who writes this.

## Recent posts

- [Third post](https://example.com/third/index.md)
```

A document's `description` follows its link. A static homepage is listed at
`/index.md`, because `/` is where it is published. The file is served as
`text/markdown` and carries an `ETag` and a `Last-Modified`, the newest date
among its entries. It answers a conditional request with 304, as the sitemap
does.

The home page advertises the file twice. The response carries
`Link: </llms.txt>; rel="describedby"; type="text/markdown"`, for a tool that
reads no HTML. The default theme's head carries
`<link rel="describedby" type="text/markdown" href="/llms.txt">`. A theme
gets the path as `llmsTxt` while the site serves the file.

To write the file yourself, put it at `content/llms.txt`. The CMS serves it
exactly as written in place of the generated one, dated by the file. To serve
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

Text responses are compressed on the way out: HTML, CSS, JavaScript, feeds,
JSON, Markdown, SVG, sitemaps and anything else whose media type is `text/*`,
`+json` or `+xml`. A client that accepts brotli (`br`) gets brotli, at quality
5 because every page is built per request; one that accepts only gzip gets
gzip; one that accepts neither gets the plain bytes.

Some responses go out as they are:

- Images, video, WOFF and WOFF2 fonts and other formats that carry their own
  compression. Encoding them again costs CPU and can make them bigger.
- Bodies under 1024 bytes, where the saving is smaller than the cost.
- A response that already has a `Content-Encoding`, or whose `Cache-Control`
  says `no-transform`.
- A response that may hold a secret: anything whose `Cache-Control` says
  `private` or `no-store`, which every page drawn for somebody signed in does,
  and every admin screen under `/admin`, the setup and login forms included.
  These carry CSRF tokens next to text a visitor can influence, and compressing
  them would let an attacker who watches response sizes recover the token a
  byte at a time (the BREACH attack). Their `Vary` is left as it was. The
  admin's static files under `/admin/_static/` hold no secret and are
  compressed. Error pages say `no-store`, so they go out plain too.

Every other text response carries `Vary: Accept-Encoding`, whether it was
compressed or not, and so does every `304`. A cache in front of the site
therefore keeps a copy per encoding and never hands brotli to a client that
cannot decode it.

A compressed response's `ETag` is the plain response's with `W/` in front: the
bytes differ, but the representation is the same. `If-None-Match` compares
weakly, so a browser holding the brotli copy and a feed reader holding the gzip
copy both revalidate to `304`, and each gets back the validator it sent.

`compression: false`, or `GEEKITY_COMPRESSION=false`, turns all of this off.
Turn it off when a reverse proxy or CDN in front of the site compresses
responses itself (Caddy's `encode`, nginx's `gzip on`, Cloudflare), so the work
is done once and the proxy's settings apply. Leave it on when nothing in front
compresses, as in the Docker deployment the repository documents.
