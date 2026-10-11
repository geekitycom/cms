# The page shell

`layouts/base.njk` is the page shell: the skip link, one `.global-wrapper` at the
42rem measure, `.global-header`, `<main id="main">` and the footer, in that
order. The shape is the andrewshell.org design's (decision-16) and the look is
Paper's (doc-9).

**One home for each kind of link.** The header carries the site menu, on every
page. [The bio](#the-bio) carries the person whose page or post it is. The
footer carries the site's own links. The search box is on the search page and
nowhere else.

**The header has one rule, and the menu under it.** On the front page it is the
site title as `h1.main-heading`, linked home, with `site.tagline` in a
`p.site-tagline` under it; on every other page it is `a.header-link-home`, the site
title small and linked home, and no tagline. The wrapper carries
`data-is-root-path="true"` at `/` and nothing anywhere else, which is how the
stylesheet tells the two apart. `menus.primary` is printed inside the
`.global-header` on both: at the root it is a line of its own under the
tagline, and everywhere else the stylesheet lays the header out as one line so
it sits beside the link home. See [Navigation](navigation.md).

**The footer** prints the copyright with the current year and the site
author's display name, `soloAuthor.name`, or the site title on a site with
several authors,
then the page's license, when it has one, as `<a rel="license">` with its name,
then `Published with Geekity`, and then `menus.footer` — the `footer` area this
theme declares, and the whole of what the footer links. A site that wants its
feed there types an `RSS | /feed/` line into it, the way the starter site does.
Nothing in the footer is read off an account: it used to hold one `rel="me"`
link per entry of `siteAuthor.links`, which was one nominated user's profile
presented as the site's. An empty or missing footer menu prints no list at all,
and the copyright line stands on its own. The year is
`{{ "now" | date("year") }}` — `now` is the one word the `date` filter reads
rather than parses — so it is the year at the moment the page is rendered, in
the site's own timezone. The license is `license`: a post's own from its
`license` front matter, else the site's from Settings > General, and nothing
on a site with none.

**The breadcrumb** opens `<main>` on a page with a place in the site's
hierarchy (TASK-150): a post filed under a category, and a category, tag or
author archive. It is `nav.breadcrumbs` labelled `Breadcrumb`, holding an `ol`
whose items run Home, then the post's first category and the post, or the
archive's term or person, then `Page N` past page one. Every crumb but the last
is a link; the last is the page itself, a `span` with `aria-current="page"`.
The trail is `breadcrumbs`, a list of `{ name, url }` that `layouts/base.njk`
sets before anything is printed, and the JSON-LD prints the same list, so the
two cannot disagree. Every other page has an empty trail and prints nothing. A
site that wants no visible breadcrumb empties the `breadcrumbs` block, and the
`BreadcrumbList` stays in the graph.

Webrings, badges and anything else that is markup rather than a link are
deliberately not in the package. They go in a site theme's `footer`
block:

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

When somebody signed in to the admin reads the site, the CMS puts the admin bar
across the top of every HTML page: the site title linking to the dashboard,
**+ New**, **Edit Post** or **Edit Page** on a post or a page, and the account
menu. A theme draws none of it and needs no template for it. The CMS inserts a
`<geekity-admin-bar>` element straight after the page's `<body>` tag, and an
anonymous reader's page is unchanged, byte for byte.

The bar keeps its markup and its stylesheet in a shadow root, so a theme's CSS
cannot restyle it and its CSS cannot restyle the theme. The element carries an
inline style that resets it and fixes it to the top of the window, full width,
above the page. Padding or margins on `<body>`, and rules such as `body > *` or
a grid on `<body>`, do not move or resize it. It stays in place while the page
scrolls.

The bar takes no room by itself, so the CMS makes room for it from outside. On
a page that carries the bar:

- `<html>` has the class `geekity-admin-bar`.
- A stylesheet in `<head>` declares `--geekity-admin-bar-height` on `:root`
  and sets `margin-top: var(--geekity-admin-bar-height) !important` on
  `<html>`, which pushes the whole page down below the bar. The height is
  40px, or 80px on a screen 600px wide or less, where the bar can wrap onto a
  second line. A script in the bar then measures it and sets the real height
  on `<html>`, so the push matches the bar at any width, and is 0 when a theme
  hides the bar.
- The same stylesheet sets `scroll-padding-top` on `<html>` to the bar's
  height, so a link to an anchor on the page, such as a skip link or a
  footnote, scrolls its target to below the bar. It is declared with no
  specificity, so a theme that sets its own `scroll-padding-top` keeps it.

A theme with a sticky or fixed header of its own offsets it by the bar's
height. The fallback of `0` applies on every page the bar is not on:

```css
.site-header {
  position: sticky;
  top: var(--geekity-admin-bar-height, 0);
}
```

A theme that sets its own `scroll-padding-top` adds the bar to it the same
way, for example `calc(var(--geekity-admin-bar-height, 0px) + 4rem)`. Use the
`geekity-admin-bar` class for any other change, for example
`.geekity-admin-bar .site-header { ... }`.

A theme that must not show the bar can hide it:

```css
geekity-admin-bar {
  display: none !important;
}
```

The `!important` is needed because it has to beat the element's inline style.
With script on, the bar then measures 0 and the page moves back up. For a
reader without script, the theme also removes the margin:

```css
html.geekity-admin-bar {
  margin-top: 0 !important;
}
```

## An entry

`layouts/post.njk` and `layouts/page.njk` draw the same thing, the entry, and it
is a microformats2 `h-entry`. An article, and a page:

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
every entry: the kind word in `span.kicker-kind` (Article, Note or Reply for a
post, from its `postType`; Page for a page), then the categories it is filed
under as `p-category` links. It is the only place the kind is said, small and
once, and an article is additionally the only kind with a visible headline.
The deck is the front matter's `description` as a `p.post-deck.p-summary`,
printed only when the author wrote one.

**The Published line is inside the `e-content`**, which is the one thing about
this shape worth knowing. It is what the source theme does: the date and the
permalink are part of the words, so a reader, or a fediverse peer reading the
`e-content`, takes them with the post. The permalink wraps the `dt-published`
time as a `u-url`, and a `dt-updated` follows it after a middle dot only when
the update happened on a different day in the site's own timezone; a typo fixed
an hour later is not news. The line opens with a `u-syndication` link to each
syndication target the post selects (`syndicateTo`, TASK-155), which is what
IndieNews and Bridgy Publish look for on the page, and ends with the post's
copies elsewhere (`syndication`) after **Also on**. A page never prints either,
and its line is a `p.page-meta` rather than a `p.entry-meta`.

**A post first published elsewhere says so.** A post whose front matter names
its original with `canonical_href`, an absolute http or https URL such as a
Substack essay's, has it on the context as `original` (TASK-293). The line
then reads **Originally published at** and links the original as a second
`u-url` of the h-entry, after the permalink's. The link says the publication's
name when the front matter gives one in `canonical_name`, such as `Smarter
Engineers` for a guest post on someone else's Substack (TASK-316), and the
original's host otherwise. It is no
`u-syndication`, because the original is not a copy of this post, and
original-post-discovery reads a copy's off-site `u-url` as its original. The
same URL is the page's `rel="canonical"` and its `og:url`, so search engines
credit the original. A value that is not an absolute http or https URL is
ignored, and `geekity sync` names the file. So is a `canonical_name` with no
valid `canonical_href` beside it.

**Every post's page has one `h1`.** A post with a name of its own is headed by
it, as above. So is a post with a title and no words, such as a titled like,
repost or bookmark (TASK-256): its header comes first and its citation after
it. A title that only repeats a post's opening words is no name. A note, or a
reply without a title, opens on its words instead,
set larger, so it has no `header`; in its place is an `h1` a screen reader and
a crawler navigate by and a sighted reader never sees, saying what the post is,
who wrote it and when, and then the kicker:

```html
<h1 class="screen-reader-text">Note by Ada Lovelace, 11 September 2026</h1>
<p class="kicker"><span class="kicker-kind">Note</span></p>
```

It says `Reply`, `Like`, `Repost` or `Bookmark` for those and leaves out the name or the date the post does
not have. It is not a `p-name`: a parser that found one would take the post
for an article. The headings under it step down one level at a time: the
conversation and the comment form are `h2`, and a refused form's error summary
is an `h3` inside the form's section.

**A reply cites what it answers** with `partials/reply-context.njk`, a
`div.reply-context.cite.u-in-reply-to.h-cite`: a rule on the start side, a
`p.cite-line` saying "In reply to" and the target's name, author and date as
far as they are known, and its excerpt as a `blockquote.cite-quote.p-content`.
Where it goes depends on whether the post shows a title. An untitled reply
opens on it, under the kicker and before its words. A titled reply prints its
`header.post-header` first and the citation after it, before the `e-content`,
so the page opens on its title rather than on a link. A listing follows the
same rule: an untitled entry cites under its kicker, a titled one after its
title and summary. The same partial cites a reply in a feed. The layouts own
the placement; the partial owns only what the citation says, and it stays
inside the `h-entry` wherever it is printed.

**A reply to a silo copy cites the original** (TASK-197). When the post a
reply answers is a copy of a post on another site, and that post lists the
copy as its `u-syndication`, `replyContext.original` is the original's URL and
the rest of `replyContext` describes the original. The `h-cite` links the
original, and a `p.cite-copy` after it says "Also in reply to its copy on" the
silo's host, linking the copy as a `u-in-reply-to` of its own, so a parser
reads both as what the post answers.

**An RSVP says whether its author is going** (TASK-198). An RSVP is a reply
to an event whose `rsvp` is `yes`, `no`, `maybe` or `interested`.
`partials/rsvp.njk` opens its `e-content` with a `p.rsvp-line` holding a
`data.p-rsvp` whose value is the answer and whose text is Going, Not going,
Maybe or Interested; it prints `rsvp.line`, the HTML the feeds also carry. Its
reply context says "RSVP to" rather than "In reply to", and when the event's
page is an `h-event`, or describes a schema.org `Event` in JSON-LD, its start
follows the event's name as a `time.dt-start` and its place as a
`span.p-location`, inside the `h-cite`. A start the event page wrote with no
zone is that wall clock where the event is, so it is printed in UTC
(`replyContext.startZone`) rather than moved into the site's zone. Its kicker
and its hidden `h1` say RSVP. An RSVP to a silo copy of an event cites the
original as a reply does.

**An event is an h-event** (TASK-200, decision-32). A post whose front matter
has a readable `start` is an event: its title is the event's name, its body
the description, and `end` and `location` are optional. `layouts/post.njk`
types its article `h-event` rather than `h-entry`, its kicker and hidden `h1`
say Event, and `partials/event.njk` follows the title with a
`dl.event-details`. The When row is a `time.dt-start` and, with an end, a
`time.dt-end`, each written with the `date` filter's `datetime` format in the
site's zone, with the instant as its `datetime`. The Where row is a
`span.p-location` holding the place's words, or "Online at" an
`a.p-location` that links the address to join an online event. The JSON-LD
describes the post as a schema.org `Event` instead of a `BlogPosting`. That
`Event` is a `Place` or a `VirtualLocation`, carries an attendance mode and an
`EventScheduled` status, and names the author's Person as its `organizer`.
The answers it is given are grouped in `conversation.rsvps`; see [The
conversation](conversation.md).

**A like, a repost or a bookmark cites what it cites** (TASK-169) with
`partials/citations.njk`, beside the reply context and drawn the same way: one
`div.reply-context.cite.h-cite` per entry of `citations`, classed
`u-repost-of`, `u-like-of` or `u-bookmark-of`, whose `p.cite-line` says
Reposted, Liked or Bookmarked and links the target as its `u-url`. The link
says the target's name, as the reply context does, with its author after it as
a `p-author h-card`, when the target was read when the post was saved
(TASK-244): its `h-entry` name, its oEmbed title, or its `og:title` or
`<title>`. A YouTube, TikTok, Reddit or Giphy target is named by that
provider's known oEmbed endpoint, asked before its page, which is read only
when the endpoint names nothing (TASK-251, TASK-253). Any other target's oEmbed
title comes from the endpoint its page links. A title that is only a site suffix such as "- YouTube" is
no title. A comment on this site (`replyContext.comment`, TASK-326) says "a
comment". With only an author it says "a post", and with neither "a page on"
the target's host, never the bare URL, which can run to hundreds of
characters: "Bookmarked a page on example.com" (TASK-255). Its kicker
and its hidden `h1` say Repost, Like or Bookmark. It is placed as the reply
context is: at the top of an untitled post, after the header of a titled one.
A listing cites each entry's from the same partial, by the same rule.

**Both citations name the cited page** through `partials/cited-page.njk`, so
they print its name and author by one rule. A name that already ends in " by "
and the author's name, in any case, does not print the author again
(TASK-247): SoundCloud titles a track "Flickermood by Forss" and names Forss
as its author. The title link stops before " by ", and the words after it
become the `p-author h-card`, so the line reads "Liked Flickermood by Forss"
and a parser still reads the whole title as the `p-name`. A name that mentions
its author anywhere else, such as "Rick Astley - Never Gonna Give You Up" by
Rick Astley, keeps the author after it. A page that names no author but names
its site, its `og:site_name`, is followed by a middle dot and the site as a
plain `span.cite-site`, never an `h-card`, because a site is not an author: a
bookmark of a Scripting News post reads "Bookmarked RSS tip #2 · Scripting
News". A like's, a repost's or a bookmark's citation never prints the page's
description, which on many sites describes the site rather than the post.

**A citation shows who wrote the cited page** (TASK-199) as fully as the page
said. The author's photo, an `img.u-photo.cite-avatar` with empty alt text
since their name is beside it, comes before the name inside the `h-card`; a
fediverse author's handle follows the name as a `span.p-nickname.cite-handle`
reading `@user@host`. The photo is the `u-photo` of the `h-entry` author's
`h-card` (or of the page's `h-card` for the same person), the avatar of the
account an ActivityPub object is attributed to, or the author image in the
page's JSON-LD, copied into the site's uploads as a picture is, and left out
when the post has removed its preview. A Mastodon status is read from the
ActivityPub object its page links, so its author's display name, handle,
avatar, words, first image and date come from the status itself rather than
from the page's `og:title`. A page with no `h-entry` and no object is read
from its JSON-LD (`headline`, `author`, `datePublished`, `image`) and then its
Open Graph, Twitter and `article:` tags.

**A citation shows the cited page's picture** (TASK-252) when the page named
one and the post has not removed its preview. The picture is the page's
oEmbed photo, else its oEmbed thumbnail, else its `og:image`, else its
`twitter:image`, copied into the site's uploads when the post was saved, so
a reader's browser never asks the cited site or its CDN for anything. It is
`context.picture`: `{ src, width, height, kind, video, shownInFull, imgHtml }`, where
`imgHtml` is an `img.u-photo` inside the `h-cite`, responsive when the copy has
variants. A repost of a photo (`shownInFull`, such as a Giphy GIF) prints it in full
under the line, as `a.cite-photo` linking to the target, with the target's
name as its alt text. Every other citation with a picture (a like, a bookmark,
a reply, a repost of a video or a page) is classed `cite-with-thumb` and
prints it as `a.cite-thumb` beside the line: a 6rem thumbnail linking to the
target, out of the tab order and hidden from assistive technology because the
title beside it is the same link, with an empty alt text. A video's thumbnail
is also classed `cite-video`, which the stylesheet draws a play mark on. A
picture that could not be copied, was bigger than the site's upload limit or
was never named leaves the citation as it was, with no picture. A post whose
front matter says `preview: false`, which the editor's remove control writes,
prints the plain citation, and so do its listing entry and its feed items.
There is never an iframe or a script from the cited page.

**A cited URL that is itself an image** (TASK-255), one that answers with an
`image/*` type rather than a page, is copied as its own picture of kind
`photo` and has no name, so `context.image` is true and the line says "an
image from" its host as the link: "Reposted an image from edu.casio.com". A
repost shows it in full like a reposted GIF, a like or a bookmark as a
thumbnail beside "Liked an image from edu.casio.com", and a post that hid its
preview still says it reposted an image. Its alt text is the post's
`cited-alt`, which the editor's card writes, else the post's title, else
empty. An image that could not be copied, or was bigger than the site's
upload limit, keeps no context, so its citation says "a page on" its host.

The feeds open each
citing post's HTML with the same citation as a `p.cite-line`, the picture
after it with an absolute `src`.

**A read says what was read** (TASK-229) with `partials/read.njk`, a
`p.read-line` at the top of the `e-content` that reads like indiebookclub's
own: a `data.p-read-status` whose value is `to-read`, `reading` or `finished`
and whose text is Want to read, Currently reading or Finished reading, then a
`span.p-read-of.h-cite` with the title as a `cite.p-name` (linked as its
`u-url` when the post gives one), the author as a `p-author`, and the
identifier as a `data.p-uid` whose value is the `isbn:` or `doi:` uid. Its
kicker and its hidden `h1` say Read. A listing prints each entry's from the
same partial. The partial prints `read.line`, the same HTML the feeds and the
federated Note open with (TASK-233); `read.status`, `read.statusLabel` and
`read.of` are there for a theme that marks it up differently.

The tags are printed under the words and inside the article, so that each link
is a `p-category` of this entry, as one `p.post-categories` from
`partials/tags.njk`. The stylesheet draws the `#` in front of each, so the
category a parser reads is the tag and not the hash.

**A post with a recording plays it** (TASK-213), from
`partials/recording.njk`, between the header and the `e-content`. The main file
is the browser's own player, `<audio controls>` or `<video controls>` as
`enclosure.player` says, with `preload="metadata"` so a reader who never presses
play downloads nothing, and a download link inside it for a browser that plays
neither. The `<source>` carries `u-audio` or `u-video`, so a microformats parser
finds the file on the entry. A video whose transcript is WebVTT also gets it as
a `<track kind="captions">`. Under the player a `figcaption` links the
transcript, as Captions for VTT or SRT and Transcript otherwise, and lists the
other versions by their title, else their media type. A post without a
recording, or whose front matter is missing what a player needs, prints none of
it.

**A post with photos shows them** (TASK-166), from `partials/photos.njk`, after
the recording and before the `e-content`, each in a `figure.post-photo`. Each is
the context's `photo.html`: an `<img class="u-photo">` with its alt text, so a
microformats parser finds every photo on the entry, and a `<picture>` with the
upload's resizes when it has them. The alt text is the post's own, else the
media library's. A listing prints them the same way above each entry, and the
JSON-LD `BlogPosting` lists each as an `ImageObject` with its absolute `url`
and its alt text as `caption`. The first photo is the post's share image when
its front matter names no `image`.

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

After the entry a post prints its backlinks, then `nav.blog-post-nav`: the
`previous` and `next` posts as two cards, `rel="prev"` and `rel="next"`, each
opening on a `span.blog-post-nav-label`, and nothing at all at the ends of the
archive; then the conversation and the comment form. A page prints its
backlinks too, then the conversation and the comment form when it takes
comments, and the contact form when its front matter asked for one. A page has
no neighbours, no tags and no syndication links, because none of those are
things a page has.

## Backlinks

A link from one of the site's posts or pages to another sends no webmention.
The CMS records it instead, and the linked document's context carries
`backlinks`: the listed posts and pages whose body links to it, newest first,
each as `{ title, url, date }`. `title` is the linking document's title, or a
note's first words. `date` is absent for a page that has none. A link counts
whether it is absolute or relative, with or without its trailing slash, a query
or a fragment, and through a `redirect_from` of the target. A link to `/`
counts for the page the Reading setting makes the homepage. A link to a URL the
site answers with a redirect counts for the document the redirect leads to,
whether the redirect is a `redirect_from` or an entry in `_data/redirects.json`
or `_data/redirects/*.json`, `/?p=123` included. A link with a query names the
query's redirect only when the query matches the redirect's source exactly, as
a request does, so `/?p=123&ref=feed` is a link to `/`. A document that links
to itself is not its own backlink. Drafts, future-dated, unlisted,
private and trashed documents never appear. `backlinks` is always a list, and
it is empty when nothing links to the document.

`partials/backlinks.njk` prints a `section.backlinks` under the entry, apart
from the conversation: an `h2` that says "Linked from", then an `ol` of links,
each with its date in a `<time>`. It prints nothing for an empty list, so
`layouts/post.njk` and `layouts/page.njk` include it with no condition. The
front page has `backlinks` on its context too, but `layouts/front-page.njk`
does not print them, because most of a site links home. A site theme that wants
them there adds the same include to its own `layouts/front-page.njk`:

```njk
{% include "partials/backlinks.njk" %}
```

A site theme moves the list by including the partial somewhere else in its own
layout, and leaves it out by overriding a layout without the include. To change
the markup, add a `partials/backlinks.njk` to the site theme. That file replaces
this one, as any other template is replaced.

## The bio

`partials/bio.njk` is who the page is by: the `p-author h-card` the rule and
the footer at the end of an entry hold, and the heading of an author archive.
It replaces `partials/byline.njk`, which is gone — a byline was a name in a
meta line, and this is the whole credit.

```njk
{% set bioAuthor = author or siteAuthor %}
{% include "partials/bio.njk" %}
```

`bioAuthor` is the one thing to set, and nothing renders when it is absent.
It is one of the profile objects the context already carries: `author` on a
post, falling back to `siteAuthor`; `siteAuthor` on a page; the archive's
person on an author archive.

What the bio prints: a round `u-photo` at 50px when they have an avatar,
"Written by" and their name as a `p-name u-url` linked `rel="author me"` to
their archive, then `p-job-title` and `p-locality` when the profile says, then
their `p-note` and their `rel="me"` links as a `ul.hlist.bio-links` — each
link's `rel` is on it ready to print, `me` first and then whatever else the
Links box typed. Set `bioRelMe` to `false` to keep the card and drop its
claims: the name is linked `rel="author"` alone and `me` comes off every
link.

**The homepage** speaks for the site's author only on a site whose Site author
setting names a user, which `soloAuthor` on the context says. Then
`layouts/base.njk` puts that person's `rel="me"` claims in the head of `/` as
`<link rel="me">` elements, one for their author archive and one for each
profile link, whichever layout draws the page (decision-45). Their author
archive's link home carries `rel="me"` back, so the homepage and the archive
name each other. `layouts/home.njk` at `/` also ends with that person's card,
with the same claims, and sets `bioHome` to the homepage's absolute URL, which
puts a `data.u-url.u-uid` holding it first in the card, so a parser running the
[representative h-card algorithm](https://microformats.org/wiki/representative-h-card-parsing)
on the homepage finds this card as the site's (TASK-193). The archive stays a
second `u-url`. No other page sets `bioHome`. A static front page prints no
card: see [The front page](#the-front-page) for how a site puts one back. On a
site with several authors neither homepage prints a card or makes a claim. Each of
those is printed only when the profile says it, so a profile holding a name
alone prints a name alone. A name this site has no account for is printed
unlinked, because the file still said somebody wrote this.

**The person and only the person.** The site menu used to be printed here as
well, because the design had no header navigation; it is in the header on
every page now — see [Navigation](navigation.md) — so the bio says nothing about
the site. The note and the links used to be behind a `bioProfile` switch that
an author archive set and an entry did not, on the grounds that the page
footer already carried the site's identity links. It carries nobody's, so the
switch is gone and the card is the same wherever it appears: at the top of
somebody's archive, and under each of their posts.

`bioLead` is what the line opens with, `Written by` unless a layout sets
another; `layouts/author.njk` sets `Posts by`, because the card there heads
somebody's writing rather than crediting one piece of it.

**A site that used `partials/byline.njk`** — `{{ byline.line(author) }}` from
an overridden layout — either includes this partial instead or writes the line
itself. It was four lines of markup, and the object behind it has not changed:

```njk
{% set writer = author or { name: site.title } %}
<span class="p-author h-card">
  {%- if writer.url %}<a class="u-url" href="{{ writer.url | url }}">{{ writer.name }}</a>
  {%- else %}{{ writer.name }}{% endif %}
</span>
```

`apps/demo/themes/demo/layouts/post.njk` is that, worked: the demo wants a
byline under the title rather than a bio in the footer, so it writes one.

## A listing

`partials/post-list.njk` is the feed every listing is made of (the home page,
the posts page, a tag, category or author archive, and a front page that
lists `newestPosts`) and it is a microformats2 `h-feed` of `h-entry` items, each opening on
its kicker:

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

**Only an article has a headline.** A note, which has no title, is printed
whole as its `e-content`, and the date in its kicker is its `u-url`. A reply is
a note that first cites what it answers with `partials/reply-context.njk`, and
a reply with a title is an article that cites it after its title and summary.
A like, a repost and a bookmark place `partials/citations.njk` the same way,
and one with a title and no words is listed by its title too. An article's categories are in
its kicker; a note's are on its own page.

The excerpt is the entry's `summary`, the very line the feeds publish, so a
reader and a feed cannot be told two different things, through Nunjucks'
`truncate(280)`, which cuts at the last space before 280 characters and adds an
ellipsis. A `description` shorter than that is printed whole. It is plain text
rather than markup, deliberately: an excerpt with half a code block in it is
not an excerpt.

Each entry of a listing carries `replyContext` beside `inReplyTo` when it is a
reply whose target has been fetched, the same object a reply's own page gets,
so the feed can cite it in full.

An entry's tags are not in a feed item. They belong under the entry, where
there is one post's worth of them rather than twenty.

**The heading level belongs to the layout**, not to the list. `feedHeading` is
the level `post-list.njk` prints its titles at and defaults to 2, which is what
a listing wants; a page whose feed sits under a heading of its own sets 3
before including it, so the outline never skips a level:

```njk
{% set feedHeading = 3 %}
{% include "partials/post-list.njk" %}
```

A listing with nothing on it says `No posts found.` in `p.empty`.

`partials/pagination.njk` prints two links in `nav.pagination`, `← Previous`
to the page before this one and `Next →` to the page after it, with `rel="prev"`
and `rel="next"`, and nothing at all on a listing of one page. The arrows
themselves are `aria-hidden`, because a screen reader that announced them would
read the decoration and then the word.

Each listing layout heads its own page: `layouts/home.njk` with the listing's
title, and the three archives with a `header.archive-header` whose kicker says
what kind of archive it is (Tag, Category, Author) over an `h1.page-title`
naming whose: the term, or the person, followed by their `h-card`. The
category archive's header is also a `header.category-header` and prints a
`div.category-description` under the name when the context carries a
`categoryDescription`; the CMS has no store of term descriptions, so nothing
writes one today and the header is the heading alone.

`layouts/404.njk` says `Content not found.` under a `Not found` kicker and
links home and to the search. The 500 and 503 pages below open on a kicker the
same way.

`layouts/410.njk` is the page at the URL of a post or page that was moved to
the trash (TASK-195). It says `This content has been deleted.` under a
`Deleted` kicker and links home and to the search. The context is the 404's:
`title`, `url` and `page.url`, and nothing of the deleted document. Its `.md`
and `.json` representations answer 410 too. A trashed draft was never public,
so its URL is a 404 instead.

`layouts/500.njk` is the page a request gets when the server fails while
answering it (TASK-129). It says `Something went wrong.` in an
`article.server-error` and links home. The context is the 404's: `title`,
`url` and `page.url`. The response is a 500 with `Cache-Control: no-store`, and
the error itself goes to the server's log, never into the page. If this template
fails too, the CMS answers with a plain HTML page of its own instead, so a theme
cannot turn one failure into a crash. A request for the `.md` or `.json`
representation gets a 500 in that format and never reaches this template.

`layouts/503.njk` is the page a request gets while the site is in maintenance
mode (TASK-130). It says `Down for maintenance.` in an `article.maintenance`.
The context is the 404's, plus `until` (an ISO 8601 time) and `untilText` (the
same time as an HTTP date) when the operator named when the site should be
back. The response is a 503 with `Retry-After` and `Cache-Control: no-store`.
The theme's files under `/theme/` are still served, so the page can use the
stylesheet. If this template fails, the CMS answers with a plain HTML page of
its own.

## Search

`layouts/search.njk` is the page at `/search/` (TASK-22). It prints
`partials/search-form.njk`, and once there is a `query` a `p.search-summary`
saying how many documents matched, a `div.search-results` of
`article.search-result` entries, and the ordinary pager. It asks not to be
indexed with `<meta name="robots" content="noindex">` in its `head` block.

The context is a listing's with two differences. `query` is the words searched
for, trimmed, and an empty string on the page before a search. Each entry in
`posts` carries a `snippet`: a few words of
HTML around the match, escaped, with every matched word in `<mark>`. Print it
with `safe`. The results are best match first rather than newest first, and
only what the public site would serve is ever among them.

`partials/search-form.njk` is a `GET` form to `/search/` with the words in `q`,
so it needs no JavaScript and a search is a URL. This layout is the only thing
that includes it: the box used to be in the footer of every page as well, and
search is a menu item now — a `Search | /search/` line like any other. The
search page takes the path `/search/` ahead of any document permalinked there.

## The front page

`layouts/front-page.njk` is what a site gets at `/` once the Reading settings
name a homepage (`homepage` in `content/_data/site.json`). It is that page read
somewhere else: the same document, the same context, with `page.url` saying `/`
rather than the permalink that redirects there.

It draws the page's own title and words, and nothing else (decision-44):

1. `h2.section-title`, the page's title. It is an `h2` because
   `layouts/base.njk` heads the root path with the site title as the `h1`.
2. `div.page-body.e-content`, the rendered body. There is no Published line,
   because a front page is read as the site rather than as a page somebody
   wrote on a Tuesday.
3. The contact form, when the page's front matter says `contact: true`.

It lists no posts, prints no line of links and prints no bio. A site that wants
any of them on its front page overrides `layouts/front-page.njk` in its own
theme. Two context keys are the front page's alone, for that override:

- `newestPosts(count)` is a function. It returns the newest `count` published
  posts as entries, in the same shape a listing's `posts` are, so
  `partials/post-list.njk` prints them. Drafts, future-dated, unlisted and
  trashed posts are left out. The theme chooses the count. The query runs only
  when a template calls it, so a front page that lists nothing costs nothing.
  A count that is not a whole number of at least 1 is an error.
- `postsPage` is `{ title, url }` for the page carrying the listing, and is
  **absent** when the site names none, because a link to a listing that has no
  URL is a link to nothing.

`newestPosts` replaces `recentPosts`, which held this month's posts when there
were at least five and the five newest otherwise. An override that read
`recentPosts` calls `newestPosts(5)` instead. This override draws the page's
words, the five newest posts, a line of links and the site author's card as
the site's representative h-card:

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
override can use both. Whatever the override prints, the solo author's
`rel="me"` claims stay in the head of `/` (decision-45).

## An archive page

A page whose front matter says `archive: true` prints every post the site has
published under its own words, newest month first:

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

`partials/archive.njk` draws it and `layouts/page.njk` includes it. It is the
whole archive on one page and nothing paginates it: an archive page is a way of
finding one piece of writing rather than a listing to read through, which is
also why there are no excerpts on it. Drafts and posts whose date has not
arrived are absent, as they are everywhere else.

`archiveMonths` is what it loops over, and it is on the context **only** for a
page whose front matter says `archive: true`, so a layout asks:

```njk
{% if archiveMonths %}
{% include "partials/archive.njk" %}
{% endif %}
```

Each entry of it is `{ month, posts }`: `month` is the heading, `September
2026`, and `posts` is `{ title, url, date }` for each post of it, newest first.
Which month a post belongs to is the CMS's answer rather than the template's,
because a date in a file is a UTC instant and the site's `timezone` is the lens
it is read through — so the grouping and the date printed under an entry are
one decision rather than two.

The key is honoured wherever it is written, exactly as `contact: true` is: a
theme that wants the list on some other kind of page adds the same three lines
to that layout.

## The head

Beside the title, the canonical link and the feeds, every page carries a
description, Open Graph and Twitter card tags, the site's icons and one
JSON-LD graph. All of it is in the `head` block, so an override that only means
to add a tag calls `{{ super() }}` first.

**The description** is the page's own `description` from the front matter, else
the entry's `summary` — the line the feeds publish — else `site.tagline`. It is
printed once, as `<meta name="description">`, and the Open Graph and Twitter
descriptions say the same thing.

**The colours** come from the theme's `theme.json` (see
[The manifest](manifest.md)), on the context as `theme`.
`<meta name="color-scheme">` comes before the stylesheet, so a reader in dark
mode gets a dark canvas rather than a white flash while the stylesheet loads.
`<meta name="theme-color">` is printed twice, once with
`media="(prefers-color-scheme: light)"` and once for dark.

**The card.** `og:title` is the page's title, or the site's on the front page;
`og:site_name` is always the site's. `og:type` is `article` on a rendered post
or page and `website` everywhere else, a listing carrying a page's front matter
included. `og:url` is the canonical URL: the page's own, or the `original` a
post first published elsewhere names. An article also carries
`article:published_time`, `article:modified_time` (the `updated` date, else the
publish date), `article:author` (the author's profile URL here, else their
name) and one `article:tag` per tag.

**The picture** is the first of these that the page has, on the context as
`shareImage`:

1. The `image` in the entry's front matter.
2. `site.avatar`, which only a hand edit of `site.json` sets.
3. The profile photo of the person the page is by: the writer of a post or page
   that names an author, the user of an author archive, and the site's author
   on a solo-author site's homepage and other pages about nobody in particular.
4. The site icon, from `icon` in `site.json`.

A page with none of these prints no `og:image` and no `twitter:image` rather
than an empty one. The picture always carries `og:image:alt` and
`twitter:image:alt`. The alt text is what the media library says about the
upload, else words for what it shows. For the entry's own picture, its
`imageAlt` front matter comes first, and the entry's title last. For the
avatar, the last resort is the site's author; for a photo, that person's
display name; for the icon, the site's title. `og:image:width` and
`og:image:height` are printed when the image's variants have been derived,
because the size is read from their sidecar rather than from the file.
`twitter:card` is `summary_large_image` for a picture at least 1200 pixels wide
and wider than it is tall. Everything else, a square photo included, is
`summary`, the small picture beside the words.

**The icons** come from the site's `icon` setting in `site.json`, else
`site.avatar`, through the derived images (decision-10). `icon` exists for a
site whose avatar is a face and whose mark is a logo. The head links `icon` at
32 and 16 pixels and `apple-touch-icon` at 180, each a square PNG cropped from
the middle of the picture and encoded the first time a browser asks for it. An
SVG icon is linked first as itself, with `type="image/svg+xml"` and no
`sizes`, and the PNGs are rasterised from it. They are on the context as
`icons`, a list of `{ rel, sizes, type, href }`, which is empty, and the links
are not printed at all, when the site has neither setting, when it names a
file no icon can be made of, or when image optimization is off.

**The favicon and the manifest** are routes, not templates. `/favicon.ico`
holds 16, 32 and 48 pixel frames drawn from the same picture, because browsers
and crawlers ask the root for it whatever the head links; it answers 404 on a
site with no icon. `/manifest.webmanifest` gives the site's title as `name` and
`short_name`, `start_url` `/`, `display` `minimal-ui`, the theme's light
`themeColor` as `theme_color` and `background_color`, and icons at 192 and 512
pixels plus a maskable 512 whose picture sits inside the middle 80%, padded
with its own dominant colour. The head links it on every page.

**The search description** is a route too. `/opensearch.xml` is an OpenSearch
1.1 description that names the site by its title (cut to the 16 characters
`ShortName` allows), describes it by its tagline, else its title, shows
`/favicon.ico` as its `Image` when the site has an icon, and searches
`/search/?q={searchTerms}`. Every URL in it is absolute and carries the base
path. The head links it on every page with `<link rel="search"
type="application/opensearchdescription+xml">`, outside the `head` block, so a
browser offers the site as a search engine. A theme that replaces `base.njk`
copies that line to keep the offer.

**The embed card** is a route too. `/_geekity/oembed?url=…` is an oEmbed
provider: for the URL of a published post or page it answers a `rich` embed
with the title, the author and their archive, the site as provider, a
thumbnail when the post's own `image` has a recorded size, and an `html`
card that is a blockquote of escaped text and links with no script, followed
by a hidden, sandboxed `<iframe>` of `/_geekity/embed?url=…`. That route is
the same card as a page of its own, and it is the one response another site may
frame. WordPress keeps a card from a provider it does not know only when the
card has an iframe, and it shows the frame once the page inside reports its
height. A consumer that strips iframes still has the blockquote. `maxwidth`
and `maxheight` are honoured, `format=xml` gives the same fields as XML, and
any other URL is a 404. The head of each post and page links it with
`<link rel="alternate" type="application/json+oembed">` and its `text/xml+oembed`
twin, outside the `head` block. A theme that replaces `base.njk` copies those
lines to keep the card.

**The structured data** is `partials/jsonld.njk`, one `<script
type="application/ld+json">` holding one `@graph` per page, and it is the only
structured data the theme emits — there is no Microdata anywhere, by
decision-16, because the visible markup already carries microformats2 for the
IndieWeb. The graph holds:

- `WebSite`, always, with the site's title, tagline and URL, and a
  `potentialAction` that is a `SearchAction` on
  `/search/?q={search_term_string}`. On a site whose author is a user, its
  `publisher` and `about` both point at that user's Person, on every page. On
  a site with several authors its `publisher` is the Organization below and it
  has no `about`. With a site license, `license` is its URL.
- `Organization`, on a site with several authors only: the site itself, named
  for its title, at `{baseUrl}/#organization`. It publishes the `WebSite` and
  every entry.
- `Person`, from `siteAuthor`: their name, archive URL, avatar, bio, job title
  and location, and a `sameAs` of their profile links and their actor id, which
  is what asserts that the schema.org Person and the fediverse actor are one
  identity. Identity comes from a user profile, so a site — or a byline —
  naming nobody with an account here prints no Person, and the `author`
  reference goes with it. A site with several authors prints no Person on a
  page about nobody in particular.
- `ProfilePage` on an author archive, whose `mainEntity` is that Person.
- `BlogPosting` on a post and `Article` on a page, with the headline, URL,
  `mainEntityOfPage`, `datePublished`, `dateModified`, description, image,
  `author`, and the site's `publisher`: the site author's Person, or the
  Organization. A post with no title is headed by the words its `<title>`
  names it by, its `label`, cut on a word boundary to at most 110 characters.
  A post with no words either is labelled by what it is (TASK-261): "Liked",
  "Reposted", "Bookmarked" or "Reply to" and the cited page's stored title,
  else the host its citation line names ("Liked a page on www.youtube.com"), and
  for a photo post its first photo's alt text, cut to ten words like a note's
  (TASK-264), or "Photo" when that photo has none. The kicker still says Photo
  and no heading is printed. "Untitled" is the last fallback.
  Its `image` is the picture the Open Graph tags print, so the two always
  agree (see [The head](#the-head)). Its `license` is the page's license URL,
  the front matter's over the site's, and absent with none.
- `BreadcrumbList` wherever the page prints a breadcrumb (see
  [The page shell](page-shell.md)): one `ListItem` per crumb with its
  `position`, `name` and absolute URL as `item`.

A site that wants a different graph — more types, an `Organization` publisher,
nothing at all — writes its own `partials/jsonld.njk` and that file replaces
this one, like any other partial.

## Prefetching and page transitions

Two tags near the top of `<head>` make moving between pages feel faster. Both
are progressive enhancement: a browser that does not support one ignores it.

**Speculation rules.** The `speculationRules` block prints one `<script
type="speculationrules">` that asks the browser to prefetch a page the reader
is about to open. It covers links to this site's own pages, at `moderate`
eagerness, which in Chrome is a hover of about 200 milliseconds or the start of
a tap. It never prefetches:

- `/admin` and anything under `/admin/`, which includes `/admin/logout`.
- Any path with `logout` in it.
- A feed: `/feed/`, `/feed/atom/`, `/feed/json/`, and any other path that has
  a `/feed/` segment, such as a tag's feed or a post's comments feed.
- A file under `/uploads/`.
- A URL with a query, such as `/search/?q=words`.

Every pattern is written through the `url` filter, so a site served from a
subdirectory prefetches only its own pages.

**No rules reach a signed-in reader.** The CMS removes every `<script
type="speculationrules">` from a page it draws for somebody signed in, the same
page that carries [the admin bar](#the-admin-bar). That page is drawn for one
person and never stored, so a prefetch of it is wasted work. A site theme that
writes its own rules does not have to check who is reading.

**View transitions.** The `viewTransitions` block prints a `<style>` that opts
into cross-document view transitions. The browser cross-fades from one page of
the site to the next, with no JavaScript. The rule is inside `@media
(prefers-reduced-motion: no-preference)`, so a reader who asks for reduced
motion gets no transition:

```css
@media (prefers-reduced-motion: no-preference) {
  @view-transition {
    navigation: auto;
  }
}
```

A site theme that wants a different animation adds `::view-transition-*` rules
to its own stylesheet.

**Turning either off.** Override its block with nothing in it:

```njk
{% extends "layouts/base.njk" %}

{% block speculationRules %}{% endblock %}
{% block viewTransitions %}{% endblock %}
```

## Colours

Every colour is a custom property on `:root`, and these tokens are the
override contract: a site that only wants different colours redefines them in
its own stylesheet rather than replacing this one. Tailwind's own palette is
cleared in `src/style.css`, and its utilities (`text-ink`, `bg-paper`,
`border-edge` and the rest) are mapped onto these properties with
`@theme inline`, so redefining a token recolours every rule that uses it.

A second scheme under `@media (prefers-color-scheme: dark)` redefines the same
tokens on dark paper, and `color-scheme: light dark` lets a browser paint its
own form controls and scrollbars to match. There is no toggle: the reader's
system setting is the setting.

Both schemes meet the Colour contrast rule of the
[specification.website checklist](https://specification.website/checklist.md):
every run of text, the small kickers, dates and meta lines included, at 7:1
(WCAG 1.4.6, AAA) on whatever it sits on, and every border a reader relies on
(a field, a card, a code block, the focus outline, the citation and blockquote
rules) at 3:1 (1.4.11). Nothing a reader needs is drawn at reduced opacity.
That is a test rather than a claim: `src/web/theme-colors.test.ts` reads the
tokens out of the compiled stylesheet and computes the ratio of every pair the
design puts on screen, so a colour changed in `src/style.css` that breaks one
fails the build.

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
| `--color-error`           | `error`    | A field that will not do, and what the form says about it.             |

`--color-rule` is the one token in no contrast pair, because it is decoration:
a site that recolours it may make it as faint as it likes. Anything drawn with
`--color-edge` has to stay at 3:1 against the paper and the surface.

## Code highlighting

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
scope takes which slot. None of the light colours is the stock one: a syntax
theme is drawn for an editor, where a faint comment is a feature, and here code
is text like any other and meets 7:1 on its block, the bar every run of text
on the page meets. Each light colour was darkened along its own hue until it
did and no further, and four of the dark ones (the comment grey, the red, the
blue and the `base0F` brown) were lightened toward white the same way. Every one
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

## Videos

A YouTube or Vimeo URL on a line of its own in a post plays as the video
(decision-34; doc-2 lists the addresses it knows). The core renders it into the
body, so it reaches a theme inside `content` as:

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

It is one line in the real output. A Vimeo video is the same with
`video-embed-vimeo`, a `https://player.vimeo.com/video/ID?dnt=1` player and the
title `Vimeo video`. The core sets no style on it: with nothing from the theme
the player is the providers' standard 560 by 315.

**Paper** makes it responsive. `.video-embed iframe` takes the full width of
the text column at 16:9, with the rounded corners an image has, and the
figcaption takes the muted caption style every figure in a post has. A theme
that ships its own `static/style.css` writes that rule itself:

```css
.video-embed iframe {
  width: 100%;
  height: auto;
  aspect-ratio: 16 / 9;
}
```

The figcaption is the link a feed reader, a fediverse server or the embed view
keeps when it drops the iframe. A theme that would rather not show it on the
page can hide `.video-embed figcaption`; the feeds carry it either way.
