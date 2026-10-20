# The page shell

`layouts/base.njk` is the page shell. It holds these parts, in this order:

1. The skip link.
2. One `.global-wrapper` at the 42rem measure.
3. `.global-header`.
4. `<main id="main">`.
5. The footer.

The shape follows the andrewshell.org design (decision-16). The look is
Paper's (doc-9).

**One home for each kind of link.**

- The header carries the site menu, on every page.
- [The bio](#the-bio) carries the person whose page or post it is.
- The footer carries the site's own links.
- The search box is on the search page only.

**The header has one rule, and the menu under it.** On the front page, the
header is the site title as `h1.main-heading`, linked home, with
`site.tagline` in a `p.site-tagline` under it. On every other page, the header
is `a.header-link-home`: the site title, small and linked home, with no
tagline. The wrapper carries `data-is-root-path="true"` at `/` and on no other
page. The stylesheet uses this attribute to tell the two apart.
`menus.primary` prints inside `.global-header` on both. At the root, the menu
is on its own line under the tagline. On every other page, the stylesheet lays
out the header as one line, with the menu beside the link home. See
[Navigation](navigation.md).

**The footer** prints these items, in order:

1. The copyright, with the current year and the site author's display name,
   `soloAuthor.name`. On a site with several authors, it prints the site title
   instead.
2. The page's license, when it has one, as `<a rel="license">` with its name.
3. `Published with Geekity`.
4. `menus.footer`, the `footer` area this theme declares. It is the only source
   of links in the footer.

To put the feed in the footer, add an `RSS | /feed/` line to the footer menu.
The starter site does this. The footer reads nothing from an account. It used
to hold one `rel="me"` link per entry of `siteAuthor.links`, which presented
one nominated user's profile as the site's. An empty or missing footer menu
prints no list, and the copyright line appears alone.

The year is `{{ "now" | date("year") }}`. `now` is the only word that the
`date` filter reads as a keyword and does not parse. The result is the year at
the moment the page renders, in the site's timezone.

The license is `license`. On a post, it is the post's own license from its
`license` front matter. Otherwise it is the site's license from Settings >
General. A site with no license prints nothing.

**The breadcrumb** opens `<main>` on a page with a place in the site's
hierarchy (TASK-150): a post filed under a category, and a category, tag or
author archive. It is `nav.breadcrumbs`, labelled `Breadcrumb`, holding an
`ol`. The items are:

1. Home.
2. On a post, the post's first category and then the post. On an archive, the
   archive's term or person.
3. `Page N`, past page one.

Every crumb except the last is a link. The last crumb is the page itself, a
`span` with `aria-current="page"`. The trail is `breadcrumbs`, a list of
`{ name, url }` that `layouts/base.njk` sets before it prints anything. The
JSON-LD prints the same list, so the visible trail and the JSON-LD always
match. Every other page has an empty trail and prints nothing. To hide the
visible breadcrumb, empty the `breadcrumbs` block. The `BreadcrumbList` stays
in the graph.

Webrings, badges and other markup that is not a link are not in the package,
by design. Put them in a site theme's `footer` block:

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

## The admin bar

When a user who is signed in to the admin views the site, the CMS adds the
admin bar across the top of every HTML page. The bar holds:

- The site title, linking to the dashboard.
- **+ New**.
- **Edit Post** or **Edit Page**, on a post or a page.
- The account menu.

A theme draws none of it and needs no template for it. The CMS inserts a
`<geekity-admin-bar>` element directly after the page's `<body>` tag. A page
served to an anonymous visitor is unchanged, byte for byte.

The bar keeps its markup and its stylesheet in a shadow root. A theme's CSS
cannot restyle the bar, and the bar's CSS cannot restyle the theme. The element
has an inline style that resets it and fixes it to the top of the window, full
width, above the page. Padding or margins on `<body>`, rules such as
`body > *`, and a grid on `<body>` do not move or resize it. It stays in place
when the page scrolls.

The bar takes no room by itself, so the CMS makes room for it from outside. On
a page that carries the bar:

- `<html>` has the class `geekity-admin-bar`.
- A stylesheet in `<head>` declares `--geekity-admin-bar-height` on `:root`
  and sets `margin-top: var(--geekity-admin-bar-height) !important` on
  `<html>`. This pushes the whole page down below the bar. The height is 40px,
  or 80px on a screen 600px wide or less, where the bar can wrap onto a second
  line. A script in the bar then measures the bar and sets the real height on
  `<html>`. The push then matches the bar at any width, and is 0 when a theme
  hides the bar.
- The same stylesheet sets `scroll-padding-top` on `<html>` to the bar's
  height. A link to an anchor on the page, such as a skip link or a footnote,
  then scrolls its target to below the bar. The rule has no specificity, so a
  theme that sets its own `scroll-padding-top` keeps it.

A theme with its own sticky or fixed header offsets it by the bar's height. The
fallback of `0` applies on every page without the bar:

```css
.site-header {
  position: sticky;
  top: var(--geekity-admin-bar-height, 0);
}
```

A theme that sets its own `scroll-padding-top` adds the bar's height the same
way, for example `calc(var(--geekity-admin-bar-height, 0px) + 4rem)`. For any
other change, use the `geekity-admin-bar` class, for example
`.geekity-admin-bar .site-header { ... }`.

To hide the bar in a theme:

```css
geekity-admin-bar {
  display: none !important;
}
```

The `!important` is needed to beat the element's inline style. With script on,
the bar then measures 0 and the page moves back up. For a visitor without
script, also remove the margin:

```css
html.geekity-admin-bar {
  margin-top: 0 !important;
}
```

## An entry

`layouts/post.njk` and `layouts/page.njk` both draw the entry, a microformats2
`h-entry`. This is an article. A page has the same shape, with the differences
listed below.

```html
<article class="blog-post h-entry">
  <header class="post-header">
    <p class="kicker">
      <span class="kicker-kind">Article</span>
      <span class="kicker-dot" aria-hidden="true">·</span>
      <a href="/category/notes/" class="p-category" rel="category">notes</a>
    </p>
    <h1 class="p-name">Hello</h1>
    <p class="post-deck p-summary">The description the author wrote.</p>
  </header>
  <section class="e-content">
    <p>The rendered body.</p>
    <p class="entry-meta">
      <a class="u-syndication small" href="https://news.indieweb.org/en"
        >IndieNews</a
      >
      <a href="/2026/09/hello/" class="u-url"
        ><time class="small dt-published" datetime="2026-09-02T09:00:00.000Z"
          >Published 2 September 2026</time
        ></a
      >
      <span aria-hidden="true">·</span>
      <time class="small dt-updated" datetime="2026-09-05T09:00:00.000Z"
        >Updated 5 September 2026</time
      >
      <span aria-hidden="true">·</span>
      <span class="small"
        >Also on
        <a class="u-syndication" href="https://news.indieweb.org/en/…"
          >news.indieweb.org</a
        ></span
      >
    </p>
  </section>
  <p class="post-categories">…tags…</p>
  <hr />
  <footer>…the bio…</footer>
</article>
<nav class="blog-post-nav" aria-label="Neighbouring posts">…</nav>
```

**The kicker names the kind.** `p.kicker`, from `partials/kicker.njk`, opens
every entry. It holds:

- The kind word, in `span.kicker-kind`. For a post, the word is Article, Note
  or Reply, from its `postType`. For a page, it is Page.
- The categories the entry is filed under, as `p-category` links.

The kicker is the only place that states the kind, small and once. An article
is also the only kind with a visible headline. The deck is the front matter's
`description`, as a `p.post-deck.p-summary`. It prints only when the author
wrote a description.

**The Published line is inside the `e-content`.** This is the one unusual
thing about this shape. The source theme does the same. The date and the
permalink are part of the words, so a visitor, or a fediverse peer that reads
the `e-content`, gets them with the post.

- The permalink wraps the `dt-published` time as a `u-url`.
- A `dt-updated` follows it, after a middle dot, only when the update happened
  on a different day in the site's timezone. A typo fixed an hour later does
  not count.
- The line opens with a `u-syndication` link to each syndication target the
  post selects (`syndicateTo`, TASK-155). IndieNews and Bridgy Publish look for
  these links on the page.
- The line ends with the post's copies elsewhere (`syndication`), after
  **Also on**.

A page prints neither kind of syndication link. Its line is a `p.page-meta`,
not a `p.entry-meta`.

**A post first published elsewhere says so.** A post can name its original
with `canonical_href` in its front matter. The value is an absolute http or
https URL, such as a Substack essay's. The context then carries it as
`original` (TASK-293). The line reads **Originally published at** and links
the original as a second `u-url` of the h-entry, after the permalink's.

The link text is the publication's name when the front matter gives one in
`canonical_name`, such as `Smarter Engineers` for a guest post on someone
else's Substack (TASK-316). Otherwise the link text is the original's host. The
link is not a `u-syndication`. The original is not a copy of this post, and
original-post-discovery reads a copy's off-site `u-url` as its original.

The same URL is the page's `rel="canonical"` and its `og:url`, so search
engines credit the original. The CMS ignores a value that is not an absolute
http or https URL, and `geekity sync` names the file. It also ignores a
`canonical_name` with no valid `canonical_href` beside it, and `geekity sync`
names that file too.

**Every post's page has one `h1`.**

- A post with a name of its own is headed by its name, as above.
- A post with a title and no words, such as a titled like, repost or bookmark
  (TASK-256), is headed the same way. Its header comes first and its citation
  after it.
- A title that only repeats a post's opening words does not count as a name.
- A note, or a reply without a title, opens on its words, set larger. It has no
  `header`. In its place is a visually hidden `h1` for screen readers and
  crawlers. The `h1` says what the post is, who wrote it and when. The kicker
  follows it:

```html
<h1 class="screen-reader-text">Note by Ada Lovelace, 11 September 2026</h1>
<p class="kicker"><span class="kicker-kind">Note</span></p>
```

The hidden `h1` says `Reply`, `Like`, `Repost` or `Bookmark` for those kinds.
It leaves out a name or a date that the post does not have. It is not a
`p-name`, because a parser that found one would take the post for an article.
The headings under it step down one level at a time. The conversation and the
comment form are `h2`. A refused form's error summary is an `h3` inside the
form's section.

**A reply cites what it answers** with `partials/reply-context.njk`, a
`div.reply-context.cite.u-in-reply-to.h-cite`. The citation holds:

- A rule on the start side.
- A `p.cite-line` that says "In reply to" and gives the target's name, author
  and date, as far as they are known.
- The target's excerpt, as a `blockquote.cite-quote.p-content`.

The placement depends on whether the post shows a title:

- An untitled reply opens on the citation, under the kicker and before its
  words.
- A titled reply prints its `header.post-header` first and the citation after
  it, before the `e-content`. The page then opens on its title, not on a link.

A listing follows the same rule. An untitled entry cites under its kicker. A
titled entry cites after its title and summary. The same partial cites a reply
in a feed. The layouts own the placement. The partial owns only what the
citation says. The citation stays inside the `h-entry` wherever it prints.

**A reply to a silo copy cites the original** (TASK-197). This applies when the
post a reply answers is a copy of a post on another site, and that original
post lists the copy as its `u-syndication`. Then `replyContext.original` is the
original's URL, and the rest of `replyContext` describes the original. The
`h-cite` links the original. A `p.cite-copy` after it says "Also in reply to
its copy on" and the silo's host. It links the copy as a `u-in-reply-to` of its
own, so a parser reads both as what the post answers.

**An RSVP says whether its author is going** (TASK-198). An RSVP is a reply to
an event whose `rsvp` is `yes`, `no`, `maybe` or `interested`.

- `partials/rsvp.njk` opens the RSVP's `e-content` with a `p.rsvp-line`. The
  line holds a `data.p-rsvp`. Its value is the answer, and its text is Going,
  Not going, Maybe or Interested. The partial prints `rsvp.line`, the HTML the
  feeds also carry.
- The reply context says "RSVP to", not "In reply to".
- When the event's page is an `h-event`, or describes a schema.org `Event` in
  JSON-LD, the event's start follows its name as a `time.dt-start`, and its
  place follows as a `span.p-location`, inside the `h-cite`.
- A start that the event page wrote with no zone is a wall-clock time where the
  event happens. The CMS prints it in UTC (`replyContext.startZone`) and does
  not move it into the site's zone.
- The RSVP's kicker and hidden `h1` say RSVP.
- An RSVP to a silo copy of an event cites the original, as a reply does.

**An event is an h-event** (TASK-200, decision-32). A post whose front matter
has a readable `start` is an event. Its title is the event's name, and its body
is the description. `end` and `location` are optional.

- `layouts/post.njk` gives its article the class `h-event` instead of
  `h-entry`.
- Its kicker and hidden `h1` say Event.
- `partials/event.njk` follows the title with a `dl.event-details`.
- The When row is a `time.dt-start` and, when there is an end, a `time.dt-end`.
  Each is written with the `date` filter's `datetime` format in the site's
  zone, with the instant as its `datetime`.
- The Where row is a `span.p-location` that holds the place's words. For an
  online event, it is "Online at" and an `a.p-location` that links the address
  to join.

The JSON-LD describes the post as a schema.org `Event` instead of a
`BlogPosting`. The `Event`'s location is a `Place` or a `VirtualLocation`. The
`Event` carries an attendance mode and an `EventScheduled` status, and names
the author's Person as its `organizer`. The RSVPs an event receives are grouped
in `conversation.rsvps`. See [The conversation](conversation.md).

**A like, a repost or a bookmark cites its target** (TASK-169) with
`partials/citations.njk`. The partial sits beside the reply context and uses
the same style. It prints one `div.reply-context.cite.h-cite` per entry of
`citations`, classed `u-repost-of`, `u-like-of` or `u-bookmark-of`. Its
`p.cite-line` says Reposted, Liked or Bookmarked and links the target as its
`u-url`.

The link text is the target's name, as in the reply context. The target's
author follows it as a `p-author h-card`. Both come from reading the target
when the post was saved (TASK-244). The name is the target's `h-entry` name,
its oEmbed title, or its `og:title` or `<title>`.

- For a YouTube, TikTok, Reddit or Giphy target, the CMS asks that provider's
  known oEmbed endpoint first. It reads the target's page only when the
  endpoint names nothing (TASK-251, TASK-253).
- Any other target's oEmbed title comes from the endpoint that its page links.
- A title that is only a site suffix, such as "- YouTube", does not count as a
  title.

When the target has no name, the link text is one of these:

- "a comment", for a comment on this site (`replyContext.comment`, TASK-326).
- "a post", for a target with only an author.
- "a page on" and the target's host, for a target with neither, for example
  "Bookmarked a page on example.com" (TASK-255). The link text is never the
  bare URL, which can be hundreds of characters long.

The kicker and the hidden `h1` say Repost, Like or Bookmark. The citation is
placed as the reply context is: at the top of an untitled post, and after the
header of a titled one. A listing cites each entry's target from the same
partial, by the same rule.

**Both citations name the cited page** through `partials/cited-page.njk`, so
they print its name and author by one rule.

- A name that already ends in " by " and the author's name, in any case, does
  not print the author again (TASK-247). For example, SoundCloud titles a track
  "Flickermood by Forss" and names Forss as its author. The title link stops
  before " by ", and the words after it become the `p-author h-card`. The line
  reads "Liked Flickermood by Forss", and a parser still reads the whole title
  as the `p-name`.
- A name that mentions its author anywhere else keeps the author after it. For
  example, "Rick Astley - Never Gonna Give You Up" by Rick Astley keeps the
  author.
- A page that names no author but names its site in `og:site_name` gets a
  middle dot and the site as a plain `span.cite-site`. The site is never an
  `h-card`, because a site is not an author. A bookmark of a Scripting News
  post reads "Bookmarked RSS tip #2 · Scripting News".

The citation of a like, a repost or a bookmark never prints the page's
description. On many sites, the description describes the site, not the post.

**A citation shows who wrote the cited page** (TASK-199), with as much detail
as the page gives.

- The author's photo is an `img.u-photo.cite-avatar` before the name, inside
  the `h-card`. Its alt text is empty, because the name is beside it.
- A fediverse author's handle follows the name as a
  `span.p-nickname.cite-handle` that reads `@user@host`.

The photo is one of these:

- The `u-photo` of the `h-entry` author's `h-card`, or of the page's `h-card`
  for the same person.
- The avatar of the account that an ActivityPub object is attributed to.
- The author image in the page's JSON-LD.

The CMS copies the photo into the site's uploads, as it does a picture. It
leaves the photo out when the post has removed its preview.

For a Mastodon status, the CMS reads the ActivityPub object that the status
page links. The author's display name, handle, avatar, words, first image and
date come from the status itself, not from the page's `og:title`. For a page
with no `h-entry` and no object, the CMS reads its JSON-LD (`headline`,
`author`, `datePublished`, `image`), then its Open Graph, Twitter and
`article:` tags.

**A citation shows the cited page's picture** (TASK-252) when the page named
one and the post has not removed its preview. The picture is the first of
these that the page has:

1. Its oEmbed photo.
2. Its oEmbed thumbnail.
3. Its `og:image`.
4. Its `twitter:image`.

The CMS copies the picture into the site's uploads when the post is saved. A
visitor's browser never requests anything from the cited site or its CDN. The
picture is `context.picture`:
`{ src, width, height, kind, video, shownInFull, imgHtml }`. `imgHtml` is an
`img.u-photo` inside the `h-cite`, and is responsive when the copy has
variants.

- A repost of a photo (`shownInFull`, such as a Giphy GIF) prints the picture
  in full under the line. It is an `a.cite-photo` that links to the target,
  with the target's name as its alt text.
- Every other citation with a picture (a like, a bookmark, a reply, a repost of
  a video or a page) has the class `cite-with-thumb`. It prints the picture as
  an `a.cite-thumb` beside the line. This is a 6rem thumbnail that links to the
  target, with empty alt text. It is out of the tab order and hidden from
  assistive technology, because the title beside it is the same link.
- A video's thumbnail also has the class `cite-video`. The stylesheet draws a
  play mark on it.

A citation prints no picture when the picture could not be copied, was bigger
than the site's upload limit, or was never named. A post whose front matter
says `preview: false` prints the plain citation. So do its listing entry and
its feed items. The editor's remove control writes `preview: false`. A
citation never includes an iframe or a script from the cited page.

**A cited URL that is itself an image** (TASK-255) answers with an `image/*`
type instead of a page. The CMS copies it as its own picture, of kind `photo`,
with no name. `context.image` is then true, and the line's link says "an image
from" and its host: "Reposted an image from edu.casio.com".

- A repost shows the image in full, like a reposted GIF.
- A like or a bookmark shows it as a thumbnail beside "Liked an image from
  edu.casio.com".
- A post that hid its preview still says it reposted an image.

The image's alt text is the post's `cited-alt`, which the editor's card writes.
The fallbacks are the post's title, then empty. An image that could not be
copied, or was bigger than the site's upload limit, keeps no context. Its
citation says "a page on" and its host.

The feeds open the HTML of each post that cites something with the same
citation, as a `p.cite-line`. The picture follows it, with an absolute `src`.

The tags print under the words and inside the article, as one
`p.post-categories` from `partials/tags.njk`. Each link is then a `p-category`
of this entry. The stylesheet draws the `#` in front of each tag, so the
category a parser reads is the tag without the hash.

**A post with a recording plays it** (TASK-213), from
`partials/recording.njk`, between the header and the `e-content`.

- The main file plays in the browser's own player: `<audio controls>` or
  `<video controls>`, as `enclosure.player` says.
- The player has `preload="metadata"`, so a visitor who never presses play
  downloads nothing.
- A download link inside the player serves a browser that plays neither.
- The `<source>` carries `u-audio` or `u-video`, so a microformats parser finds
  the file on the entry.
- A video whose transcript is WebVTT also gets the transcript as a
  `<track kind="captions">`.
- Under the player, a `figcaption` links the transcript, as Captions for VTT or
  SRT and as Transcript otherwise. It lists the other versions by their title,
  else by their media type.

A post without a recording, or whose front matter lacks what a player needs,
prints none of it.

```html
<figure class="post-recording">
  <audio controls preload="metadata" aria-label="Recording of Episode twelve">
    <source
      class="u-audio"
      src="/uploads/2026/10/episode-12.mp3"
      type="audio/mpeg"
    />
    <a href="/uploads/2026/10/episode-12.mp3">Download the recording</a>
  </audio>
  <figcaption class="post-recording-links">
    <p><a href="/uploads/2026/10/episode-12.vtt">Captions</a></p>
    <p id="post-recording-versions">Other versions</p>
    <ul aria-labelledby="post-recording-versions">
      <li>
        <a href="/uploads/2026/10/episode-12.mp4" type="video/mp4">Video</a>
      </li>
    </ul>
  </figcaption>
</figure>
```

**A post with photos shows them** (TASK-166), from `partials/photos.njk`, after
the recording and before the `e-content`. Each photo is in a
`figure.post-photo`, and is the context's `photo.html`. That is an
`<img class="u-photo">` with its alt text, so a microformats parser finds every
photo on the entry. When the upload has resizes, the `<img>` sits in a
`<picture>` that offers them.

- The alt text is the post's own, else the media library's.
- A listing prints the photos the same way, above each entry.
- The JSON-LD `BlogPosting` lists each photo as an `ImageObject`, with its
  absolute `url` and its alt text as `caption`.
- The first photo is the post's share image when its front matter names no
  `image`.

After the entry, a post prints:

1. Its backlinks.
2. `nav.blog-post-nav`, with the `previous` and `next` posts as two cards,
   `rel="prev"` and `rel="next"`. Each card opens on a
   `span.blog-post-nav-label`. A missing neighbour has no card, and a post with
   neither neighbour prints no nav.
3. The conversation and the comment form.

A page prints its backlinks too. Then it prints the conversation and the
comment form when it takes comments, and the contact form when its front
matter asks for one. A page has no neighbours, no tags and no syndication
links. A page with no title prints no `h1`, and its header holds only the
kicker (see [Titles](../content.md#titles)).

## Backlinks

A link from one of the site's posts or pages to another sends no webmention.
The CMS records the link instead. The linked document's context carries
`backlinks`: the listed posts and pages whose body links to it, newest first,
each as `{ title, url, date }`.

- `title` is the linking document's title, or a note's first words.
- `date` is absent for a page that has no date.

A link counts in each of these forms:

- Absolute or relative.
- With or without its trailing slash, a query or a fragment.
- Through a `redirect_from` of the target.
- A link to `/` counts for the page that the Reading setting makes the
  homepage.
- A link to a URL that the site answers with a redirect counts for the document
  the redirect leads to. The redirect can be a `redirect_from` or an entry in
  `_data/redirects.json` or `_data/redirects/*.json`, `/?p=123` included.

A link with a query names a query redirect only when the query matches the
redirect's source exactly, as a request does. So `/?p=123&ref=feed` is a link
to `/`. A document that links to itself is not its own backlink. Drafts and
future-dated, unlisted, private and trashed documents never appear.
`backlinks` is always a list. It is empty when nothing links to the document.

`partials/backlinks.njk` prints a `section.backlinks` under the entry,
separate from the conversation. It holds an `h2` that says "Linked from", then
an `ol` of links, each with its date in a `<time>`. It prints nothing for an
empty list, so `layouts/post.njk` and `layouts/page.njk` include it with no
condition. The front page also has `backlinks` on its context, but
`layouts/front-page.njk` does not print them, because most of a site links
home. To show them on the front page, add the same include to the site theme's
own `layouts/front-page.njk`:

```njk
{% include "partials/backlinks.njk" %}
```

To move the list, include the partial somewhere else in the site theme's
layout. To leave it out, override a layout without the include. To change the
markup, add a `partials/backlinks.njk` to the site theme. That file replaces
this one, as with any other template.

## The bio

`partials/bio.njk` prints who the page is by. It is the `p-author h-card` in
the rule and the footer at the end of an entry, and the heading of an author
archive. It replaces `partials/byline.njk`, which is removed. A byline was a
name in a meta line. The bio is the full credit.

```njk
{% set bioAuthor = author or siteAuthor %}
{% include "partials/bio.njk" %}
```

`bioAuthor` is the only variable to set. Nothing renders when it is absent. It
is one of the profile objects the context already carries:

- On a post, `author`, falling back to `siteAuthor`.
- On a page, `siteAuthor`.
- On an author archive, the archive's person.

The bio prints:

- A round `u-photo` at 50px, when the person has an avatar.
- "Written by" and the person's name as a `p-name u-url`, linked
  `rel="author me"` to their archive.
- `p-job-title` and `p-locality`, when the profile has them.
- Their `p-note`.
- Their `rel="me"` links, as a `ul.hlist.bio-links`. Each link's `rel` is
  ready to print: `me` first, then any other values typed in the Links box.

Each item prints only when the profile has it, so a profile that holds only a
name prints only the name. A name with no account on this site prints
unlinked, because the file still names a writer.

Set `bioRelMe` to `false` to keep the card and drop its claims. The name is
then linked `rel="author"` alone, and `me` comes off every link.

**The homepage** speaks for the site's author only when the Site author setting
names a user. `soloAuthor` on the context reports this. On such a site:

- `layouts/base.njk` puts that person's `rel="me"` claims in the head of `/` as
  `<link rel="me">` elements. There is one for their author archive and one for
  each profile link. This happens whichever layout draws the page
  (decision-45).
- The link home on their author archive carries `rel="me"` back, so the
  homepage and the archive name each other.
- `layouts/home.njk` at `/` ends with that person's card, with the same claims.
  It sets `bioHome` to the homepage's absolute URL. This puts a
  `data.u-url.u-uid` that holds the URL first in the card. A parser that runs
  the
  [representative h-card algorithm](https://microformats.org/wiki/representative-h-card-parsing)
  on the homepage then finds this card as the site's (TASK-193). The archive
  stays a second `u-url`.

No other page sets `bioHome`. A static front page prints no card. See
[The front page](#the-front-page) for how a site adds one back. On a site with
several authors, neither kind of homepage prints a card or makes a claim.

**The person and only the person.** The bio says nothing about the site. It
used to print the site menu, because the design had no header navigation. The
menu is now in the header on every page, as [Navigation](navigation.md)
describes.

The note and the links used to sit behind a `bioProfile` switch. An author
archive set it and an entry did not, because the page footer was meant to
carry the site's identity links. The footer now carries no one's identity
links, so the switch is removed. The card is the same wherever it appears: at
the top of an author's archive, and under each of their posts.

`bioLead` is the text the line opens with. It is `Written by` unless a layout
sets another value. `layouts/author.njk` sets `Posts by`, because on an author
archive the card heads the author's writing and does not credit one piece of
it.

**A site that used `partials/byline.njk`** by calling
`{{ byline.line(author) }}` from an overridden layout can include this partial
instead, or write the line itself. The byline was four lines of markup, and the
object behind it has not changed:

```njk
{% set writer = author or { name: site.title } %}
<span class="p-author h-card">
  {%- if writer.url %}<a class="u-url" href="{{ writer.url | url }}">{{ writer.name }}</a>
  {%- else %}{{ writer.name }}{% endif %}
</span>
```

`apps/demo/themes/demo/layouts/post.njk` is a worked example. The demo prints
a byline under the title instead of a bio in the footer, so it writes its own.

## A listing

`partials/post-list.njk` draws every listing:

- The home page.
- The posts page.
- A tag, category or author archive.
- A front page that lists `newestPosts`.

It is a microformats2 `h-feed` of `h-entry` items, each opening on its kicker:

```html
<div class="feed h-feed">
  <article class="feed-item h-entry">
    <p class="kicker">
      <span class="kicker-kind">Article</span>
      <span class="kicker-dot" aria-hidden="true">·</span>
      <time class="feed-date dt-published" datetime="…">2 September 2026</time>
      <span class="kicker-dot" aria-hidden="true">·</span>
      <a href="/category/notes/" class="p-category" rel="category">notes</a>
    </p>
    <h2 class="feed-title p-name">
      <a href="/2026/09/hello/" class="u-url">Hello</a>
    </h2>
    <div class="feed-excerpt p-summary">
      <p>What the post is about, in about 280 characters...</p>
    </div>
    <p class="feed-more">
      <a href="/2026/09/hello/" aria-label="Continue reading: Hello">
        Continue reading<span aria-hidden="true"> &rarr;</span>
      </a>
    </p>
  </article>
  <hr class="feed-separator" />
  <article class="feed-item h-entry">
    <p class="kicker">
      <span class="kicker-kind">Note</span>
      <span class="kicker-dot" aria-hidden="true">·</span>
      <a href="/2026/09/coffee/" class="u-url"
        ><time class="feed-date dt-published" datetime="…"
          >3 September 2026</time
        ></a
      >
    </p>
    <div class="feed-excerpt e-content"><p>The whole note.</p></div>
  </article>
</div>
```

**Only an article has a headline.**

- A note has no title. It prints whole as its `e-content`, and the date in its
  kicker is its `u-url`.
- A reply is a note that first cites what it answers, with
  `partials/reply-context.njk`.
- A reply with a title is an article that cites its target after its title and
  summary.
- A like, a repost and a bookmark place `partials/citations.njk` the same way.
  One with a title and no words is also listed by its title.

An article's categories are in its kicker. A note's categories are on its own
page.

The excerpt is the entry's `summary`, the same line the feeds publish, so the
listing and the feed always show the same text. The excerpt passes through
Nunjucks' `truncate(280)`, which cuts at the last space before 280 characters
and adds an ellipsis. A `description` shorter than that prints whole. The
excerpt is plain text, not markup, by design. Markup cut at 280 characters
could hold half a code block.

Each entry of a listing carries `replyContext` beside `inReplyTo` when it is a
reply whose target has been fetched. It is the same object that a reply's own
page gets, so the listing can cite the target in full.

A listing item has no tags. Tags print under the entry on its own page, where
there is one post's worth of them, not twenty.

**The heading level belongs to the layout**, not to the list. `feedHeading` is
the level at which `post-list.njk` prints its titles. It defaults to 2, the
level a listing needs. A page whose feed sits under a heading of its own sets 3
before the include, so the outline never skips a level:

```njk
{% set feedHeading = 3 %}
{% include "partials/post-list.njk" %}
```

A listing with no posts prints `No posts found.` in `p.empty`.

`partials/pagination.njk` prints two links in `nav.pagination`: `← Previous`
to the page before this one and `Next →` to the page after it, with
`rel="prev"` and `rel="next"`. A listing of one page prints nothing. The arrows
are `aria-hidden`, so a screen reader reads only the word.

Each listing layout heads its own page:

- `layouts/home.njk` heads it with the listing's title.
- The three archives head it with a `header.archive-header`. Its kicker says
  the kind of archive (Tag, Category, Author). Under the kicker, an
  `h1.page-title` names the term, or the person followed by their `h-card`.

The category archive's header is also a `header.category-header`. It prints a
`div.category-description` under the name when the context carries a
`categoryDescription`. The CMS has no store of term descriptions, so nothing
sets one today, and the header is only the heading.

`layouts/404.njk` says `Content not found.` under a `Not found` kicker and
links home and to the search. The 500 and 503 pages below also open on a
kicker.

`layouts/410.njk` is the page at the URL of a post or page that was moved to
the trash (TASK-195). It says `This content has been deleted.` under a
`Deleted` kicker and links home and to the search. The context is the 404's:
`title`, `url` and `page.url`, and nothing from the deleted document. Its `.md`
and `.json` representations also answer 410. A trashed draft was never public,
so its URL answers 404 instead.

`layouts/500.njk` is the page a request gets when the server fails while it
answers the request (TASK-129). It says `Something went wrong.` in an
`article.server-error` and links home. The context is the 404's: `title`,
`url` and `page.url`. The response is a 500 with `Cache-Control: no-store`.
The error goes to the server's log, never into the page. If this template also
fails, the CMS answers with its own plain HTML page, so a theme cannot turn one
failure into a crash. A request for the `.md` or `.json` representation gets a
500 in that format and never reaches this template.

`layouts/503.njk` is the page a request gets while the site is in maintenance
mode (TASK-130). It says `Down for maintenance.` in an `article.maintenance`.
The context is the 404's. When the operator set a time for the site to be back,
the context also has `until` (an ISO 8601 time) and `untilText` (the same time
as an HTTP date). The response is a 503 with `Retry-After` and
`Cache-Control: no-store`. The server still serves the theme's files under
`/theme/`, so the page can use the stylesheet. If this template fails, the CMS
answers with its own plain HTML page.

## Search

`layouts/search.njk` is the page at `/search/` (TASK-22). It prints
`partials/search-form.njk`. When there is a `query`, it also prints:

- A `p.search-summary` with the number of documents that matched.
- A `div.search-results` of `article.search-result` entries.
- The standard pager.

Its `head` block has `<meta name="robots" content="noindex">`, so search
engines do not index it.

The context is a listing's, with two differences:

- `query` is the search words, trimmed. It is an empty string on the page
  before a search.
- Each entry in `posts` carries a `snippet`: a few words of HTML around the
  match, escaped, with every matched word in `<mark>`. Print it with `safe`.

The results are best match first, not newest first. They only ever include
what the public site serves.

`partials/search-form.njk` is a `GET` form to `/search/` with the words in `q`.
It needs no JavaScript, and every search has a URL. This layout is the only
template that includes it. The box used to be in the footer of every page.
Search is now a menu item, a `Search | /search/` line like any other. The
search page takes the path `/search/` ahead of any document permalinked there.

## The front page

`layouts/front-page.njk` draws `/` once the Reading settings name a homepage
(`homepage` in `content/_data/site.json`). It draws that page at a second URL.
The document and the context are the same, and `page.url` is `/` instead of
the permalink that redirects there.

It draws the page's own title and words, and nothing else (decision-44):

1. `h2.section-title`, the page's title. It is an `h2` because
   `layouts/base.njk` heads the root path with the site title as the `h1`. A
   page with no title prints no `h2`.
2. `div.page-body.e-content`, the rendered body. There is no Published line,
   because the front page stands for the site, not for a dated piece of
   writing.
3. The contact form, when the page's front matter says `contact: true`.

It lists no posts, prints no line of links and prints no bio. To add any of
them to the front page, override `layouts/front-page.njk` in the site theme.
Two context keys exist only on the front page, for that override:

- `newestPosts(count)` is a function. It returns the newest `count` published
  posts as entries, in the same shape as a listing's `posts`, so
  `partials/post-list.njk` prints them. It leaves out drafts and future-dated,
  unlisted and trashed posts. The theme chooses the count. The query runs only
  when a template calls the function, so a front page that lists nothing costs
  nothing. A count that is not a whole number of at least 1 is an error.
- `postsPage` is `{ title, url }` for the page that carries the listing. It is
  **absent** when the site names none, because a listing with no URL cannot be
  linked.

`newestPosts` replaces `recentPosts`. `recentPosts` held this month's posts
when there were at least five, and the five newest otherwise. In an override
that read `recentPosts`, call `newestPosts(5)` instead. This override draws the
page's words, the five newest posts, a line of links, and the site author's
card as the site's representative h-card:

```njk
{% extends "layouts/base.njk" %}

{% block content %}
<div class="page-body e-content">
  {{ content | safe }}
</div>

<h2 class="section-title">Recent Posts</h2>
{% set posts = newestPosts(5) %}
{% set feedHeading = 3 %}
{% include "partials/post-list.njk" %}

<p class="front-links">
  {% if postsPage %}
  <a href="{{ postsPage.url | url }}">{{ postsPage.title }}<span aria-hidden="true"> &rarr;</span></a>
  {% endif %}
  <a href="{{ "/search/" | url }}">Search<span aria-hidden="true"> &rarr;</span></a>
</p>

{% if soloAuthor %}
{% set bioAuthor = soloAuthor %}
{% set bioHome = "/" | absoluteUrl %}
<hr>
<footer>
  {% include "partials/bio.njk" %}
</footer>
{% endif %}
{% endblock %}
```

The stylesheet still styles `h2.section-title` and `p.front-links`, so an
override can use both. The solo author's `rel="me"` claims stay in the head of
`/` whatever the override prints (decision-45).

## An archive page

A page whose front matter says `archive: true` prints every published post
under its own words, newest month first:

```html
<section class="archive">
  <h2>September 2026</h2>
  <ol class="list-none">
    <li>
      <a href="/2026/09/hello/"><span>Hello</span></a>
    </li>
  </ol>
  <h2>August 2026</h2>
  …
</section>
```

`partials/archive.njk` draws the list, and `layouts/page.njk` includes it. The
whole archive is on one page, and nothing paginates it. An archive page is for
finding one piece of writing, not a listing to read through, so it also has no
excerpts. Drafts and posts whose date has not arrived are absent, as they are
everywhere else.

`archiveMonths` is the list the partial loops over. It is on the context
**only** for a page whose front matter says `archive: true`, so a layout checks
for it:

```njk
{% if archiveMonths %}
{% include "partials/archive.njk" %}
{% endif %}
```

Each entry is `{ month, posts }`. `month` is the heading, such as
`September 2026`. `posts` is `{ title, url, date }` for each post in that
month, newest first. The CMS decides which month a post belongs to, not the
template. A date in a file is a UTC instant, and the CMS reads it in the site's
`timezone`. The month grouping and the date printed under an entry come from
the same decision, so they always agree.

The CMS honours the key on any page, as it does `contact: true`. To show the
list on another kind of page, add the same three lines to that layout.

## The head

Besides the title, the canonical link and the feeds, every page carries a
description, Open Graph and Twitter card tags, the site's icons and one JSON-LD
graph. All of it is in the `head` block. An override that only adds a tag calls
`{{ super() }}` first.

**The title** is the page's title and the site title, as `Hello · Site`. A
post with no title uses its `label` in place of a title. A page with no title,
and the front page, use the site title alone.

**The description** is the page's own `description` from the front matter,
else the entry's `summary` (the line the feeds publish), else `site.tagline`.
It prints once, as `<meta name="description">`. The Open Graph and Twitter
descriptions use the same text.

**The colours** come from the theme's `theme.json` (see
[The manifest](manifest.md)), on the context as `theme`.
`<meta name="color-scheme">` comes before the stylesheet, so a visitor in dark
mode gets a dark canvas, not a white flash, while the stylesheet loads.
`<meta name="theme-color">` prints twice: once with
`media="(prefers-color-scheme: light)"` and once for dark.

**The card.**

- `og:title` is the page's title, or a post's `label` when it has no title. It
  is the site's title on the front page and on a page with no title.
- `og:site_name` is always the site's.
- `og:type` is `article` on a rendered post or page, and `website` everywhere
  else, including a listing that carries a page's front matter.
- `og:url` is the canonical URL: the page's own, or the `original` that a post
  first published elsewhere names.
- An article also carries `article:published_time`, `article:modified_time`
  (the `updated` date, else the publish date), `article:author` (the author's
  profile URL on this site, else their name) and one `article:tag` per tag.

**The picture** is the first of these that the page has, on the context as
`shareImage`:

1. The `image` in the entry's front matter.
2. `site.avatar`, which only a hand edit of `site.json` sets.
3. The profile photo of the person the page is by. That is the writer of a post
   or page that names an author, or the user of an author archive. On a
   solo-author site, it is also the site's author on the homepage and on other
   pages that are not about one person.
4. The site icon, from `icon` in `site.json`.

A page with none of these prints no `og:image` and no `twitter:image`, not
empty ones. The picture always carries `og:image:alt` and `twitter:image:alt`.
The alt text is what the media library says about the upload, else words for
what the picture shows:

- For the entry's own picture, its `imageAlt` front matter comes first, and the
  entry's title is the last fallback.
- For the avatar, the last fallback is the site's author.
- For a profile photo, it is that person's display name.
- For the icon, it is the site's title.

`og:image:width` and `og:image:height` print when the image's variants have
been derived, because the CMS reads the size from their sidecar, not from the
file. `twitter:card` is `summary_large_image` for a picture at least 1200
pixels wide and wider than it is tall. Every other picture, a square photo
included, gets `summary`, the small picture beside the words.

**The icons** come from the site's `icon` setting in `site.json`, else
`site.avatar`, through the derived images (decision-10). `icon` exists for a
site whose avatar is a face and whose mark is a logo. The head links `icon` at
32 and 16 pixels and `apple-touch-icon` at 180. Each is a square PNG cropped
from the middle of the picture and encoded the first time a browser requests
it. An SVG icon is linked first as itself, with `type="image/svg+xml"` and no
`sizes`, and the PNGs are rasterised from it. The icons are on the context as
`icons`, a list of `{ rel, sizes, type, href }`. The list is empty, and no
links print, in each of these cases:

- The site has neither setting.
- The setting names a file that no icon can be made from.
- Image optimization is off.

**The favicon and the manifest** are routes, not templates.

- `/favicon.ico` holds 16, 32 and 48 pixel frames drawn from the same picture.
  Browsers and crawlers request it from the root whatever the head links. It
  answers 404 on a site with no icon.
- `/manifest.webmanifest` gives the site's title as `name` and `short_name`,
  `start_url` `/`, and `display` `minimal-ui`. It gives the theme's light
  `themeColor` as `theme_color` and `background_color`. Its icons are at 192
  and 512 pixels, plus a maskable 512 whose picture sits inside the middle 80%,
  padded with its own dominant colour. The head links the manifest on every
  page.

**The search description** is a route too. `/opensearch.xml` is an OpenSearch
1.1 description. It:

- Names the site by its title, cut to the 16 characters that `ShortName`
  allows.
- Describes the site by its tagline, else its title.
- Shows `/favicon.ico` as its `Image` when the site has an icon.
- Searches `/search/?q={searchTerms}`.

Every URL in it is absolute and carries the base path. The head links it on
every page with
`<link rel="search" type="application/opensearchdescription+xml">`, outside the
`head` block, so a browser offers the site as a search engine. A theme that
replaces `base.njk` copies that line to keep the offer.

**The embed card** is a route too. `/_geekity/oembed?url=…` is an oEmbed
provider. For the URL of a published post or page, it answers a `rich` embed
with:

- The title, the author and their archive.
- The site as provider.
- A thumbnail, when the post's own `image` has a recorded size.
- An `html` card. The card is a blockquote of escaped text and links with no
  script, followed by a hidden, sandboxed `<iframe>` of
  `/_geekity/embed?url=…`.

`/_geekity/embed` is the same card as a page of its own. It is the only
response another site may frame. WordPress keeps a card from an unknown
provider only when the card has an iframe. It shows the frame once the page
inside reports its height. A consumer that strips iframes still has the
blockquote. The provider honours `maxwidth` and `maxheight`. `format=xml` gives
the same fields as XML. Any other URL answers 404. The head of each post and
page links the provider with
`<link rel="alternate" type="application/json+oembed">` and its
`text/xml+oembed` twin, outside the `head` block. A theme that replaces
`base.njk` copies those lines to keep the card.

**The structured data** is `partials/jsonld.njk`: one
`<script type="application/ld+json">` that holds one `@graph` per page. It is
the only structured data the theme emits. There is no Microdata (decision-16),
because the visible markup already carries microformats2 for the IndieWeb. The
graph holds:

- `WebSite`, always, with the site's title, tagline and URL. Its
  `potentialAction` is a `SearchAction` on `/search/?q={search_term_string}`.
  On a site whose author is a user, its `publisher` and `about` both point at
  that user's Person, on every page. On a site with several authors, its
  `publisher` is the Organization below, and it has no `about`. With a site
  license, `license` is the license URL.
- `Organization`, on a site with several authors only. It is the site itself,
  named for its title, at `{baseUrl}/#organization`. It publishes the `WebSite`
  and every entry.
- `Person`, from `siteAuthor`. It has their name, archive URL, avatar, bio, job
  title and location, and a `sameAs` of their profile links and their actor id.
  The `sameAs` asserts that the schema.org Person and the fediverse actor are
  one identity. Identity comes from a user profile. A site or a byline that
  names no one with an account here prints no Person, and the `author`
  reference goes with it. A site with several authors prints no Person on a
  page that is not about one person.
- `ProfilePage` on an author archive. Its `mainEntity` is that Person.
- `BlogPosting` on a post and `Article` on a page. Each has the headline, URL,
  `mainEntityOfPage`, `datePublished`, `dateModified`, description, image,
  `author`, and the site's `publisher`: the site author's Person, or the
  Organization.
  - A post with no title uses its `label` as the headline. The `label` is the
    words its `<title>` uses, cut on a word boundary to at most 110 characters.
  - A post with no words either is labelled by what it is (TASK-261): "Liked",
    "Reposted", "Bookmarked" or "Reply to" and the cited page's stored title,
    else the host that its citation line names ("Liked a page on
    www.youtube.com").
  - A photo post is labelled by its first photo's alt text, cut to ten words
    like a note's (TASK-264), or "Photo" when that photo has no alt text. The
    kicker still says Photo, and no heading prints.
  - "Untitled" is the last fallback.
  - A page with no title has no headline.
  - Its `image` is the picture the Open Graph tags print, so the two always
    match (see [The head](#the-head)).
  - Its `license` is the page's license URL, the front matter's over the
    site's. It is absent when there is no license.
- `BreadcrumbList` wherever the page prints a breadcrumb (see
  [The page shell](page-shell.md)). It has one `ListItem` per crumb, with its
  `position`, its `name` and its absolute URL as `item`.

To use a different graph, with more types, an `Organization` publisher or
nothing at all, write a `partials/jsonld.njk` in the site theme. That file
replaces this one, like any other partial.

## Prefetching and page transitions

Two tags near the top of `<head>` make navigation between pages faster. Both
are progressive enhancement. A browser that does not support one ignores it.

**Speculation rules.** The `speculationRules` block prints one
`<script type="speculationrules">`. It asks the browser to prefetch a page the
visitor is about to open. It covers links to this site's own pages, at
`moderate` eagerness. In Chrome, that is a hover of about 200 milliseconds or
the start of a tap. It never prefetches:

- `/admin` and anything under `/admin/`, which includes `/admin/logout`.
- Any path with `logout` in it.
- A feed: `/feed/`, `/feed/atom/`, `/feed/json/`, and any other path that has
  a `/feed/` segment, such as a tag's feed or a post's comments feed.
- A file under `/uploads/`.
- A URL with a query, such as `/search/?q=words`.

Every pattern goes through the `url` filter, so a site served from a
subdirectory prefetches only its own pages.

**No rules reach a signed-in user.** The CMS removes every
`<script type="speculationrules">` from a page it draws for a signed-in user.
This is the same page that carries [the admin bar](#the-admin-bar). The CMS
draws that page for one person and never stores it, so a prefetch of it is
wasted work. A site theme that writes its own rules does not need to check who
is signed in.

**View transitions.** The `viewTransitions` block prints a `<style>` that opts
into cross-document view transitions. The browser cross-fades from one page of
the site to the next, with no JavaScript. The rule is inside
`@media (prefers-reduced-motion: no-preference)`, so a visitor who asks for
reduced motion gets no transition:

```css
@media (prefers-reduced-motion: no-preference) {
  @view-transition {
    navigation: auto;
  }
}
```

To use a different animation, add `::view-transition-*` rules to the site
theme's stylesheet.

**Turning either off.** Override its block with an empty block:

```njk
{% extends "layouts/base.njk" %}

{% block speculationRules %}{% endblock %}
{% block viewTransitions %}{% endblock %}
```

## Colours

Every colour is a custom property on `:root`. These tokens are the override
contract. To change only the colours, redefine the tokens in the site's own
stylesheet. There is no need to replace this stylesheet. `src/style.css`
clears Tailwind's own palette. It maps Tailwind's utilities (`text-ink`,
`bg-paper`, `border-edge` and the rest) onto these properties with
`@theme inline`, so redefining a token recolours every rule that uses it.

A second scheme under `@media (prefers-color-scheme: dark)` redefines the same
tokens on dark paper. `color-scheme: light dark` lets a browser paint its own
form controls and scrollbars to match. There is no toggle. The visitor's system
setting picks the scheme.

Both schemes meet the Colour contrast rule of the
[specification.website checklist](https://specification.website/checklist.md):

- Every run of text, including the small kickers, dates and meta lines, is at
  7:1 (WCAG 1.4.6, AAA) on whatever it sits on.
- Every border a visitor relies on (a field, a card, a code block, the focus
  outline, the citation and blockquote rules) is at 3:1 (1.4.11).
- Nothing a visitor needs is drawn at reduced opacity.

A test enforces this. `src/web/theme-colors.test.ts` reads the tokens out of
the compiled stylesheet and computes the ratio of every pair the design puts on
screen. A colour change in `src/style.css` that breaks a pair fails the build.

| Token                     | Utility    | What it colours                                                        |
| ------------------------- | ---------- | ---------------------------------------------------------------------- |
| `--color-body`            | `paper`    | The paper, and the words on a submit button.                           |
| `--color-text`            | `ink`      | Body text and headlines.                                               |
| `--color-muted`           | `muted`    | Kickers, dates, meta lines, decks, quotes, the bio note, the footer.   |
| `--color-primary`         | `accent`   | Links, a kicker's kind word, the citation rule, the submit button.     |
| `--color-secondary`       | `accent-2` | Tag links and the focus outline.                                       |
| `--color-rule`            | `rule`     | Decorative hairlines only: between entries, above the footer.          |
| `--color-edge`            | `edge`     | Borders a reader relies on: fields, the previous and next cards, code. |
| `--color-base`            | `surface`  | A sunk surface: fields, notices, a face with no avatar.                |
| `--color-base-2`          | —          | A cooler sunk surface.                                                 |
| `--color-base-3`          | —          | The raised surface: the focused skip link.                             |
| `--color-code-background` | `code`     | Behind `code` and a fenced block.                                      |
| `--color-code-text`       | —          | Code with no highlighting on it.                                       |
| `--color-error`           | `error`    | A field with an invalid value, and the form's message about it.        |

`--color-rule` is the only token in no contrast pair, because it is
decoration. A site that recolours it can make it as faint as it likes.
Anything drawn with `--color-edge` must stay at 3:1 against the paper and the
surface.

## Code highlighting

The CMS renders a fenced block as
`<pre tabindex="0"><code class="language-x">` and highlights nothing.
Highlighting is the theme's job, and it runs on the client (decision-16). The
core adds the `tabindex` to every `<pre>`. A block wider than the measure
scrolls sideways, and a keyboard user cannot scroll a container that cannot
take focus.

This theme highlights with **[highlight.js](https://highlightjs.org/)**,
self-hosted at `static/highlight.js` and pinned. Nothing comes from a CDN. The
`scripts` block of `layouts/base.njk` loads it, deferred, **only on a page
whose rendered body holds a `language-` class**. A page with no code ships no
JavaScript. Auto-detection is off. A block with no language, or with a language
the bundle does not include, stays as the renderer wrote it: its class, its
plain text, and no highlighting.

The bundle holds the core and eighteen grammars: `bash`, `css`, `diff`,
`dockerfile`, `go`, `ini`, `javascript`, `json`, `markdown`, `nginx`, `php`,
`python`, `rust`, `shell`, `sql`, `typescript`, `xml` and `yaml`. Their aliases
are included, so `js`, `ts`, `html`, `yml` and `sh` all work. The bundle is a
build product, but it is committed, so a site gets a working highlighter from
the package with no build step. To rebuild it, run:

```
pnpm --filter @geekity/cms build:highlight
```

Run that command after you bump the `highlight.js` devDependency or edit the
language list in `scripts/build-highlight.js`. Then commit what it writes.
`src/web/highlight-bundle.test.ts` fails when the committed file was built from
a different version of highlight.js than the one installed.

**The palette is Tomorrow**, the palette of both sites this design comes from.
It is Chris Kempson's Tomorrow on light paper and Tomorrow Night on dark, from
highlight.js's own base16 themes. Those themes also decide which `hljs-` scope
takes which slot.

None of the light colours is the stock one. A syntax theme is designed for an
editor, where a faint comment is useful. Here code is text like any other, and
it meets 7:1 on its block, the same bar as every run of text on the page. Each
light colour was darkened along its own hue until it reached 7:1, and no
further. Four of the dark colours (the comment grey, the red, the blue and the
`base0F` brown) were lightened toward white the same way. The contrast test
checks every one of them, with the rest of the palette.

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

Delimiters, operators and substitutions use `--color-code-text`, the block's
own ink, by design. They are most of the characters on screen, and colour there
is noise. A `diff` block is coloured by line, not by token, as the source
site's `prism-diff.css` did. `.hljs-addition` and `.hljs-deletion` add a tint
out to the edges of the block and keep the ink. The `+` and the `-` in the text
carry the meaning as well as the colour does.

**Swapping it.** Four sizes of change, smallest first:

- _Another palette, same highlighter._ Redefine the dozen `--color-code-*`
  tokens. `static/style.css` is an all-or-nothing override. A theme that ships
  its own stylesheet owns these rules too, and a fenced block in that theme is
  unhighlighted until the theme writes them.
- _Other languages._ Edit `LANGUAGES` in `scripts/build-highlight.js`, rebuild,
  and commit. Or put your own `static/highlight.js` in your theme. The
  `/theme/` route resolves it before the packaged one.
- _Another highlighter._ Override the `scripts` block with your own tag. The
  markup is `pre > code.language-x`, which every highlighter reads.
- _None._ Override the `scripts` block with an empty block.

```njk
{% extends "layouts/base.njk" %}

{% block scripts %}{% endblock %}
```

## Videos

A YouTube or Vimeo URL on a line of its own in a post plays as the video
(decision-34; doc-2 lists the addresses it recognises). The core renders the
player into the body, so a theme receives it inside `content` as:

```html
<figure class="video-embed video-embed-youtube">
  <iframe
    src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"
    width="560"
    height="315"
    title="YouTube video"
    loading="lazy"
    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
    referrerpolicy="strict-origin-when-cross-origin"
    allowfullscreen
  ></iframe>
  <figcaption>
    <a href="https://www.youtube.com/watch?v=dQw4w9WgXcQ"
      >https://www.youtube.com/watch?v=dQw4w9WgXcQ</a
    >
  </figcaption>
</figure>
```

The real output is one line. A Vimeo video is the same, with
`video-embed-vimeo`, a `https://player.vimeo.com/video/ID?dnt=1` player and the
title `Vimeo video`. The core sets no style on it. With no styles from the
theme, the player is the providers' standard 560 by 315.

**Paper** makes it responsive. `.video-embed iframe` takes the full width of
the text column at 16:9, with the same rounded corners as an image. The
figcaption uses the muted caption style of every figure in a post. A theme that
ships its own `static/style.css` writes that rule itself:

```css
.video-embed iframe {
  width: 100%;
  height: auto;
  aspect-ratio: 16 / 9;
}
```

The figcaption is the link that a feed reader, a fediverse server or the embed
view keeps when it drops the iframe. To keep it off the page, hide
`.video-embed figcaption`. The feeds carry it either way.
