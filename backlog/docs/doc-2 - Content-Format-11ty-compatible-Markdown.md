---
id: doc-2
title: Content Format (11ty-compatible Markdown)
type: specification
created_date: '2026-09-02 13:21'
updated_date: '2026-10-09 15:21'
---
# Content Format (11ty-compatible Markdown)

Content files must build unchanged under Eleventy 3.x. We use only front matter keys Eleventy already understands, plus a small set of extra keys Eleventy ignores.

## Directory layout

```
content/
  posts/
    posts.json                 directory data: {"layout":"post","tags":["post"]}
    2026-09-02-hello-world.md
  pages/
    pages.json                 directory data: {"layout":"page"}
    about.md
  uploads/                     images and files, passthrough copy in 11ty
    2026/09/photo.jpg
  _data/
    site.json                  title, tagline, url, author (mirrored from settings)
    replyContexts.json         what the posts replies answer said about themselves
```

`site.json` also carries what the site chooses on the Reading settings page,
including WordPress's own question of what the front page shows: `homepage` is
the slug of the page served at `/` and `postsPage` the slug of the page whose
own URL carries the post listing. Both are absent when the site shows its
latest posts at `/`, which is the default; `postsPage` needs a `homepage`
beside it, and is ignored without one. They are slugs rather than URLs because
the setting follows the page rather than the permalink it happens to have, and
a slug naming no published page is a site back on its latest posts. An Eleventy
build reads the same two keys: `docs/eleventy.config.example.js` puts the
homepage at `/` and flags the posts page on the context as `isPostsPage`.

One thing about a post is deliberately not in `content/`: where it was written. It lives in `data/locations.json`, keyed by permalink (decision-29), so a public repository never carries it; the Micropub section below says how it gets there. An Eleventy build therefore prints no location.

Post filenames carry a date prefix so they sort on disk. Pages do not. The CMS never depends on filename parsing for URLs; it always reads `permalink` from front matter.

## Front matter

Keys the CMS reads and writes. Eleventy semantics are preserved.

| Key | Required | Eleventy meaning | CMS use |
| --- | --- | --- | --- |
| `title` | yes | data | display title |
| `date` | posts | sets page date | publish date, a UTC ISO 8601 instant ending in `Z` |
| `permalink` | yes | output URL | canonical URL path; always written explicitly so 11ty and the CMS agree |
| `tags` | no | collections | taxonomy, matched without regard to case (see Tags below); `post` tag comes from `posts.json`, not from the file |
| `categories` | no | data | the second taxonomy, archived at `/category/{name}/`; Eleventy reads it as an ordinary data key |
| `draft` | no | honoured by an 11ty preprocessor | `true` hides from public site and feeds |
| `visibility` | no | honoured by an 11ty preprocessor | `unlisted` keeps the document's page and drops it from every list; absent is public; any other value hides the document like a draft. See Visibility below |
| `description` | no | data | meta description and excerpt fallback |
| `layout` | no | template | not written per file; comes from directory data |
| `eleventyExcludeFromCollections` | no | hides from collections | mirrored for pages that should not list |
| `contact` | no | data | `true` renders a contact form under a page: name, email, subject, message. Messages land under `data/contact/` and on `/admin/messages`, and are emailed to the site's `contactEmail`. The destination address is never in the page |

Extra keys, ignored by Eleventy, prefixed to avoid collisions:

| Key | Use |
| --- | --- |
| `updated` | last modified date, a UTC instant, written on every admin save |
| `author` | the username of a user; see below |
| `in-reply-to` | the URL of the post this one answers, under its microformats2 name. An http or https URL makes the post a reply (Post Type Discovery, TASK-121): the theme cites it as an embedded `u-in-reply-to h-cite` filled in from `_data/replyContexts.json` (TASK-123, decision-19), the ActivityStreams object carries it as `inReplyTo`, and publishing sends it a webmention. Any other value is kept in the file, logged as a warning when the file is indexed, and ignored; the admin editor refuses to save one |
| `rsvp` | whether the author is going to the event `in-reply-to` names (TASK-198): `yes`, `no`, `maybe` or `interested`, under its microformats2 name. One of the four makes the post an RSVP under Post Type Discovery, ahead of every other type as the spec orders it. The theme opens its content with a `p-rsvp` and cites the event, with its start and place when its page gives them, as the reply's `u-in-reply-to h-cite`; publishing sends the event a webmention, and the post federates as a note replying to the event that opens with a line such as "Going to Event" (decision-31). Any other value is ignored; the admin editor refuses to save one, and refuses an RSVP with no `in-reply-to` |
| `start`, `end`, `location` | when and where an event is (TASK-200, decision-32), under their microformats2 names. A `start` that reads as a date makes the post an event under Post Type Discovery, ahead of every other type as the spec orders it; its `title` is the event's name and its body the description. `start` and `end` are UTC instants the admin writes from wall-clock time in the site's zone, and one written by hand with no offset is read as UTC; an `end` before the `start` is ignored. `location` is the event's place in words, or the http or https address to join it online. It is public by nature, unlike the author's own location, which never goes in front matter (decision-29). The theme renders the post as an `h-event` with `dt-start`, `dt-end` and `p-location` and describes it as a schema.org `Event`; it federates as an ActivityStreams `Event`. The admin editor refuses an unreadable time, an end before the start, an end or place without a start, and an event with no title, and leaves these keys alone on a post that is no event |
| `photo` | the post's photos (TASK-166), a list in Micropub's name. Each entry is `url`, an upload's `/uploads/…` path or an http or https URL, and an optional `alt`; a bare URL string reads as an entry without `alt`. An entry with no `alt` takes the media library's alt text for that upload (TASK-141), so a library image is described once. The theme prints each as an `img.u-photo` in the h-entry, the ActivityStreams object attaches each as an `Image` named by its alt text, and the JSON-LD lists each as an `ImageObject`. A post with a photo is a photo post under Post Type Discovery unless it is a reply, which comes first. An entry whose `url` is neither is dropped when read; the admin editor refuses to save one, and refuses an upload that is not an image in the library |
| `like-of`, `repost-of`, `bookmark-of` | the URL a post likes, reposts or bookmarks (TASK-169), each under its microformats2 name, one URL each; a list of one reads as that URL. An http or https URL makes the post a like, a repost or a bookmark under Post Type Discovery, in the order repost, like, reply, photo, bookmark: the spec's order, with bookmark, which the spec leaves to note and article, just ahead of them. The theme cites each as an embedded `u-like-of`, `u-repost-of` or `u-bookmark-of` `h-cite`, and publishing sends the URL a webmention. A like or repost of a fediverse object federates as a `Like` or `Announce` of it; anything else federates as the note it is, with a line linking the page (decision-28). Any other value is ignored; the admin editor refuses to save one |
| `read-of`, `read-status` | what a read post read, and how far its author got (TASK-229), as indiebookclub posts it. `read-of` is a map of `name` and, when known, `author`, `uid` (`isbn:…` or `doi:…`) and `url`; a bare string reads as its `name`. `read-status` is `to-read`, `reading` or `finished`. With both, the post is a read under Post Type Discovery, placed after photo and ahead of bookmark. The theme prints a `p-read-status` and a `p-read-of` `h-cite`, and the post federates as a note opening with the same sentence, such as "Want to read: Title by Author". Either without the other is ignored; the admin editor refuses to save one |
| `activitypub.published` | timestamp of first delivery, a UTC instant. The only key the CMS writes here: it records that the post has been announced and when, which is what decides `Create` against `Update` |
| `activitypub.id` | never written by the CMS. A post's ActivityStreams object id is its permalink (decision-13); this key is read, not minted, so a post migrated from elsewhere keeps the id its followers already hold — `https://example.com/?p=813` — and every `Update` and `Delete` names it |
| `activitypub.type` | never written by the CMS. `Note` or `Article`, overriding the ActivityStreams type Post Type Discovery derives for the post (decision-17). Any other value is kept in the file, logged as a warning, and ignored. The `activitypub` block is everything about how a post federates, whether the author set it or the CMS wrote it back, and a save never rewrites what the author set |
| `guid` | the id every feed publishes for the post (TASK-292): RSS's `guid`, Atom's `<id>` and JSON Feed's `id`, in place of the object id decision-12 otherwise prints. A post migrated from elsewhere keeps the guid its feed readers already hold, such as `https://blog.example.com/essays/slug/`, even where it federated as `https://example.com/?p=813`. RSS marks it `isPermaLink="true"` only when it equals the permalink. It changes nothing else: the ActivityStreams object id, the permalink and every redirect stay as they were, and the site answers nothing at the guid's URL. A value that is not an absolute URL is ignored, and the post falls back to `activitypub.id`, else its permalink. The admin editor shows no field for it and keeps it on save |
| `canonical_href` | where the post was first published, when that is somewhere else (TASK-293), such as a Substack essay republished here. The name is the one an Eleventy site in the wild already used for it, so its files keep their values. An absolute http or https URL becomes the page's `<link rel="canonical">` and `og:url` in place of its own URL, and is on the theme's context as `original` (`{ url, label }`); the default theme prints "Originally published at" and links it as a second `u-url` of the h-entry, after the permalink's. It is no `u-syndication`, which names copies of this post, and original-post-discovery reads a copy's off-site `u-url` as its original. The JSON and Markdown representations carry it in the front matter as written. Any other value is kept in the file, named in a warning by `geekity sync` and when the watcher indexes the file, and ignored. The admin editor shows no field for it and keeps it on save |

Unknown keys are preserved on round trip. The writer emits YAML with a stable key order so diffs stay small.

## Tags

Tags match without regard to case (TASK-308): `WordPress`, `wordpress` and `WORDPRESS` are one tag, with one count, one archive and one feed. Two spellings are the same tag when JavaScript's `toLowerCase()` makes them equal; there is no locale-specific folding and no Unicode normalisation. A file keeps the spelling it was written in: the CMS never rewrites a file only to change a tag's spelling, though a file it saves for another reason (an editor or Micropub save, the `activitypub.published` stamp on a scheduled post coming due) is written with the site's spelling.

- The site shows each tag in one spelling, wherever it prints it: archive titles, a post's tag links, the feeds' categories, ActivityPub hashtags, the admin's tag screens, Micropub's `q=category` and the tags a plugin is handed. That spelling is the one most listed documents use, ties going to the one used earliest; a tag only drafts, scheduled posts or the trash carry is shown in the spelling most of those use. It is worked out from the index, so a rebuild gives the same answer.
- A tag's archive lives at its lower-case URL, `/{tagBase}/wordpress/`. Any other casing of the archive, its pages and its feeds answers `301` there while something carries the tag. The default theme builds tag links with `tag | lower | urlencode`.
- A file that lists one tag twice in two casings carries it once, in the first spelling.
- Saving from the editor or Micropub writes the site's spelling for a tag that matches one ignoring case, leaving the document being saved out of the count, and the editor says when it did. The tag rename, merge and delete screens act on every casing at once; renaming a tag to another casing of itself rewrites every file to that casing and records no redirect.
- Categories are matched exactly as they are spelled.

An Eleventy build of the same folder treats each casing as a different tag: `collections.WordPress` and `collections.wordpress` are two collections. A tag archive template paginated over the tags and permalinked with `tag | lower` would write both to one URL, which Eleventy refuses as a duplicate permalink. A folder written through the CMS's editor and Micropub keeps one spelling per tag and does not hit this; a file edited by hand in another casing does, until the tag screen renames that tag to one spelling.

## Author

`author` names a **user**, by username. decision-14 makes each user an actor at
`/author/{username}/`, so a post's author is a person rather than a string: it
decides whose archive the post is on, whose byline it carries, and whose
followers hear about it.

The editor writes the username. A new document starts on whoever is signed in;
an existing one offers the site's users in a select, preselected to the one the
file names.

A file the CMS did not write is read as generously as possible, because a site
moving here has thousands of them. The value is matched first against every
username, exactly, and then — for a file written before this — against every
user's display name. A display name **exactly one** user answers to reads as
that user, on the page and in the index alike, so their posts appear on their
archive and their byline links to it without a file changing. Two people
answering to the same display name is not an attribution, and reads as nobody.

The mapping is read, not written: the file keeps what it says until the editor
next saves it, and that save writes the username. A name no user answers to is
kept and printed as it stands; it simply links nowhere.

A username has to survive as a URL segment, because it is one. The rules are in
`src/admin/credentials.ts`, and a name that would not is refused when the
account is created.

## Dates

Every date the CMS writes — `date`, `updated` and `activitypub.published` — is a UTC ISO 8601 instant ending in `Z`. The instant is the truth; the site's `timezone` setting is the lens it is read through (decision-11).

- The editor shows a stored instant as wall-clock time in the site's zone, names the zone under the field, and reads offset-less input as that zone. `2026-09-04 09:00` in a site set to `America/Chicago` is written as `2026-09-04T14:00:00Z`.
- The theme's `date` filter renders `readable`, `html` and `year` in the site's zone; `iso` stays the instant. Changing the setting changes what every page shows without a file changing.
- A new post's filename day and the `/{yyyy}/{mm}/` of its default permalink come from the calendar day the site's zone was on at that instant, taken once when the post is saved. The permalink is then written explicitly into the file, so changing the setting later never moves a URL.

A file written by hand is still read as it is. A `date` carrying an offset, or one YAML parses into a timestamp of its own, names an instant and is sorted, scheduled and rendered by it; the CMS rewrites it as UTC the next time it saves that file, never on a mere scan. A hand-written file with no `permalink` resolves to the URL Eleventy gives it, which is cut from the date exactly as the file spells it.

Feeds, the sitemap and the ActivityStreams objects emit instants and are not affected by the setting.

## Permalink rules

- Posts default to `/{yyyy}/{mm}/{slug}/`. Pages default to `/{slug}/`. Both are just defaults the admin form fills in; the stored value is what counts.
- Slug is derived on creation, lowercased, ASCII, hyphenated, and unique within the index (a repeat gets `-2`). It comes from the title, or for a post with no title from its first five words, or a read's title. A post with no title and no text is named after what it is (TASK-242): `liked-`, `reposted-`, `bookmarked-` or `reply-to-` and up to five words of the cited page's title (TASK-250), or, when that page could not be read within three seconds or has no title, up to four words of its address (its host without `www.`, then the path segments that hold a letter); or `photo`. `untitled` is the last fallback. A checkin's venue never names it, since the slug is public and the location is private. Only a new post is named this way: an existing one keeps its slug. Editing the slug later rewrites `permalink` but does not rename the file.
- Trailing slash is canonical. Requests without it redirect.

## Drafts and status

`draft: true` is the only status flag. There is no scheduled publishing in phase one; a future date with `draft: false` is simply published with that date, which matches 11ty. Trashing a post moves the file to `content/_trash/` (an underscore directory that Eleventy ignores) so it can be restored.

## Visibility

`visibility: unlisted` (TASK-227, TASK-219's visibility decision) serves a post or page at its permalink and leaves it off every list the site publishes: the home page, the tag, category and author archives, an `archive: true` page, previous and next links, every feed including the site-wide comments feed, the sitemap, search, `llms.txt`, IndexNow, the ActivityPub outbox and the featured collection. Its page answers with `X-Robots-Tag: noindex`, and the default theme prints `<meta name="robots" content="noindex">` from the `noindex` context flag. It still federates: its `Create` and `Update` are addressed `to` the author's followers with Public in `cc`, the swap of a public post's addressing, which Mastodon shows as unlisted, and relays are sent nothing about it. Webmentions still go out.

Public is the key's absence; the editor and Micropub remove the key rather than write `visibility: public`. There are no private posts. A value other than `public` or `unlisted` (a hand-typed `visibility: private`, a misspelling, a number) fails closed further: the document is not served, as if it were a draft. Its URL and its `.md` and `.json` answer 404, it is on no list, and a post the followers hold is withdrawn with a `Delete`. The editor offers the stored value as a third, selected choice and keeps it through a save until Public or Unlisted is chosen; the admin list marks the post Hidden; `q=source` returns the value as stored and a Micropub update that does not name `visibility` keeps it.

In code, `visibilityOf` answers `public`, `unlisted` or `{ unrecognized }`. `isServed` (draft, trash, schedule, a recognized visibility) says whether the site serves a document and `isListed` (served, and public) whether it lists it; the content index answers the same two rules in SQL. An Eleventy build with `docs/eleventy.config.example.js` reads the key in a preprocessor beside the draft one: `unlisted` sets `eleventyExcludeFromCollections`, so no collection and nothing built from one (a feed, a sitemap, an archive) holds the document, and sets the `noindex` flag for the layout to print as a robots meta; any other value returns `false`, so the build writes no page, as for a draft. A static build sends no `X-Robots-Tag` header and no `Delete`.

## Micropub

A post created over Micropub (TASK-164) is written by the editor's own write path, so its file is the one the editor would write for the same fields. decision-27 records why. Each property fills one editor field:

| Micropub property | Front matter |
| --- | --- |
| `name` | `title` |
| `content`, plain text | the body, as the Markdown it is |
| `content`, `{ "html": "…" }` | the body, as the HTML it is |
| `summary` | `description` |
| `category`, each value | `tags` |
| `in-reply-to` | `in-reply-to` |
| `rsvp` | `rsvp` |
| `like-of`, `repost-of`, `bookmark-of` | the key of the same name |
| `read-of` (an h-cite), `read-status` | `read-of` as a map of `name`, `author`, `uid` and `url`, and `read-status` |
| `published` | `date`, as a UTC instant; now when it is missing |
| `post-status: draft` | `draft: true`; `published`, or none, is `draft: false` |
| `mp-slug` | the slug, in the file name and the permalink |
| `visibility` | `unlisted` writes `visibility: unlisted`; `public` writes nothing. `private` is refused with its own message, and any other value by name |
| `photo`, each value | an entry in `photo`: a URL, or `{ "value": "…", "alt": "…" }` with its `alt`. A URL into the site's own uploads is written as its `/uploads/…` path. A file part of a multipart create is stored in the media library as the media endpoint stores one, and its path written; it is taken back out if the post is refused |
| `location` | nothing in the file. A `geo:` URI (`geo:LAT,LNG;u=ACC`, Quill's form), an h-geo, an h-adr or an h-card is parsed at the boundary and kept in `data/locations.json`, keyed by the post's permalink (TASK-223, decision-29). The editor's Location box writes the same entry. The file is private because `content/` may be a public repository; Settings > Privacy decides what a page or the ActivityStreams object shows of it, nothing by default. `q=source` answers it whatever the setting, as a `geo:` URI, an h-adr or an h-card with the coordinates nested as `geo` |
| `start`, `end` | `start` and `end`, as UTC instants; one without an offset is the site's zone, as `published` is (TASK-280). h-event only |
| `location` on an h-event | `location`, the event's place (decision-32): words as sent, or an h-card or h-adr reduced to its name, street address, locality, region and country joined by commas, or to its `url` when it names none. Its coordinates are dropped. A `geo:` URI is refused, since it has no words to show |
| `checkin` | the post's location, as `location` is, marked `checkin: true` in `data/locations.json` (TASK-236). An h-card only: its name, locality, region, country and coordinates are kept, and its `url`, `street-address` and `postal-code` dropped. A `location` sent beside it is the same place and fills in what the checkin leaves out. The editor's Location box shows the mark as A check-in. A reader sees an ordinary location, under the same setting. `q=source` answers it as `checkin`, an h-card |

`slug` and `syndicate-to`, which Quill accounts from before its renames send, are read as `mp-slug` and `mp-syndicate-to`. `p3k-content-type` (`text/plain` or `text/markdown`) is accepted and writes nothing (TASK-222); any other value is refused by name. `q=config` advertises `visibility: ["public", "unlisted"]`, and `q=source` answers every post's `visibility`.

The token's user is `author`. `h-entry` and `h-event` are created (TASK-280). An `h-event` goes through the editor's event fields, so the editor's refusals apply (an unreadable time, an end before the start, no name), and one without a `start` is refused; an `h-entry` that sends `start` or `end` is refused and pointed at `h-event`. On an `h-event`, `checkin` is still the author's own location in `data/locations.json`. In JSON, a property sent as a bare value rather than a list is read as one value, as Quill's event editor sends `location`, `content` and `end`. A property outside the table is kept verbatim in the private `data/kept-properties.json` and published nowhere (TASK-237, decision-27); an `mp-*` command the site does not support, another type, a second value where one is expected, or a value that is not text is refused by name and nothing is written.

An update (TASK-167) reads the same table backwards: `q=source` answers a post's front matter as those properties, with an upload's path as its absolute URL, and `action=update` applies `replace`, `add` and `delete` to them, fills only the editor fields the named properties own, and leaves every other key as it was. An event is read back as an `h-event` with `start`, `end` and `location` (its place); the author's own location is answered only when it is a checkin. Updating any of an event's `start`, `end` or `location` keeps the other two, and deleting its `start` is refused. A kept property outside the table is replaced, added to or deleted in `data/kept-properties.json`. `mp-slug` and unsupported `mp-*` commands are refused, so an update moves a URL only where an editor save with the same date would, which is a draft nobody has been shown. `action=delete` moves the file into `content/_trash/` as the editor's Move to trash does, and `action=undelete` moves it back. A post whose `author` is another user is refused.

## Markdown dialect

markdown-it with the same options 11ty uses by default (`html: true`), plus:

- footnotes
- heading anchors
- fenced code with language class only (no server-side highlighting)
- videos: a YouTube or Vimeo URL on a line of its own (decision-34)

Anything that must survive an Eleventy build is checked by a test that runs Eleventy against the fixtures directory.

### Videos

A YouTube or Vimeo URL that is a paragraph by itself, with a blank line before and after it, plays as the video. Write it bare or in `<…>`:

```markdown
The talk I gave in Berlin.

https://www.youtube.com/watch?v=dQw4w9WgXcQ

And the follow-up.

<https://vimeo.com/76979871>
```

The addresses it knows:

| Provider | Addresses                                                                                                                              |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| YouTube  | `youtube.com/watch?v=ID`, `/shorts/ID`, `/embed/ID` and `/live/ID` (with or without `www.` or `m.`), `youtu.be/ID`, `youtube-nocookie.com/embed/ID`. A `t` or `start` of seconds or `1h2m3s` starts the player there. |
| Vimeo    | `vimeo.com/ID`, `vimeo.com/ID/HASH` for an unlisted video, `vimeo.com/channels/NAME/ID`, `player.vimeo.com/video/ID` with an optional `h=HASH`. |

The page shows the provider's privacy-enhanced player (YouTube's `youtube-nocookie.com`, Vimeo with `dnt=1`), lazily loaded, in a `figure.video-embed` with the URL linked beneath it. The default theme README describes the markup. The Markdown and text/plain representations are the file, so they carry the URL as written; the JSON carries it in `markdown` and the player and link in `html`; the feeds carry the player and the link, so a reader that drops iframes still shows the address.

Anything else stays a link: a URL with words beside it, a `[link](url)` with words of its own (the way to link a video without playing it), a URL inside a list item or a blockquote, and a YouTube or Vimeo address that is not a video, such as a playlist or a channel.

The editor's Add video button asks for the address and puts it on a line of its own at the cursor, so nobody has to remember the blank lines. Eleventy prints the URL as text.
