# Default theme

Templates ship here, inside the published package, so every site gets them
without copying anything.

```
themes/default/
  theme.json     the manifest: name, kind and description
  layouts/
    base.njk     the page every other layout extends
    home.njk     the post archive, paginated
    post.njk     one post
    page.njk     one page
    tag.njk      a tag archive, paginated
    category.njk a category archive, paginated
    author.njk   one person's archive, paginated
    404.njk      nothing at this URL
  partials/
    post-list.njk     a list of documents
    pagination.njk    previous/next pager
    tags.njk          macros for tag and category links
    byline.njk        who wrote a post, linked to their archive
    feeds.njk         macros for the feed links in <head>
    conversation.njk  the replies, likes and boosts under a post
    comment-form.njk  the form under a post that is taking comments
    contact-form.njk  the form on a page whose front matter says contact: true
  mail/
    test.*.njk              the Send test email message
    password-reset.*.njk    the forgot-password link
    password-changed.*.njk  the notice sent once a password has been set
    comment-pending.*.njk   the moderation notice
    comment-digest.*.njk    the hourly or daily digest of what is waiting
    comment-reply.*.njk     the notice a commenter gets about a reply
    contact-message.*.njk   a message from a page's contact form
  static/
    style.css    served at /theme/style.css
```

Plain Nunjucks and plain CSS. There is no build step and no dependency: a site
that wants Tailwind or anything else brings its own.

## The manifest

`theme.json` is what makes a directory a theme:

```json
{
  "name": "Default",
  "kind": "site",
  "description": "One line about the theme."
}
```

`name` is what a person sees, `kind` is `site` — the only kind there is, and
the field exists so another can be added later without the format changing —
and `description` is optional. The directory name is the theme's id. A
directory without a readable manifest, or one naming a kind this CMS does not
have, is not a theme.

## Overriding a template

A site keeps its themes under one directory, `themes/` by default and
`themesDir` in the config, with one folder per theme and a `theme.json` in
each. Which one it wears is one setting, `theme` in `content/_data/site.json`,
holding the folder's name:

```
themes/
  midnight/
    theme.json
    layouts/post.njk
    static/style.css
```

```json
{ "theme": "midnight" }
```

The setting is what **Appearance > Themes** in the admin writes: the screen
lists this theme and every folder under `themes/`, marks the one in use, and
Activate on another writes its name — or, on the packaged theme, takes the key
out again. A change takes effect on the next request, with no restart, and a
folder whose manifest will not read is listed under "Not themes" with the
reason rather than quietly left out.

Resolution order for any template is then that theme first, this directory
second, one file at a time. The theme above replaces the post layout and keeps
receiving updates to every other template, and `static/style.css` replaces the
stylesheet the same way — assets under `/theme/` resolve in the same order. A
site that has chosen no theme reads this one and nothing else, and a theme
sitting in `themes/` that the setting does not name is never on the path at
all. A `theme` naming a folder that is not there, or is not a theme, falls back
to this one with a warning in the log rather than a broken site.

The admin is not a theme and has no setting. Its templates live in their own
tree with a loader of their own, off this search path entirely, so no theme can
shadow the login form or the CSRF field inside it.

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

Two layouts are override points rather than files shipped here, for the pages
the Reading settings name:

| Template                 | Rendered for                  | Falls back to      |
| ------------------------ | ----------------------------- | ------------------ |
| `layouts/front-page.njk` | the page served at `/`        | `layouts/page.njk` |
| `layouts/posts-page.njk` | the listing on the posts page | `layouts/home.njk` |

Neither is needed: a site that sets a homepage gets the page layout for it and
a site that sets a posts page gets the listing layout, until it writes one.
Writing `layouts/front-page.njk` into the theme is how a front page is laid out
differently from every other page without overriding the layout they all use.
The front page also gets `recentPosts`, entries in the same shape a listing's
are, so it can print its words and then the writing: the posts of the current
month when there are at least five of them, and the five newest otherwise.
On the posts page the page's own front matter and rendered body are on the
context beside the listing, so `{{ content | safe }}` prints its words above
the posts; `layouts/home.njk` already does.

## The page shell

`layouts/base.njk` is the andrewshell.org design's shell (decision-16): the
skip link, one `.global-wrapper` at the 42rem measure, `.global-header`,
`<main id="main">` and the footer, in that order.

**The header has one rule.** On the front page it is the site title as
`h1.main-heading`, linked home, with `site.tagline` in a paragraph under it; on
every other page it is `a.header-link-home`, the site title small and linked
home, and no tagline. The wrapper carries `data-is-root-path="true"` at `/` and
nothing anywhere else, which is how the stylesheet tells the two apart. There is
no navigation in the header — see [Navigation](#navigation).

**The footer** prints the copyright with the current year and `site.author`,
`Published with Geekity`, and then one `ul.hlist` holding an RSS link to
`/feed/` and one `rel="me"` link per entry of `siteAuthor.links`. A site whose
`author` setting names nobody with an account here gets the line and the RSS
link and no identity links, because `siteAuthor` is absent. The year is
`{{ "now" | date("year") }}` — `now` is the one word the `date` filter reads
rather than parses — so it is the year at the moment the page is rendered, in
the site's own timezone.

Webrings, badges, a licence notice and anything else particular to one site are
deliberately not in the package. They go in a site theme's `footer` block:

```njk
{% extends "layouts/base.njk" %}

{% block footer %}
{{ super() }}
<p class="webring">
  <a href="https://example.ring/previous">&larr;</a>
  An <a href="https://example.ring">example webring</a>
  <a href="https://example.ring/next">&rarr;</a>
</p>
{% endblock %}
```

### The head

Beside the title, the canonical link and the feeds, every page carries a
description, Open Graph and Twitter card tags, the site's icons and one
JSON-LD graph. All of it is in the `head` block, so an override that only means
to add a tag calls `{{ super() }}` first.

**The description** is the page's own `description` from the front matter, else
the entry's `summary` — the line the feeds publish — else `site.tagline`. It is
printed once, as `<meta name="description">`, and the Open Graph and Twitter
descriptions say the same thing.

**The card.** `og:title` is the page's title, or the site's on the front page;
`og:site_name` is always the site's. `og:type` is `article` on a rendered post
or page and `website` everywhere else, a listing carrying a page's front matter
included. `og:url` is the canonical URL. `twitter:card` is `summary`, the small
square picture beside the words, because the picture is usually a face rather
than a wide photograph.

**The picture** is the `image` in the entry's front matter, else `site.avatar`.
A site with neither prints no `og:image` and no `twitter:image` rather than an
empty one.

**The icons** come from the site's avatar through the derived images
(decision-10): `icon` at 32 and 16 pixels and `apple-touch-icon` at 180, each a
square PNG cropped from the middle of the avatar and encoded the first time a
browser asks for it. They are on the context as `icons`, a list of
`{ rel, sizes, href }`, which is empty — and the links are not printed at all —
when the site has no avatar, when its avatar is a file no icon can be made of,
or when image optimization is off. There is no web manifest; a site that wants
one adds it in its own `head` block.

**The structured data** is `partials/jsonld.njk`, one `<script
type="application/ld+json">` holding one `@graph` per page, and it is the only
structured data the theme emits — there is no Microdata anywhere, by
decision-16, because the visible markup already carries microformats2 for the
IndieWeb. The graph holds:

- `WebSite`, always, with the site's title, tagline and URL, and a `publisher`
  pointing at the Person. Its `SearchAction` goes in when the site has a search
  to point it at.
- `Person`, from `siteAuthor`: their name, archive URL, avatar, bio, job title
  and location, and a `sameAs` of their profile links and their actor id, which
  is what asserts that the schema.org Person and the fediverse actor are one
  identity. Identity comes from a user profile, so a site — or a byline —
  naming nobody with an account here prints no Person, and the `author` and
  `publisher` references go with it.
- `ProfilePage` on an author archive, whose `mainEntity` is that Person.
- `BlogPosting` on a post and `Article` on a page, with the headline, URL,
  `mainEntityOfPage`, `datePublished`, `dateModified`, description, image,
  `author` and `publisher`.

A site that wants a different graph — more types, an `Organization` publisher,
nothing at all — writes its own `partials/jsonld.njk` and that file replaces
this one, like any other partial.

### Colours

`static/style.css` is the source design: a serif body and sans headings at an
18px root on a 1.2 minor-third scale, warm paper with near-black text, a rust
primary and a blue secondary, one column, links that invert to the primary
colour on hover, and a rule in the primary colour. Everything is a custom
property on `:root`, so a site that only wants different colours overrides the
half-dozen `--color-*` tokens rather than the stylesheet.

The source is light only. The theme adds a second scheme under
`@media (prefers-color-scheme: dark)` that redefines the same colour tokens on
dark paper, with the rust and the blue lifted until they read on it, and
`color-scheme: light dark` so a browser paints its own form controls and
scrollbars to match. There is no toggle: the reader's system setting is the
setting.

Both schemes meet WCAG 2.2 AA — 4.5:1 for body text, 3:1 for large text, rules
and focus outlines — and that is a test rather than a claim.
`src/web/theme-colors.test.ts` reads the custom properties out of this
stylesheet and computes the ratios for every pair the design puts on screen, so
a colour changed here that breaks one fails the build.

| Token                     | What it colours                                    |
| ------------------------- | -------------------------------------------------- |
| `--color-body`            | The paper, and the text of an inverted link.       |
| `--color-text`            | The ink.                                           |
| `--color-primary`         | Links, the rule, the focus outline, table headers. |
| `--color-secondary`       | Blockquote text and its border.                    |
| `--color-base`            | A warm sunk surface: rules between entries.        |
| `--color-base-2`          | A cooler sunk surface.                             |
| `--color-base-3`          | The raised surface: the focused skip link, inputs. |
| `--color-code-background` | Behind `code` and a fenced block.                  |
| `--color-code-text`       | Code with no highlighting on it.                   |
| `--color-error`           | A form field that will not do.                     |

### Code highlighting

The CMS renders a fenced block as `<pre tabindex="0"><code
class="language-x">` and highlights nothing: highlighting is a theme's, and it
happens on the client (decision-16). The `tabindex` is the core's doing and is
there on every `<pre>`, because a block wider than the measure scrolls sideways
and a scroll container nothing can focus cannot be read from a keyboard.

This theme highlights with **[highlight.js](https://highlightjs.org/)**,
self-hosted at `static/highlight.js` and pinned — nothing is fetched from a
CDN. The `scripts` block of `layouts/base.njk` loads it, deferred, **only on a
page whose rendered body holds a `language-` class**, so a page with no code on
it ships no JavaScript at all. Auto-detection is off: a block with no language,
or one naming a language the bundle does not carry, is left exactly as the
renderer wrote it — its class, its plain text, no highlighting.

The bundle carries the core and eighteen grammars — `bash`, `css`, `diff`,
`dockerfile`, `go`, `ini`, `javascript`, `json`, `markdown`, `nginx`, `php`,
`python`, `rust`, `shell`, `sql`, `typescript`, `xml` and `yaml`, with their
aliases, so `js`, `ts`, `html`, `yml` and `sh` all work. It is a build product
that is nevertheless committed, so a site gets a working highlighter out of the
package with no build step. Rebuilding it is one command:

```
pnpm --filter @geekity/cms build:highlight
```

Run that after bumping the `highlight.js` devDependency or editing the language
list in `scripts/build-highlight.js`, and commit what it writes.
`src/web/highlight-bundle.test.ts` fails when the committed file was built from
a different version of highlight.js than the one installed.

**The palette is Tomorrow**, the one both of the sites this design comes from
used: Chris Kempson's Tomorrow on light paper and Tomorrow Night on dark, from
highlight.js's own base16 themes, which is also what decides which `hljs-`
scope takes which slot. Five of the light colours are not the stock ones — a
syntax theme is drawn for an editor, where a faint comment is a feature, and on
this paper the stock greys, orange, yellow, green and teal read between 1.7:1
and 3.5:1. Each was darkened along its own hue until it made 4.5:1 and no
further; on the dark scheme only the `base0F` brown needed lifting. Every one
of them is in the contrast test beside the rest of the palette.

| Token                             | base16   | What it colours                            |
| --------------------------------- | -------- | ------------------------------------------ |
| `--color-code-comment`            | `base03` | Comments.                                  |
| `--color-code-tag`                | `base04` | Markup tags.                               |
| `--color-code-name`               | `base08` | Variables, names, selectors, list bullets. |
| `--color-code-literal`            | `base09` | Numbers, constants, attributes, links.     |
| `--color-code-class`              | `base0A` | Class names, bold.                         |
| `--color-code-string`             | `base0B` | Strings and inline code.                   |
| `--color-code-support`            | `base0C` | Built-ins, regexps, quotes.                |
| `--color-code-function`           | `base0D` | Function names, headings, attributes.      |
| `--color-code-keyword`            | `base0E` | Keywords, types, italic.                   |
| `--color-code-meta`               | `base0F` | Preprocessor and embedded-language lines.  |
| `--color-code-added-background`   | —        | An added line in a diff.                   |
| `--color-code-removed-background` | —        | A removed line in a diff.                  |

Delimiters, operators and substitutions are deliberately `--color-code-text`,
the block's own ink: they are most of the characters on screen and a colour
there is noise. A `diff` block reads by the line rather than by the token, the
way the source site's `prism-diff.css` did: `.hljs-addition` and
`.hljs-deletion` take a tint out to the edges of the block and keep the ink, so
the `+` and the `-` in the text carry the meaning as well as the colour does.

**Swapping it.** Four sizes of change, smallest first:

- _Another palette, same highlighter._ Redefine the dozen `--color-code-*`
  tokens. Note that `static/style.css` is an all-or-nothing override: a theme
  that ships its own stylesheet owns these rules too, and a fenced block on it
  is unhighlighted until it writes them.
- _Other languages._ Edit `LANGUAGES` in `scripts/build-highlight.js`, rebuild,
  and commit — or put your own `static/highlight.js` in your theme, which the
  `/theme/` route resolves before the packaged one.
- _Another highlighter._ Override the `scripts` block with your own tag. The
  markup is `pre > code.language-x`, which is what every highlighter reads.
- _None._ Override the `scripts` block with nothing in it.

```njk
{% extends "layouts/base.njk" %}

{% block scripts %}{% endblock %}
```

## Mail templates

The messages the CMS sends live under `mail/` and resolve the same way, so a
`mail/test.txt.njk` in the theme the site wears replaces the text of the test
message and leaves its subject and HTML twin coming from the package. Each message is up to three
files:

| File                      | What it is                                                     |
| ------------------------- | -------------------------------------------------------------- |
| `mail/<name>.subject.njk` | The subject. Rendered to a single line. Optional.              |
| `mail/<name>.txt.njk`     | The plain text body. **Required.**                             |
| `mail/<name>.html.njk`    | The HTML twin. Optional; without it the message is plain text. |

A message that has no `.txt.njk` anywhere on the search path is an error rather
than an empty email, so a typo in a template name is reported instead of sent.

The package ships seven messages:

| Name               | When it goes                                     | What `data` carries                                                                                                                        |
| ------------------ | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `test`             | Send test email, on Settings.                    | Nothing.                                                                                                                                   |
| `password-reset`   | Somebody asked to reset a password.              | `username`, `resetUrl`, `expiresAt`, `expiresInHours`.                                                                                     |
| `password-changed` | A reset link was used.                           | `username`, `signedOut` (how many sessions ended).                                                                                         |
| `comment-pending`  | A comment or webmention is waiting for approval. | `comment`, `post` (`title`, `url`), `actions` (one `{ action, label, url }` each for approve, spam and delete), `queueUrl`.                |
| `comment-digest`   | An hourly or daily digest of what is waiting.    | `items` (one `{ comment, post, actions }` each), `total` waiting, `more` beyond the ones listed, the `mode` that asked for it, `queueUrl`. |
| `comment-reply`    | A reply to somebody's comment was approved.      | `reply`, `comment` (the one it answers), `post`, `unsubscribeUrl`.                                                                         |
| `contact-message`  | Somebody filled in a page's contact form.        | `message` (`id`, `subject`, `text`, `received`), `from` (`name`, `email`), `page` (`slug`, `permalink`, `title`, `url`), `messagesUrl`.    |

The `comment` inside each of a digest's `items` is the same shape as
`comment-pending`'s, and its `actions` are the same three links, minted per
recipient because each is spent the first time it is used. A digest is built
from the queue as it stands when it is sent, so an item moderated in the
meantime is simply not in it, and no digest is sent to somebody with an empty
queue.

`comment` and `reply` above are the same shape: `author`, `website`, `source`
(`comment` or `webmention`), `kind`, `text`, `html`, `submitted`, and `url`.
The commenter's email address is deliberately **not** among them — the message
goes to a moderator, but it also goes through a mail provider's servers, and
nothing on that screen needs it.

The links in `actions` and `unsubscribeUrl` each carry a signed token and work
without a login. Print them; do not try to build one.

`contact-message` is sent with reply-to set to the sender, so answering it in a
mail reader answers the person who wrote it. `message.text` is plain text as it
was typed — print it, do not render it as Markdown or as HTML.

The subject and the plain text body render with autoescaping **off**, because
neither is HTML: `&` between two query parameters stays an `&`, and an
apostrophe in somebody's name stays an apostrophe. The HTML twin escapes as
every other template does.

The context is `site` (that is `content/_data/site.json`), `baseUrl`, and
whatever the feature that sent it passed as `data`. The `date`, `url` and
`absoluteUrl` filters are the same ones a page has, so a message can write a
link with `{{ "/admin/" | absoluteUrl }}`.

Writing `mail/welcome.txt.njk` into the theme is enough to add a message this
package never shipped; nothing has to be registered.

## Template context

The context mirrors what an Eleventy layout receives, so a layout ported from
an Eleventy build needs few edits. It is part of the package's semver contract.

Every template gets:

| Key          | What it holds                                                                                                                                                                                           |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `site`       | `content/_data/site.json`, if the site has one, over the defaults `title` and `url`. Any key in the file is readable, so `site.tagline`, `site.author` and anything else a site adds are all available. |
| `menu`       | The site menu for this page: a list of `{ label, url, current }`. See [Navigation](#navigation).                                                                                                        |
| `siteAuthor` | Who the page is by, as a profile. **Absent** when nobody matches. See [Bylines and author archives](#bylines-and-author-archives).                                                                      |
| `icons`      | The site's icons, as `{ rel, sizes, href }`. Empty until the site has an avatar to derive them from. See [The head](#the-head).                                                                         |

A document — one post, one page, or one entry of a listing — adds:

| Key                                         | What it holds                                                                                                     |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `title`                                     | Display title.                                                                                                    |
| `date`                                      | Publish date, a JavaScript `Date` at the UTC instant the file holds. Absent when the document has none.           |
| `updated`                                   | Last modified date, a `Date`, when the front matter has one.                                                      |
| `tags`                                      | The document's tags, in file order.                                                                               |
| `categories`                                | The document's categories, in file order.                                                                         |
| `content`                                   | The Markdown body rendered to HTML. Print it with `\| safe`.                                                      |
| `summary`                                   | Its `description` as plain text, else an excerpt of the body, else empty. The line the feeds publish.             |
| `url`                                       | The document's URL path, the same value as `page.url`.                                                            |
| `page.url`                                  | The document's URL path. Always ends in `/`.                                                                      |
| `page.date`                                 | The same `Date` as `date`.                                                                                        |
| `page.fileSlug`                             | The permalink's last segment.                                                                                     |
| `page.inputPath`                            | The source file, relative to the content directory.                                                               |
| `type`                                      | `post` or `page`.                                                                                                 |
| `permalink`, `slug`, `draft`, `description` | Straight from the front matter.                                                                                   |
| `author`                                    | Who wrote it, as a profile rather than a string. See [Bylines and author archives](#bylines-and-author-archives). |
| `activityStreams`                           | The post's ActivityPub object id, absolute. Only on a rendered published post.                                    |
| `previous`                                  | The published post before this one by date, as `{ title, url }`. Absent on the oldest post.                       |
| `next`                                      | The published post after it. Absent on the newest post, and on a page.                                            |
| `recentPosts`                               | The newest posts, as entries, on the front page only: this month's when it holds five, else five.                 |
| `webmention`                                | Where a webmention about this page is sent. Only on a rendered document, and only while the site takes them.      |
| `conversation`                              | The replies, likes and boosts under the post. Only when there are any. See [The conversation](#the-conversation). |
| everything else                             | Any front matter key the CMS does not model is on the context under its own name.                                 |

A listing — the home page, a tag archive, a category archive or an author
archive — adds:

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
| `author`                                   | The person, on an author archive only. Same shape as a post's `author`.           |

How many posts a listing page holds comes from `postsPerPage` in
`content/_data/site.json`, and defaults to 10. How many entries a feed holds
comes from `feedSize` in the same file, and defaults to 20. The `<html lang>`
comes from `language`, and defaults to `en`. The rssCloud and WebSub server the
feeds advertise comes from `notifyServer`, and is empty for none; the theme
writes nothing for it, because a cloud is advertised in the feed rather than on
the page.

## Bylines and author archives

`author` on a document is the person the front matter names, resolved against
the site's users. The fields come from their profile on **Users** in the admin,
which is the one place identity is written:

| Key               | What it holds                                                                                                  |
| ----------------- | -------------------------------------------------------------------------------------------------------------- |
| `author.name`     | What to print: their display name, else their username, else the raw name the file gives.                      |
| `author.url`      | Their archive, `/author/{username}/`. **Absent** when the name is nobody this site has.                        |
| `author.username` | Their login. Absent for the same reason `url` is.                                                              |
| `author.bio`      | What they wrote about themselves, when they wrote any.                                                         |
| `author.avatar`   | Their picture, as a path or URL. Absent when they have none.                                                   |
| `author.jobTitle` | What they do, when their profile says.                                                                         |
| `author.location` | Where they are, as they wrote it.                                                                              |
| `author.links`    | `{ label, href }` for each link on their profile, in the order they listed them. Absent when they listed none. |

`author` is absent altogether when the document names no author, so a byline is
`{% if author %}`. Guard the link with `{% if author.url %}`: a file may name
somebody who has no account here — a guest post, or a colleague whose account
has gone — and that name is still printed, it simply links nowhere.
`partials/byline.njk` does both:

```njk
{% import "partials/byline.njk" as byline %}
by {{ byline.line(author) }}
```

`layouts/author.njk` is that person's archive, at `/author/{username}/`, with
their pages at `/author/{username}/page/2/` and their three feeds under
`/author/{username}/feed/`. It is headed with the same `author` object — the
name, the avatar, the bio and the links — and lists their published posts
newest first. A user with no profile still has one; they are called by their
username.

`siteAuthor` is the same object on a different question: not who wrote this
document, but who the page in front of the reader is by. It is what the bio,
the footer's `rel="me"` links and any structured data a theme emits should all
read, so that what a reader sees and what a machine reads cannot drift apart.
It resolves in this order:

- the document's own `author`, on a post or a page that names one;
- the person whose archive it is, on an author archive;
- the profile behind the site's `author` setting, everywhere else — the home
  page, a taxonomy archive, a page that names nobody, the 404.

It is **absent** when none of those name anybody this site has. The site
setting is read more strictly than a byline is: a byline prints the name a file
gives whether or not somebody answers to it, but a site author with no profile
behind it has no picture, no bio and nowhere to link, so there is nothing to
print and the key is not there. Write `{% if siteAuthor %}` around the bio and
the identity links.

The URL is not only a page. Each user is an ActivityPub actor at that address,
so it is the page a follower lands on when they click through from the
fediverse. `author` is therefore a reserved first URL segment, like `tag` and
`feed`: no document can be permalinked under it and no taxonomy base can take
it.

## Navigation

`menu` is the site menu, already in order and already knowing which of its items
is the page being looked at. Every template gets it. The design has no header
navigation, so `layouts/base.njk` renders it in the `footer` block; a layout
that overrides `header` or `footer` renders it the same way:

```njk
{% if menu.length %}
<nav class="site-nav" aria-label="Site">
  <ul class="hlist">
    {% for item in menu %}
    <li><a href="{{ item.url | url }}"{% if item.current %} class="is-current" aria-current="page"{% endif %}>{{ item.label }}</a></li>
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

`layouts/tag.njk`, `layouts/category.njk` and `layouts/author.njk` each call
`feedLinks` over their own root, so an archive advertises its own three feeds
as well as the site's — on an author archive that root is `author.url`.

`layouts/base.njk` fills the `alternates` block with `feedLinks` over `/` and
then the site's comments feed, so every page that extends it advertises all
four. On a published post it adds that post's own comments feed, from
`commentsFeed` on the context, and a link pointing at the post's ActivityPub
object:

```html
<link
  rel="alternate"
  type="application/activity+json"
  href="https://example.com/2026/09/hello/"
/>
```

A post's object id is its permalink, so that link usually points at the page it
is on: it says the URL answers ActivityStreams as well as HTML. A post migrated
from elsewhere keeps the id its file names, and the link points there instead.
It comes from `activityStreams`, which — like `commentsFeed` — is only on the
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
the people behind them inside a `<details>` — and a site replaces it with a
`partials/conversation.njk` of its own in the theme it wears, exactly as it
replaces any other template. It defines three macros, `comment(reply)`,
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

## The contact form

`contactForm` is on the context of a rendered document **only when its front
matter says `contact: true`**, so a layout asks:

```njk
{% if contactForm %}
{% include "partials/contact-form.njk" %}
{% endif %}
```

That is what `layouts/page.njk` does, after the page's content. The key is
honoured wherever it is written, so a theme that wants the form under a post as
well only has to add the same two lines to `layouts/post.njk`; the editor
offers the checkbox on pages.

| Key                                            | What it holds                                                                                                                                    |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `action`                                       | Where the form posts. One fixed path; the page travels as a field.                                                                               |
| `fields`                                       | The name each field is submitted under: `page`, `name`, `email`, `subject`, `message`, `trap`, `loaded`. Use these rather than typing the names. |
| `page`                                         | The page's slug, for the hidden field.                                                                                                           |
| `loaded`                                       | When this form was rendered, in epoch milliseconds, for the hidden field. A submission that comes back too fast is refused.                      |
| `values`                                       | What is in the fields: empty on a fresh form, what was typed on a refused one.                                                                   |
| `problems`                                     | One message per field a person has to put right — `name`, `email`, `subject`, `message`.                                                         |
| `error`                                        | A message about the submission as a whole, when there is one.                                                                                    |
| `nameLength`, `subjectLength`, `messageLength` | The `maxlength` for the three fields that have one.                                                                                              |

`fields.trap` is the same honeypot the comment form carries, and the same rules
apply: render it, hide it, and **do not** remove it from a replacement partial.

One more key travels beside it, from the URL rather than from the page:

| Key             | What it holds                                                                                                                            |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `contactNotice` | The thank-you after a message was sent, from the `?contact=` the redirect carried. The shipped partial shows it **instead of** the form. |

**Where the message goes is never on the context.** The contact address is read
when a submission arrives, so it cannot end up in the HTML however this partial
is rewritten. Do not try to print it, and do not put a `mailto:` beside the
form.

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

`date` reads one word rather than parsing it: `{{ "now" | date("year") }}` is
the year at the moment the page is rendered, in the site's own timezone. It is
what the footer's copyright line is written with, and it is the one date a page
has that no file carries.

Nunjucks' own filters — `default`, `join`, `urlencode`, `safe` and the rest —
are all available. Autoescaping is on, so rendered Markdown is the one thing
that has to be passed through `safe`.
