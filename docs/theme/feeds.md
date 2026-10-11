# Feeds

`partials/feeds.njk` holds two macros. `feedLinks(root, title)` writes the three
`rel="alternate"` links for a listing's RSS, Atom and JSON feeds. RSS is first,
because most subscribers use it:

```njk
{% import "partials/feeds.njk" as feeds %}
{{ feeds.feedLinks("/", site.title) }}
```

`root` is any listing URL that ends in `/`. The macro appends `feed/`,
`feed/atom/` and `feed/json/` and passes each through the `url` filter, so the
links include the base path of a site served from a subdirectory. The macro
needs only its arguments, so you can import it without `with context`.

`commentsFeedLink(feed, title)` writes the single link for a comments feed. It
takes the feed's own URL, not a root, because a comments feed is only RSS 2.0:

```njk
{{ feeds.commentsFeedLink("/comments/feed/", site.title + " comments") }}
```

`layouts/tag.njk`, `layouts/category.njk` and `layouts/author.njk` each call
`feedLinks` with their own root. An archive advertises its own three feeds and
the site's feeds. On an author archive, the root is `author.url`.

`layouts/base.njk` fills the `alternates` block with `feedLinks` for `/` and
then the site's comments feed. Every page that extends it advertises all four
feeds. On a published post, and on a page that takes comments, it adds the
document's own comments feed, from `commentsFeed` on the context. On a
published post, it also adds a link to the post's ActivityPub object:

```html
<link
  rel="alternate"
  type="application/activity+json"
  href="https://example.com/2026/09/hello/"
/>
```

A post's object id is its permalink, so this link usually points at the page
it is on. It says that the URL answers with ActivityStreams as well as HTML. A
post migrated from another site keeps the id that its file names, and the link
points there.

The link comes from `activityStreams`, which is on the context only for a
rendered published post. `commentsFeed` is on the context only for a document
that has a comments feed. A layout that overrides the block without calling
`super()` must emit both links itself. The values are on the context, not in
`post.njk`, so a site that overrides that layout, as the demo does, keeps them.

After the block, and outside it, the base layout writes the webmention
endpoint:

```html
<link rel="webmention" href="/_geekity/webmention" />
```

It comes from `webmention` on the context. That key is on a rendered document
only while the site takes webmentions. Wrap the link in `{% if webmention %}`.
A site with webmentions turned off advertises no endpoint. The CMS also sends
the endpoint as a `Link` header on every representation of a document, for
senders that do not parse HTML.

The pingback endpoint follows it, as an absolute URL, because the spec
requires one:

```html
<link rel="pingback" href="https://example.com/_geekity/pingback" />
```

It comes from `pingback` on the context. That key is there only when the site
takes webmentions and the document accepts responses: every post, and a page
only while it takes comments. The CMS sends the same endpoint in an
`X-Pingback` header under the same rule.

On the front page, the base layout also writes the site's index for language
models:

```html
<link rel="describedby" type="text/markdown" href="/llms.txt" />
```

It comes from `llmsTxt` on the context, which is absent when the site turns the
file off. The CMS sends the same link as a `Link` header on the front page.

`layouts/tag.njk` and `layouts/category.njk` override the `alternates` block,
call `super()`, and add the archive's own three feeds:

```njk
{% import "partials/feeds.njk" as feeds %}
{% set tagRoot = "/" + (site.tagBase or "tag") + "/" + (tag | lower | urlencode) + "/" %}
{% block alternates %}
{{ super() }}
{{ feeds.feedLinks(tagRoot, site.title + ": " + tag) }}
{% endblock %}
```

Category archives add their own three feeds in the same way.

A layout that does not extend the base layout must emit the links itself. The
CMS generates the feeds, not a template, so no template controls what goes in
them.
