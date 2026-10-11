# Webmentions

The open web's version of what ActivityPub does: one page telling another that
it linked to it. Both directions are on by default and each has a switch on the
Discussion settings page.

| Setting in `site.json` | What it does                                                               |
| ---------------------- | -------------------------------------------------------------------------- |
| `webmentionsSend`      | Tell the external pages a post links to, when it is published or edited.   |
| `webmentionsReceive`   | Advertise the endpoints and accept webmentions and pingbacks sent to them. |

**Sending** runs off the same index changes federation does, so a post saved in
the editor and one edited on disk are one thing, and a full scan sends nothing.
Every external link in the rendered body is asked whether it advertises a
Webmention endpoint — the `Link` header first, then the first `<link>` or `<a>`
with `rel="webmention"` — and told if it does. Both versions of an edited post
are read, so a page that has just been _unlinked_ is told too and can drop what
it was showing. One outcome is recorded per link (`sent`, `none` for a page that
takes none, or `failed`), shown per post on `/admin/federation`, and the Resend
button there sends them again from the file as it now reads.

**Links to the site's own pages** send no webmention. A post that cites another
post on the same site does not go through moderation, does not add to a comment
count and does not make an HTTP request to the site itself. The index records
the link instead. The linked post or page then lists the linking one among its
backlinks, which the default theme prints as "Linked from" under it, apart from
the comments. A link counts for the document the site serves at its URL: a link
to `/` counts for the page the Reading setting makes the homepage, and a link
to a URL the site redirects, such as an imported `/?p=123`, counts for the
document the redirect leads to. Redirects are followed when the backlinks are
read, so editing a redirect file moves a backlink without touching the post
that holds the link. A draft, future-dated, unlisted, private or trashed post is never
a backlink. See [Backlinks](theme/page-shell.md#backlinks) for the `backlinks` context.

**Receiving** advertises `/_geekity/webmention` two ways — a `Link` header on
every representation of a document, and a `<link rel="webmention">` in the head
— and takes a form `POST` of `source` and `target`. It answers `202` for
anything worth checking and `400` for anything that is not, and does the looking
afterwards: it fetches the source, checks it really links to the target, reads
its microformats (`h-entry`, `h-card`, and whether it is a reply, a like, a
repost or a plain mention), and files the result as a **pending comment** with
`source: "webmention"` in the same file, the same thread and the same moderation
queue as everything else — through the same `commentChecker` seam, so a checker
can tell one from a form submission by its `source`. Akismet is told it is a
`webmention` rather than a `comment`.

A reply whose `u-in-reply-to` names a reply already on the post (a comment by
its own page or its `#comment-{key}` anchor, an earlier webmention by the page it
was sent from, a fediverse reply by its url or id) threads under that reply, and
moves with it when the source is edited and sent again. A webmention sent to a
comment's page, `/comment/{key}/`, lands on that comment's post.

The source URL is its identity. A page that sends its webmention again updates
what it left rather than adding a second, and one whose link has gone — or which
answers 404 or 410 — takes it away. Closing rules do not apply: a post that
stopped taking comments still hears about a page that links to it, exactly as it
still hears a fediverse reply.

**Pingbacks** are how most WordPress sites say they linked here. The same
switch takes them at `/_geekity/pingback`, advertised as an absolute URL in an
`X-Pingback` header and a `<link rel="pingback">` on every post and on every
page that takes comments. A `pingback.ping(source, target)` XML-RPC call goes
through the same check, verification, spam checker and moderation queue as a
webmention and is filed as the same comment, so a link pinged and a link
mentioned are one entry. Because XML-RPC wants an answer, the source is read
before the endpoint replies, and a failure is one of the spec's fault codes:
`0x0010` for a source that does not exist, `0x0011` for one that does not link
here, `0x0020` for a target that does not exist, `0x0021` for a target that
takes no pingbacks, and `0x0030` for a ping sent again, which still rewrites
the entry from the source as it now reads. A body over 16 KB, XML that is not
well formed, and any document type declaration are refused with `-32700`
before anything is resolved. The CMS does not send pingbacks.

## Syndication targets

Some services copy a post when it links to them and sends them a webmention,
and answer with the address of the copy. IndieNews lists posts about the
IndieWeb; Bridgy Publish posts to Mastodon, Bluesky, GitHub and Flickr. The
CMS knows none of them by name. A site lists the ones it uses on the admin's
**Posts > Syndication** screen (`/admin/syndication`), which reads
and writes `content/_data/syndicationTargets.json`. The file stays the source of
truth, so it can still be edited by hand, and it looks like this:

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

An entry missing any of the first three, repeating an id, or with a `languages`
value that is not a list of language tags, is ignored. It is reported in the log
when the site starts, and the Syndication screen shows it with its problem so it
can be fixed or removed there. No file means no targets.

The screen has a panel for each entry, in file order, and an **Add a target**
form. A save is checked by the same rules the file is read by: a field that
breaks one is marked on the form and the file is left as it was. A save that
passes is written atomically, and the editor's **Syndicate to** checkboxes and
Micropub's `q=syndicate-to` offer the change on the next request. A save or
remove is refused when the entry changed in the file since the page was drawn.
A file that is not a JSON list is shown with its problem and never saved over.
To keep the default theme's old IndieNews link, add a target with the id
`indienews`, the url `https://news.indieweb.org/{lang}` and the tag `indienews`.

Some targets have a page per language. IndieNews has `news.indieweb.org/en`,
`/de`, `/fr` and more. Declare one target and put `{lang}` where the language
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

The CMS fills `{lang}` with the post's language: its `lang` front matter, or the
site's language when the post names none. With `languages`, a post in a
language the list does not name neither links to the target nor notifies it. A
regional tag counts as its language, so a `de-AT` post goes to
`news.indieweb.org/de`, and `{lang}` takes the tag from the list. Without
`languages`, `{lang}` takes the post's own tag as written, region and all.

A post selects targets in one of two ways:

- **By listing them.** The post editor has a **Syndicate to** checkbox for each
  target, and saving writes the ticked ids into the front matter as
  `syndicate-to: [indienews, mastodon]`. An id no target declares is kept as
  written.
- **By its tags.** A post tagged `indienews` is sent to the target whose `tag`
  is `indienews`, as the WordPress IndieNews plugin did.

The default theme links to each selected target at the start of the Published
line, inside the post's `h-entry`, as `<a class="u-syndication"
href="https://news.indieweb.org/en">IndieNews</a>`. That link is what IndieNews
and Bridgy Publish check for when they fetch the post. When the post is
published or updated, the sender adds each selected target to the pages it
notifies, the same way it adds the post a reply answers. Nothing is sent while a
page is served.

A target that answers `201` or `202` with a `Location` header has made a copy.
The address is kept in `content/_data/syndication.json`, keyed by the post's
permalink (decision-26), and the theme prints it after the dates as **Also on**
with a `u-syndication` link. A copy made by hand goes in the post's own front
matter, and is printed the same way:

```yaml
syndication:
  - https://mastodon.social/@me/113000000000000000
```

Removing a target from `syndicate-to`, or removing its tag, removes the link.
The sender then tells the target, as it tells any page a post stops linking to,
and the copy is dropped from `syndication.json`. IndieNews takes the post down
when it finds the link gone. Drafting or trashing the post does the same.

The posts table on `/admin/federation` lists each selected target with how its
last webmention went and a link to its copy, and **Resend** sends to the targets
again.
