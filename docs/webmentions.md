# Webmentions

A webmention is one page telling another page that it links to it. It does on
the open web what ActivityPub does on the fediverse. Sending and receiving are
both on by default. Each has a switch on the Discussion settings page.

| Setting in `site.json` | What it does                                                               |
| ---------------------- | -------------------------------------------------------------------------- |
| `webmentionsSend`      | Tell the external pages a post links to, when it is published or edited.   |
| `webmentionsReceive`   | Advertise the endpoints and accept webmentions and pingbacks sent to them. |

**Sending** runs on the same index changes as federation. A post saved in the
editor and a post edited on disk are handled the same way. A full scan sends
nothing.

For every external link in the rendered body, the sender looks for a
Webmention endpoint. It checks the `Link` header first, then the first `<link>`
or `<a>` with `rel="webmention"`. If the page has an endpoint, the sender
notifies it. The sender reads both versions of an edited post, so it also
notifies a page that was just _unlinked_. That page can then drop what it was
showing.

The sender records one outcome per link:

- `sent`
- `none`, for a page that takes no webmentions
- `failed`

`/admin/federation` shows the outcomes per post. The Resend button there queues
a job that sends them again from the file as it reads when the job runs.

**Only public addresses are fetched.** This covers the target page the sender
reads for an endpoint, the endpoint it posts to, and the source the receiver
verifies. Before each request, and again before following each redirect, the
site resolves the host name. It refuses the request when any address is
loopback, private, link-local or reserved, and the connection goes to the
address that passed the check, not to a second resolution of the name. A
refused endpoint is recorded as
`failed`. A refused source is treated as unreachable, so nothing already stored
from it changes.

**Links to the site's own pages** send no webmention. A post that cites another
post on the same site does not go through moderation, does not add to a comment
count, and does not make an HTTP request to the site itself. The index records
the link instead. The linked post or page lists the linking post among its
backlinks. The default theme prints backlinks as "Linked from" under the post,
separate from the comments.

A link counts for the document the site serves at its URL:

- A link to `/` counts for the page that the Reading setting makes the
  homepage.
- A link to a URL the site redirects, such as an imported `/?p=123`, counts for
  the document the redirect leads to.

The site follows redirects when it reads the backlinks. Editing a redirect file
moves a backlink without changing the post that holds the link. A draft,
future-dated, unlisted, private, or trashed post is never a backlink. See
[Backlinks](theme/page-shell.md#backlinks) for the `backlinks` context.

**Receiving** advertises `/_geekity/webmention` in two ways:

- a `Link` header on every representation of a document
- a `<link rel="webmention">` in the head

The endpoint takes a form `POST` of `source` and `target`. It answers `202`
for a request worth checking and `400` for one that is not. A source on the
site's own origin gets `400`, as does a source that names the target page, with
or without a fragment. The site does not fetch its own pages, and a link
between them is a backlink, not a comment. It does the checks after it
answers:

1. It fetches the source, up to its first megabyte. It decodes the source in
   the character encoding that its `Content-Type` names. When the header names
   none, it uses the encoding that a `<meta>` element in the first kilobyte
   names. Otherwise it uses UTF-8.
2. It checks that the source links to the target.
3. It reads the source's microformats: `h-entry`, `h-card`, and whether it is a
   reply, a like, a repost, or a plain mention. It reads at most 1,000
   microformats from one page and at most 16 property classes from one
   element. It keeps the first 64 KiB of the text and of the markup of each
   property value, so a longer `e-content` is cut short.
4. It files the result as a **pending comment** with `source: "webmention"`.

The comment goes in the same file, the same thread, and the same moderation
queue as every other comment. It goes through the same `commentChecker` seam.
A checker can tell a webmention from a form submission by its `source`. The
site reports a webmention to Akismet as a `webmention`, not as a `comment`.

A reply can name, in `u-in-reply-to`, a reply that is already on the post:

- a comment, by its own page or its `#comment-{key}` anchor
- an earlier webmention of any kind (a reply, like, repost, mention or RSVP),
  by the page it was sent from
- a fediverse reply, by its url or id

The new reply threads under the named reply. When the source is edited and
sent again, the reply moves with it. A webmention sent to a comment's page,
`/comment/{key}/`, lands on that comment's post.

The endpoint refuses a target on this site with a query string, because no
page here has one.

The source URL, without any fragment, identifies a webmention: `X` and
`X#reply` are one source. When a page sends its webmention again, the site updates the earlier entry and does not add a second one. When
the link is gone from the source, or the source answers 404 or 410, the site
removes the entry. Any other failure to read the source, such as a 401, 403,
408, 429, 451 or 5xx answer or a timeout, changes nothing. A source larger
than a megabyte that has no link to the target in its first megabyte also
changes nothing, because the link can be in the part that was not read. A source that does
not link to the target but still links to another URL of the same post keeps
its entry. Those URLs are the post's page, a former permalink, a comment page
on the post, and a syndicated copy.

The kind of a webmention is read against every one of those URLs, not only
the target the sender named. A page that likes the post and links one of its
comment pages is a like whichever of the two is sent as the target.

An approved entry stays approved only while the page says the same thing. When
its kind, author name, author link, author photo or words change, the site
decides the entry again as if it were new: it goes back to the moderation queue
and the moderators get a new notice. Until a moderator approves it again, the
post does not show it, and its replies sit under a placeholder that says the
comment is no longer shown. A pending entry stays pending and sends no new
notice. A spam entry stays spam. When the page gives no `dt-published`, the
entry keeps the date it was first stored with.

Closing rules do not apply. A post that no longer takes comments still receives
webmentions, as it still receives fediverse replies.

**Pingbacks** are how most WordPress sites report a link. The
`webmentionsReceive` switch also accepts them at `/_geekity/pingback`. The
site advertises the endpoint as an absolute URL in an `X-Pingback` header and
a `<link rel="pingback">` on every post and page.

A `pingback.ping(source, target)` XML-RPC call goes through the same check,
verification, spam checker, and moderation queue as a webmention. The site
files it as the same comment, so a link that was pinged and mentioned is one
entry. XML-RPC expects an answer, so the endpoint reads the source before it
replies. A failure returns one of the spec's fault codes:

| Code     | Meaning                                                                                                                                                                                                                                                                     |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0x0000` | The source could not be read this time: it timed out, the server failed, or it answered any 4xx status other than 404 and 410, or it is larger than a megabyte and has no link in the part that was read. Nothing stored changes. Also sent when the ping was not accepted. |
| `0x0010` | The source answers 404 or 410, its URL is not a public `http` or `https` page, or it is a page on this site.                                                                                                                                                                |
| `0x0011` | The source does not link here.                                                                                                                                                                                                                                              |
| `0x0020` | The target does not exist.                                                                                                                                                                                                                                                  |
| `0x0021` | The target takes no pingbacks.                                                                                                                                                                                                                                              |
| `0x0030` | The ping was sent before. The site still rewrites the entry from the source as it reads now.                                                                                                                                                                                |
| `-32700` | The body is over 16 KB, the XML is not well formed, or it has a document type declaration. The site refuses these before it resolves anything.                                                                                                                              |

The CMS does not send pingbacks.

## Syndication targets

Some services copy a post when the post links to them and sends them a
webmention. They answer with the address of the copy. IndieNews lists posts
about the IndieWeb. Bridgy Publish posts to Mastodon, Bluesky, GitHub, and
Flickr. The CMS does not know any of them by name.

List the targets your site uses on the admin's **Posts > Syndication** screen
(`/admin/syndication`). The screen reads and writes
`content/_data/syndicationTargets.json`. The file is the source of truth, and
you can also edit it by hand:

```json
[
  {
    "id": "indienews",
    "name": "IndieNews",
    "url": "https://news.indieweb.org/en",
    "tag": "indienews"
  },
  {
    "id": "mastodon",
    "name": "Mastodon",
    "url": "https://brid.gy/publish/mastodon"
  }
]
```

| Key         | What it is                                                                                    |
| ----------- | --------------------------------------------------------------------------------------------- |
| `id`        | What a post's `syndicate-to` lists. Letters, digits, `.`, `-` and `_`.                        |
| `name`      | What the editor's checkbox and the post's link say.                                           |
| `url`       | The page the post links to and sends its webmention to. May hold `{lang}`.                    |
| `tag`       | Optional. A post carrying this tag is sent to the target without listing it.                  |
| `languages` | Optional. The language tags the target takes posts in. A post in any other language skips it. |

The site ignores an entry that is missing any of the first three keys, repeats
an id, or has a `languages` value that is not a list of language tags. It
reports the entry in the log when the site starts. The Syndication screen shows
the entry with its problem, so you can fix or remove it there. With no file,
the site has no targets.

The screen has a panel for each entry, in file order, and an **Add a target**
form. A save is checked by the same rules the site uses to read the file. If a
field breaks a rule, the form marks it and the file stays unchanged. A save
that passes is written atomically. The editor's **Syndicate to** checkboxes and
Micropub's `q=syndicate-to` offer the change on the next request. The screen
refuses a save or remove when the entry changed in the file after the page was
drawn. If the file is not a JSON list, the screen shows the problem and never
saves over the file.

To keep the default theme's old IndieNews link, add a target with the id
`indienews`, the url `https://news.indieweb.org/{lang}` and the tag `indienews`.

Some targets have a page per language. IndieNews has `news.indieweb.org/en`,
`/de`, `/fr`, and more. Declare one target and put `{lang}` where the language
goes:

```json
{
  "id": "indienews",
  "name": "IndieNews",
  "url": "https://news.indieweb.org/{lang}",
  "tag": "indienews",
  "languages": ["en", "de", "fr"]
}
```

The CMS fills `{lang}` with the post's language. That is its `lang` front
matter, or the site's language when the post names none.

- With `languages`, a post in a language the list does not name does not link
  to the target and does not notify it. A regional tag counts as its language,
  so a `de-AT` post goes to `news.indieweb.org/de`. `{lang}` takes the tag from
  the list.
- Without `languages`, `{lang}` takes the post's own tag as written, including
  the region.

A post selects targets in one of two ways:

- **By listing them.** The post editor has a **Syndicate to** checkbox for each
  target. Saving writes the ticked ids into the front matter as
  `syndicate-to: [indienews, mastodon]`. An id that no target declares is kept
  as written.
- **By its tags.** A post tagged `indienews` is sent to the target whose `tag`
  is `indienews`. The WordPress IndieNews plugin worked the same way.

The default theme links to each selected target at the start of the Published
line, inside the post's `h-entry`, as `<a class="u-syndication"
href="https://news.indieweb.org/en">IndieNews</a>`. IndieNews and Bridgy
Publish check for that link when they fetch the post. When the post is
published or updated, the sender adds each selected target to the pages it
notifies. It adds the post that a reply answers in the same way. Nothing is
sent while a page is served.

A target that answers `201` or `202` with a `Location` header has made a copy.
The site keeps the address in `content/_data/syndication.json`, keyed by the
post's permalink (decision-26). The theme prints it after the dates as **Also
on**, with a `u-syndication` link. To record a copy you made by hand, add it to
the post's own front matter. The theme prints it the same way:

```yaml
syndication:
  - https://mastodon.social/@me/113000000000000000
```

Removing a target from `syndicate-to`, or removing its tag, removes the link.
The sender then notifies the target, as it notifies any page a post stops
linking to, and drops the copy from `syndication.json`. IndieNews takes the
post down when it finds the link gone. Drafting or trashing the post has the
same effect.

A `syndication.json` that cannot be read as a JSON object is read as empty,
and the site logs a warning that names the file once, so pages show no
**Also on** links in the meantime. The site does not write over a damaged
file: recording or dropping a copy fails, and logs why, until the file is
fixed.

The posts table on `/admin/federation` lists each selected target with the
result of its last webmention and a link to its copy. **Resend** queues a job
that sends to the targets again.
