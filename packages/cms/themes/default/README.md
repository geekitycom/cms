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
    404.njk      nothing at this URL
  partials/
    post-list.njk   a list of documents
    pagination.njk  previous/next pager
    tags.njk        macros for tag links
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
| `content`                                             | The Markdown body rendered to HTML. Print it with `\| safe`.                      |
| `url`                                                 | The document's URL path, the same value as `page.url`.                            |
| `page.url`                                            | The document's URL path. Always ends in `/`.                                      |
| `page.date`                                           | The same `Date` as `date`.                                                        |
| `page.fileSlug`                                       | The permalink's last segment.                                                     |
| `page.inputPath`                                      | The source file, relative to the content directory.                               |
| `type`                                                | `post` or `page`.                                                                 |
| `permalink`, `slug`, `draft`, `description`, `author` | Straight from the front matter.                                                   |
| everything else                                       | Any front matter key the CMS does not model is on the context under its own name. |

A listing — the home page or a tag archive — adds:

| Key                                        | What it holds                                                                     |
| ------------------------------------------ | --------------------------------------------------------------------------------- |
| `title`                                    | The site title on the home page, the tag on a tag archive.                        |
| `posts`                                    | The documents on this page of the listing, newest first, each in the shape above. |
| `pagination.items`                         | The same array, under the name Eleventy gives it.                                 |
| `pagination.pageNumber`                    | Zero-based index of this page, as in Eleventy.                                    |
| `pagination.totalPages`, `.total`, `.size` | How many pages, how many documents, how many per page.                            |
| `pagination.href.first/last/next/previous` | Pager URLs. `next` and `previous` are `null` at the ends.                         |
| `pagination.pages`                         | Every page's URL, in order.                                                       |
| `tag`                                      | The tag, on a tag archive only.                                                   |

How many posts a listing page holds comes from `postsPerPage` in
`content/_data/site.json`, and defaults to 10. How many entries a feed holds
comes from `feedSize` in the same file, and defaults to 20.

## Feeds

`layouts/base.njk` fills the `alternates` block with the `rel="alternate"`
links for `/feed.xml` and `/feed.json`, so every page that extends it
advertises both feeds. `layouts/tag.njk` overrides that block, calls `super()`
and adds the tag's own two feeds:

```njk
{% set tagRoot = "/tags/" + (tag | urlencode) + "/" %}
{% block alternates %}
{{ super() }}
<link rel="alternate" type="application/atom+xml" href="{{ (tagRoot + "feed.xml") | url }}">
{% endblock %}
```

A layout that does not extend the base one has to emit the links itself. The
feeds are generated by the CMS, not by a template, so nothing here decides what
goes in them.

## Filters

| Filter         | What it does                                                                                                                                                                                                                                                                       |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `date(format)` | Formats a `Date` or a date string. `readable` (the default) gives `2 September 2026`, `html` gives `2026-09-02` for a `<time datetime>`, `year` gives `2026`, `iso` gives the full ISO 8601 instant. Formatting is in UTC. A value that is not a date renders as the empty string. |
| `url`          | Prefixes a root-relative path with the base URL's path, so a site served from a subdirectory links correctly. Eleventy's filter of the same name.                                                                                                                                  |
| `absoluteUrl`  | The same path as a fully qualified URL against the site's `baseUrl`.                                                                                                                                                                                                               |

Nunjucks' own filters — `default`, `join`, `urlencode`, `safe` and the rest —
are all available. Autoescaping is on, so rendered Markdown is the one thing
that has to be passed through `safe`.
