---
id: doc-7
title: Webmentions
type: specification
created_date: '2026-09-04 23:08'
updated_date: '2026-09-12 21:02'
---
# Webmentions

A webmention is the open web's version of what ActivityPub does with a
`Create`: one page telling another that it linked to it. This site does both
halves — it tells the pages a post links to, and it takes what other pages send
it — and what arrives lands in the same thread, the same files and the same
moderation queue as a native comment (doc-6) and a fediverse reply (doc-4).

Both directions are switchable, `webmentionsSend` and `webmentionsReceive` in
`site.json`, on by default.

## Sending

Driven by the same index changes delivery is, so a post saved in the editor and
a post edited on disk are one thing here. A full scan sends nothing: the boot
scan reports a cold index as a directory full of creations, and telling every
page the archive has ever linked to on every rebuild would be a denial of
service with this site's name on it.

1. **The links.** Every external `<a href>` in the post's rendered body, each
   named once, fragment dropped. A link back into the site is not one: the
   conversation under a post is no place for a loop.
2. **The endpoint.** Per the W3C discovery order: the HTTP `Link` header first,
   then the first `<link>` **or** `<a>` carrying `rel="webmention"` in document
   order — one search over both, not one each — resolved against the URL the
   request actually ended at, so a target that redirects advertises its new
   home's endpoint. An `href` that is there but empty means the page itself.
3. **The POST.** `source` and `target`, form encoded, to that endpoint.

Both versions of a changed post are read, before and after, so a page that has
just been *unlinked* is told as well: it goes and looks, finds the link gone,
and drops what it was showing. That is the only way a webmention is withdrawn.

### What is recorded

One row per `(post, target)` in `webmentions_sent`, holding the endpoint, the
outcome and the reason. Three outcomes:

| Status   | What it means                                                                     |
| -------- | --------------------------------------------------------------------------------- |
| `sent`   | An endpoint accepted the notification.                                            |
| `none`   | The target advertises no endpoint. Most of the web; not a failure.                |
| `failed` | An endpoint was there and refused, with the reason in the row.                    |

Like `ap_deliveries`, this is a cache of outcomes and nothing else (decision-9):
the links are in the post's file, so a database thrown away costs the record of
how yesterday's notification went and not the ability to send it again. The
federation screen shows the counts per post, and its **Resend** button sends the
webmentions as well as the activity — it reads the file again rather than
replaying anything, so a link added since the last publish goes out.

## Receiving

The endpoint is `/_geekity/webmention`, one fixed path under the CMS's own
prefix like the comment form's, and every document advertises it two ways:

```
Link: </_geekity/webmention>; rel="webmention"
```

```html
<link rel="webmention" href="/_geekity/webmention" />
```

The header is on **every representation** of a document — HTML, Markdown and
JSON — because a sender is allowed to find the endpoint without parsing a page,
and two of the three have no head to put a `<link>` in. The theme's
`layouts/base.njk` writes the element from `webmention` on the context, which is
only there when the site takes them.

### The two steps

The endpoint decides in one request whether what it was handed could possibly be
a webmention, and answers without touching the network:

| Answer | When                                                                                   |
| ------ | ---------------------------------------------------------------------------------------- |
| `202`  | Two http(s) URLs, not the same one, the target a public document on this site.          |
| `400`  | Anything else, with a sentence saying which.                                            |
| `404`  | The site is not taking webmentions. Having no endpoint is what that looks like.         |
| `405`  | A `GET`, with `Allow: POST`, because a URL that is really there should say so.          |

A source on a loopback or private address is refused: it is not somebody else's
page, and fetching it would make this site a way of reaching machines nobody
outside can reach. That stops the obvious spelling and not a name that resolves
to one — a receiver that has to be sure has to check the address it connects to.

Everything that needs somebody else's server happens afterwards, on a queue of
its own. That is why a source that turns out to say nothing about this site
still gets a 202: the alternative is holding a connection open while a
stranger's server is fetched, which is a way of being held open by a stranger's
server.

### Verifying

The source is fetched, redirects followed, and no more than a megabyte read.

- **HTML** is parsed and searched for a real link — `href`, `src`, `data`,
  `poster` or `cite` — resolved against the page's `<base>` or the URL it was
  fetched from. The target written out in the prose is not a link and does not
  count.
- **Anything else** — plain text, JSON — is searched for the target as it
  stands, which is all a format with no links can offer.

Three endings, and they are the three things a source can be:

| The source                          | What happens                                                    |
| ----------------------------------- | ----------------------------------------------------------------- |
| Links here                          | Stored, or the one already held from it is rewritten.           |
| Does not link here, or is 4xx/gone  | Whatever it left is deleted. There is no other way to withdraw one. |
| Could not be read (5xx, timeout)    | Nothing changes. A bad afternoon must not delete last week.     |

The **source URL is the identity**. A blog post edited and re-sent updates the
comment it made rather than adding a second, and a moderator's decision stands
across an update: an approved mention is not put back in the queue and a spam
one is not quietly let out.

### What is read off the source

A deliberate subset of microformats2 — `h-entry` and `h-card` — and no more.
The entry chosen is the one that is actually about the target: the first
`h-entry` whose `in-reply-to`, `like-of` or `repost-of` names it, else the first
that links to it at all, else the first on the page.

| Property                | Becomes                                                        |
| ----------------------- | ---------------------------------------------------------------- |
| `u-in-reply-to`         | kind `reply`                                                   |
| `u-like-of`             | kind `like`                                                    |
| `u-repost-of`           | kind `repost`                                                  |
| anything else           | kind `mention`                                                 |
| `p-author` → `h-card`   | `author.name`, `author.url`, `author.avatar` (`u-photo`)       |
| `e-content`             | `content.html`, through `sanitizeCommentHtml`                  |
| `dt-published`          | `submitted`                                                    |

A page with no `h-entry` is still a mention: it is described from its `<title>`
and the host it is on, which is not a name but is the truest thing this site
knows. A like and a repost are stored wordless — a page's title is a title, not
a comment, and printing it under a post would be putting words in somebody's
mouth.

**No dependency.** `microformats-parser` is the usual choice, MIT licensed, and
it pulls `parse5` with it; it implements nested items, `hentry` backcompat,
`rel-urls`, the value-class pattern and implied properties in full, none of
which changes what ends up in a comment file. The subset here is around two
hundred lines (`src/webmention/microformats.ts`, over a small tree parser in
`src/webmention/html.ts`) against a dependency tree, so it is the subset.

### Where it lands

A comment in the post's file, `source: "webmention"`, `status: "pending"` — see
doc-6 for the shape and the two keys a webmention fills in that a form does not.

Nothing here writes it. What this module does is read the source and hand
`intakeComment` a proposed comment, exactly as the form under a post does
(doc-6, "One door in"): the file, the index, the `CommentChecker` seam, the
verdict-to-status rule and the moderation notice are then the very ones a
native comment gets. Three things follow, and none of them is decided here.

- A checker sees `comment.source === 'webmention'` and can tell Akismet it is a
  webmention rather than a comment. The shipped Akismet checker does exactly
  that: with a key in `data/akismet.json` an incoming webmention is sent to
  `comment-check` with `comment_type: webmention`, and a `true` answer files it
  as spam or drops it entirely (doc-6). The post a checker is told about is the
  `target` its sender named, because that is the URL the conversation is about.
- A page that is edited and re-sent rewrites the entry it made, and a
  moderator's decision on that entry stands unless the fresh verdict is `spam`.
- The moderators are emailed about a mention the first time it lands and not
  when it is rewritten, because a source updating its entry is not new news.

The one thing this module still decides on its own is a source that has stopped
linking here or has gone: it looks up the entry that source left, deletes it,
and never reaches the intake at all. There is no other way to withdraw a
webmention, and no verdict is involved.

What it is *not* held by is the closing rules. `commentsOpen` is asked by the
form and by the form's endpoint and nowhere else: a post that stopped taking
comments a year ago still hears about a page that links to it, exactly as it
still hears a fediverse reply, because neither is something this site can stop
happening.

## On the page

A `reply` threads with the comments. A `repost` joins the boosts, because to a
reader they are the same act under two vocabularies. A `like` joins the likes. A
`mention` is neither an answer nor a reaction and gets a list of its own,
`conversation.mentions`, which the packaged partial draws as a `<details>` of
who linked here. Every one of them links to the page it came from rather than to
an anchor on this one, and carries the face its `h-card` gave it. An Eleventy
build of the same content directory shows the same thing from the same files.

## Testing it

The test suite reaches no network. `src/webmention/receive.test.ts` reproduces
the webmention.rocks receiver cases against a stubbed web — the link in an `<a>`,
a `<link>`, an `<img>`, a `<video>`, written relative, behind a redirect, in
plain text, in JSON, only in the prose, inside a `<script>`, gone from a page
that had it, and a source answering 404, 410 or 503 — and
`src/webmention/send.test.ts` publishes a post into a make-believe web and
checks what went where. A live run against <https://webmention.rocks/> needs a
public URL and belongs to whoever deploys the site.
