# The Markdown representation

Every post, page and listing has a Markdown representation at its `.md` URL.
See [The Markdown](../public-site.md#the-markdown) for what it holds. The CMS
writes the front matter, the page's own Markdown and the rewriting of the
site's links. The theme writes the header and the footer.

| Template                          | Where it goes                                       |
| --------------------------------- | --------------------------------------------------- |
| `partials/markdown-header.md.njk` | After the front matter, before the page's Markdown. |
| `partials/markdown-footer.md.njk` | After the page's Markdown, at the end of the file.  |

Both resolve like every other template. For example, a
`partials/markdown-footer.md.njk` in the site's theme replaces the footer. The
header still comes from the package. See
[Overriding a template](overriding-a-template.md).

## Escaping

The two partials render with autoescaping **off**, because Markdown is not
HTML. An `&` stays an `&`. Print text through the `escapeMarkdown` filter.
It puts the text on one line and escapes the characters that would start
emphasis, code, a link or raw HTML, so a label prints as written:

```njk
- [{{ item.label | escapeMarkdown }}]({{ item.url | markdownUrl }})
```

## Links

Every link in the context is data: a `label` and the canonical `url` of what
it names, never a `.md` URL. Write a link through the `markdownUrl` filter.
It gives a URL that the site answers with a document or a listing its
root-relative `.md` URL. It leaves any other URL as it is, such as another
site's page or `/search/`. The data stays the same for a renderer of another
format, such as a Gemini page:

```njk
{% for item in navigation %}
=> {{ item.url | markdownUrl }} {{ item.label }}
{% endfor %}
```

## Context

| Key               | What it is                                                                                                                 |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `site`            | `content/_data/site.json`.                                                                                                 |
| `url`             | The path the page is served at.                                                                                            |
| `title`           | The heading to write. Absent when the page has no title, or when its body opens with a level-one heading of its own.       |
| `home`            | A link to the homepage.                                                                                                    |
| `previous`        | A post's older neighbour, or a listing's newer page. Absent when there is none.                                            |
| `next`            | A post's newer neighbour, or a listing's older page. Absent when there is none.                                            |
| `byline`          | On a post whose author is a user: the author's display name and the URL of their archive.                                  |
| `bio`             | On an author archive, and on the homepage of a site whose author is a user: `name`, `url`, `note` (their bio) and `links`. |
| `navigation`      | Every item of every menu the site stores, each URL once, in the order the menus are stored.                                |
| `menus`           | The same menus by name, as the HTML has them. See [Navigation](navigation.md).                                             |
| `soloAuthor`      | The site's author, on a site whose author is a user. The same object the HTML has.                                         |
| `newestPosts`     | On the homepage, when it is a page: the function the front page layout has. See [Template context](template-context.md).   |
| `staticFrontPage` | True on the homepage when it is a page, false everywhere else.                                                             |
| `archiveMonths`   | On a page whose front matter says `archive: true`: every published post as `{ month, posts }`, newest month first.         |
| `type`            | `post`, `page` or `listing`.                                                                                               |
| `categories`      | On a post: its categories, in the order the file lists them.                                                               |
| `tags`            | On a post: its tags, in the order the file lists them.                                                                     |
| `backlinks`       | On a post or a page: the site's posts and pages that link to it, newest first, as the HTML's Linked from list has them.    |
| `feeds`           | The feeds the HTML head advertises for the page, in the head's order.                                                      |

`home`, `previous`, `next` and `byline` are each a `label` and a `url`. So is
each of `bio.links`, each `navigation` item, and each of `categories` and
`tags`. A term's `label` is the term as the file writes it, and its `url` is
its archive. The front matter carries `home`, `previous` and `next` already,
for a Markdown browser.

Each of `backlinks` is a `label`, a `url` and a `date`, the linking
document's calendar day as `YYYY-MM-DD`. The `date` is absent for a page that
has none.

Each of `feeds` is a `label`, a `url`, a `format` and a `type`. The `label` is
the feed's title, as the head's `<link title>` has it. The `format` is `RSS`,
`Atom` or `JSON Feed`, and the `type` is the media type the head declares,
such as `application/rss+xml`. Every page lists the site's three feeds and its
comments feed. A post or page adds its own comments feed. A tag, category or
author archive adds its three feeds.

Each post in `archiveMonths` is a `label`, a `url`, a `date` and a
`description`. The `date` is the post's calendar day in the site's timezone,
as `YYYY-MM-DD`. The `description` is already on one line, and is absent when
the post has none. The months and their posts are the same ones the HTML
archive page lists. See [An archive page](page-shell.md#an-archive-page).

## The default partials

The default header writes `title` as a level-one heading, then the bio's note
and its links as a list. On a homepage that is a page (`staticFrontPage`), it
leaves the bio out and prints only the page, as the HTML front page does
(decision-45). A site theme that wants the bio there tests `bio` without
`staticFrontPage`.

The default footer starts with the archive, when the context has
`archiveMonths`. It writes each month as a level-two heading over a list of
that month's posts, one line each, in the shape a listing's Markdown has:

```markdown
## September 2026

- [2026-09-03 Third post](/third/index.md): The third post's description.
```

After the archive, the footer writes these sections, each as a level-two
heading over a list, and leaves out a section that has nothing to list:

| Heading       | What it lists                                                                     |
| ------------- | --------------------------------------------------------------------------------- |
| `Filed under` | A post's categories, then its tags.                                               |
| `Linked from` | `backlinks`, one line each in the shape a listing's Markdown has.                 |
| `More posts`  | A post's `previous` and `next`. The CMS writes a listing's pages under its posts. |
| `Feeds`       | `feeds`, each labelled with its title and format.                                 |

```markdown
## Filed under

- [Category: Field notes](/category/Field%20notes/index.md)
- [Tag: travel](/tag/travel/index.md)

## Linked from

- [2026-09-04 A later post](/2026/09/later/index.md)

## More posts

- [Previous: First post](/2026/09/first/index.md)
- [Next: Third post](/2026/09/third/index.md)

## Feeds

- [Field Notes (RSS)](/feed/)
- [Field Notes (Atom)](/feed/atom/)
- [Field Notes (JSON Feed)](/feed/json/)
- [Field Notes comments (RSS)](/comments/feed/)
- [Comments on: Second post (RSS)](/2026/09/second/feed/)
```

A feed has no Markdown, so its link stays the feed's own URL. On a homepage
that is a page (`staticFrontPage`), the footer leaves out `Linked from`, as
the default front page layout does. A site theme that wants the list there
tests `backlinks` without `staticFrontPage`.

The footer then writes nothing more when there is no byline and no
navigation. Otherwise it writes the site's title as a level-two heading, the
byline as a link line, and the navigation as a list:

```markdown
## Field Notes

[Written by Ada Lovelace](/author/ada/index.md)

- [Home](/index.md)
- [About](/about/index.md)
- [Search](/search/)
- [Mastodon](https://mastodon.example/@ada)
```

Each link is on a line of its own with its own label, so the same data
maps onto Gemini link lines.
