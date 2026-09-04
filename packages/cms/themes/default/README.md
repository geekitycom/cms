# Default theme

Templates ship here, inside the published package, so every site gets them
without copying anything.

```
themes/default/
  layouts/
    base.njk     the page every other layout extends
    home.njk     the post archive, paginated
    post.njk     one post
    page.njk     one page
    tag.njk      a tag archive, paginated
    category.njk a category archive, paginated
    404.njk      nothing at this URL
  partials/
    post-list.njk   a list of documents
    pagination.njk  previous/next pager
    tags.njk        macros for tag and category links
  static/
    style.css    served at /theme/style.css
```

Plain Nunjucks and plain CSS. There is no build step and no dependency: a site
that wants Tailwind or anything else brings its own.

## Overriding a template

Resolution order for any template is the site's own `themeDir` (`theme/` by
default) first, then this directory, one file at a time. A site that ships only

```
theme/layouts/post.njk
```

replaces the post layout and keeps receiving updates to every other template.
`theme/static/style.css` replaces the stylesheet the same way — assets under
`/theme/` resolve in the same order.

An override is a normal Nunjucks template, so it can extend or include the
packaged ones by name:

```njk
{% extends "layouts/base.njk" %}

{% block content %}
<article>
  <h1>{{ title }}</h1>
  {{ content | safe }}
</article>
{% endblock %}
```

`layouts/base.njk` defines the blocks `title`, `head`, `alternates`, `header`,
`content`, `footer` and `scripts`, so most sites never have to copy it.

## Template context

The context mirrors what an Eleventy layout receives, so a layout ported from
an Eleventy build needs few edits. It is part of the package's semver contract.

Every template gets:

| Key    | What it holds                                                                                                                                                                                           |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `site` | `content/_data/site.json`, if the site has one, over the defaults `title` and `url`. Any key in the file is readable, so `site.tagline`, `site.author` and anything else a site adds are all available. |

A document — one post, one page, or one entry of a listing — adds:

| Key                                                   | What it holds                                                                     |
| ----------------------------------------------------- | --------------------------------------------------------------------------------- |
| `title`                                               | Display title.                                                                    |
| `date`                                                | Publish date, a JavaScript `Date`. Absent when the document has none.             |
| `updated`                                             | Last modified date, a `Date`, when the front matter has one.                      |
| `tags`                                                | The document's tags, in file order.                                               |
| `categories`                                          | The document's categories, in file order.                                         |
| `content`                                             | The Markdown body rendered to HTML. Print it with `\| safe`.                      |
| `url`                                                 | The document's URL path, the same value as `page.url`.                            |
| `page.url`                                            | The document's URL path. Always ends in `/`.                                      |
| `page.date`                                           | The same `Date` as `date`.                                                        |
| `page.fileSlug`                                       | The permalink's last segment.                                                     |
| `page.inputPath`                                      | The source file, relative to the content directory.                               |
| `type`                                                | `post` or `page`.                                                                 |
| `permalink`, `slug`, `draft`, `description`, `author` | Straight from the front matter.                                                   |
| `activityStreams`                                     | The post's ActivityPub object id, absolute. Only on a rendered published post.    |
| everything else                                       | Any front matter key the CMS does not model is on the context under its own name. |

A listing — the home page, a tag archive or a category archive — adds:

| Key                                        | What it holds                                                                     |
| ------------------------------------------ | --------------------------------------------------------------------------------- |
| `title`                                    | The site title on the home page, the term on a taxonomy archive.                  |
| `posts`                                    | The documents on this page of the listing, newest first, each in the shape above. |
| `pagination.items`                         | The same array, under the name Eleventy gives it.                                 |
| `pagination.pageNumber`                    | Zero-based index of this page, as in Eleventy.                                    |
| `pagination.totalPages`, `.total`, `.size` | How many pages, how many documents, how many per page.                            |
| `pagination.href.first/last/next/previous` | Pager URLs. `next` and `previous` are `null` at the ends.                         |
| `pagination.pages`                         | Every page's URL, in order.                                                       |
| `tag`                                      | The tag, on a tag archive only.                                                   |
| `category`                                 | The category, on a category archive only.                                         |

How many posts a listing page holds comes from `postsPerPage` in
`content/_data/site.json`, and defaults to 10. How many entries a feed holds
comes from `feedSize` in the same file, and defaults to 20. The `<html lang>`
comes from `language`, and defaults to `en`.

## Feeds

`partials/feeds.njk` holds two macros. `feedLinks(root, title)` writes the three
`rel="alternate"` links for a listing's RSS, Atom and JSON feeds — RSS first,
because it is what most subscribers hold:

```njk
{% import "partials/feeds.njk" as feeds %}
{{ feeds.feedLinks("/", site.title) }}
```

`root` is any listing URL ending in `/`; the macro appends `feed/`, `feed/atom/`
and `feed/json/` and puts each through the `url` filter, so the links carry the
base path of a site served from a subdirectory. The arguments carry everything
the macro needs, so it can be imported without `with context`.

`commentsFeedLink(feed, title)` writes the one link a comments feed has. It
takes the feed's own URL rather than a root, because a comments feed is RSS 2.0
and nothing else:

```njk
{{ feeds.commentsFeedLink("/comments/feed/", site.title + " comments") }}
```

`layouts/base.njk` fills the `alternates` block with `feedLinks` over `/` and
then the site's comments feed, so every page that extends it advertises all
four. On a published post it adds that post's own comments feed, from
`commentsFeed` on the context, and a link pointing at the post's ActivityPub
object:

```html
<link
  rel="alternate"
  type="application/activity+json"
  href="https://example.com/ap/posts/hello"
/>
```

That link is what lets a fediverse client find the post from its permalink. It
comes from `activityStreams`, which — like `commentsFeed` — is only on the
context of a rendered published post, so a layout that overrides the block and
does not call `super()` has to emit both itself. They are on the context rather
than in `post.njk` so that a site which overrides that layout, as the demo
does, keeps them.

`layouts/tag.njk` and `layouts/category.njk` override that block, call `super()`
and add the archive's own three feeds:

```njk
{% import "partials/feeds.njk" as feeds %}
{% set tagRoot = "/" + (site.tagBase or "tag") + "/" + (tag | urlencode) + "/" %}
{% block alternates %}
{{ super() }}
{{ feeds.feedLinks(tagRoot, site.title + ": " + tag) }}
{% endblock %}
```

A layout that does not extend the base one has to emit the links itself. The
feeds are generated by the CMS, not by a template, so nothing here decides what
goes in them.

Category archives get their own three the same way.

## Taxonomy macros

`partials/tags.njk` holds one macro per taxonomy. Both render a `<ul>` of links
to the archives, and nothing at all for an empty list:

```njk
{% import "partials/tags.njk" as taxonomy with context %}
{{ taxonomy.categories(categories) }}
{{ taxonomy.list(tags) }}
```

`list` links to `/{{ site.tagBase }}/{tag}/` and `categories` to
`/{{ site.categoryBase }}/{category}/`, which is where the CMS serves each
archive. Both bases are settings — `tag` and `category` until the settings
screen says otherwise — and they reach a template through `site`, which is why
the import above carries `with context`: a macro imported without it cannot see
`site` and would fall back to the defaults.

## Filters

| Filter         | What it does                                                                                                                                                                                                                                                                       |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `date(format)` | Formats a `Date` or a date string. `readable` (the default) gives `2 September 2026`, `html` gives `2026-09-02` for a `<time datetime>`, `year` gives `2026`, `iso` gives the full ISO 8601 instant. Formatting is in UTC. A value that is not a date renders as the empty string. |
| `url`          | Prefixes a root-relative path with the base URL's path, so a site served from a subdirectory links correctly. Eleventy's filter of the same name.                                                                                                                                  |
| `absoluteUrl`  | The same path as a fully qualified URL against the site's `baseUrl`.                                                                                                                                                                                                               |

Nunjucks' own filters — `default`, `join`, `urlencode`, `safe` and the rest —
are all available. Autoescaping is on, so rendered Markdown is the one thing
that has to be passed through `safe`.
