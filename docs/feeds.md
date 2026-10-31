# Feeds

The site publishes its recent posts in three formats, at the URLs WordPress
uses. A site that moves off WordPress keeps every subscriber it had.

| URL                      | Format                                           |
| ------------------------ | ------------------------------------------------ |
| `/feed/`                 | RSS 2.0 (`application/rss+xml`)                  |
| `/feed/atom/`            | Atom 1.0 (`application/atom+xml`)                |
| `/feed/json/`            | JSON Feed 1.1 (`application/feed+json`)          |
| `/tag/{tag}/feed/`       | One tag archive, in RSS; `atom/` and `json/` too |
| `/category/{name}/feed/` | One category archive, the same three             |
| `/comments/feed/`        | Every reply the site has been sent, in RSS       |
| `{permalink}feed/`       | One post's replies, in RSS                       |
| `/replies/{key}/`        | One item's direct replies, in RSS                |

`/feed/` is RSS because nearly every existing subscriber holds an RSS feed. The
two archive bases are settings (`tagBase`, `categoryBase`). The per-archive
feeds move with the archives.

WordPress's older spellings redirect with `301`, not 404:

- `/feed/rss/` redirects to `/feed/`.
- `?feed=rss2`, `?feed=rss`, `?feed=atom` and `?feed=json` on any listing
  redirect to that listing's feed.
- `?feed=rss2` or `?feed=rss` on a post's permalink redirects to that post's
  comments feed.

A feed URL without its trailing slash redirects to the canonical one in a
single hop.

A feed holds the newest published posts, newest first. Drafts, documents in the
trash, pages and wiki pages are never in a feed. A term that no published post carries
answers 404, not an empty feed. `feedSize` in `content/_data/site.json` sets
how many entries a feed holds. The default is 20, which is more than an archive
page on purpose. A feed reader that polls once a day then does not miss a post
on a site that publishes several a day.

```json
{ "title": "My Site", "tagline": "Notes", "author": "me", "feedSize": 20 }
```

Every RSS feed, including the comments feeds, tells feed readers how often to
poll it, with the Syndication module's `sy:updatePeriod` and
`sy:updateFrequency`. Settings → Reading sets both, as these keys in
`site.json`:

| Key                   | Values                                             | Default  |
| --------------------- | -------------------------------------------------- | -------- |
| `feedUpdatePeriod`    | `hourly`, `daily`, `weekly`, `monthly` or `yearly` | `hourly` |
| `feedUpdateFrequency` | A whole number, 1 or more                          | `1`      |

The defaults match what WordPress declares, so the subscribers of a migrated
site keep polling as they did. A feed reader may poll less often when a feed
stays quiet much longer than it says. A site that posts weekly should set
`weekly`. Atom and JSON Feed have no element for the poll interval.

## What every format says about a post

The three formats render one **feed item**. The site derives it once per post,
so the formats do not each read the file. They agree about the facts below.

**Identity.** The site names a post by the first of these that it has:

1. the `guid` its front matter sets, when that parses as a URL
2. the `activitypub.id` the front matter stores for a post migrated from
   elsewhere
3. its permalink (see [Federation](federation.md))

That name is RSS's `guid`, Atom's `id`, and JSON Feed's `id`. The permalink is
always the link: RSS's `link`, Atom's `link rel="alternate"`, and JSON Feed's
`url`. For every post created on this CMS the two are the same URL. They differ
only for a post that carries a stored id or a `guid`. A migrated post keeps the
name its WordPress subscribers already hold this way. RSS's `isPermaLink` says
which of the two a `guid` is. It is `true` only when the `guid` equals the
permalink, and `false` for anything else, such as a stored `?p=813`.

**Terms.** Every format lists the post's categories and then its tags, in file
order, as one flat list: RSS's `category` elements, Atom's `category term`
attributes, and JSON Feed's `tags`. None of the three can say which vocabulary
a term came from. WordPress publishes both the same way.

**Summary.** Every format summarises a post the same way:

- the `description` front matter, when the post has one, because the author
  wrote it for this purpose
- otherwise, the first paragraph of the rendered body, stripped to plain text
  and cut at 55 words, which is WordPress's excerpt length. A review's summary
  opens with what it reviews, its details and the rating, such as
  `Review of Severance (TV show). Season 2. Rated 4 out of 5.`

The summary is RSS's `description`, Atom's `summary`, and JSON Feed's
`summary`. It is left out only when the post has nothing to summarise. The
whole post goes in the content element beside it, so a feed reader that shows
both has two versions to choose from.

**Replies.** A post whose `in-reply-to` front matter is an absolute `http` or
`https` URL is a reply. Atom and JSON Feed name the URL it answers. An Atom
entry carries RFC 4685's `<thr:in-reply-to ref="…" href="…"/>`, with the target
URL as both its identity and its location. Every Atom feed declares
`xmlns:thr="http://purl.org/syndication/thread/1.0"`.

JSON Feed 1.1 has no reply field. A JSON Feed item carries the target in an
extension object. The spec allows an extension under any key that starts with
an underscore, and tells feed readers that do not know the key to ignore it:

```json
{
  "id": "…",
  "url": "…",
  "content_html": "…",
  "_geekity": { "in_reply_to": "https://example.net/notes/1" }
}
```

The key is `_geekity` because an extension is named after its publisher.
`in_reply_to` is the JSON spelling of the microformats `in-reply-to` property.
A post that is not a reply, or whose `in-reply-to` is not such a URL, carries
neither element. RSS 2.0 has no equivalent element, so an RSS item carries the
target as the [source namespace][source-ns]'s `<source:inReplyTo>`.

**Languages.** Every feed declares the site's `language` once: RSS as the
channel's `language`, Atom as the feed's `xml:lang`, and JSON Feed as its
`language`. A post whose `lang` front matter names another language declares it
on its own item: RSS as `dc:language`, Atom as `xml:lang` on the `entry`, and
JSON Feed as the item's `language`. A post in the site's language, or whose
`lang` is not a language tag, adds nothing.

**Reviews.** A review's item and rating print in every format's content before
the photos and the body: the item's picture as a plain `<img>` absolute on the
site's base URL, a sentence saying what it reviews, and the rating as stars and
as words such as "Rated 4 out of 5". The page prints the same block, with the
picture responsive.

**Photos.** A post's `photo` front matter prints in every format's content,
before the body. The page prints it in the same place. Each photo is a plain
`<figure><img src alt></figure>` of the original upload, never the responsive
variants, because a feed reader cannot resolve those (decision-10). Its `src`
is absolute on the site's base URL. Its `alt` is the post's own text, else the
media library's, else empty. A photo-only post therefore reads in a feed reader
as its photos. JSON Feed also names the item's main image as `image`: the
post's `image` front matter, else its first photo. A photo is never an RSS
`enclosure`, an Atom `rel="enclosure"` link, or a JSON Feed attachment. Those
carry a recording only.

## RSS 2.0

The channel carries:

- `title`
- `link`
- `description` (the tagline)
- `language` (the `language` setting, `en` by default)
- `lastBuildDate`
- `generator`
- an `atom:link rel="self"`
- the three notify-server elements described under
  [Real-time notification](#real-time-notification)
- an `image` built from the avatar, when the site has one

An item carries:

- `title`
- `link`
- `guid`
- `pubDate` in RFC 822
- `dc:creator`, from the post's author or the site's
- one `category` per term
- `description`, holding the summary
- `content:encoded`, holding the whole rendered post
- `source:markdown`, holding the Markdown the post was written from
- `source:inReplyTo`, holding the URL it answers, on a reply only

The `guid`, the terms, and the summary are the ones described above.

`source:inReplyTo` also carries `feedUrl` and `feedTitle`, which name the feed
that holds the item it answers. RSS.chat clients follow `feedUrl` to the other
side of a conversation. The site finds that feed as follows:

- A post or page on this site: a listed post is in the site feed `/feed/`,
  titled with the site's title. A page is in no feed.
- A comment or reply on this site: the comments feed of the post it is on,
  `{permalink}feed/`, titled `Comments on: {post}`.
- A page on another site: the site reads the page when it fetches the reply
  context. If the page links an RSS feed with `rel="alternate"`, the site
  fetches that feed and looks for an item whose `guid` or `link` is the page.
  The item's RSS 2.0 `<source url>` and its text name the feed, when the item
  has one. Otherwise the feed's URL and its channel `title` do. rss.chat
  publishes a site-wide feed whose items point to each author's own feed this
  way.

Each attribute is left out when the site does not know it: the page links no
RSS feed, the feed holds no such item, or the feed has no title. Mastodon
status pages link no RSS feed, so a reply to a toot carries neither.

`source:markdown` is from Dave Winer's [source namespace][source-ns]. A feed
reader that understands Markdown should render from it, not from
`content:encoded`. It is the same text the ActivityStreams `Article` carries as
its `source`.

Every item also says where its comments are:

- `comments` is the page to read them on.
- `wfw:commentRss` (the [Well-Formed Web][wfw-ns] comment API) is the feed of
  the whole thread to poll.
- `source:comments` appears on a post with replies. Its `count` is how many
  replies answer the post directly. Its `feedUrl` is the post's
  `/replies/{key}/` feed, which holds only those replies (see
  [Walking a thread](#walking-a-thread)). A post with no replies carries no
  `source:comments`.

When the site has a license (Settings > General, or `license` in `site.json`),
the channel carries a `creativeCommons:license` holding its URL. Every item
carries one for its own license: the post's `license` front matter, else the
site's. A post whose front matter says `license: none` carries none. The
element is the [Creative Commons RSS module][cc-rss], declared as
`xmlns:creativeCommons` only when some license is printed. It names a license
by URL, Creative Commons or not, so a feed reader can act on it. `dc:rights`
would be free text. A site with no license, and posts without one, print
nothing about a license.

RSS has no element for "no license". On a licensed site, a post with
`license: none` carries no item license, but the channel still names the
site's. A feed reader that applies the channel's license to every item reads
that post as under the site's license.

[source-ns]: https://source.scripting.com/
[wfw-ns]: http://wellformedweb.org/CommentAPI/
[cc-rss]: https://cyber.harvard.edu/rss/creativeCommonsRssModule.html

## Comments

The comments feeds publish a document's conversation, at the same URLs
WordPress uses: `{permalink}feed/` for one post or page, and `/comments/feed/`
for the whole site. Both read the same conversation the page shows under the
post, so they carry what a visitor sees there:

- native comments left through the form, once a moderator approves them
- webmention replies and mentions
- fediverse replies: a `Create` of a `Note` whose `inReplyTo` names the post
  or a reply under it (see [Federation](federation.md)), and the quotes of a
  post that its author approved
- reply posts written on this site that answer the post or a reply under it

The feeds carry replies and mentions only. Likes, boosts, and reposts have no
text. The page shows and counts them, but they are in no feed, and no
`source:comments` count includes them. A post answered only with reactions
advertises no replies feed. The page shows an RSVP to an event with the people
answering, not in the thread, so an RSVP is in no feed either, with or without
text. An RSVP sent to a post that is not an event is a reply like any other.
Neither feed carries a [migrated comment](comments.md#migrated-comments).

Both feeds are RSS 2.0 only. A comments feed has no Atom or JSON version, so
`{permalink}feed/atom/` answers 404.

- A post or a page has a comments feed whether or not it still takes
  comments, and `/comments/feed/` carries what was said on either. The page
  chosen as the posts page is the exception: it shows the post listing rather
  than its own content, so `{permalink}feed/` there answers 404.
- A document with no replies answers an empty feed, not a 404. The document
  exists, and a feed reader that subscribed before the first reply should keep
  polling.
- A permalink that is not a published document answers 404 like any other.

The page advertises its own feed with a
`<link rel="alternate" type="application/rss+xml">` in its `<head>`.

A channel carries the usual `title` (`Comments on: {post}`), `link`,
`description`, `language`, `lastBuildDate`, `generator`, and
`atom:link rel="self"`. It also carries the same notify-server elements as
every other feed. An item carries:

- the author's name, as its `title` and `dc:creator`
- the reply's `url`, as its `link`. A comment left through the form links to
  its own page at `/comment/{key}/`.
- a `guid`
- the `published` time the reply gave, or the time it arrived if it gave none
- `description`, holding a plain-text excerpt
- `content:encoded`, holding the reply

The `guid` depends on the kind of reply:

| Reply                         | `guid`                         |
| ----------------------------- | ------------------------------ |
| Comment left through the form | Its page, `isPermaLink="true"` |
| Fediverse note                | Its id                         |
| Webmention                    | Its source URL                 |
| Reply post                    | Its object id                  |

A migrated comment is in neither feed, so its old `guid` does not need to
survive the move. `isPermaLink` is `true` when the `guid` is the `link`, and
only then.

Each item also carries, from the [source namespace][source-ns]:

- `source:inReplyTo`, the `guid` of what it answers in these feeds. For an
  answer to the post, that is the post's feed `guid`. Otherwise it is the
  `guid` of the reply it answers. A reply can sit under a comment that visitors
  cannot see, because it is waiting for a moderator, is spam, or is deleted.
  That reply names the nearest visible reply above it, or the post, and counts
  as that one's reply. It has `isPermaLink="false"` when that `guid` is not
  the item's page, as `guid` itself does. It also has `feedUrl` and
  `feedTitle`: the site feed for an answer to a listed post, nothing for an
  answer to a page, and the post's comments feed for an answer to a reply.
- `source:comments`, only on an item with replies. `count` is how many replies
  answer it directly, and `feedUrl` is its `/replies/` feed.
- `<source url="…">Name</source>`, the core RSS element, when the site knows a
  feed for the author. That is a webmention author's `h-card` URL or site, or a
  site user's author feed `/author/{username}/feed/`. A comment left through
  the form and a fediverse reply carry none.

On the site-wide feed the title also names the post or page: `{author} on
{post}`, or `{author} replying to {parent author} on {post}` for an answer to
another visible reply.

A fediverse reply's author is named by the profile the site stored when that
actor followed the site. Otherwise the name is the `@user@host` that the
actor's own URL implies. The site does not dereference the actor for a better
name, because that would cost a network round trip per comment shown.

**The site sanitises a reply's HTML before it publishes it.** A stranger wrote
the markup, so the site tokenises it and rebuilds it from an allowlist:

- `p`, `br`, `a`, `em`, `strong`, `del`, `code`, `pre`, `blockquote`, and the
  list elements are kept.
- `script` and `style` are dropped, with their contents.
- Every other element is unwrapped, and its text is kept.
- Every attribute is removed except an `a`'s `href`. The `href` must be
  `http`, `https`, or `mailto`, and the link gets
  `rel="nofollow noopener noreferrer"`.

`sanitizeCommentHtml` is exported for a site that shows comments in its own
templates.

When a document is unpublished or moved to the trash, its replies disappear
from `/comments/feed/`, and the document's own feed answers 404. `feedSize`
caps both feeds.

## Walking a thread

`{permalink}feed/` is the whole thread, flat. That is what WordPress publishes
and what `wfw:commentRss` points at. A program that wants the tree walks it one
level at a time instead. Dave Winer's [rss.chat][rss-chat] reads conversations
this way:

1. Start at a post item's `source:comments`. It points to a feed of the replies
   that answer the post directly.
2. Each of those items has its own `source:comments`, which points to the
   replies that answer it.
3. Continue until an item has no `source:comments`.

The walk reaches every visible reply once.

Each of those feeds is `/replies/{key}/`, RSS 2.0, newest first. Its items have
the same shape as the comments feeds. It carries replies only. A mention
answers nothing in the thread, and a like, a boost, a repost, or an event's
RSVP is in no feed.

A comment's key is its id (see [Keys](comments.md#keys)). For a post, a page, a
fediverse reply, or a reply post, the key is the first 16 hex digits of the
SHA-256 of its feed `guid`. A document has no id of its own, and slugs are not
unique across posts and pages.

- An item with no replies answers an empty feed.
- A segment that is not a key, or a key that names nothing visible, answers 404.
- A migrated comment's feed still answers, with the native replies under it,
  though no feed links to it.

[rss-chat]: https://github.com/scripting/rss.chat

## Atom and JSON Feed

An Atom entry carries:

- `id` (the post's object id)
- `title`
- `updated`
- `published`
- `link rel="alternate"` (the permalink)
- an `author`, when the front matter names one
- a `category` per term
- a `summary`
- the whole rendered post, as `content type="html"`

The Atom feed carries:

- `id`
- `title`
- `subtitle`, from the site's tagline
- `updated`
- `link rel="self"`
- `link rel="alternate"` to the HTML page
- a `generator`
- an `xml:lang`, from the `language` setting
- a `source:cloud` and a `link rel="hub"`, when the site names a notify server

With a license, the feed carries an [RFC 4946][rfc4946] `link rel="license"` to
the site's license, with the license name as its `title`. Every entry carries
one for its own license: the post's `license` front matter, else the site's.
Each entry states its own because RFC 4946 does not let an entry inherit the
feed's. JSON Feed has no field for a license and says nothing about one.

[rfc4946]: https://www.rfc-editor.org/rfc/rfc4946

A JSON Feed item carries `id` (the object id), `url` (the permalink), `title`,
`content_html`, `image` (see Photos above), `summary`, `date_published`,
`date_modified`, `tags` (the terms), and `authors`. The feed carries `version`,
`title`, `home_page_url`, `feed_url`, `description`, `authors`, and `hubs`. A
key with no value is left out, not sent empty.

This package writes the XML itself, without a library. Text is escaped.
`content:encoded` and `source:markdown` are CDATA sections. Any `]]>` in the
text is split across two sections, so it cannot end a section early.

## A recording on a post

A post can carry one recording, such as a spoken version of an article or an
occasional episode. The site is a blog that sometimes has audio, not a podcast
host. The feeds carry what a podcast app needs to play, describe, and caption
an item, and leave out the podcast directory tags. The front matter uses the
RSS spelling:

```yaml
enclosure:
  url: /uploads/2026/10/episode-12.mp3 # an upload; written by the editor
  type: audio/mpeg # from the upload table; written by the editor
  length: 23456789 # bytes, from the file on disk; written by the editor
  duration: 1834 # seconds, optional
  transcript: # optional
    url: /uploads/2026/10/episode-12.vtt # an upload or an http(s) URL
    type: text/vtt # text/vtt, application/x-subrip, text/html or text/plain
  alternates: # optional, any number
    - url: /uploads/2026/10/episode-12.mp4
      type: video/mp4
      length: 98765432
      title: Video # optional, at most 32 characters
      height: 720 # optional, for video
      lang: en # optional
    - url: https://cdn.example.com/episode-12-low.mp3
      type: audio/mpeg # required for a link
      title: Low bandwidth # a link's length is optional
```

**The main file is always an upload** under `/uploads/`. RSS requires its
`url`, `length`, and `type`, and an upload is the only file whose length the
site knows. A main file without all three is not a recording. The site drops a
bad alternate version or transcript on its own. One wrong line in a
hand-edited file loses only that line, not the episode. `enclosureOf(extra)`
is the one function that reads the key. The feeds, the theme, and federation
read only what it returns.

**The post editor** has a Recording section on posts:

- The main file is a select of the audio and video in the media library. None
  removes the whole key, including the transcript and the alternate versions.
- The duration takes seconds, `30:34`, or `1:02:03`.
- The transcript is an upload (`.vtt`, `.srt` or `.txt`) or an `https` address
  with its type.
- Alternate versions are numbered rows with one blank row at the end, so a
  plain form can add, edit, and remove them. Emptying a row's address removes
  it.

On save, the editor reads the type and length of every upload from the upload
table and from the file on disk, never from the form. The editor refuses these
with a message, and writes nothing:

- a main file that is not an audio or video upload
- a linked version without an `http` or `https` address or a media type
- a title over 32 characters

**What the feeds print, and when.** A post with no recording prints none of
this. A feed with no recording in it declares neither namespace, so its bytes
and its ETag are the same as before recordings existed.

| Element                                                     | Format      | Printed when                                                                                                                                                                            |
| ----------------------------------------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `<enclosure url length type/>`                              | RSS item    | The post has a main file. `url` is absolute.                                                                                                                                            |
| `<podcast:alternateEnclosure>` with `<podcast:source uri/>` | RSS item    | Once per alternate version, with `type`, and `length`, `title`, `height` and `lang` when known.                                                                                         |
| `<podcast:transcript url type/>`                            | RSS item    | The post has a transcript, with `rel="captions"` for WebVTT or SubRip.                                                                                                                  |
| `<itunes:duration>`                                         | RSS item    | The duration is known, in whole seconds.                                                                                                                                                |
| `<podcast:medium>blog</podcast:medium>`                     | RSS channel | Any item in the feed has a recording. Without it an app assumes `podcast`; `blog` is the spec's word for articles that sometimes have audio.                                            |
| `<link rel="enclosure" type length href/>`                  | Atom entry  | The post has a main file. Atom has no way to say the others are versions of it.                                                                                                         |
| `attachments`                                               | JSON Feed   | The main file and then each alternate version, with `url`, `mime_type`, `size_in_bytes` and `title` when known, and `duration_in_seconds` on audio or video when the duration is known. |

`xmlns:podcast="https://podcastindex.org/namespace/1.0"` is declared only on a
feed that prints a podcast element.
`xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"` is declared only on
a feed that prints `itunes:duration`.

**Left out on purpose:** the Apple directory tags (`itunes:image`,
`itunes:category`, `itunes:explicit`, `itunes:owner`), and `podcast:guid`,
`podcast:locked`, `podcast:person`, `podcast:season`, `podcast:episode`,
`podcast:value`, and `podcast:chapters`. Each one matters only to a podcast
directory or a dedicated show. Adding them is a follow-up for a site that wants
a listing in Apple Podcasts. `podcast:license` is also a follow-up. It could
reuse the [content license](#rss-20).

**The fediverse** gets the main file as an `Audio` or `Video` attachment. The
attachment has the file's absolute `url`, its `mediaType`, and a `name`, which
is the post's title or a note's first words. It goes before the post's `Image`
attachments. Mastodon picks a player or a gallery by the type of the first
attachment, and keeps only four. Alternate versions and linked files are not
sent. A remote server fetches and re-encodes what it receives, and this site
cannot check the type of a link to another host. `playsAsVideo(type)` chooses
`Video` or `Audio`, and also the default theme's `<video>` or `<audio>`, so the
two always agree.

The default theme plays the main file on the post page. See
[Videos](theme/page-shell.md#videos).

## Real-time notification

A feed reader that polls learns about a post at its next poll. An
[rssCloud][] or [WebSub][] server notifies subscribers instead:

1. The feed reader registers with the server.
2. The site tells the server when a feed changes.
3. The server notifies every subscriber at once.

One setting, `notifyServer`, controls all of it. It defaults to
`https://rpc.rsscloud.io`, which supports both protocols. The site derives
every other URL from it:

| URL                           | Purpose                               |
| ----------------------------- | ------------------------------------- |
| `{notifyServer}/pleaseNotify` | Where a subscriber registers          |
| `{notifyServer}/websub`       | The WebSub hub                        |
| `{notifyServer}/ping`         | Where this site reports a feed change |

Emptying the setting removes every element, every header, and every ping.
Setting a different URL moves all of them.

**Advertising.** An RSS channel carries all three forms, so old and new feed
readers each find one they understand:

```xml
<cloud domain="rpc.rsscloud.io" port="80" path="/pleaseNotify"
       registerProcedure="" protocol="http-post"/>
<source:cloud>https://rpc.rsscloud.io/pleaseNotify</source:cloud>
<atom:link rel="hub" href="https://rpc.rsscloud.io/websub"/>
```

The legacy `<cloud>` always has port `80` and protocol `http-post`, whatever
scheme the site uses to reach the server. [rpc.rsscloud.io's quick
start][quick-start] prescribes those values, and a 2001 aggregator expects
them. An Atom feed carries the `source:cloud` and the `rel="hub"` link but no
`<cloud>`, because `<cloud>` is an RSS 2.0 element with no namespace. A JSON
Feed carries JSON Feed 1.1's `hubs`:

```json
{ "hubs": [{ "type": "WebSub", "url": "https://rpc.rsscloud.io/websub" }] }
```

Every feed response in every format also carries WebSub's discovery header.
That covers the site's feeds, each archive's feeds, and both comments feeds. The
header is on the `304` as well as on the full response, because a poller
mostly gets the `304`:

```
Link: <https://rpc.rsscloud.io/websub>; rel="hub", <https://example.com/feed/>; rel="self"
```

**Pinging.** The server notifies nobody until the site reports a change. The
site pings on the same index changes that drive ActivityPub delivery, and
never on a full scan. When a post is published, edited, or withdrawn, the site
posts `url={feed}` to `{notifyServer}/ping` once for each feed whose contents
changed:

- the three site feeds
- the three feeds of every tag and category the post carried before _and_
  after the change. A post that left a tag changed that tag's feed as much as
  the feed of the tag it joined.

Pings are best effort:

- They run one after another, on a queue of their own.
- A repeated URL is sent once.
- Each ping has ten seconds.
- A refusal is logged, not thrown. A notify server that is down adds a line to
  the log and never fails a save.

A site can ping a feed of its own:

```js
await cms.notifyFeeds(['https://example.com/podcast/feed/']);
```

`cms.notifier` is the service behind it, already subscribed to the index. It
has `notify(urls)`, `feedsFor(change)`, `handle(change)`, and `settled()`.
`feedsFor` resolves to the feed URLs, because it reads the taxonomy bases from
the settings.

[rsscloud]: https://rpc.rsscloud.io/docs
[websub]: https://www.w3.org/TR/websub/
[quick-start]: https://rpc.rsscloud.io/docs/quick-start

## Caching and discovery

Every feed carries `ETag`, `Last-Modified`, and `Cache-Control: no-cache`. It
answers `If-None-Match` and `If-Modified-Since` with `304`. The validator
covers the feed's metadata as well as its entries. Each format and each scope
gets its own validator, so a feed reader that holds the RSS feed never gets a
`304` for the Atom one. Feeds are validated even while `watch` is on, because a
feed is not rendered through the theme.

The validator also covers the revision of the item format. A release that
changes what a feed says about a post changes every post feed's `ETag` once.
A polling feed reader then gets the new bytes, not a `304`.

```sh
curl -i https://example.com/feed/
curl -i https://example.com/tag/releases/feed/json/
```

Every page of the default theme advertises all three feeds in its `<head>`, RSS
first, then the site's comments feed. An archive also advertises that
archive's three feeds. A post also advertises its own comments feed. The
renderer puts that URL in `commentsFeed`, so a layout that overrides
`post.njk` keeps it. A theme that does not extend `layouts/base.njk` must emit
the links itself:

```html
<link
  rel="alternate"
  type="application/rss+xml"
  title="My Site"
  href="/feed/"
/>
<link
  rel="alternate"
  type="application/atom+xml"
  title="My Site"
  href="/feed/atom/"
/>
<link
  rel="alternate"
  type="application/feed+json"
  title="My Site"
  href="/feed/json/"
/>
<link
  rel="alternate"
  type="application/rss+xml"
  title="My Site comments"
  href="/comments/feed/"
/>
```

The builders are exported. A site can write a feed of its own, such as one for
a single category or author, without reimplementing any of the three formats:

```ts
import {
  atomFeed,
  createRenderer,
  jsonFeed,
  listUsers,
  rssFeed,
} from '@geekity/cms';

const site = createRenderer({ config: cms.config }).site();

const source = {
  site,
  users: listUsers(cms.config.dataDir),
  documents: cms.store.listByTag('releases', { limit: 20 }),
  title: `${site.title}: releases`,
  href: '/tag/releases/',
  feedHref: '/tag/releases/feed/',
  baseUrl: cms.config.baseUrl,
};

rssFeed(source); // a string
atomFeed(source); // a string
jsonFeed(source); // a JSON Feed object
```

`commentsRssFeed` does the same for comments. Its entries come from the
conversation reader. The conversation reader is the only code that reads the
inbox log and the comment index to show replies, so a feed and the page under
the post carry the same entries:

```ts
import {
  commentsRssFeed,
  createConversation,
  feedComments,
  listUsers,
  SITE,
} from '@geekity/cms';

const conversation = createConversation({
  admin: cms.admin,
  store: cms.store,
  contentDir: cms.config.contentDir,
  baseUrl: cms.config.baseUrl,
  users: () => listUsers(cms.config.dataDir),
});
const settings = await cms.settings.values(SITE);

commentsRssFeed({
  site,
  comments: feedComments(conversation.latest(20, settings), {
    baseUrl: cms.config.baseUrl,
    limit: 20,
    cited: (url) => cms.replyContexts.read(url, settings),
  }),
  title: `${site.title}: comments`,
  href: '/',
  feedHref: '/comments/feed/',
  baseUrl: cms.config.baseUrl,
});
```

Each question takes the site settings as its last argument: a post with no
author is by the site's author or title, and `latest` leaves out what the
comment policy closes. Read them once with `cms.settings.values(SITE)` and pass
the same object to every call. The conversation reader also has these:

- `conversation.thread(document, settings)` reads one post, in the shape the
  theme's `conversation.njk` receives.
- `spokenIn` flattens a thread into the entries a feed carries, each with the
  reply it sits under.
- `conversation.counts(documents, settings)` returns the number of direct replies that
  `source:comments` puts beside each item of a post feed.
- `conversation.repliesTo(segment, settings)` returns what one `/replies/` feed holds.
