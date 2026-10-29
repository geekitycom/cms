# The Markdown representation

Every post, page and listing has a Markdown representation at its `.md` URL,
and so do the search and a comment's own page. The 404, 410, 500 and 503
pages answer a Markdown request in Markdown too. See
[The Markdown](../public-site.md#the-markdown) for what it holds. The CMS
writes the front matter, the page's own Markdown and the rewriting of the
site's links. The theme writes the header and the footer, and the body of
each status page. A theme may also write a layout template for a kind of page,
which places the page's Markdown, the header and the footer itself. See
[Layout templates](#layout-templates).

| Template                             | Where it goes                                               |
| ------------------------------------ | ----------------------------------------------------------- |
| `partials/markdown-header.md.njk`    | After the front matter, before the page's Markdown.         |
| `partials/markdown-footer.md.njk`    | After the page's Markdown, at the end of the file.          |
| `partials/markdown-reply.md.njk`     | Macros both partials write the conversation with.           |
| `partials/markdown-bio.md.njk`       | The bio, where the header or a layout template includes it. |
| `partials/markdown-post-list.md.njk` | A list of posts, where a layout template includes it.       |
| `layouts/<name>.md.njk`              | The whole Markdown after the front matter, for one layout.  |
| `layouts/404.md.njk`                 | The body of the 404 page's Markdown.                        |
| `layouts/410.md.njk`                 | The body of the 410 page's Markdown.                        |
| `layouts/500.md.njk`                 | The body of the 500 page's Markdown.                        |
| `layouts/503.md.njk`                 | The body of the maintenance page's Markdown.                |

All of them resolve like every other template. For example, a
`partials/markdown-footer.md.njk` in the site's theme replaces the footer. The
header still comes from the package. See
[Overriding a template](overriding-a-template.md).

## Escaping

These templates render with autoescaping **off**, because Markdown is not
HTML. An `&` stays an `&`. Print text through the `escapeMarkdown` filter.
It puts the text on one line and escapes the characters that would start
emphasis, code, a link or raw HTML, so a label prints as written:

```njk
- [{{ item.label | escapeMarkdown }}]({{ item.url | markdownUrl }})
```

A reply's `text` is already Markdown and is printed as it is. The `nest`
filter indents every line after the first by a number of spaces, 2 by
default, and leaves blank lines blank. It puts a reply's paragraphs, and the
replies under it, inside its list item:

```njk
- {{ entry.author.label | escapeMarkdown }}

  {{ entry.text | nest(2) }}
```

## Links

Every link in the context is data: a `label` and the canonical `url` of what
it names, never a `.md` URL. Write a link through the `markdownUrl` filter.
It gives a URL that the site answers with a document or a listing its
root-relative `.md` URL, the search's with its query kept. It leaves any
other URL as it is, such as another site's page or a feed. The data stays the
same for another format. The `.gmi` page converts these templates, and a
theme's Gemini templates read the same context. See
[The Gemini representation](gemini.md).

A piece of Markdown in the context, such as `bio.note`, has its links written
inside it. The `markdownLinks` filter passes each of them through
`markdownUrl` and leaves the rest of the text as written.

## Context

| Key               | What it is                                                                                                                                             |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `site`            | `content/_data/site.json`.                                                                                                                             |
| `url`             | The path the page is served at.                                                                                                                        |
| `title`           | The heading to write. Absent when the page has no title, or when its body opens with a level-one heading of its own.                                   |
| `home`            | A link to the homepage.                                                                                                                                |
| `previous`        | A post's older neighbour, or a listing's newer page. Absent when there is none.                                                                        |
| `next`            | A post's newer neighbour, or a listing's older page. Absent when there is none.                                                                        |
| `byline`          | On a post whose author is a user: the author's display name and the URL of their archive.                                                              |
| `bio`             | On an author archive, and on the homepage of a site whose author is a user: `name`, `url`, `note` (their bio, as the Markdown they wrote) and `links`. |
| `navigation`      | Every item of every menu the site stores, each URL once, in the order the menus are stored.                                                            |
| `menus`           | The same menus by name, as the HTML has them. See [Navigation](navigation.md).                                                                         |
| `soloAuthor`      | The site's author, on a site whose author is a user. The same object the HTML has.                                                                     |
| `newestPosts`     | On the homepage, when it is a page: the function the front page layout has. See [Template context](template-context.md).                               |
| `staticFrontPage` | True on the homepage when it is a page, false everywhere else.                                                                                         |
| `archiveMonths`   | On a page whose front matter says `archive: true`: every published post as `{ month, posts }`, newest month first.                                     |
| `type`            | `post`, `page`, `listing`, `comment` or `status`. The search is a `listing`, and a 404, 410, 500 or 503 is a `status`.                                 |
| `categories`      | On a post: its categories, in the order the file lists them.                                                                                           |
| `tags`            | On a post: its tags, in the order the file lists them.                                                                                                 |
| `backlinks`       | On a post or a page: the site's posts and pages that link to it, newest first, as the HTML's Linked from list has them.                                |
| `feeds`           | The feeds the HTML head advertises for the page, in the head's order.                                                                                  |
| `postType`        | On a post: its kind, as the HTML has it, such as `reply`, `like`, `rsvp`, `event` or `review`.                                                         |
| `cites`           | On a post: what it answers or cites, one entry for its reply target, then one for each like, repost and bookmark.                                      |
| `rsvp`            | On an RSVP: its `value` (`yes`, `no`, `maybe` or `interested`) and its `label`, such as `Going`.                                                       |
| `event`           | On an event: `start`, `end` when it has one, and `location`, the same object `event.njk` reads.                                                        |
| `review`          | On a review: the HTML's `item`, `kindLabel`, `rating` and `best`, with the review line in plain words.                                                 |
| `location`        | On a post with a location: what Settings > Privacy shares of it, the same object `location.njk` reads. Absent otherwise.                               |
| `lang`            | On a post whose front matter names its language: that language. Dates are written in it.                                                               |
| `enclosure`       | On a post with a recording: the object `recording.njk` reads. Absent otherwise.                                                                        |
| `photos`          | On a post: its photos, in the order the HTML draws them, each a `url` and an `alt`. Empty when it has none.                                            |
| `conversation`    | On a post or a page that has been answered: what `conversation.njk` draws, in Markdown. Absent when nothing has been said.                             |
| `commentForm`     | On a post or a page taking comments: the `url` of the comment form on its HTML page. Absent when it is closed.                                         |
| `contactForm`     | On a page whose front matter says `contact: true`: the `url` of the contact form on its HTML page.                                                     |
| `webmention`      | The site's webmention endpoint, when it takes webmentions.                                                                                             |
| `thread`          | On a comment's own page: the post, the comments it answers and the comment itself. See below.                                                          |

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

`enclosure.player` is `audio` or `video`. `enclosure.url` and
`enclosure.type` are the main file's, and `enclosure.length` is its size in
bytes. The `fileSize` filter prints a size the way the admin does, such as
`22.4 MB`. `enclosure.transcript`, when there is one, is a `url`, a `type` and
`captions`, which is true for timed captions (WebVTT or SubRip). Each of
`enclosure.alternates` is a `url` and a `type`, with a `title`, a `length`, a
`height` and a `lang` when the front matter gives them.

A photo's `alt` is the post's own alt text for it, else the media library's,
as the HTML prints it. It is empty when neither says.

`conversation` comes from the same reader as the HTML's `conversation`, so
it holds what a reader of the HTML may see and nothing more: no pending, spam
or deleted comment, and no fediverse reply its author withdrew. See
[The conversation](conversation.md). Its keys are:

| Key        | What it is                                                                                                        |
| ---------- | ----------------------------------------------------------------------------------------------------------------- |
| `replies`  | The replies to the document, oldest first, each with its own `replies`, threaded as the HTML threads them.        |
| `likes`    | The likes, oldest first. Each is a `label`, the person's name, and a `url`, their profile, when the site has one. |
| `boosts`   | The boosts and reposts, in the same shape.                                                                        |
| `mentions` | The pages that mention the document, in the same shape. The `url` is the mentioning page, as in the facepile.     |
| `rsvps`    | An event's answers, each `{ value, label, people }`, with `people` in the same shape.                             |
| `counts`   | The HTML's `counts`: `replies` through the whole thread, `likes`, `boosts`, `mentions`, `rsvps` and `total`.      |

Each reply is:

| Key         | What it is                                                                                               |
| ----------- | -------------------------------------------------------------------------------------------------------- |
| `key`       | Its key, as in the HTML's `#comment-{key}` anchor.                                                       |
| `source`    | `comment`, `webmention`, `activitypub` or `post`.                                                        |
| `author`    | A `label`, their name, and a `url` when they gave one.                                                   |
| `url`       | Where it can be read: a comment's own page, the webmention's page or the fediverse note.                 |
| `published` | A `Date`. The `date` filter prints it as the HTML does.                                                  |
| `rsvp`      | An RSVP's `value` and `label`, on a reply that is one.                                                   |
| `text`      | Its words as Markdown, converted from the sanitised HTML the thread prints. Empty for a reply with none. |
| `replies`   | The replies to it, in the same shape.                                                                    |

A reply the HTML prints as a placeholder, a hidden comment with a visible
reply under it, is `{ key, withheld: true, replies }`.

The forms need HTML, so `commentForm.url` and `contactForm.url` are absolute
URLs of the HTML page with the form's anchor, `#respond` or `#contact`. Print
them as they are: through `markdownUrl` they would become the `.md` URL of the
page the reader is already on.

`thread` is on a comment's own page only, and holds the chain the HTML
comment page draws:

| Key         | What it is                                                                                                 |
| ----------- | ---------------------------------------------------------------------------------------------------------- |
| `post`      | The post the comment is on: a `label`, a `url`, an `author` (`label` and `url`), a `date` and a `summary`. |
| `ancestors` | The comments it answers, from the top of the thread down, each a reply without its `replies`, or `null`.   |
| `comment`   | The comment, a reply as above, with its replies threaded under it.                                         |
| `onPostUrl` | The comment's anchor on the post's page, `{permalink}#comment-{key}`.                                      |

A `null` ancestor is a comment a reader may not see. The comment's `text` is
the page's body, so the partials do not print it. The `quote` filter writes
Markdown as a blockquote, which the default header uses for each ancestor's
words and the post's summary.

`partials/markdown-reply.md.njk` holds the macros the default partials share:
`named(person)`, `said(reply)`, the byline of a reply, and `reply(reply)`, a
reply as a list item with its replies nested under it. Import it
`with context`, so its links go through `markdownUrl`:

```njk
{% import "partials/markdown-reply.md.njk" as conversing with context %}
{% for entry in conversation.replies %}
{{ conversing.reply(entry) | trim }}
{% endfor %}
```

Each post in `archiveMonths` is a `label`, a `url`, a `date` and a
`description`. The `date` is the post's calendar day in the site's timezone,
as `YYYY-MM-DD`. The `description` is already on one line, and is absent when
the post has none. The months and their posts are the same ones the HTML
archive page lists. See [An archive page](page-shell.md#an-archive-page).

## Layout templates

A page's Markdown is the header, the page's Markdown and the footer, in that
order. A theme that wants something else on one kind of page writes a layout
template for it, named after the HTML layout that draws the same page. When
the template exists, the Markdown after the front matter is what it writes.
When no theme on the search path has one, the page is the header, its
Markdown and the footer, as before. The default theme ships no layout
templates.

| Layout template             | The page                                                              |
| --------------------------- | --------------------------------------------------------------------- |
| `layouts/post.md.njk`       | A post.                                                               |
| `layouts/page.md.njk`       | A page, and the homepage when it is a page and has no front page one. |
| `layouts/front-page.md.njk` | The homepage, when it is a page.                                      |
| `layouts/home.md.njk`       | The homepage when it lists posts, and the posts page without its own. |
| `layouts/posts-page.md.njk` | The page the Reading setting names for the posts.                     |
| `layouts/tag.md.njk`        | A tag archive.                                                        |
| `layouts/category.md.njk`   | A category archive.                                                   |
| `layouts/author.md.njk`     | An author archive.                                                    |
| `layouts/search.md.njk`     | The search.                                                           |
| `layouts/comment.md.njk`    | A comment's own page.                                                 |

The homepage that is a page takes `layouts/front-page.md.njk`, else
`layouts/page.md.njk`, as its HTML takes `layouts/front-page.njk`, else
`layouts/page.njk`. The posts page takes `layouts/posts-page.md.njk`, else
`layouts/home.md.njk`. The status pages keep their own templates, listed
under [Status pages](#status-pages). A layout template resolves like every
other template, so a site theme's one replaces the package's.

A layout template gets everything the header and the footer get (see
[Context](#context)), with three more keys:

| Key       | What it is                                                                                                |
| --------- | --------------------------------------------------------------------------------------------------------- |
| `content` | The page's own Markdown, with the site's links rewritten. On a listing, its description, posts and pager. |
| `header`  | What `partials/markdown-header.md.njk` writes for this page.                                              |
| `footer`  | What `partials/markdown-footer.md.njk` writes for this page.                                              |

Print `header` and `footer` where they belong, or leave either out. A
template can also include the partials, which render with the same context:

```njk
{% include "partials/markdown-header.md.njk" %}
{{ content }}
```

The template is written as it renders, so the blank lines between its blocks
are the template's own. Nunjucks keeps the line after a `{# comment #}`.
Close a comment with `-#}` to drop it.

### A front page

A site theme whose front page shows the author's bio and the newest posts
writes `layouts/front-page.md.njk`. The header and the footer stay the
package's:

```njk
{{ header }}

{{ content }}

{% include "partials/markdown-bio.md.njk" %}

## Newest posts

{% set postList = newestPosts(5) %}
{% include "partials/markdown-post-list.md.njk" %}

{{ footer }}
```

`partials/markdown-bio.md.njk` prints `bio.note` and `bio.links` as the
default header does, and nothing when there is no `bio`. The note is Markdown
already, so the partial prints it as written through the `markdownLinks`
filter, which gives each link to a page of this site its `.md` URL and leaves
every other link as it is.
`partials/markdown-post-list.md.njk` prints `postList`, entries in the shape
`newestPosts(count)` gives, one line each as a listing's Markdown has them.
Between the header and the footer, the page reads:

```markdown
Who writes this.

Wrote the _first_ program. Start [here](/about/index.md).

- [Her notes](https://ada.example)

## Newest posts

- [2026-09-03 Third post](/2026/09/third/index.md)
- [2026-09-02 Second post](/2026/09/second/index.md)
```

The `.gmi` page converts this template as well. See
[The Gemini representation](gemini.md#layout-templates).

## Status pages

A request for a URL's `.md`, or with an `Accept` header that prefers
`text/markdown` or `text/plain`, gets the 404, 410, 500 or 503 page in
Markdown, with the same status code. Other requests get the HTML layout of the
same name. The page has the front matter `title` and `home`, the header, the
body from the status page's template, and the footer. The 503 front matter
adds `until` when the operator named a time it has not reached.

The header and footer get `type` as `status`, `title`, `url`, `site`, `feeds`,
`navigation` and `menus`. The status page's template gets:

| Key         | What it is                                                                                             |
| ----------- | ------------------------------------------------------------------------------------------------------ |
| `site`      | `content/_data/site.json`.                                                                             |
| `url`       | The path that was requested, such as `/2026/09/gone/index.md`.                                         |
| `title`     | `Not found`, `Deleted`, `Something went wrong` or `Down for maintenance`.                              |
| `until`     | On the 503: when the site is expected back, in ISO 8601. Absent when no time is set, or it has passed. |
| `untilText` | The same time as an HTTP date, as the HTML 503 prints it.                                              |

It has the `escapeMarkdown` and `markdownUrl` filters. The default templates
write the HTML layout's sentence, the 503's back-by time, and links to the
homepage and the search:

```markdown
# Down for maintenance

This site is down for maintenance and will be back shortly. It should be back by Tue, 01 Dec 2026 14:00:00 GMT. Please try again then.

Go [home](/index.md), or [search the site](/search/index.md).
```

When the 500 or 503 template fails to render, the CMS writes a fixed
Markdown body in its place, as it writes a fixed HTML page when the HTML
layout fails.

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

After those lines comes the post's recording, then its photos, in the order
the HTML draws them above the post's words. The recording is a download link
with its type and size, a link to its captions or transcript, and a list of
its other versions, each labelled with its title, or its type when it has
none. Each photo is an image with its alt text:

```markdown
[Download the recording](/uploads/2026/09/episode-12.mp3) (audio/mpeg, 22.4 MB)

[Captions](/uploads/2026/09/episode-12.vtt)

Other versions:

- [Video](/uploads/2026/09/episode-12.mp4) (video/mp4, 94.2 MB)
- [audio/mpeg](https://cdn.example.com/episode-12-low.mp3)

![Waves breaking at dusk](/uploads/2026/09/beach.jpg)
```

A video's link says `Download the video`.

The dates are in the site's timezone, and a cited event's start is in its
own zone when its page wrote it without one, as the HTML prints them. The
location line prints the place's words, or the coordinates when the site
shares the exact location and the place has no words.

Where there is a bio, the header writes its note and its links as a list. On a homepage that is a page (`staticFrontPage`), it
leaves the bio out and prints only the page, as the HTML front page does
(decision-45). A site theme that wants the bio there includes
`partials/markdown-bio.md.njk` from its `layouts/front-page.md.njk`. See
[A front page](#a-front-page).

On a comment's own page the header writes `thread`: a line naming the post
with its author and date, the post's summary as a quote, a line for each
ancestor (`In reply to` its author and date, then its words as a quote, or
`In reply to a comment that is no longer shown.`), and the comment's own
author and date.

The default footer starts with the archive, when the context has
`archiveMonths`. It writes each month as a level-two heading over a list of
that month's posts, one line each, in the shape a listing's Markdown has:

```markdown
## September 2026

- [2026-09-03 Third post](/third/index.md): The third post's description.
```

After the archive, the footer writes these sections, each as a level-two
heading over a list, and leaves out a section that has nothing to list:

| Heading           | What it lists                                                                       |
| ----------------- | ----------------------------------------------------------------------------------- |
| `Filed under`     | A post's categories, then its tags.                                                 |
| `Linked from`     | `backlinks`, one line each in the shape a listing's Markdown has.                   |
| `More posts`      | A post's `previous` and `next`. The CMS writes a listing's pages under its posts.   |
| RSVP answers      | Each of `conversation.rsvps`, headed with its label and count, such as `Going (2)`. |
| `Likes`           | `conversation.likes`, headed with the count.                                        |
| `Boosts`          | `conversation.boosts`, headed with the count.                                       |
| `Mentions`        | `conversation.mentions`, headed with the count.                                     |
| The replies       | `conversation.replies`, headed `One reply` or `3 replies` as the HTML is.           |
| `Replies`         | On a comment's own page: `thread.comment.replies`, then a link to the whole thread. |
| `Leave a comment` | A link to the comment form on the HTML page, while the document takes comments.     |
| `Send a message`  | A link to the contact form on the HTML page.                                        |
| `Gemini`          | `capsuleUrl`, a link to this page over Gemini, while the site serves Gemini.        |
| `Feeds`           | `feeds`, each labelled with its title and format.                                   |

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

The replies are a nested list. Each item opens with the author, linked when
they gave a URL, the date linked to where the reply can be read, and
`via webmention` or `via the fediverse` for those sources. The reply's words
follow as paragraphs in the item, and the replies to it as a list inside it.
A placeholder prints `This comment is no longer shown.` with its replies under
it. Under the replies of a document that no longer takes comments, the footer
writes `Comments are closed.`, as the HTML does:

```markdown
## Likes (1)

- [Ada Lovelace](https://remote.example/@ada)

## 2 replies

- [Ada Lovelace](https://ada.example/), [11 September 2026](/comment/0000000000000001/)

  Approved _words_.

  - Grace Hopper, [11 September 2026](/comment/0000000000000002/)

    Answering Ada.

## Leave a comment

[Leave a comment on the web page](https://example.com/2026/09/second/#respond)

Or reply from your own site and send a [webmention](https://indieweb.org/Webmention).
```

The webmention line is there only when the site takes webmentions. On a
contact page the footer writes a `Send a message` section the same way, with
a link to `#contact` on the HTML page.

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
- [Search](/search/index.md)
- [Mastodon](https://mastodon.example/@ada)
```

Each link is on a line of its own with its own label, so the same data
maps onto Gemini link lines.
