# Site settings

`/admin/settings` holds the values that are a site's own rather than a post's,
on six pages under the Settings menu: **General** (title, tagline, author, base
URL, time zone, language, the locale dates and counts are written in when
it is not the language, the site icon and the license), **Reading** (what the
homepage displays, posts per page, the notify server the feeds advertise),
**Permalinks** (the tag and category archive bases, and the archive redirects
already recorded), **Discussion** (comments and when they close, webmentions
sent and received, the Akismet key, and how long commenter emails, address
hashes and contact messages are kept), **Email** (how the site sends mail,
where a message written to it goes, and the security contact) and **Privacy**
(what the site shares of where a post was written, and every later privacy
choice). Federation's page is a seventh one of exactly the same kind, filed
under its own section at `/admin/federation/settings` rather than under
Settings, because the relays are about the section that holds the followers.
They live in `content/_data/site.json`, which is published with the site and
in git.

Nothing on those pages is an ActivityPub profile. Every user is an actor with a
name, a summary, a picture and links of their own, edited on that user's own
screen under `/admin/users`; saving one sends an `Update` of that actor to
their followers.

## `site.json` is the source

`content/_data/site.json` is the source of truth for a site's settings. Every
settings page reads that file, validates what was typed and writes it back;
nothing else remembers a setting, and `data/geekity.db` holds none of them.

Each page saves its own fields and no others, onto the file as re-read inside
the write, so two people saving two different pages at the same moment both
land, and each page validates only what it shows: a refused save comes back on
the page it was sent from and writes nothing at all.

The write is atomic and serialised: the bytes go to a temporary file beside the
real one and are renamed over it, and the read of what the file already held
and the write of what it says next are one step nothing else writing that file
can get between. So a reader — an Eleventy build, the CMS's own site data
source, another process entirely — always sees one whole version, and two saves
at once cannot each keep half of what the other kept.

The file carries `title`, `tagline`, `url`, `author` (a username, when the
site has one author), `postsPerPage`, `homepage`, `postsPage`,
`timezone`, `language`, `locale` (when it is set), `icon` (when it is set),
`license` and `licenseName` (when a license is chosen; see below), `tagBase`,
`categoryBase`, `notifyServer`, `feedUpdatePeriod`, `feedUpdateFrequency`,
`webmentionsSend`, `webmentionsReceive`,
`mailProvider`, `mailFromName`, `mailFromAddress`, `mailReplyTo`,
`contactEmail`, `securityContacts`, `securityPolicy`, `securityLanguages`,
`relays`, `menus` and `taxonomyRedirects`,
and every other key it already had is kept, `feedSize` and anything a site put
there included. A key it does not carry is the default, and a key of the wrong
type is the default too: a hand-edited `site.json` cannot take the site down.

An absent `notifyServer` is `https://rpc.rsscloud.io`, an empty one is
real-time notification turned off.

`homepage` and `postsPage` are the only two written just when they have a
value: the slug of the page served at `/` and the slug of the page whose own
URL carries the post listing, absent altogether on a site that shows its latest
posts at `/`. A `postsPage` without a `homepage` is
ignored, the listing being at `/` already, and a slug naming no published page
is a site back on its latest posts. See [The front page](#the-front-page).

Because it is the source rather than a copy, a save is on the public site and
in the feeds on the very next request, an Eleventy build of the same content
directory renders with the same values, and editing the file by hand while the
server runs is picked up on the next request — on the public site, in the feeds
and on the settings screen alike — with nothing to restart and nothing to tell.
Put the file in git and a checkout of it is the site's settings.

A site whose database was written by a version that kept the settings in SQLite
has those rows written into `site.json` on the first boot of this one, and the
table is dropped. If the file was written after the rows were — a hand edit, or
a content directory restored from git — the file wins outright.

## The base URL setting

The one exception is `url`. A base URL decides the absolute URLs in the feeds,
the ActivityStreams ids and whether the session cookie is `Secure`, so
`GEEKITY_BASE_URL` and a `baseUrl` in the config file both win over the file's,
and the General settings page renders the field read-only and says which value
is in effect and why. When neither names one, the file's `url` becomes the base URL
at boot — at boot rather than on save, so an `https` base URL cannot log out
the admin who submitted it over `http`.

## Credentials

Two things on that screen are not settings and are not in that file: the
Akismet key and the mail credential. Both are credentials, both live under
`data/` at mode `0600`, and each is its own pair of forms — save and remove —
so a key typed wrong cannot lose an edit to the title. See
[Akismet](comments.md#akismet) and [Email](email.md).

How the site sends email is a setting; the key or password that makes it work
is not. `mailProvider` picks `none`, Brevo's transactional API or any SMTP
server, and the From name, From address and reply-to go in `site.json` with
everything else — but the Brevo API key and the SMTP host, port, user and
password live in `data/mail.json` at mode `0600`, which is private and out of
git, and they have a pair of forms of their own on the Email page. Neither
secret is ever printed back into the page: the panel shows the last four
characters of the key and the host and user of the SMTP connection, and leaving
a secret blank keeps the one already stored. A **Send test email** button sends
a message through the whole chain and reports what the provider said, and with
no configuration at all nothing is sent and every feature that emails carries on
working. See [Email][email].

[email]: email.md

## Validation

Nothing is written until every field is valid, and a form with a problem comes
back with a 400 and one message under each field that has one:

| Field          | Has to be                                                                                   |
| -------------- | ------------------------------------------------------------------------------------------- |
| Title          | Not empty.                                                                                  |
| Base URL       | An absolute `http://` or `https://` URL. See [The base URL](configuration.md#the-base-url). |
| Time zone      | An IANA zone name `Intl` knows, such as `Europe/London`.                                    |
| Language       | A BCP 47 tag, such as `en` or `en-GB`. It is the page's `lang` and the feeds'.              |
| Posts per page | A whole number of one or more. It is what the home page and tag archives page by.           |
| Tag base       | One URL-safe path segment. See below.                                                       |
| Category base  | The same, and not the same word as the tag base.                                            |
| Relays         | One relay inbox per line, each an absolute `http://` or `https://` URL.                     |
| Notify server  | An absolute `http://` or `https://` URL, or empty for none. See below.                      |
| Mail provider  | `none`, `brevo` or `smtp`. See [Credentials](#credentials).                                 |
| From address   | An email address, or empty for `no-reply@` at the site's host.                              |
| Reply-to       | An email address, or empty to reply to the From address.                                    |

## The notify server and relays

The notify server is an [rssCloud][rsscloud] and [WebSub][websub] server, and
it defaults to `https://rpc.rsscloud.io`, which speaks both. Every feed
advertises it, and the site tells it whenever a feed changes, so a subscriber
hears about a post at once instead of on its next poll. Emptying the field
takes the advertisement out of every feed and stops the pings; a different URL
moves both. See [Real-time notification][notify].

A relay is a Mastodon-style hashtag or instance relay ([FEP-ae0c][fepae0c]) that
boosts every public post it is sent on to instances nobody here follows —
`https://tags.pub/user/_____relay_____/inbox` is one. Adding a line sends that
inbox a follow of the ActivityStreams Public collection; the relay answers, and
`/admin/federation` says where each subscription stands and offers a Retry for
one still waiting. Removing a line unfollows it. See
[Relays][relays].

[fepae0c]: https://w3id.org/fep/ae0c
[relays]: federation.md#relays
[rsscloud]: https://rpc.rsscloud.io/docs
[websub]: https://www.w3.org/TR/websub/
[notify]: feeds.md#real-time-notification

## The archive bases

The two archive bases decide where the taxonomy archives live: `/{tagBase}/{tag}/`
and `/{categoryBase}/{name}/`. They default to WordPress's `tag` and `category`,
so a site imported from WordPress keeps every archive URL it published. Each is
one path segment — up to 64 letters, digits, dashes or underscores, starting
with a letter or a digit — the two may not be the same word, and neither may
take a path the site already answers on: `page`, `feed`, `comments`, `admin`,
`theme`, `uploads`, `nodeinfo`, `author`, `inbox` or `search`. Saving one moves the archive, its paging, its
feeds, every link the theme renders and the `Hashtag` hrefs on the
ActivityStreams `Article` on the next request; the old base 404s.

An archive path matches its term without regard to case. A tag's archive lives
at its lower-case spelling, and a category's at the spelling the site uses, so
`/category/rsscloud/` and `/category/rsscloud/feed/` answer `301` at
`/category/rssCloud/` and `/category/rssCloud/feed/`. WordPress lower-cased
every slug, so this is what keeps an imported site's archive and feed URLs
working. Two categories that differ only in case stay apart, and each answers
at its own spelling. An archive path, a page of one, or a feed of one whose
term no published post carries is not an archive. That request goes on to the
recorded renames (`taxonomyRedirects`), then to the redirects in
`content/_data/redirects.json` and `content/_data/redirects/*.json`, and only
then answers 404. So a migration can send the archive of a category it
dropped, and each of its feeds, anywhere it likes.

## The time zone

The time zone is the one setting that changes what a page says rather than what
it holds. Every date the CMS writes into a file is a UTC instant ending in `Z`;
the setting is the lens it is read through — the editor shows and accepts
wall-clock time in that zone, the theme's `date` filter renders `readable`,
`html` and `year` in it, and a new post's filename day and `/{yyyy}/{mm}/`
permalink come from the calendar day that zone was on when it was saved.
Changing it moves what every page shows on the next request and moves nothing
on disk, and it cannot move a URL that already exists.
[Dates and the timezone setting](content.md#dates-and-the-timezone-setting)
has the whole rule.

## Site author

**Site author** on the General page says who the site is. It lists every
user by display name, and Several authors. A new site has several authors.
Choosing a user makes the site that person's, and the homepage speaks for them,
whether it lists posts or shows a static front page. It carries their
`rel="me"` profile links and links their author archive with `rel="me"`, as
`<link rel="me">` elements in the head. A homepage that lists posts also shows
their bio card; a static front page shows only its own title and words. The archive links back to the homepage with `rel="me"`, so the two
URLs are provably the same person. A Mastodon profile that links the homepage
then verifies, the homepage is their IndieAuth identity, and the structured
data names them as the site's publisher and what it is about. The footer and
the feeds credit them by display name. With Several authors, the homepage
speaks for nobody: it shows no bio and makes no `rel="me"` claims, the site
title stands in for a name in the footer and the feeds, and the structured
data has the site published by an Organization named for it. The bio always
links `/author/{username}/`, which stays the author's canonical page.

A link preview on Mastodon can credit the author, with a button to follow
them. Every post and page by a user carries
`<meta name="fediverse:creator" content="@username@host">`, which names that
user's own account on this site: the handle WebFinger answers for. The
homepage of a site with one author names that author. A page by nobody in
particular, such as a tag archive or the homepage of a site with several
authors, names nobody.

Mastodon shows the credit only when the account the tag names lists the
site's domain as one it may be credited from. A Mastodon account sets that
list under **Preferences > Public profile > Verification > Author
attribution**, by adding a domain such as `example.com`. Mastodon reads the
same list from a remote account's `attributionDomains`. The account this tag
names is the user's actor on this site, not a Mastodon account, so there is no
Mastodon setting to change. Every user's actor publishes `attributionDomains`
with the host of `baseUrl`, such as `example.com`, and so does the Update a
profile change sends. The port is left out, because Mastodon compares the list
with the shared link's host, which has none. A Mastodon server that fetched
the actor before this list existed reads it when it next refreshes the
account, or at once when the user saves their profile and the Update reaches
it.

`site.json` stores the chosen username as `author`, and has no `author` on a
site with several authors. **Breaking:** the free-text Author field and the
Solo author blog checkbox are gone, and `soloAuthor` is no longer read. An
`author` that names a user by username or display name keeps naming that user,
and the General page writes the username at its next save. An `author` that
names nobody, such as a free-text name, now makes a site with several authors:
its footer and feeds print the site title instead of the old name. decision-25
records the shape.

## Site icon

**Site icon** on the General page is the picture a browser tab, a home screen
and a search box show for the site. It takes the path of an image in the media
library, such as `/uploads/2026/10/icon.png`, the same form the Avatar field on
a user's screen takes. Use a square image at least 512 pixels wide: every icon
is cropped to the middle of it, and the largest one the web app manifest lists
is 512 pixels. From that one upload the site derives the 32 and 16 pixel
favicons and the 180 pixel `apple-touch-icon` the head links, `/favicon.ico`,
the 192, 512 and maskable 512 pixel icons in `/manifest.webmanifest`, and the
`Image` in `/opensearch.xml`. The page shows the current icon beside the field.
A full URL, a path outside `/uploads/`, a file that is not an image (PNG, JPEG,
GIF, WebP, AVIF, TIFF or SVG) and a path with no upload behind it are refused
with a message that says which, and nothing is saved. Clearing the field takes
the icon away.

`site.json` stores the path as `icon`, and has no `icon` when the field is
empty. A `site.json` written by hand with an `avatar` and no `icon` keeps using
the avatar as its icon. The field shows that avatar, and the next save of the
General page writes it as `icon`. With image optimization turned off, no icons
are derived and the site links none.

## License

**License** on the General page says what readers may do with the site's
posts. The choices are no license, which is the default and means all rights
reserved, one of the seven Creative Commons licenses (CC BY, BY-SA, BY-NC,
BY-NC-SA, BY-ND and BY-NC-ND at version 4.0, and CC0 1.0), or a custom license
with the URL of its terms and a name. A custom license without an `http://` or
`https://` URL, or without a name, is refused. With a license chosen, the
default theme's footer links it with `rel="license"`, the JSON-LD `WebSite`
and each `BlogPosting` or `Article` carry it as `license`, the Atom feed and
each entry carry a `link rel="license"`, and the RSS channel and each item
carry a `creativeCommons:license`. JSON Feed has no field for a license and
says nothing. With no license, none of these is printed.

`site.json` stores a Creative Commons choice as its key under `license`, such
as `"license": "cc-by-sa"`, and a custom license as its URL under `license`
with its name under `licenseName`. Neither key is written when there is no
license.

A post or page can name its own license in its front matter, and it then
applies to that post's footer, its JSON-LD and its feed items instead of the
site's. The value takes the same forms as `site.json`:

- `license: cc-by` names a Creative Commons license by its key, in any case.
- `license: https://example.com/terms` names a custom license, with
  `licenseName: House terms` beside it. Without a name, a Creative Commons URL
  is named by its deed and any other URL by itself.
- `license: none` is all rights reserved on that post, whatever the site says.

A value that is neither a key, an `http` or `https` URL, nor `none` is
ignored, and the post keeps the site's license.

## Location on posts

A Micropub app such as Quill can send where a post was written, and the
editor has a Location box for it: coordinates, their accuracy, and the place's
name, locality, region and country. The site keeps it in `data/locations.json`,
keyed by the post's permalink, at mode 0600. It is never written into the
post's file, so `content/` and its git history never carry it, whatever the
setting says (decision-29). An Eleventy build of the same `content/` prints no
location for the same reason.

Where the browser can share its position, the Location box has a **Use my
location** button. It fills Coordinates and Accuracy, and says in the box when
the browser refused, timed out or could not find a position. It does not fill
in the place's name: turning coordinates into a name means sending them to a
geocoding service somebody else runs, so those boxes stay typed by hand.

A Micropub `checkin`, which Swarm-style apps send, is kept the same way, with
the editor's A check-in box ticked. Only its venue's name, locality, region,
country and coordinates are kept, never its street address, postcode or URL.
Readers see it as any other location, under the same setting.

**Location on posts** on Settings > Privacy decides what readers see, and
takes effect on the next request for every post without rewriting one:

| Choice                   | `locationSharing` | What a reader sees                                                                                       |
| ------------------------ | ----------------- | -------------------------------------------------------------------------------------------------------- |
| Keep it, publish nothing | `none`            | Nothing. The default.                                                                                    |
| Publish the place only   | `place`           | The name, locality, region and country, never a coordinate. A post with coordinates alone shows nothing. |
| Publish the coordinates  | `exact`           | The words and the coordinates.                                                                           |

What is shared is printed inside the post's h-entry as `p-location`, an h-card
when the place is named, an h-adr for its words, an h-geo for coordinates
alone, and federates as an ActivityStreams `Place` on the post's object,
with `latitude`, `longitude` and `accuracy` only under `exact`. The feeds, the
JSON and Markdown representations, the JSON-LD, oEmbed, search and `llms.txt`
carry no location at any level. The post's author gets the whole location back
from `q=source` whatever the setting.

The same page says that location and camera metadata is always removed from
uploads, and names `geekity strip-metadata` for files uploaded before that was
so.

## The front page

`/` is the site's latest posts until the Reading settings say otherwise. The
choice is WordPress's own, and so are its two answers:

- **Your latest posts.** The archive at `/`, paginated at `/page/N/`. This is
  the default, and it is what an empty `homepage` means.
- **A static page.** The page is served at `/`, its own permalink answers `301`
  to `/` so the front page has one URL, and the menu links it at `/`. The
  default theme draws it with `layouts/front-page.njk`, which prints the
  page's own title and words and nothing else (decision-44). It lists no
  posts, prints no links and prints no bio.

A site that wants more on its front page, such as its newest posts or links
to its archives, overrides `layouts/front-page.njk` in its own theme. The
front page's context carries `newestPosts(count)`, a function that returns the
newest `count` published posts as the same entries a listing prints. Drafts,
future-dated, unlisted and trashed posts are left out. The theme chooses the
count, and the query runs only when the theme calls it. For example, this
override lists the five newest posts under the page's words:

```njk
{% extends "layouts/base.njk" %}

{% block content %}
<div class="page-body e-content">{{ content | safe }}</div>

<h2 class="section-title">Recent Posts</h2>
{% set posts = newestPosts(5) %}
{% set feedHeading = 3 %}
{% include "partials/post-list.njk" %}
{% endblock %}
```

On a solo author site the default theme's base layout puts the author's
`rel="me"` claims in the head of `/` as `<link rel="me">` elements, one for
their author archive and one for each profile link, whatever the front page
prints (decision-45). A static front page prints no h-card. A site that wants
its homepage to carry a representative h-card writes one in the homepage's
words, or includes `partials/bio.njk` with `bioHome` set in its override, as
[The front page](theme/page-shell.md#the-front-page) in the theme docs shows.

With a homepage set, a second pick gives the listing a page of its own: the
**posts page**. Its permalink carries the listing, with the page's own title
and words above the posts, paginated beneath it at `{permalink}page/N/`;
`/page/N/` at the root redirects there, and the theme's `layouts/posts-page.njk` is
the theme's override, falling back to the listing layout. A posts page with no
homepage is refused, as WordPress refuses it, and so is one page picked as
both. With a homepage and no posts page the listing has no page of its own,
which is WordPress's answer too.

The feeds do not move: `/feed/`, `/feed/atom/` and `/feed/json/` syndicate the
site's posts wherever the listing is read, and every page advertises them. The
sitemap follows the site — `/` once, and the listing's pages under the posts
page — and the pages list marks the two rows **Front Page** and **Posts Page**.

Both settings are page slugs in `content/_data/site.json`, so an Eleventy build
of the same directory shows the same front page:
`docs/eleventy.config.example.js` puts the homepage at `/` and flags the posts
page on the context as `isPostsPage`. A slug whose page is drafted, trashed or
deleted names nothing published, and the site is back to its latest posts with
the pick kept: publishing the page again puts the front page back.
