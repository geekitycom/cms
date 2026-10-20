# Site settings

`/admin/settings` holds the values that belong to the site, not to a post. It
has six pages under the Settings menu:

| Page           | What it holds                                                                                                                                                                                 |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **General**    | Title, tagline, author, base URL, time zone, language, the locale for dates and counts when it differs from the language, site icon and license.                                              |
| **Reading**    | What the homepage displays, posts per page, and the notify server the feeds advertise.                                                                                                        |
| **Permalinks** | The tag and category archive bases, and the archive redirects already recorded.                                                                                                               |
| **Discussion** | Comments, which types take them by default, and when they close, webmentions sent and received, the Akismet key, and how long commenter emails, address hashes and contact messages are kept. |
| **Email**      | How the site sends mail, where a message written to the site goes, and the security contact.                                                                                                  |
| **Privacy**    | What the site shares about where a post was written, and every later privacy choice.                                                                                                          |

Federation has a seventh page of the same kind at `/admin/federation/settings`.
It sits under the Federation section, not under Settings, because the relays
belong with the followers.

The settings live in `content/_data/site.json`, which is published with the
site and kept in git.

None of these pages edits an ActivityPub profile. Every user is an actor with
their own name, summary, picture and links. Edit those on the user's own screen
under `/admin/users`. Saving the profile sends an `Update` of that actor to the
user's followers.

## `site.json` is the source

`content/_data/site.json` is the source of truth for a site's settings. It is
the `site` namespace of the settings registry (see
[Runtime settings](#runtime-settings)): each setting has a name such as
`site.title` or `site.posts_per_page`, and the file keeps its own key for it,
such as `title` or `postsPerPage`. No other store holds a setting, and
`data/geekity.db` holds none.

Every settings page, the Navigation, Taxonomy and Connected apps screens, and
Appearance > Themes save through the registry. Each saves only its own
settings. The registry re-reads the file inside the write and applies the
change to that copy, so when two people save two different pages at the same
moment, both saves land. Each page validates only the fields it shows. A
refused save returns to the page it came from with status 400 and writes
nothing.

A setting that an environment variable or the config overrides is shown on its
page as the value in effect. The page lists each such setting and what sets
it, and a save neither checks nor writes it, so the override never reaches the
file.

The write is atomic and serialised:

- The server writes the bytes to a temporary file beside the real one and
  renames it over the real one.
- Reading the current file and writing the new one are a single step that no
  other writer of that file can interrupt.

A reader, whether an Eleventy build, the CMS's own site data source or another
process, always sees one complete version. Two saves at once cannot each keep
half of the other's changes.

The file holds these keys:

- `title`, `tagline`, `url`
- `author` (a username, when the site has one author)
- `postsPerPage`, `homepage`, `postsPage`
- `timezone`, `language`, `locale` (when set), `icon` (when set)
- `license` and `licenseName` (when a license is chosen, see [License](#license))
- `tagBase`, `categoryBase`
- `comments`, `commentsOnPosts`, `commentsOnPages`, `commentsCloseAfterDays`
  (see [Comments](comments.md))
- `notifyServer`, `feedUpdatePeriod`, `feedUpdateFrequency`
- `webmentionsSend`, `webmentionsReceive`
- `mailProvider`, `mailFromName`, `mailFromAddress`, `mailReplyTo`
- `contactEmail`, `securityContacts`, `securityPolicy`, `securityLanguages`
- `relays`, `menus` and `taxonomyRedirects`

A save writes every one of these keys, so the file always holds the whole set
of values in effect for a theme or an Eleventy build to read. It keeps every
other key already in the file, including `feedSize` and anything a site added,
and drops the retired `navigation` and `soloAuthor` keys. A missing key takes its default. A key of the wrong type
also takes its default, so a hand-edited `site.json` cannot take the site down.

A missing `notifyServer` means `https://rpc.rsscloud.io`. An empty
`notifyServer` turns real-time notification off.

`homepage` and `postsPage` are the only keys written only when they have a
value:

- `homepage` is the slug of the page served at `/`.
- `postsPage` is the slug of the page whose own URL carries the post listing.

Both are absent on a site that shows its latest posts at `/`. The server
ignores a `postsPage` without a `homepage`, because the listing is already at
`/`. A slug that names no published page puts the site back on its latest
posts. See [The front page](#the-front-page).

Because the file is the source and not a copy:

- A save appears on the public site and in the feeds on the next request.
- An Eleventy build of the same content directory renders with the same
  values.
- A hand edit to the file while the server runs takes effect on the next
  request, on the public site, in the feeds and on the settings screen, with no
  restart.

Put the file in git, and a checkout of it is the site's settings.

An older version kept the settings in SQLite. On the first boot of this
version, the server writes those rows into `site.json` and drops the table. If
the file was written after the rows, by a hand edit or a content directory
restored from git, the file wins outright.

## The base URL setting

`url` is the one exception. The base URL decides the absolute URLs in the
feeds, the ActivityStreams ids, and whether the session cookie is `Secure`.
`GEEKITY_BASE_URL` and a `baseUrl` in the config file both take precedence
over the file's `url`. In that case the General settings page shows the field
read-only and says which value is in effect and why.

When neither sets a value, the file's `url` becomes the base URL at boot. It
takes effect at boot, not on save, so saving an `https` base URL cannot log out
the admin who submitted it over `http`. IndieAuth and Micropub use the same
base URL as the rest of the site, so a new `url` reaches them at the next boot
too.

Every `geekity` command settles the base URL this way before it builds the
CMS. A site that calls `createCms` from its own entry file passes it
`await settleConfig(config)` for the same result; built from the plain config,
it uses `baseUrl` or the `http://localhost:<port>` fallback and `serve()` logs
that the setting was not applied.

## Credentials

Two groups of values on the settings screens are not in `site.json`: the
Akismet key and the mail credential. Both are credentials. They are the `mail`
and `akismet` [runtime settings](#runtime-settings), kept under `data/` at mode
`0600`. Each has its own pair of forms, save and remove, so a mistyped key
cannot lose an edit to the title. See [Akismet](comments.md#akismet) and
[Email](email.md).

How the site sends email is a setting. The key or password that makes it work
is not.

- `mailProvider` picks `none`, Brevo's transactional API or any SMTP server.
- The From name, From address and reply-to go in `site.json` with the other
  settings.
- The Brevo API key and the SMTP host, port, TLS flag, user and password are
  the `mail.*` settings, kept in `data/mail.json` at mode `0600`. That file is
  private and out of git. These values have their own pair of forms on the
  Email page.

A deployment can set any of them in the environment instead, as
`GEEKITY_MAIL__BREVO_API_KEY`, `GEEKITY_MAIL__SMTP_PASSWORD` or
`GEEKITY_AKISMET__KEY`. A value set there is in effect, the page says which
variable sets it, and the page refuses to store a value over it.

The page never prints either secret back. The panel shows the last four
characters of a stored key, and the host and user of the SMTP connection.
Leaving a secret blank keeps the stored one.

A **Send test email** button sends a message through the whole chain and
reports the provider's response. With no configuration, nothing is sent, and
every feature that sends email keeps working. See [Email][email].

[email]: email.md

## Validation

Nothing is written until every field is valid. A form with a problem returns a
400 with one message under each field that has one:

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

The notify server is an [rssCloud][rsscloud] and [WebSub][websub] server. It
defaults to `https://rpc.rsscloud.io`, which supports both. Every feed
advertises it, and the site pings it whenever a feed changes. A subscriber
learns about a post at once instead of on its next poll.

- Empty the field to remove the advertisement from every feed and stop the
  pings.
- Enter a different URL to move both to that server.

See [Real-time notification][notify].

A relay is a Mastodon-style hashtag or instance relay ([FEP-ae0c][fepae0c]). It
boosts every public post it receives to instances where nobody follows this
site. `https://tags.pub/user/_____relay_____/inbox` is one example.

- Adding a line sends that inbox a follow of the ActivityStreams Public
  collection. The relay answers.
- `/admin/federation` shows the state of each subscription and offers a Retry
  for one that is still waiting.
- Removing a line unfollows the relay.

The running site follows and unfollows when `site.relays` changes. A change
made with `geekity settings set site.relays` runs in another process, so the
site acts on it when it next starts.

See [Relays][relays].

[fepae0c]: https://w3id.org/fep/ae0c
[relays]: federation.md#relays
[rsscloud]: https://rpc.rsscloud.io/docs
[websub]: https://www.w3.org/TR/websub/
[notify]: feeds.md#real-time-notification

## The archive bases

The two archive bases set where the taxonomy archives live:
`/{tagBase}/{tag}/` and `/{categoryBase}/{name}/`. They default to WordPress's
`tag` and `category`, so a site imported from WordPress keeps every archive URL
it published.

Each base is one path segment of up to 64 letters, digits, dashes or
underscores, starting with a letter or a digit. The two cannot be the same
word. Neither can take a path the site already uses: `page`, `feed`,
`comments`, `admin`, `theme`, `uploads`, `nodeinfo`, `author`, `inbox` or
`search`.

Saving a base moves these on the next request:

- the archive and its paging
- its feeds
- every link the theme renders
- the `Hashtag` hrefs on the ActivityStreams `Article`

The old base returns 404.

An archive path matches its term case-insensitively. A tag's archive lives at
its lower-case spelling. A category's archive lives at the spelling the site
uses. For example, `/category/rsscloud/` and `/category/rsscloud/feed/` return
`301` to `/category/rssCloud/` and `/category/rssCloud/feed/`. WordPress
lower-cased every slug, so this keeps an imported site's archive and feed URLs
working. Two categories that differ only in case stay separate, and each
answers at its own spelling.

If no published post carries the term, an archive path, a page of one, or a
feed of one is not an archive. The server checks, in order:

1. the recorded renames (`taxonomyRedirects`)
2. the redirects in `content/_data/redirects.json` and
   `content/_data/redirects/*.json`
3. otherwise, it returns 404

A migration can therefore redirect the archive of a dropped category, and each
of its feeds, to any URL.

## The time zone

The time zone changes how a page displays dates, not what the files hold. Every
date the CMS writes into a file is a UTC instant ending in `Z`. The time zone
setting controls how the CMS displays and interprets those instants:

- The editor shows and accepts wall-clock time in that zone.
- The theme's `date` filter renders `readable`, `html` and `year` in it.
- A new post's filename day and `/{yyyy}/{mm}/` permalink come from the
  calendar day in that zone when the post was saved.

Changing the zone changes what every page shows on the next request. It
changes nothing on disk, and it cannot move a URL that already exists.
[Dates and the timezone setting](content.md#dates-and-the-timezone-setting)
has the whole rule.

## Site author

**Site author** on the General page sets who the site belongs to. It lists
every user by display name, plus Several authors. A new site has several
authors.

When you choose a user, the site becomes that person's, and the homepage
represents them, whether it lists posts or shows a static front page:

- The head of the homepage has `<link rel="me">` elements for their profile
  links and their author archive.
- A homepage that lists posts also shows their bio card. A static front page
  shows only its own title and words.
- The author archive links back to the homepage with `rel="me"`, so the two
  URLs verifiably belong to the same person.
- A Mastodon profile that links the homepage then verifies, and the homepage is
  their IndieAuth identity.
- The structured data names them as the site's publisher and its subject.
- The footer and the feeds credit them by display name.

With Several authors, the homepage represents nobody:

- It shows no bio and has no `rel="me"` links.
- The site title replaces a name in the footer and the feeds.
- The structured data says the site is published by an Organization with the
  site's name.

The bio always links `/author/{username}/`, which stays the author's canonical
page.

A link preview on Mastodon can credit the author, with a button to follow
them. Every post and page by a user carries
`<meta name="fediverse:creator" content="@username@host">`. It names that
user's own account on this site, the handle WebFinger answers for. On a site
with one author, the homepage names that author. A page by no particular user,
such as a tag archive or the homepage of a site with several authors, names
nobody.

Mastodon shows the credit only when the named account lists the site's domain
as one it may be credited from. A Mastodon account sets that list under
**Preferences > Public profile > Verification > Author attribution**, by adding
a domain such as `example.com`. Mastodon reads the same list from a remote
account's `attributionDomains`.

The account the tag names is the user's actor on this site, not a Mastodon
account, so there is no Mastodon setting to change. Every user's actor
publishes `attributionDomains` with the host of `baseUrl`, such as
`example.com`. The `Update` that a profile change sends includes it too. The
port is left out, because Mastodon compares the list with the shared link's
host, which has no port. A Mastodon server that fetched the actor before this
list existed reads it the next time it refreshes the account, or immediately
when the user saves their profile and the `Update` arrives.

`site.json` stores the chosen username as `author`. A site with several authors
has no `author`.

**Breaking:** the free-text Author field and the Solo author blog checkbox are
gone, and the server no longer reads `soloAuthor`.

- An `author` that names a user by username or display name keeps naming that
  user. The General page writes the username at its next save.
- An `author` that names nobody, such as a free-text name, now means a site
  with several authors. Its footer and feeds print the site title instead of
  the old name.

decision-25 records the shape.

## Site icon

**Site icon** on the General page sets the picture that a browser tab, a home
screen and a search box show for the site. It takes the path of an image in the
media library, such as `/uploads/2026/10/icon.png`. The Avatar field on a
user's screen takes the same form.

Use a square image at least 512 pixels wide. The CMS crops every icon from the
middle of the image, and the largest icon the web app manifest lists is 512
pixels. From that one upload, the site derives:

- the 32 and 16 pixel favicons and the 180 pixel `apple-touch-icon` that the
  head links
- `/favicon.ico`
- the 192, 512 and maskable 512 pixel icons in `/manifest.webmanifest`
- the `Image` in `/opensearch.xml`

The page shows the current icon beside the field.

The field refuses these values, with a message that says which problem it
found, and saves nothing:

- a full URL
- a path outside `/uploads/`
- a file that is not an image (PNG, JPEG, GIF, WebP, AVIF, TIFF or SVG)
- a path with no upload behind it

Clear the field to remove the icon.

`site.json` stores the path as `icon`. It has no `icon` when the field is
empty. If a hand-written `site.json` has an `avatar` and no `icon`, the site
uses the avatar as its icon. The field shows that avatar, and the next save of
the General page writes it as `icon`. With image optimization turned off, the
site derives no icons and links none.

## License

**License** on the General page sets what visitors may do with the site's
posts. The choices are:

- no license, the default, which means all rights reserved
- one of the seven Creative Commons licenses: CC BY, BY-SA, BY-NC, BY-NC-SA,
  BY-ND and BY-NC-ND at version 4.0, and CC0 1.0
- a custom license, with the URL of its terms and a name

A custom license without an `http://` or `https://` URL, or without a name, is
refused.

With a license chosen, the site publishes it in these places:

- The default theme's footer links it with `rel="license"`.
- The JSON-LD `WebSite` and each `BlogPosting` or `Article` carry it as
  `license`.
- The Atom feed and each entry carry a `link rel="license"`.
- The RSS channel and each item carry a `creativeCommons:license`.

JSON Feed has no field for a license and says nothing. With no license, none of
these appear.

`site.json` stores a Creative Commons choice as its key under `license`, such
as `"license": "cc-by-sa"`. It stores a custom license as its URL under
`license`, with its name under `licenseName`. Neither key is written when there
is no license.

A post or page can name its own license in its front matter. That license then
applies to the post's footer, its JSON-LD and its feed items instead of the
site's. The value takes the same forms as `site.json`:

- `license: cc-by` names a Creative Commons license by its key, in any case.
- `license: https://example.com/terms` names a custom license, with
  `licenseName: House terms` beside it. Without a name, a Creative Commons URL
  is named by its deed and any other URL by itself.
- `license: none` is all rights reserved on that post, whatever the site says.

The server ignores any other value, and the post keeps the site's license.

## Location on posts

A Micropub app such as Quill can send where a post was written. The editor has
a Location box for it: coordinates, their accuracy, and the place's name,
locality, region and country.

The site keeps the location in `data/locations.json`, keyed by the post's
permalink, at mode 0600. The server never writes it into the post's file, so
`content/` and its git history never contain it, whatever the setting says
(decision-29). For the same reason, an Eleventy build of the same `content/`
prints no location.

When the browser can share its position, the Location box has a **Use my
location** button. It fills Coordinates and Accuracy. If the browser refused,
timed out or could not find a position, the box says so. The button does not
fill in the place's name. Turning coordinates into a name means sending them to
a third-party geocoding service, so you type those boxes by hand.

A Micropub `checkin`, which Swarm-style apps send, is stored the same way, with
the editor's A check-in box ticked. The server keeps only the venue's name,
locality, region, country and coordinates, never its street address, postcode
or URL. Visitors see a check-in like any other location, under the same
setting.

**Location on posts** on Settings > Privacy decides what visitors see. A change
takes effect on the next request for every post, without rewriting any file:

| Choice                   | `locationSharing` | What a reader sees                                                                                       |
| ------------------------ | ----------------- | -------------------------------------------------------------------------------------------------------- |
| Keep it, publish nothing | `none`            | Nothing. The default.                                                                                    |
| Publish the place only   | `place`           | The name, locality, region and country, never a coordinate. A post with coordinates alone shows nothing. |
| Publish the coordinates  | `exact`           | The words and the coordinates.                                                                           |

The shared location appears inside the post's h-entry as `p-location`:

- an h-card when the place has a name
- an h-adr for its words
- an h-geo for coordinates alone

It federates as an ActivityStreams `Place` on the post's object. `latitude`,
`longitude` and `accuracy` appear only under `exact`.

These carry no location at any setting: the feeds, the JSON and Markdown
representations, the JSON-LD, oEmbed, search and `llms.txt`. The post's author
always gets the whole location back from `q=source`, whatever the setting.

The same page says that the server always removes location and camera metadata
from uploads. For files uploaded before that change, it links to the sweep on
**Tools > Maintenance** and names `geekity strip-metadata`.

## The front page

`/` shows the site's latest posts until the Reading settings say otherwise. The
choice and its two options come from WordPress:

- **Your latest posts.** The archive at `/`, paginated at `/page/N/`. This is
  the default, and an empty `homepage` means this option.
- **A static page.** The page is served at `/`. Its own permalink returns `301`
  to `/`, so the front page has one URL, and the menu links it at `/`. Its
  Markdown and JSON are at `/index.md` and `/index.json`, and the same
  representations under its permalink redirect there. See
  [Content negotiation](public-site.md#content-negotiation). The
  default theme renders it with `layouts/front-page.njk`, which prints only the
  page's own title and words (decision-44). It lists no posts, prints no links
  and prints no bio.

To show more on the front page, such as the newest posts or links to the
archives, override `layouts/front-page.njk` in your own theme. The front page's
context has `newestPosts(count)`. This function returns the newest `count`
published posts as the same entries a listing prints. It leaves out drafts and
future-dated, unlisted and trashed posts. The theme chooses the count, and the
query runs only when the theme calls the function. This override lists the five
newest posts under the page's words:

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

On a solo author site, the default theme's base layout puts the author's
`rel="me"` links in the head of `/` as `<link rel="me">` elements: one for
their author archive and one for each profile link. This happens whatever the
front page prints (decision-45). A static front page prints no h-card. To give
the homepage a representative h-card, write one in the homepage's words, or
include `partials/bio.njk` with `bioHome` set in your override. See
[The front page](theme/page-shell.md#the-front-page) in the theme docs.

With a homepage set, a second choice gives the listing its own page: the
**posts page**.

- Its permalink carries the listing, with the page's own title and words above
  the posts.
- The listing is paginated beneath it at `{permalink}page/N/`.
- `/page/N/` at the root redirects there.
- The theme's `layouts/posts-page.njk` overrides its layout, falling back to
  the listing layout.

A posts page with no homepage is refused, as WordPress refuses it. The same
page chosen as both is also refused. With a homepage and no posts page, the
listing has no page of its own, which matches WordPress.

The feeds do not move. `/feed/`, `/feed/atom/` and `/feed/json/` syndicate the
site's posts wherever the listing is, and every page advertises them. The
sitemap follows the site: it lists `/` once and puts the listing's pages under
the posts page. The pages list marks the two rows **Front Page** and **Posts
Page**.

Both settings are page slugs in `content/_data/site.json`, so an Eleventy build
of the same directory shows the same front page.
`docs/eleventy.config.example.js` puts the homepage at `/` and flags the posts
page on the context as `isPostsPage`.

If the chosen page is drafted, trashed or deleted, the slug names nothing
published. The site goes back to its latest posts and keeps the choice.
Publishing the page again restores the front page.

## Runtime settings

Some settings change how a running site behaves rather than what it says, and
the admin's settings pages do not hold them. They are kept in one settings
registry (decision-53). Each setting is named `namespace.key`, and each
namespace keeps its values in one file under `data/`:

| Setting              | File                    | What it does                                                                                               |
| -------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------- |
| `maintenance.on`     | `data/maintenance.json` | Answer 503 to the public site, feeds and inboxes. See [Maintenance mode](public-site.md#maintenance-mode). |
| `maintenance.until`  | `data/maintenance.json` | When the site is expected back, as an instant. Sent as `Retry-After`.                                      |
| `dev_mode.on`        | `data/dev-mode.json`    | Hold every outbound side effect. See [Dev mode](deploying.md#dev-mode).                                    |
| `mail.brevo_api_key` | `data/mail.json`        | Brevo's API key. Secret. See [Email](email.md).                                                            |
| `mail.smtp_host`     | `data/mail.json`        | The SMTP server. Empty means no server.                                                                    |
| `mail.smtp_port`     | `data/mail.json`        | The SMTP port, 587 by default. 465 needs `mail.smtp_secure` true, and 587 needs it false.                  |
| `mail.smtp_secure`   | `data/mail.json`        | Whether the SMTP connection is TLS from the first byte.                                                    |
| `mail.smtp_user`     | `data/mail.json`        | The SMTP username.                                                                                         |
| `mail.smtp_password` | `data/mail.json`        | The SMTP password. Secret.                                                                                 |
| `akismet.key`        | `data/akismet.json`     | The Akismet API key. Secret. See [Akismet](comments.md#akismet).                                           |
| `akismet.status`     | `data/akismet.json`     | What Akismet said about the key when it was last checked: `valid`, `invalid` or `unchecked`.               |
| `akismet.checked_at` | `data/akismet.json`     | When the key was last checked.                                                                             |

The value in effect is the first of these that is set:

1. The environment variable `GEEKITY_<NAMESPACE>__<KEY>`, such as
   `GEEKITY_MAINTENANCE__UNTIL` or `GEEKITY_MAIL__SMTP_PASSWORD`.
   `dev_mode.on` has none.
2. A config field that overrides the setting. `maintenance` in the config, or
   `GEEKITY_MAINTENANCE`, overrides `maintenance.on`.
3. The value stored in the file.
4. The default.

A setting that the environment or the config overrides cannot be changed from
the admin or the command line. The save is refused with a sentence that names
the source, such as
`maintenance.on is set by GEEKITY_MAINTENANCE and cannot be changed here.`
Remove the variable or the field and restart the site first.

The site's own settings are the `site` namespace, kept in
`content/_data/site.json` and described in
[`site.json` is the source](#sitejson-is-the-source). Their variables are
`GEEKITY_SITE__<KEY>`, such as `GEEKITY_SITE__TAGLINE`. `site.base_url` is also
overridden by `GEEKITY_BASE_URL` and the config's `baseUrl` (see
[The base URL setting](#the-base-url-setting)).

Tools > Maintenance and Tools > Dev mode in the admin are the switches for
the first three settings. The Email and Discussion settings pages save the
`mail` and `akismet` settings.
`data/mail.json` and `data/akismet.json` written by a version before the
registry are read in their old shape and stored in the new one on the next
save. `geekity settings` reads and writes every one of them:

```
$ geekity settings list
maintenance.on     false  default                   Answer 503 to the public site, feeds and inboxes.
maintenance.until         default                   When the site is expected back, as an instant. Sent as Retry-After.
dev_mode.on        false  default, not overridable  Hold every outbound side effect and record it in data/dev-mode.jsonl.
$ geekity settings set maintenance.until 2026-10-14T09:00:00Z
maintenance.until  2026-10-14T09:00:00.000Z  file  When the site is expected back, as an instant. Sent as Retry-After.
$ GEEKITY_MAINTENANCE=on geekity settings get maintenance.on
true
overridden by env GEEKITY_MAINTENANCE; the file holds false
$ geekity settings set maintenance.until --unset
```

`geekity settings list site` prints the `site` namespace alone, and `get` and
`set` take its settings like any other:

```
$ geekity settings get site.title
Geekity Demo
$ geekity settings set site.posts_per_page 5
site.posts_per_page  5  file  How many posts a listing page holds.
$ GEEKITY_SITE__TAGLINE=Hello geekity settings set site.tagline Goodbye
site.tagline is set by GEEKITY_SITE__TAGLINE and cannot be changed here.
```

In `list site` the value column is as wide as the longest value, which for
`site.menus` is every menu as JSON. `get` reads one setting more easily.

Turning `site.index_now` on, from the admin or the command line, also stores a
new `site.index_now_key` when the site has none. The site does the same at boot
when IndexNow is on, from `site.json` or `GEEKITY_SITE__INDEX_NOW`, and there is
no key. A key that the environment sets is never written to the file.

`list` prints each setting with its value in effect, where that value came
from, and what the setting does. When something overrides the file, `list`
adds what the file holds, as in `env GEEKITY_MAINTENANCE (file: false)`.
`list <namespace>` prints one namespace. `set` checks the value before it
writes anything, and exits 1 with the reason when the value is not valid or an
override is in effect. `--unset` removes the stored value so the default
applies. A secret setting prints as `(set)` or `(not set)`, never as its value.
A secret given to `set` stays in the shell history.

Each running plugin's settings follow the core ones, named by the package
name, as in `@geekity/plugin-llm.default_model`. `set` writes them to
`data/plugins/<name>/settings.json`, or `secrets.json` for a secret. A plugin
that the server would not run, because it is not enabled, did not load or
needs a plugin that is not running, is named in a warning and its settings are
not listed. [Plugins and hooks](plugins.md) has more.

`geekity maintenance` and `geekity dev-mode` are shorter ways to change the
same settings, and they print the same sentences as before.
