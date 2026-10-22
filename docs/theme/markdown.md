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
| `postType`        | On a post: its kind, as the HTML has it, such as `reply`, `like`, `rsvp`, `event` or `review`.                             |
| `cites`           | On a post: what it answers or cites, one entry for its reply target, then one for each like, repost and bookmark.          |
| `rsvp`            | On an RSVP: its `value` (`yes`, `no`, `maybe` or `interested`) and its `label`, such as `Going`.                           |
| `event`           | On an event: `start`, `end` when it has one, and `location`, the same object `event.njk` reads.                            |
| `review`          | On a review: the HTML's `item`, `kindLabel`, `rating` and `best`, with the review line in plain words.                     |
| `location`        | On a post with a location: what Settings > Privacy shares of it, the same object `location.njk` reads. Absent otherwise.   |
| `lang`            | On a post whose front matter names its language: that language. Dates are written in it.                                   |

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

Each of `cites` is a `verb`, a `url` and a `name`. The `verb` is
`In reply to`, the RSVP's phrase (`Going to`, `Not going to`, `Maybe going to`
or `Interested in`), `Liked`, `Reposted` or `Bookmarked`. The `name` is the
cited page's title, or what the HTML calls a page without one: `a comment`,
`a post`, `an image from example.com` or `a page on example.com`. These keys
are present only when the site knows them from the cited page:

| Key         | What it is                                                                               |
| ----------- | ---------------------------------------------------------------------------------------- |
| `author`    | Who wrote it. Absent when the `name` already ends with "by" and the author.              |
| `site`      | The site it is on, when it names no author.                                              |
| `startDate` | When the event it is starts, as a `Date`. Print it in `startZone` when that is present.  |
| `published` | When it was published, on a page that is no event.                                       |
| `location`  | Where the event takes place, as its page names it.                                       |
| `copy`      | The silo copy the post answers, when `url` is the original the copy was syndicated from. |

`event.start` and `event.end` are `Date`s. The `date` filter prints them in
the site's timezone. `event.location` is `{ kind: "place", name }` or
`{ kind: "virtual", url }`.

`review.item` is the reviewed item as the front matter gives it: `kind`,
`name`, and `by`, `year`, `url` and the rest when it has them. `review.rating`
is absent on a review with no rating, and `review.best` is 5. The plain words
of the review line are `link` (the item's URL, absent when it has none),
`about` (the kind or category, then the year), `by` (the creator with the
kind's phrase, such as `by Frank Herbert` or `directed by Denis Villeneuve`),
`uid` (an identifier such as `ISBN 9780441013593`, absent when it is a web
address) and `details` (the sentences under the line, such as
`Finished on 1 September 2026.`).

`location.words` are the place's words, each a `text`. `location.geo` is a
`latitude` and a `longitude`, present only when Settings > Privacy shares the
exact location. Under `none`, a post has no `location`. See
[Location on posts](../settings.md#location-on-posts).

Each post in `archiveMonths` is a `label`, a `url`, a `date` and a
`description`. The `date` is the post's calendar day in the site's timezone,
as `YYYY-MM-DD`. The `description` is already on one line, and is absent when
the post has none. The months and their posts are the same ones the HTML
archive page lists. See [An archive page](page-shell.md#an-archive-page).

## The default partials

The default header writes `title` as a level-one heading. On a post it then
writes what kind of post it is, each line a paragraph of its own: an event's
`When` and `Where`, a line for each of `cites`, a review's line, its details
and its rating, and the location. A post of none of these kinds gets none of
these lines. Here are the lines of several kinds of post together:

```markdown
When: 13 October 2026 at 19:30 GMT-5 to 13 October 2026 at 21:30 GMT-5

Where: Online at [meet.example](https://meet.example/room)

In reply to [Their post](https://them.example/post) by Bea, 1 September 2026

Going to [IndieWeb Camp](https://events.example/camp), 10 October 2026, Chicago Public Library

Liked [a page on them.example](https://them.example/liked)

Review of [Dune](https://books.example/dune) (book, 1965), by Frank Herbert

Finished on 1 September 2026.

Rated 4 out of 5

Location: Los Gorditos, Portland
```

The dates are in the site's timezone, and a cited event's start is in its
own zone when its page wrote it without one, as the HTML prints them. The
location line prints the place's words, or the coordinates when the site
shares the exact location and the place has no words.

Where there is a bio, the header writes its note and its links as a list. On a homepage that is a page (`staticFrontPage`), it
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
