---
id: decision-19
title: >-
  A reply's fetched context lives in content/_data/replyContexts.json, keyed by
  the URL it answers
date: '2026-09-23 19:29'
status: accepted
---
## Context

TASK-123 gives a reply a preview of the post it answers: that post's name or a short excerpt, its author and its date. The post is on somebody else's site, so the preview needs data fetched from there. A page request must never make that fetch. It happens when a reply is saved or synced, and what it finds has to be kept somewhere a later page request can read.

decision-1 makes the files the source of truth and the database an index. decision-9 extends that to every piece of durable state: what cannot be rebuilt from the files lives in a file, and `data/geekity.db` may be deleted at rest. A fetched context is a snapshot of a stranger's page. It can be fetched again, but not always with the same result: the page may have changed, moved or gone. A database rebuild that forgot every context would also have to fetch every reply target again, from every boot of a cold index.

Three places were considered.

- **The index.** A column or a table in SQLite. A deleted database loses every preview and refetches every target, and decision-9 says nothing irreplaceable goes there.
- **The reply's own front matter.** Self-contained, but the CMS would rewrite an author's file after every save and every hand edit, which fights the admin's content hash and the file watcher, and mixes a stranger's words into the author's.
- **A data file beside `site.json`.** One JSON object, keyed by the URL a reply answers.

## Decision

The fetched contexts live in `content/_data/replyContexts.json`: one object whose keys are the absolute URLs replies answer, each holding the `name`, `text`, `author` (`name`, `url`) and `published` that page gave, and only those it gave. The file is written atomically, like every other file the CMS writes (decision-9).

- It is in `content/`, not `data/`, because the preview is public: it is printed on a public page, and an Eleventy build of the same directory can read it as the `replyContexts` global.
- It is keyed by the target rather than by the reply, so two replies to one post share one entry, and a reply whose `in-reply-to` changes shows nothing stale: the page looks up whatever the file says now.
- The index gains no column. Rendering a reply reads the file (parsed again only when its bytes change), the way `site.json` is read.
- A save or a sync fetches a target when the reply's `in-reply-to` changed, or when the file holds nothing for it. A scan fetches only what the file has never held, so a deleted database costs no fetches. When the site starts serving it fetches every target a live post replies to that the file lacks, so an upgraded site, or one whose file was removed, catches up without each reply being edited. An entry no live post replies to any more is removed.

## Consequences

- Deleting the database loses no preview, and rebuilding the index sends no request to anybody.
- The file enters the site's git history, with the names of the people whose posts were answered. They published those names on the page the reply links to; git makes them permanent, as it does for followers (decision-9).
- A person can correct or remove an entry by hand. The reader drops an entry that is not a context rather than failing a render.
- A target that could not be read leaves no entry. The reply shows a link-only preview and the next save or boot tries again.
- A preview is as fresh as its last fetch. Nothing refetches a target that has not changed. If previews ever need refreshing on a schedule, that is a job over this file, not a change to where it lives.

## Amendment (2026-10-03, TASK-244)

The file also holds the contexts of what a post likes, reposts or bookmarks. Its keys are every absolute URL a live post cites under `in-reply-to`, `like-of`, `repost-of` or `bookmark-of`, and an entry has the same shape whichever property cites it. Two posts that cite one page share one entry, whatever their kinds. The rules above apply to each cited URL: a save or sync fetches a target that is new to the post or that the file lacks, a scan fetches only what the file has never held, starting to serve catches up on what is missing, and an entry no live post cites any more is removed. The file keeps its name, because a site's theme and its Eleventy build read it as `replyContexts`.

A page with no `h-entry` is also asked for its oEmbed description, when it names a JSON endpoint in a `<link rel="alternate" type="application/json+oembed">`. Only the endpoint's `title`, `author_name` and `author_url` are kept, and they are preferred over the page's `<title>` and `og:title`. Its `html` is never kept or printed. The endpoint is fetched with the same guards as the page and within what is left of the page's one timeout. A failed or absent endpoint leaves the page described as before.

## Amendment (2026-10-03, TASK-246)

A cited page bigger than the byte limit is no longer refused. Its first `maxBytes` are read and the rest is never fetched, so a page such as a YouTube watch page, which runs past the limit, still gives the `<title>`, `og:title`, description and oEmbed `<link rel="alternate">` in its head. An `h-entry` is trusted only from a page read in full: a cut-off entry could be missing its author, its date or most of its text, so a truncated page is described by its head and its oEmbed endpoint alone. The oEmbed answer keeps the old rule and is refused when it is over the limit, because cut-off JSON does not parse. The guarded fetch that every other caller shares still refuses an oversized body; reading up to the limit is an option only the cited-page fetch takes.

## Amendment (2026-10-03, TASK-250)

A new post with no title and no text that cites a page is named after that page's title, so the fetch for such a post happens during the save rather than after it. The save takes the stored context when the file holds one. Otherwise it fetches the target once, with the same guards and byte limit as every other context fetch but a three-second timeout instead of ten, and waits for the answer. A context it found is written to the file before the post is, and the save's own change does not fetch that target again. A target that fails, has no title or does not answer in three seconds leaves the file as it was; the post is named after the target's address, and the change after the save fetches the target as before, with the full timeout. An edit never fetches during the save, since an existing post keeps its slug.

## Amendment (2026-10-03, TASK-251)

Some providers name no oEmbed endpoint on the page they serve a server, or refuse the server the page, while their endpoint answers it. A YouTube watch page can be a bot check whose `<title>` is only " - YouTube"; TikTok's page says "TikTok - Make Your Day" and Reddit's "Reddit", or Reddit answers 403. So the CMS keeps a table of providers whose JSON oEmbed endpoint is known, matched by host and path:

| Provider | Cited URLs                                                                     | Endpoint                         |
| -------- | ------------------------------------------------------------------------------ | -------------------------------- |
| YouTube  | `youtube.com`, `www.youtube.com`, `m.youtube.com`: `/watch?v=…`, `/shorts/…`   | `https://www.youtube.com/oembed` |
| YouTube  | `youtu.be/…`                                                                   | `https://www.youtube.com/oembed` |
| TikTok   | `tiktok.com`, `www.tiktok.com`: `/@user/video/…`                               | `https://www.tiktok.com/oembed`  |
| Reddit   | `reddit.com`, `www.reddit.com`: `/r/…/comments/…`                              | `https://www.reddit.com/oembed`  |

The endpoint is asked with `format=json` and the cited URL. A page's own oEmbed link still wins; the table is asked when the page names none, and also when the page itself could not be fetched, so a refused page still gets a title. An `h-entry` still wins over either. The table's endpoint is fetched with the same guards, byte limit and one deadline as a discovered one, and only its `title`, `author_name` and `author_url` are kept. When the page failed and the endpoint gives nothing, the fetch fails with the page's own reason, as before.

Without oEmbed, a page's `og:title` is now preferred over its `<title>`, which often carries a " - Site" suffix, and a title that is nothing but such a suffix (it starts with a separator such as "-", "|" or "·" and a space) counts as no title. Instagram is left out of the table: its endpoint needs a Facebook app token.

## Amendment (2026-10-03, TASK-253)

The table is now asked before the page, not after it. For a provider in the table the page's own oEmbed link is the same endpoint, so reading the page first bought nothing, and at TASK-250's 3 s save-time deadline a youtu.be link (a redirect to a ~1 MB watch page) could spend the whole deadline on the page and leave none for the endpoint. Giphy joins the table: its page names no oEmbed endpoint and its title ends in " - Find & Share on GIPHY", while its endpoint answers with the clean title, the author and the GIF.

| Provider | Cited URLs                                                                     | Endpoint                            |
| -------- | ------------------------------------------------------------------------------ | ----------------------------------- |
| YouTube  | `youtube.com`, `www.youtube.com`, `m.youtube.com`: `/watch?v=…`, `/shorts/…`   | `https://www.youtube.com/oembed`    |
| YouTube  | `youtu.be/…`                                                                   | `https://www.youtube.com/oembed`    |
| TikTok   | `tiktok.com`, `www.tiktok.com`: `/@user/video/…`                               | `https://www.tiktok.com/oembed`     |
| Reddit   | `reddit.com`, `www.reddit.com`: `/r/…/comments/…`                              | `https://www.reddit.com/oembed`     |
| Giphy    | `giphy.com`, `www.giphy.com`: `/gifs/…`                                        | `https://giphy.com/services/oembed` |

A cited URL in the table is first asked of its endpoint. When the answer names a title or an author, that is the context and the page is not read, so its description is not kept either. When the endpoint fails or names nothing, the page is read with what is left of the one deadline: an `h-entry` wins, then `og:title` and `<title>`, and the page's own oEmbed link is not asked, since it is the endpoint that just failed. When no time is left the page is not fetched. When both fail, the fetch fails with the page's own reason, as before. A URL not in the table is unchanged: its page first, then the oEmbed endpoint the page links when it has no `h-entry`.

## Amendment (2026-10-03, TASK-252)

A context also keeps the cited page's picture, and the picture itself is copied into the site. Hotlinking it would have every reader's browser ask the cited site or its CDN for it, and the post would lose it when the original went away.

The picture is, in order: an oEmbed answer's `url` when its `type` is `photo` (Giphy's GIF), else its `thumbnail_url` (YouTube's `hqdefault.jpg`), else the page's `og:image`, else its `twitter:image` or `twitter:image:src`. A known provider's endpoint can name a title suffix it appends to every title, which is cut off: Giphy's " - Find & Share on GIPHY".

The picture is fetched with the same guards as the page (public hosts only, every redirect checked, a 10-second timeout of its own), held to the site's `uploadMaxBytes`, the limit an author's own upload is held to (10 MiB by default, which a Giphy GIF fits), and refused unless its first bytes are a PNG, JPEG, GIF, WebP or AVIF. Its metadata is stripped as an upload's is, and its variants are derived as an upload's are. It is written to `content/uploads/cited/`, named after the first 16 hex digits of the SHA-256 of its stripped bytes, so copying the same picture twice writes one file and two contexts can share it. The media library leaves that directory out: the copies are this file's to keep and delete, not the author's.

The entry records it as `picture`: `src` (its public path, always under `/uploads/cited/`), `width` and `height` (read from the stripped file, not from the provider), `kind` (`photo` or `thumbnail`), and `video: true` for a video's thumbnail. A picture that fails, is too big or is not an image leaves the entry without one, as before. A save that names a new post after its target stores the context at once and copies the picture after the save, so the 3-second deadline is spent on the title only.

A page that names no author keeps its `og:site_name` as `site`, which a citation prints as plain text after the title.

A picture is forgotten with the last entry that names it. Whenever an entry is removed or replaced, and when the site starts serving, every file under `content/uploads/cited/` that no entry names is deleted with its variants, so a copy left by a crash or by an entry removed by hand goes too.

A post can hide the previews of what it cites with `preview: false` in its front matter, which the editor writes; the picture stays in the file, so clearing the box shows it again without a fetch.

## Amendment (2026-10-03, TASK-255)

A cited URL can be an image rather than a page about one: a repost of a bare PNG on a vendor's CDN. The page fetch already reads the response's `Content-Type`, so that is how an image is recognised, with no `HEAD` and no second request inside the one deadline. The fetch takes `image/*` beside HTML, and for an image it reads the headers only and cancels the body. The context is the URL alone, and its picture is the URL the image came from after any redirects, of kind `photo`. The picture is then copied exactly as any other (TASK-252): its own guarded fetch with its own 10-second timeout, held to `uploadMaxBytes` rather than the page limit, its signature checked, its metadata stripped, stored under `content/uploads/cited/`. That copy is the one download of the image's bytes.

An entry with nothing to show but its picture, no name, text, author or site, is kept only with the picture. An image that fails, is not one, or is over the limit leaves no entry, and the next save or start tries again, as a target that could not be read does. At save time (TASK-250) an image has no title to spend the three seconds on, so the save copies it within what is left of them and stores the entry with its picture, or stores nothing and leaves it to the change after the save.

An entry whose picture is a `photo` and which has no name and no author is an image. A citation of one says "an image from" the URL's host, as the link; a citation with nothing stored says "a page on" its host. The bare URL is never the link text, on the page, in a listing or in a feed.

A post describes an image it cites with `cited-alt` in its front matter, which the editor's card for a reposted image writes. Its alt text is `cited-alt`, else the post's title, else empty. With `requireAltText` on, a published save whose repost of an image would be shown in full with neither is refused. A new post asks the image within the save's deadline, as naming it does, and an edit reads only the stored entry.

## Amendment (2026-10-05, TASK-199)

A cited page is described from every source it offers, in this order: its `h-entry`, the ActivityPub object it names with `<link rel="alternate" type="application/activity+json">` (asked only when there is no `h-entry`), the oEmbed answer, its `application/ld+json` scripts, and then its `og:`, `twitter:` and `article:` tags and `<title>`. Each source fills only the fields the sources before it left empty. An `h-entry` or fediverse object with text decides the name, so a note keeps none. A later source adds a URL, handle or photo to the author only when it names the same person. An `h-entry` with no properties of its own is not a source, so an empty `<article class="h-entry">` does not hide the page's JSON-LD.

The ActivityPub object and its actor are fetched signed as the site's first account, as handle and profile lookups are, because servers in authorized-fetch mode refuse an unsigned fetch. The fetch stays within the one deadline and is held to public hosts.

The author gains two optional fields. `handle` is the fediverse `user@host`. `photo` is the author's picture, `{src, width, height}`. It comes from the author h-card's `u-photo`, or from an h-card elsewhere on the page that names the same person, or from the actor's icon. It is copied into `content/uploads/cited/` with the same guards as the picture (TASK-252), and the same sweep keeps or deletes it. `preview: false` hides it with the picture.

## Amendment (2026-10-05, TASK-197)

A cited page can be a silo's copy of a post on another site (original-post-discovery). After the page is read, the URLs it names for itself are candidates for the original: its `h-entry`'s `u-url` and `u-uid`, its `rel=canonical` link, and the `url` of the ActivityPub object it links. Only a candidate on another host than the copy is asked, so a page whose own permalink or canonical is on its own site costs no second fetch. A candidate is the original only when its page lists the copy, as cited or after redirects, under its `h-entry`'s `u-syndication` or a `rel=syndication` link. Without that claim back, any page could pass itself off as a copy of somebody else's post. The candidate is fetched with the same guards as the page and within what is left of the one deadline. A known oEmbed provider's URL is not asked about.

The entry stays keyed by the URL the post cites. It gains `original`, the URL of the original page as read, and every other field describes the original, read through the same source chain. A copy with no confirmed original is described as itself, as before.

Only a reply acts on it. The reply's front matter is never rewritten, so its `in-reply-to` stays the copy, and a federated reply's `inReplyTo` stays the copy as well. Its page cites the original in the `u-in-reply-to h-cite` and prints the copy beside it as a second `u-in-reply-to`, so the silo can thread the reply and the original's site finds a link to itself. The webmention sender tells the original as well as the copy. A reply saved before its context was fetched is told when the context first records an original, or a different one. A feed's citation line links the original. A like, repost or bookmark of a copy keeps citing the copy; its entry may still record an original.

## Amendment (2026-10-05, TASK-198)

An RSVP cites an event, so an entry may also hold when the event starts and where. A page's first `h-event` is a source after its `h-entry`: its `p-name`, its `p-summary`, `p-description` or `e-content` as text, its `dt-start` and its `p-location`, a nested `h-card` or `h-adr` read as its name. A schema.org `Event`, or one of its kinds such as `MusicEvent`, in the page's JSON-LD is a source after the posting types: its `name`, `description`, `startDate` and the `name` of its first `location`, or the location itself when it is text. An `h-event`, like an `h-entry`, is trusted only from a page read in full.

The entry gains `start` and `location`, each only when the page gives it. A start written with a zone is kept as an ISO 8601 instant in UTC, as `published` is. A start with no zone, a date or a date and time, is the wall clock where the event is, so it is kept as written (`2026-10-14` or `2026-10-14T18:30`) and printed in UTC, which no site's zone can move. A start that is no date is dropped. An entry whose only fields are a start or a place is still kept.
