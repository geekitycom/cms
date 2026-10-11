# Feeds

The recent posts are syndicated in three formats, at the URLs WordPress uses,
so a site moving off it keeps every subscriber it had:

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

`/feed/` is RSS because that is the format nearly every existing subscriber
holds. The two archive bases are settings (`tagBase`, `categoryBase`), so the
per-archive feeds follow wherever the archives live.

WordPress's older spellings redirect `301` rather than 404: `/feed/rss/` to
`/feed/`, and the query forms `?feed=rss2`, `?feed=rss`, `?feed=atom` and
`?feed=json` on any listing to that listing's feed, and `?feed=rss2` or
`?feed=rss` on a post's permalink to that post's comments feed. A feed URL that
arrives without its trailing slash redirects to the canonical one in a single
hop.

A feed holds the newest published posts, newest first. Drafts, documents in the
trash and pages are never in one, and a term nothing published carries 404s
rather than serving an empty feed. `feedSize` in `content/_data/site.json` sets
how many entries a feed holds; without it a feed holds 20, which is deliberately
more than an archive page, so a reader that polls once a day does not miss a
post on a site that publishes several.

```json
{ "title": "My Site", "tagline": "Notes", "author": "me", "feedSize": 20 }
```

Every RSS feed, the comments feeds included, tells a reader how often to poll
it with the Syndication module's `sy:updatePeriod` and `sy:updateFrequency`.
Settings → Reading sets both, as `feedUpdatePeriod` (`hourly`, `daily`,
`weekly`, `monthly` or `yearly`) and `feedUpdateFrequency` (a whole number, 1 or
more) in `site.json`. The default is `hourly` and `1`, which is what WordPress
declares, so the subscribers of a migrated site keep polling as they did. A
reader may back off from a feed that stays quiet much longer than it says, so
a site that posts weekly does better to say `weekly`. Atom and JSON Feed have no
element for it.

## What every format says about a post

The three formats render one **feed item**, derived once per post, rather than
each reading the file for itself. So they agree about the three things a reader
actually keys on.

**Identity.** A post is named by the first of three things it has: the `guid`
its front matter sets, when that parses as a URL; else the `activitypub.id`
the front matter stores for a post migrated from elsewhere; else its permalink
(see [Federation](federation.md)). That name is RSS's `guid`, Atom's `id` and
JSON Feed's `id`. The permalink is always the link: RSS's `link`, Atom's
`link rel="alternate"` and JSON Feed's `url`. The two are the same URL for
every post born on this CMS, and differ only for one carrying a stored id or a
`guid` — which is what lets a migrated post keep the name its WordPress
subscribers already hold. RSS's `isPermaLink` says which of the two a `guid`
is: `true` only when it equals the permalink, `false` for anything else, such
as a stored `?p=813`.

**Terms.** Every format lists the post's categories and then its tags, in file
order, as one flat list: RSS's `category` elements, Atom's `category term`
attributes, JSON Feed's `tags`. None of the three can say which vocabulary a
term came from, which is how WordPress publishes both too.

**Summary.** Every format summarises a post the same way: the `description`
front matter when the post has one — it is what the author wrote for exactly
this — and otherwise the first paragraph of the rendered body, stripped to
plain text and cut at 55 words, WordPress's own excerpt length. It is RSS's
`description`, Atom's `summary` and JSON Feed's `summary`, and it is left out
only when there is nothing to summarise at all. The whole post goes in the
content element beside it, so a reader that shows both has something to choose
between.

**Replies.** A post whose `in-reply-to` front matter is an absolute `http` or
`https` URL is a reply, and Atom and JSON Feed name the URL it answers. An Atom
entry carries RFC 4685's `<thr:in-reply-to ref="…" href="…"/>`, with the target
URL as both its identity and its location, and every Atom feed declares
`xmlns:thr="http://purl.org/syndication/thread/1.0"`. JSON Feed 1.1 has no reply
field, so a JSON Feed item carries the target in an extension object, which the
spec allows under any key that starts with an underscore and tells readers that
do not know it to ignore:

```json
{
  "id": "…",
  "url": "…",
  "content_html": "…",
  "_geekity": { "in_reply_to": "https://example.net/notes/1" }
}
```

The key is `_geekity` because an extension is named after its publisher, and
`in_reply_to` spells the microformats `in-reply-to` property the JSON way. A
post that is not a reply, or whose `in-reply-to` is not such a URL, carries
neither. RSS 2.0 has no equivalent element, so an RSS item carries the target
as the [source namespace][source-ns]'s `<source:inReplyTo>`.

**Languages.** Every feed declares the site's `language` once: RSS as the
channel's `language`, Atom as the feed's `xml:lang` and JSON Feed as its
`language`. A post whose `lang` front matter names another language says so on
its own item: RSS as `dc:language`, Atom as `xml:lang` on the `entry` and JSON
Feed as the item's `language`. A post in the site's language, or whose `lang`
is not a language tag, adds nothing.

**Photos.** A post's `photo` front matter prints in every format's content,
before the body, which is where the page prints it too. Each photo is a plain
`<figure><img src alt></figure>` of the original upload, never the responsive
variants, which a reader cannot resolve (decision-10). Its `src` is absolute on
the site's base URL. Its `alt` is the post's own text, else the media library's,
else empty. So a photo-only post reads in a feed reader as its photos. JSON Feed
also names the item's main image as `image`: the post's `image` front matter,
else its first photo. A photo is never an RSS `enclosure`, an Atom
`rel="enclosure"` link or a JSON Feed attachment. Those carry a recording only.

## RSS 2.0

The channel carries `title`, `link`, `description` (the tagline), `language`
(the `language` setting, `en` by default), `lastBuildDate`, `generator`, an
`atom:link rel="self"`, the three notify-server elements described under
[Real-time notification](#real-time-notification), and an `image` built from the
avatar when the site has one.

An item carries `title`, `link`, `guid`, `pubDate` in RFC 822, `dc:creator` from
the post's author or the site's, one `category` per term, `description` holding
the summary, `content:encoded` holding the whole rendered post, and
`source:markdown` holding the Markdown the post was written from. A reply also
carries `source:inReplyTo` holding the URL it answers. The `guid`, the terms
and the summary are the ones described above.

`source:markdown` is Dave Winer's [source namespace][source-ns]: a reader that
understands Markdown should render from it rather than from `content:encoded`.
It is the same text the ActivityStreams `Article` carries as its `source`.

Every item also says where its comments are: `comments` is the page to read
them on and `wfw:commentRss` (the [Well-Formed Web][wfw-ns] comment API) is the
feed of the whole thread to poll. A post with replies also carries
`source:comments`, whose `count` is how many replies answer the post directly
and whose `feedUrl` is its `/replies/{key}/` feed holding only those (see
[Walking a thread](#walking-a-thread)). A post nobody answered carries no
`source:comments`.

When the site has a license (Settings > General, or `license` in `site.json`),
the channel carries a `creativeCommons:license` holding its URL, and every item
carries one for its own license: the post's `license` front matter, else the
site's. A post whose front matter says `license: none` carries none. The
element is the [Creative Commons RSS module][cc-rss], declared as
`xmlns:creativeCommons` only when some license is printed. It names a license
by URL, Creative Commons or not, which a reader can act on; `dc:rights` would be
free text. Nothing about a license is printed on a site and posts without one.
RSS has no element that says "no license", so a post saying `license: none`
on a licensed site carries no item license while the channel still names the
site's; a reader that applies the channel's license to every item reads that
post as under it.

[source-ns]: https://source.scripting.com/
[wfw-ns]: http://wellformedweb.org/CommentAPI/
[cc-rss]: https://cyber.harvard.edu/rss/creativeCommonsRssModule.html

## Comments

The comments feeds publish a document's conversation, at the URLs WordPress
publishes its own at: `{permalink}feed/` for one post or page, and
`/comments/feed/` for the whole site. Both are read from the same conversation
the page draws under the post, so they carry what a reader sees there:

- native comments left through the form, once a moderator approves them;
- webmention replies and mentions;
- fediverse replies, a `Create` of a `Note` whose `inReplyTo` names the post
  or a reply under it (see [Federation](federation.md)), and the quotes of a
  post its author approved;
- reply posts written on this site that answer the post or a reply under it.

That is replies and mentions. Likes, boosts and reposts say nothing, so they
are shown and counted on the page and are in no feed, and no `source:comments`
count includes them: a post answered only with reactions advertises no replies
feed. An RSVP to an event is shown with the people answering, not in the
thread, so it is in no feed either, words or not; an RSVP sent to a post that
is no event is a reply like any other. Neither feed carries a
[migrated comment](comments.md#migrated-comments).

Both are RSS 2.0 and nothing else: a comments feed has no Atom or JSON spelling
here, so `{permalink}feed/atom/` 404s. A post has a comments feed whether or
not it still takes comments. A page has one while it takes comments
(`comments: true` in its front matter, and comments on for the site), which is
when it shows its conversation; any other page's `{permalink}feed/` 404s, and
its comments are left out of `/comments/feed/` too. A document with no replies
answers an empty feed rather than a 404, because it exists and a reader that
subscribed before anybody answered should keep polling. A permalink that is no
published document 404s like any other. The page advertises its own feed with
a `<link rel="alternate" type="application/rss+xml">` in its `<head>`.

A channel carries the usual `title` (`Comments on: {post}`), `link`,
`description`, `language`, `lastBuildDate`, `generator`, `atom:link rel="self"`
and the same notify-server elements every other feed carries. An item carries the author's name as its `title` and `dc:creator`,
the reply's `url` as its `link` (a comment left through the form links to its
own page at `/comment/{key}/`), a `guid`, the `published` time the reply gave (or
when it arrived, if it gave none), `description` holding a plain-text excerpt
and `content:encoded` holding the reply. The `guid` of a comment left through the
form is its page, `isPermaLink="true"`; a fediverse note's is its id, a
webmention's its source URL, a reply post's its object id. A migrated comment
is in neither feed, so its old `guid` never has to survive the move.
`isPermaLink` is `true` exactly when the `guid` is the `link`.

Each item also carries, from the [source namespace][source-ns]:

- `source:inReplyTo`, the `guid` of what it answers in these feeds: the post's
  feed `guid` for an answer to the post, else the `guid` of the reply it
  answers. A reply under a comment a reader may not see (one waiting for a
  moderator, spam or deleted) names the nearest reply above it a reader can
  see, or the post, and is counted as that one's reply.
- `source:comments`, only on an item with replies: `count` is how many answer
  it directly and `feedUrl` its `/replies/` feed.
- `<source url="…">Name</source>`, the core RSS element, when the site knows a
  feed for the author: a webmention author's `h-card` URL or site, or a site
  user's author feed `/author/{username}/feed/`. A comment left through the
  form and a fediverse reply carry none.

On the site-wide feed the title names the post or page as well: `{author} on
{post}`, or `{author} replying to {parent author} on {post}` for an answer to
another reply a reader can see.

A fediverse reply's author is named by the profile the site stored when that
actor followed it, and otherwise the `@user@host` the actor's own URL implies. Naming them
properly would mean dereferencing the actor, which is a network round trip per
comment shown.

**A reply's HTML is sanitised before it is published.** It is markup a
stranger wrote, so it is tokenised and rebuilt from an allowlist rather than
passed through: `p`, `br`, `a`, `em`, `strong`, `del`, `code`, `pre`,
`blockquote` and the list elements survive; `script` and `style` are dropped
along with their contents; every other element is unwrapped, keeping its text;
every attribute goes except an `a`'s `href`, which must be `http`, `https` or
`mailto` and is marked `rel="nofollow noopener noreferrer"`. `sanitizeCommentHtml`
is exported for a site that shows comments in its own templates.

A reply to a document that has since been unpublished or moved to the trash
disappears from `/comments/feed/`, and that document's own feed 404s with it.
`feedSize` caps both feeds.

## Walking a thread

`{permalink}feed/` is the whole thread, flat, which is what WordPress
publishes and `wfw:commentRss` points at. A program that wants the tree
(Dave Winer's [rss.chat][rss-chat] reads conversations this way) walks it one
level at a time instead: from a post item's `source:comments` to a feed of the
replies that answer the post directly, and from each of those items' own
`source:comments` to the replies that answer it, until an item has none.
Every reply a reader can see is reached once.

Each of those feeds is `/replies/{key}/`, RSS 2.0, newest first, its items in
the same shape as the comments feeds. It carries replies only: a mention
answers nothing in the thread, and a like, a boost, a repost or an event's RSVP
is in no feed. A comment's key is its id (see
[Keys](comments.md#keys)); a post's, a page's, a fediverse reply's or a reply post's is
the first 16 hex digits of the SHA-256 of its feed `guid`, since a document has
no id of its own and slugs are not unique across posts and pages. An item
nobody answered answers an empty feed; a segment that is no key, or a key that
names nothing a reader can see, 404s. A migrated comment's feed still answers,
with the native replies under it, though no feed links to it.

[rss-chat]: https://github.com/scripting/rss.chat

## Atom and JSON Feed

An Atom entry carries `id` (the post's object id), `title`, `updated`,
`published`, `link rel="alternate"` (the permalink), an `author` when the front
matter names one, a `category` per term, a `summary`, and the whole rendered
post as `content type="html"`. The feed itself carries `id`, `title`,
`subtitle` from the site's tagline, `updated`, `link rel="self"`,
`link rel="alternate"` to the HTML page, a `generator`, an
`xml:lang` from the `language` setting, and — when the site names a notify
server — a `source:cloud` and a `link rel="hub"`.

With a license, the feed carries an [RFC 4946][rfc4946] `link rel="license"`
to the site's license, its name as the `title`, and every entry carries one for
its own license, the post's `license` front matter else the site's. An entry
states its own because RFC 4946 does not let an entry inherit the feed's. JSON
Feed has no field for a license and says nothing about one.

[rfc4946]: https://www.rfc-editor.org/rfc/rfc4946

A JSON Feed item carries `id` (the object id), `url` (the permalink), `title`,
`content_html`, `image` (see Photos above), `summary`, `date_published`, `date_modified`, `tags` (the
terms) and `authors`; the feed carries `version`, `title`, `home_page_url`,
`feed_url`, `description`, `authors` and `hubs`. Keys with nothing behind them
are left out rather than sent empty.

The XML is written by this package rather than by a library. Text is escaped;
`content:encoded` and `source:markdown` are CDATA sections, with any `]]>` in
the text split across two sections so it cannot end one early.

## A recording on a post

A post can carry one recording: a spoken version of an article, or an episode
now and then. The site is a blog that sometimes has audio, not a podcast host,
so the feeds carry what a podcast app needs to play, describe and caption an
item, and leave the podcast directory tags out. The front matter spells it the
way RSS does:

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

**The main file is always an upload** under `/uploads/`, because RSS requires
its `url`, `length` and `type`, and an upload is the only file whose length the
site knows. A main file without all three is no recording at all. A bad
alternate version or transcript is dropped on its own, so one wrong line in a
hand-edited file costs that line and not the episode. `enclosureOf(extra)` is
the one reading of the key, and the feeds, the theme and the federation read
only what it returns.

**The post editor** has a Recording section on posts. The main file is a select
of the audio and video in the media library, and None removes the whole key,
transcript and alternate versions included. The duration takes seconds, `30:34`
or `1:02:03`. The transcript is an upload (`.vtt`, `.srt` or `.txt`) or an
`https` address with its type. Alternate versions are numbered rows with one
blank row at the end, so a plain form can add, edit and remove them; emptying a
row's address removes it. On save, the type and length of every upload are read
from the upload table and from the file on disk, never from the form. A main
file that is not an audio or video upload, a linked version without an `http`
or `https` address or a media type, or a title over 32 characters is refused
with a message, and nothing is written.

**What the feeds print, and when.** A post with no recording prints none of
this, and a feed with no recording in it declares neither namespace, so its
bytes and its ETag are what they were before recordings existed.

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
feed that prints a podcast element, and
`xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"` only on one that
prints `itunes:duration`.

**Left out on purpose:** the Apple directory tags (`itunes:image`,
`itunes:category`, `itunes:explicit`, `itunes:owner`), and `podcast:guid`,
`podcast:locked`, `podcast:person`, `podcast:season`, `podcast:episode`,
`podcast:value` and `podcast:chapters`. Each one matters only to a podcast
directory or a dedicated show. Adding them is a follow-up for a site that wants
to be listed in Apple Podcasts, and so is `podcast:license`, which could reuse
the [content license](#rss-20).

**The fediverse** gets the main file as an `Audio` or `Video` attachment with
its absolute `url`, its `mediaType`, and the post's title, or a note's first
words, as its `name`. It goes before the post's `Image` attachments, because
Mastodon shows a player or a gallery by the type of the first attachment and
keeps only four. Alternate versions and linked files stay out: a remote server
fetches and re-encodes what it is given, and a link to another host is a type
this site cannot check. `playsAsVideo(type)` decides `Video` against `Audio`,
and the default theme's `<video>` against `<audio>`, so the two never disagree.

The default theme plays the main file on the post page; see
[Videos](theme/page-shell.md#videos).

## Real-time notification

A feed reader that polls hears about a post when it next polls. An [rssCloud][]
or [WebSub][] server turns that around: the reader registers with the server,
the site tells the server when a feed changes, and the server tells every
subscriber at once.

One setting, `notifyServer`, is the whole of it. It defaults to
`https://rpc.rsscloud.io`, which speaks both protocols, and everything else is
derived from it: `{notifyServer}/pleaseNotify` is where a subscriber registers,
`{notifyServer}/websub` is the hub, and `{notifyServer}/ping` is where this site
says a feed changed. Emptying the setting removes every element, every header
and every ping; a different URL moves all of them.

**Advertising.** An RSS channel carries all three spellings, so a reader of any
age finds one it understands:

```xml
<cloud domain="rpc.rsscloud.io" port="80" path="/pleaseNotify"
       registerProcedure="" protocol="http-post"/>
<source:cloud>https://rpc.rsscloud.io/pleaseNotify</source:cloud>
<atom:link rel="hub" href="https://rpc.rsscloud.io/websub"/>
```

The port and protocol of the legacy `<cloud>` are `80` and `http-post` whatever
scheme the server is actually reached over, because that is what
[rpc.rsscloud.io's quick start][quick-start] prescribes and what a 2001
aggregator expects to read. An Atom feed carries the `source:cloud` and the
`rel="hub"` link but no `<cloud>`, which is an RSS 2.0 element with no namespace.
A JSON Feed carries JSON Feed 1.1's `hubs`:

```json
{ "hubs": [{ "type": "WebSub", "url": "https://rpc.rsscloud.io/websub" }] }
```

And every feed response in every format — the site's, each archive's and both
comments feeds — carries WebSub's discovery header, on the `304` as well as on
the body, because a poller mostly gets the `304`:

```
Link: <https://rpc.rsscloud.io/websub>; rel="hub", <https://example.com/feed/>; rel="self"
```

**Pinging.** The server notifies nobody until it hears the feed changed. So when
a post is published, edited or withdrawn — the same index changes that drive
ActivityPub delivery, and never a full scan — the site posts
`url={feed}` to `{notifyServer}/ping`, once for each feed whose contents moved:
the three site feeds, and the three feeds of every tag and category the post
carried before _and_ after the change, because a post that left a tag changed
that tag's feed as much as the one it joined.

Pings are best effort. They run one after another on a queue of their own, a
repeated URL is sent once, each is given ten seconds, and a refusal is logged
rather than thrown: a notify server that is down costs a line in the log, never
a save. A site can ping a feed of its own:

```js
await cms.notifyFeeds(['https://example.com/podcast/feed/']);
```

`cms.notifier` is the service behind it — `notify(urls)`, `feedsFor(change)`,
`handle(change)` and `settled()` — already subscribed to the index.

[rsscloud]: https://rpc.rsscloud.io/docs
[websub]: https://www.w3.org/TR/websub/
[quick-start]: https://rpc.rsscloud.io/docs/quick-start

## Caching and discovery

Every feed carries `ETag`, `Last-Modified` and `Cache-Control: no-cache`, and
answers `If-None-Match` and `If-Modified-Since` with `304`. The validator covers
the feed's metadata as well as its entries, and each format and each scope gets
its own, so a reader holding the RSS feed is never told the Atom one is
unchanged. Feeds are validated even while `watch` is on, because a feed is not
rendered through the theme.

The validator also covers the revision of the item format itself, so a release
that changes what a feed says about a post moves every post feed's `ETag` once
rather than leaving a polling reader with a `304` that hides the new bytes.

```sh
curl -i https://example.com/feed/
curl -i https://example.com/tag/releases/feed/json/
```

Every page of the default theme advertises all three feeds in its `<head>`, RSS
first, then the site's comments feed; an archive advertises that archive's three
as well, and a post its own comments feed (the renderer puts that URL in
`commentsFeed`, so a layout that overrides `post.njk` keeps it). A theme that
does not extend `layouts/base.njk` should emit them itself:

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

The builders are exported, so a site can write a feed of its own — one
category, one author — without reimplementing any of the three formats:

```ts
import { atomFeed, createRenderer, jsonFeed, rssFeed } from '@geekity/cms';

const site = createRenderer({ config: cms.config }).site();

const source = {
  site,
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

`commentsRssFeed` is the same for comments, and what goes in it comes from the
conversation reader — the one thing that reads the inbox log and the comment
index to show somebody what has been said, so a feed and the page under the
post carry the same entries:

```ts
import {
  commentsRssFeed,
  createConversation,
  feedComments,
} from '@geekity/cms';

const conversation = createConversation({
  admin: cms.admin,
  store: cms.store,
  baseUrl: cms.config.baseUrl,
});

commentsRssFeed({
  site,
  comments: feedComments(conversation.latest(20), {
    baseUrl: cms.config.baseUrl,
    limit: 20,
  }),
  title: `${site.title}: comments`,
  href: '/',
  feedHref: '/comments/feed/',
  baseUrl: cms.config.baseUrl,
});
```

`conversation.thread(document)` is the same reading for one post — the shape the
theme's `conversation.njk` is handed — `spokenIn` flattens it into the entries a
feed carries, each with the reply it sits under, `conversation.counts(documents)`
is the number of direct replies `source:comments` puts beside each item of a
post feed, and `conversation.repliesTo(segment)` is what one `/replies/` feed
holds.
