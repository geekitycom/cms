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
    post-list.njk     a list of documents
    pagination.njk    previous/next pager
    tags.njk          macros for tag and category links
    feeds.njk         macros for the feed links in <head>
    conversation.njk  the replies, likes and boosts under a post
  mail/
    test.*.njk              the Send test email message
    password-reset.*.njk    the forgot-password link
    password-changed.*.njk  the notice sent once a password has been set
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

## Mail templates

The messages the CMS sends live under `mail/` and resolve the same way, so
`theme/mail/test.txt.njk` replaces the text of the test message and leaves its
subject and HTML twin coming from the package. Each message is up to three
files:

| File                      | What it is                                                     |
| ------------------------- | -------------------------------------------------------------- |
| `mail/<name>.subject.njk` | The subject. Rendered to a single line. Optional.              |
| `mail/<name>.txt.njk`     | The plain text body. **Required.**                             |
| `mail/<name>.html.njk`    | The HTML twin. Optional; without it the message is plain text. |

A message that has no `.txt.njk` anywhere on the search path is an error rather
than an empty email, so a typo in a template name is reported instead of sent.

The package ships five messages:

| Name               | When it goes                                     | What `data` carries                                                                                                         |
| ------------------ | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| `test`             | Send test email, on Settings.                    | Nothing.                                                                                                                    |
| `password-reset`   | Somebody asked to reset a password.              | `username`, `resetUrl`, `expiresAt`, `expiresInHours`.                                                                      |
| `password-changed` | A reset link was used.                           | `username`, `signedOut` (how many sessions ended).                                                                          |
| `comment-pending`  | A comment or webmention is waiting for approval. | `comment`, `post` (`title`, `url`), `actions` (one `{ action, label, url }` each for approve, spam and delete), `queueUrl`. |
| `comment-reply`    | A reply to somebody's comment was approved.      | `reply`, `comment` (the one it answers), `post`, `unsubscribeUrl`.                                                          |

`comment` and `reply` above are the same shape: `author`, `website`, `source`
(`comment` or `webmention`), `kind`, `text`, `html`, `submitted`, and `url`.
The commenter's email address is deliberately **not** among them — the message
goes to a moderator, but it also goes through a mail provider's servers, and
nothing on that screen needs it.

The links in `actions` and `unsubscribeUrl` each carry a signed token and work
without a login. Print them; do not try to build one.

The subject and the plain text body render with autoescaping **off**, because
neither is HTML: `&` between two query parameters stays an `&`, and an
apostrophe in somebody's name stays an apostrophe. The HTML twin escapes as
every other template does.

The context is `site` (that is `content/_data/site.json`), `baseUrl`, and
whatever the feature that sent it passed as `data`. The `date`, `url` and
`absoluteUrl` filters are the same ones a page has, so a message can write a
link with `{{ "/admin/" | absoluteUrl }}`.

Writing `theme/mail/welcome.txt.njk` is enough to add a message this package
never shipped; nothing has to be registered.

## Template context

The context mirrors what an Eleventy layout receives, so a layout ported from
an Eleventy build needs few edits. It is part of the package's semver contract.

Every template gets:

| Key    | What it holds                                                                                                                                                                                           |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `site` | `content/_data/site.json`, if the site has one, over the defaults `title` and `url`. Any key in the file is readable, so `site.tagline`, `site.author` and anything else a site adds are all available. |
| `menu` | The site menu for this page: a list of `{ label, url, current }`. See [Navigation](#navigation).                                                                                                        |

A document — one post, one page, or one entry of a listing — adds:

| Key                                                   | What it holds                                                                                                     |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `title`                                               | Display title.                                                                                                    |
| `date`                                                | Publish date, a JavaScript `Date` at the UTC instant the file holds. Absent when the document has none.           |
| `updated`                                             | Last modified date, a `Date`, when the front matter has one.                                                      |
| `tags`                                                | The document's tags, in file order.                                                                               |
| `categories`                                          | The document's categories, in file order.                                                                         |
| `content`                                             | The Markdown body rendered to HTML. Print it with `\| safe`.                                                      |
| `url`                                                 | The document's URL path, the same value as `page.url`.                                                            |
| `page.url`                                            | The document's URL path. Always ends in `/`.                                                                      |
| `page.date`                                           | The same `Date` as `date`.                                                                                        |
| `page.fileSlug`                                       | The permalink's last segment.                                                                                     |
| `page.inputPath`                                      | The source file, relative to the content directory.                                                               |
| `type`                                                | `post` or `page`.                                                                                                 |
| `permalink`, `slug`, `draft`, `description`, `author` | Straight from the front matter.                                                                                   |
| `activityStreams`                                     | The post's ActivityPub object id, absolute. Only on a rendered published post.                                    |
| `webmention`                                          | Where a webmention about this page is sent. Only on a rendered document, and only while the site takes them.      |
| `conversation`                                        | The replies, likes and boosts under the post. Only when there are any. See [The conversation](#the-conversation). |
| everything else                                       | Any front matter key the CMS does not model is on the context under its own name.                                 |

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
comes from `language`, and defaults to `en`. The rssCloud and WebSub server the
feeds advertise comes from `notifyServer`, and is empty for none; the theme
writes nothing for it, because a cloud is advertised in the feed rather than on
the page.

## Navigation

`menu` is the site menu, already in order and already knowing which of its items
is the page being looked at. Every template gets it, so a layout that overrides
`header` renders the menu the same way `layouts/base.njk` does:

```njk
{% if menu.length %}
<nav class="site-nav" aria-label="Site">
  <ul>
    {% for item in menu %}
    <li><a href="{{ item.url | url }}"{% if item.current %} aria-current="page"{% endif %}>{{ item.label }}</a></li>
    {% endfor %}
  </ul>
</nav>
{% endif %}
```

Each item is `{ label, url, current }`. `url` is a site-root path or an absolute
URL for somewhere else, so put it through the `url` filter as above and a site
served from a subdirectory still links correctly. `current` is true for the item
whose path is the one being rendered, comparing without the trailing slash; an
item pointing off the site is never current.

The list is the `navigation` setting first, in the order the settings screen
names it, and then every published page whose front matter says
`navigation: true`, ordered by `navigationOrder` and then by title. A page that
names no order sorts after every page that does.

It is called `menu` rather than `navigation` because `navigation` is the
front-matter key a page opts in with, and a document's own front matter goes on
top of the globals exactly as Eleventy's data cascade does. The setting is
mirrored to `navigation` in `content/_data/site.json`, so an Eleventy build of
the same content renders the same menu; `docs/eleventy.config.example.js` builds
it as `collections.menu`.

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

After the block, and outside it, the base layout writes the webmention
endpoint:

```html
<link rel="webmention" href="/_geekity/webmention" />
```

It comes from `webmention` on the context, which is on a rendered document only
when the site is taking webmentions, so a theme asks `{% if webmention %}` and a
site that has turned them off advertises nothing. The CMS also sends the same
endpoint as a `Link` header on every representation of a document, so a sender
that does not parse HTML still finds it.

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

## The conversation

`conversation` is what has been said about a post: the fediverse replies, likes
and boosts its inbox was sent, the comments people left on the page itself, and
the webmentions other pages sent it.
It is on the context of a rendered post **only when there is something in it**,
so a post nobody has answered renders no empty section and a layout can simply
ask:

```njk
{% if conversation %}
{% include "partials/conversation.njk" %}
{% endif %}
```

That is what `layouts/post.njk` does. `partials/conversation.njk` is the whole
section — the reply thread, and the likes, boosts and mentions as counts with
the people behind them inside a `<details>` — and a site replaces it by shipping
`theme/partials/conversation.njk` of its own, exactly as it replaces any other
template. It defines three macros, `comment(reply)`,
`reactions(actors, one, many)` and `mentions(items)`, and a layout that wants to
place the pieces itself can import them:

```njk
{% import "partials/conversation.njk" as thread with context %}
{{ thread.reactions(conversation.likes, "like", "likes") }}
```

### The shape

The conversation is deliberately **not** spelled in ActivityPub's vocabulary.
Native comments and webmentions land in the same thread, so every
entry says where it came from and what it is, and nothing else about it changes
with the source. A theme that never looks at `source` renders all of them
correctly; one that does can style them apart. The one thing a theme does have
to look at is `kind`: a `mention` is in `conversation.mentions` rather than in
the thread, because it is not an answer.

| Key                                                | What it holds                                                                              |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `replies`                                          | The replies to the post, oldest first, each carrying its own `replies`. See below.         |
| `likes`                                            | The likes, oldest first, in the same shape.                                                |
| `boosts`                                           | The boosts, oldest first, in the same shape. A webmention `repost` is one of them.         |
| `mentions`                                         | The pages that linked here without answering, oldest first, in the same shape.             |
| `counts.replies`                                   | How many replies, counted through the whole thread rather than the top of it.              |
| `counts.likes`, `counts.boosts`, `counts.mentions` | How many of each.                                                                          |
| `counts.total`                                     | All four added up. Zero never reaches a template: there would be no `conversation` at all. |

Each entry — a reply, a like or a boost — is:

| Key              | What it holds                                                                                                                                                                          |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`             | What it is called: a reply's own note id, which is what an answer to it names.                                                                                                         |
| `source`         | `"activitypub"` for a fediverse reply, `"comment"` for one left on the page, `"webmention"` for another page linking here.                                                             |
| `kind`           | `"reply"`, `"like"`, `"boost"`, `"repost"` or `"mention"`. The last two only ever come from a webmention.                                                                              |
| `author.name`    | The best name available: their display name, else their handle, else their id. For a webmention, the source's `h-card` name, else its host.                                            |
| `author.handle`  | `@user@host`, or `null`. Taken from the follower profile the site holds, else guessed from the actor URL. `null` for a native comment.                                                 |
| `author.url`     | Their profile page, the website a commenter typed, or a webmention author's `u-url`. May be `null`, so guard the link.                                                                 |
| `author.avatar`  | Their avatar, or `null`. The site knows one for an actor that follows it and for a webmention whose `h-card` carried a `u-photo`.                                                      |
| `author.actorId` | Their id, which is what identifies them however they are named. `null` for a native comment.                                                                                           |
| `url`            | Where it can be read: the remote note's `url` for a fediverse reply, the source page for a webmention, and `{permalink}#comment-{id}` — this page's own anchor — for a native comment. |
| `content`        | What it says, **already sanitised**, so print it with `\| safe`. Empty for a like or a boost.                                                                                          |
| `published`      | A `Date`: when it was published, or when it arrived if it did not say. Use the `date` filter.                                                                                          |
| `inReplyTo`      | What it answers — the post's ActivityPub id, or another reply's — and `null` for a reaction.                                                                                           |
| `status`         | `"published"`. On the record for the sources that moderate.                                                                                                                            |
| `replies`        | The replies to this one, oldest first, nested as deep as the site has seen.                                                                                                            |

Three rules decide what is in the thread, and they are the CMS's rather than a
theme's: a reply whose author deleted it is gone, and its own answers move up to
whatever it was answering; a like is counted once per actor and disappears when
that actor undoes it; and a note answering something this post has nothing to do
with is left out.

`content` is safe to print whatever produced it, and safe for different reasons.
A fediverse reply is HTML somebody else's server composed, rebuilt from an
allowlist — `a`, `p`, `br`, lists, `blockquote`, `pre`, `code` and the inline
emphasis tags, with every link carrying `rel="nofollow noopener noreferrer"`. A
webmention's `e-content` goes through the same allowlist. A native comment is
Markdown the commenter typed, rendered with raw HTML off, no images embedded,
and every link carrying `rel="nofollow ugc"`. Nothing else survives any of the
three routes, so a theme may print all of them directly.

The packaged partial gives each entry `id="comment-{{ reply.id }}"` and a
`comment-{{ reply.source }}` class, and puts a Reply link on the ones written
here — `source == "comment"` — when the post is still open; the link carries the
comment's id to the form as `?reply_to=`, so threading needs no JavaScript. A
fediverse reply is answered on the server that holds it and a webmention on the
page that sent it, so neither gets one. Mentions are drawn by a third macro,
`mentions(items)`, as a `<details>` beside the likes and the boosts, each one
linking to the page it came from.

An Eleventy build of the same content gets the same thing from the same files:
`docs/eleventy.config.example.js` adds a `conversation` filter over
`federation.inbox`, and puts the post's ActivityPub id on the context as
`activityStreams` and its slug as `geekitySlug`, so a layout reads

```njk
{% set conversation = federation.inbox | conversation(activityStreams, geekitySlug) %}
```

and then loops over exactly the keys above. The slug is what names the post's
comment file under `content/_data/comments/`; the format is documented in
backlog doc-6.

## The comment form

`commentForm` is on the context of a rendered post **only when that post is
still taking comments**. A site switch, a closing window counted from the
post's date, and `comments: true` or `comments: false` in the post's own front
matter all agree before it gets here, so a layout asks:

```njk
{% if commentForm %}
{% include "partials/comment-form.njk" %}
{% endif %}
```

That is what `layouts/post.njk` does, after the conversation. A closed post
still shows the thread — including every fediverse reply, which arrives whether
a post is open or not — and simply has no form. A site replaces
`partials/comment-form.njk` the way it replaces any other template.

| Key                        | What it holds                                                                                                                                                             |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `action`                   | Where the form posts. One fixed path; the post travels as a field.                                                                                                        |
| `fields`                   | The name each field is submitted under: `post`, `name`, `email`, `url`, `body`, `inReplyTo`, `trap`, `loaded`, `notify`. Use these rather than typing the names.          |
| `post`                     | The post's slug, for the hidden field.                                                                                                                                    |
| `loaded`                   | When this form was rendered, in epoch milliseconds, for the hidden field. A submission that comes back too fast is refused.                                               |
| `values`                   | What is in the fields: empty on a fresh form, what was typed on a refused one.                                                                                            |
| `problems`                 | One message per field a person has to put right — `name`, `email`, `url`, `body`.                                                                                         |
| `error`                    | A message about the submission as a whole, when there is one.                                                                                                             |
| `notifiable`               | Whether to offer `fields.notify`, the "email me when somebody replies" box. False on a site that sends no mail, where the box would promise a message nothing could send. |
| `nameLength`, `bodyLength` | The `maxlength` for the two fields that have one.                                                                                                                         |

`fields.trap` is a honeypot: render it, hide it from sight and from assistive
technology, and give it `tabindex="-1"` and `autocomplete="off"`. A submission
that filled it is dropped. **Do not** remove it from a replacement partial —
it is one of three things standing between the site and a spam queue.

Two more keys travel beside it, both from the URL rather than from the post:

| Key                                   | What it holds                                                                                                                   |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `commentNotice`                       | The thank-you after a submission, from the `?comment=` the redirect carried.                                                    |
| `commentReplyTo`, `commentReplyingTo` | The comment a `?reply_to=` link named and the name on it, once the CMS has checked it is an approved comment on this very post. |

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

| Filter               | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `date(format, zone)` | Formats a `Date` or a date string. `readable` (the default) gives `2 September 2026`, `html` gives `2026-09-02` for a `<time datetime>`, `year` gives `2026`, `iso` gives the full ISO 8601 instant. A date in a file is a UTC instant; `readable`, `html` and `year` are rendered in the site's `timezone` setting, and `iso` stays the instant. Pass `zone` — an IANA name — to override the setting for one call. A value that is not a date renders as the empty string. |
| `url`                | Prefixes a root-relative path with the base URL's path, so a site served from a subdirectory links correctly. Eleventy's filter of the same name.                                                                                                                                                                                                                                                                                                                            |
| `absoluteUrl`        | The same path as a fully qualified URL against the site's `baseUrl`.                                                                                                                                                                                                                                                                                                                                                                                                         |

Nunjucks' own filters — `default`, `join`, `urlencode`, `safe` and the rest —
are all available. Autoescaping is on, so rendered Markdown is the one thing
that has to be passed through `safe`.
