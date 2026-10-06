---
id: decision-27
title: >-
  A Micropub create fills the editor's form and goes through the editor's write
  path, and refuses what it cannot map
date: '2026-10-02 15:16'
status: accepted
---
## Context

TASK-164 lets a Micropub client create a post. The post has to come out as the admin editor would have written it: the same file name, slug, permalink, author, front matter order, and the same announcement to the webmention sender, the federation and the feeds. Two ways were considered.

- **A second writer for Micropub.** Build `DocumentContent` from the mf2 properties and call `saveDocument`. It would have to repeat the slug, permalink, filing day, author, alt text and extra-key rules, and would drift from the editor the first time either changed.
- **The editor's own write path.** Split the editor's save into an HTTP shell and a core, `writeDocument` in `src/admin/documents.ts`, which takes plain values (the store, the config, `announce`, the writing user) and an `EditorForm`. Micropub fills in an `EditorForm` and calls the same core.

## Decision

- Micropub goes through `writeDocument`. A create is a new post (`POST_KIND`), so the core decides the slug, the permalink, the file, and the announcement exactly as it does for the editor's New post. The announcement's origin is `admin`, the same as the editor's.
- The token's user is the author and the writer.
- The properties map onto editor fields:

| Micropub property | Editor field | Front matter |
| --- | --- | --- |
| `h=entry` / `type: ["h-entry"]` | (the only type accepted) | |
| `name` | Title | `title` |
| `content` (plain) | Body, as written: plain text is the Markdown it is | the body |
| `content` (`{ "html": "…" }`) | Body, the HTML as sent | the body |
| `summary` | Description | `description` |
| `category` (each value) | Tags | `tags` |
| `in-reply-to` | In reply to | `in-reply-to` |
| `published` | Date; an offset-less date is the site's zone, a missing one is now | `date` |
| `post-status` `draft` / `published` | Save draft / Publish | `draft` |
| `mp-slug` | Slug | the slug in the file name and permalink |

- Anything else is refused with 400 `invalid_request` naming it, and nothing is written: another type (`h-event`), any other property (`like-of`, `photo`, `location`, `mp-syndicate-to`), a second value for a property that takes one, a value that is not text, a category containing a comma, and a `post-status` other than the two. The editor's own refusals, such as an `in-reply-to` that is not a web address, come back the same way with the editor's message.
- `access_token` in a form body is the token, not a property.
- A create answers 201 with `Location` set to the new post's absolute permalink, draft or not.

## Consequences

- An editor rule changes Micropub posts with it, with nothing to keep in step. A test writes the same post both ways and compares the bytes.
- A client is told what did not land instead of finding it missing later.
- Each later Micropub task (photos, likes and reposts, syndication, update, delete) widens the mapping here and in doc-2 instead of adding a path of its own.
- HTML content is stored as HTML inside the Markdown body. markdown-it passes it through (`html: true`), and Eleventy does the same, but HTML that holds a blank line inside one element may be split at it.
- Categories become tags only. The site's second taxonomy, `categories`, is not reachable from Micropub.

## Amendment (TASK-222, 2026-10-02): properties accepted and not stored

Quill sends two properties that change nothing the site writes. Refusing them refused Quill's posts; mapping them would store a key nothing reads. They are accepted, checked, and not stored, on a create and an update alike (`UNSTORED` in `src/micropub/create.ts`):

| Micropub property | Accepted | Refused |
| --- | --- | --- |
| `p3k-content-type` | `text/plain`, `text/markdown`: both are the Markdown body the site already stores | any other type, `text/html` and Quill's `code/*` included, by name |
| `visibility` | `public`, which every published post is | `unlisted` (not yet: TASK-219's visibility decision builds it) and `private` (not published), each with its own message |

Every other unmapped property is still refused by name. `q=config` advertises `visibility: ["public"]`, and adds `unlisted` when it is built.

The same task reads `slug` and `syndicate-to`, the names Quill accounts from before its migrations 0002 and 0004 send, as `mp-slug` and `mp-syndicate-to`, so they are mapped, checked and refused exactly as those are.

## Amendment (TASK-227, 2026-10-03): visibility is stored

`visibility` leaves the accepted-and-not-stored list. Unlisted posts are built (TASK-219's visibility decision), so the property maps onto an editor field like the others, on a create and an update alike:

| Micropub property | Editor field | Front matter |
| --- | --- | --- |
| `visibility` `public` / `unlisted` | Visibility | `visibility: unlisted`; public is the key absent |

`private` is still refused, with its own message: the site has no private posts. Any other value is refused by name. `q=source` returns `visibility` for every post, `public` or `unlisted`, and an update that deletes the property makes the post public again. `q=config` advertises `visibility: ["public", "unlisted"]`.

## Amendment (TASK-229, 2026-10-03): read posts

indiebookclub posts reads: `read-status` and an embedded h-cite `read-of`, with a `summary` and no content. Both map onto editor fields, on a create and an update alike:

| Micropub property | Editor field | Front matter |
| --- | --- | --- |
| `read-of`, `{ "type": ["h-cite"], "properties": { "name", "author", "uid", "url" } }`, each one text value | Read: Title, Author, Identifier, Address | `read-of`, a map of the same four keys, without the empty ones |
| `read-status` `to-read` / `reading` / `finished` | Read status | `read-status` |

A `read-of` that is not an h-cite, an h-cite property other than the four, or a `read-status` other than the three is refused by name. The two only mean something together, so the editor's rule refuses one without the other, with the editor's message. `q=source` returns `read-of` as the h-cite a create sends. A read federates as a `Note` that opens with the sentence the page prints; it has no fediverse object, so decision-28's `Like` and `Announce` do not apply.

## Amendment (TASK-233, 2026-10-03): a read post's summary is derived

indiebookclub's `summary` is the read said again ("Want to read: Title by Author"). Stored as the `description`, it went stale the moment a later update changed `read-status`, and the page's meta description, JSON-LD, feeds and Markdown and JSON representations kept saying the old status. A read post's summary is now derived from the read and never stored: the editor's write path, which a Micropub create and update go through, writes no `description` on a post that has a read, so indiebookclub's `summary` is accepted and not stored, and the first save that changes an older file's read drops the one it carried. Everything that falls back to the post's text (the feed and page summary, `og:description`, JSON-LD, an `Article`'s `summary`, the label of an untitled read) reads the read line first, so it says the current status. `q=source` returns no `summary` for a read post. The alternative, rewriting the stored summary when `read-status` changes, keeps a second copy that a hand edit or a client's own wording can still leave behind.

## Amendment (TASK-228, 2026-10-03): q=config lists each type's properties

Micropublish, and any client that follows the micropub-extensions post-types convention, shows its own default fields for a type unless `q=config` says which properties that type takes. Each `post-types` entry now carries `properties` and `required-properties`, from `POST_TYPES` in `src/micropub/endpoint.ts`, whose names are typed by `Property`, the union of the names `createForm` accepts, so a name it would refuse cannot be listed.

- `required-properties` are what Post Type Discovery needs to call a post that type: `like-of`, `repost-of`, `in-reply-to`, `photo`, `bookmark-of`, `read-of` with `read-status`; `content` for a note, `name` and `content` for an article.
- `properties` are those, then the properties that never change a post's type: `content`, `summary`, `category`, `location`, `published`, `post-status`, `visibility`, `mp-slug`, `mp-syndicate-to`, and `name` on every type but a note, where it would make an article.
- Another type's own property is not listed, though a create accepts it, since it makes the post that type instead: a like with `in-reply-to` is still accepted, as a like, but the reply form is where that property is offered.
- `slug`, `syndicate-to` and `p3k-content-type` are accepted and not listed: the first two are legacy names for listed properties, and the third changes nothing the site writes.

## Amendment (TASK-237, 2026-10-03): a property the site does not understand is kept privately

micropub.rocks test 204 sends a `checkin` h-card beside its content and expects the post published. Clients send extension properties too, and refusing one refused the whole post. A property the site does not map is now kept instead of refused, on a create and an update alike. It is never written to front matter: `content/` may be a public repository (decision-9), and a raw nested object there, a checkin's coordinates say, would be public whatever Settings > Privacy says (decision-29).

- **Where.** `data/kept-properties.json`, mode 0600, one JSON object keyed by the post's permalink, kept, moved and left exactly as `data/locations.json` is. Both are one `permalinkFile` (`src/content/permalink-file.ts`). The editor's write path owns the entry: a Micropub create replaces it, an editor save leaves it, a save that moves the permalink moves it, and trash and restore keep it. Nothing renders it: no page, representation, feed, object, search entry, oEmbed or `llms.txt` reads the file.
- **What.** The values verbatim, as mf2 JSON: each name and its list of values as the client sent them, strings from a form, objects and numbers from JSON. The site does not parse what it does not understand, so it does not reshape it. The cap is 16 KiB of JSON per post, refused by name when a post's kept properties come to more; the file is read whole on each `q=source` and rewritten on each save, and a checkin's h-card is under a kilobyte. A file part sent as a property that is not `photo` is refused, since it has no JSON form.
- **What counts as understood.** Everything `createForm` maps, the legacy names `slug` and `syndicate-to`, and the accepted-without-effect `p3k-content-type` stay as they were: mapped, checked and refused as before. A read's `summary` is still accepted and not stored (TASK-233). A property the site later learns to map stops being kept: `q=source` answers it from where it is mapped, and the old copy stays in the file, unread, until an update next rewrites what the post keeps.
- **`mp-*` commands.** Still refused by name, `This endpoint does not support mp-channel.` They are instructions to the server, not data, and keeping one would tell the client it was carried out.
- **Nothing to publish.** A create that keeps properties and sends none of `content`, `name`, `photo`, `in-reply-to`, `like-of`, `repost-of`, `bookmark-of` or `read-of` is refused with 400 `invalid_request` naming the kept properties. Quill's weight editor sends `weight` and `published` alone, and would otherwise publish an empty post at `/…/untitled/`.
- **Read and update.** `q=source` answers kept properties to the token's user, beside the mapped ones. An update's `replace`, `add` and `delete` change them as they change a mapped property; an update that names none leaves them.

Limits: a kept property is not shown anywhere, not even to the author in the admin editor. A post copied to another site by its file goes without them, as it goes without its location. `checkin` is kept here until TASK-236 maps it onto the post's location.

## Amendment (TASK-236, 2026-10-03): a checkin is the post's location

micropub.rocks test 204 and Swarm-style clients send `checkin`, an h-card naming the venue. TASK-237 kept it privately as a property the site did not understand. It now maps onto the post's location (decision-29), on a create and an update alike:

| Micropub property | Editor field | Where it lives |
| --- | --- | --- |
| `checkin`, an h-card | Location, with A check-in ticked | `data/locations.json`, the location with `checkin: true` |

- **What is kept.** The venue's `name`, `locality`, `region`, `country-name` and its coordinates, as `latitude` and `longitude` on the h-card or a nested `geo`. Its `url`, `street-address` and `postal-code` are dropped. Under the `place` sharing level they would publish more than a place name: a street address and postcode say which door, and a venue URL may be a map link carrying coordinates. Nothing renders a URL either, so keeping it would keep data for no reader.
- **Publishable.** A checkin gives a post something to publish, as a like does: Swarm sends one with no content.
- **One location.** A post has one location. A `location` sent beside a `checkin` describes the same place: the checkin's words and coordinates win, and the location fills in what the checkin leaves out. The post is then a checkin. A second `checkin` value, or one that is not an h-card naming a place, is refused by name.
- **Read and update.** `q=source` answers a checkin as `checkin`, an h-card, and no `location`; a create takes that answer back as the same checkin. An update's `replace` of `checkin` replaces the location, and `delete` of it removes the location. An update that replaces `location` on a checkin leaves an ordinary location, and one that deletes `location` removes the checkin too, since they are one value.
- **The editor.** The Location box has an A check-in box, ticked for a checkin, so an editor save keeps the mark, and unticking it leaves an ordinary location.
- **Readers.** The mark is for the author's own clients. `shareLocation` never passes it on, so the theme prints a checkin as any other `p-location` and federation as any other `Place`, only as far as Settings > Privacy allows, and with the default nothing of it. The IndieWeb checkin post type ("Checked in at …") was not built. It would put the mark into `SharedLocation`, and so publish one more fact, that the author was at the venue when posting, which no sharing level names, for a sentence the printed place already says.
- **`q=config`.** `checkin` is not listed in any post type's `properties`: the clients that send it, Swarm bridges and micropub.rocks, do not read the list, and a client that does would offer a field for an h-card.

A checkin kept by TASK-237 before this lands stays in `data/kept-properties.json`, unread. Both ship together, so no site has one.

## Amendment (TASK-258, 2026-10-03): content is cleaned at the endpoint

`content` was written to the body as it came, and the renderer passes raw HTML through (`html: true`, as Eleventy does). Pretty-printed HTML broke, because a line indented four spaces after a blank line is a Markdown code block, and a `<script>` or an `onerror` reached the public page, where the signed-in owner's admin bar and session are, from any app holding only the `create` scope. Content is now cleaned in `createForm`, so a create and an update's `replace` or `add` are both covered:

| Content sent | Stored body |
| --- | --- |
| `{ "html": "…" }` | The HTML through the post allow-list, then converted to Markdown with turndown: ATX headings, fenced code, `-` bullets, `_` emphasis, `~~` strikethrough. A `<` or entity-like `&` in text is escaped, so text never becomes markup. |
| Text, with `p3k-content-type` `text/plain`, `text/markdown` or none | The text exactly as sent, except each `html_block` and `html_inline` token the site's own markdown-it instance reads, which goes through the same allow-list in place. |

- **The allow-list.** `cleanPostHtml` in `src/web/sanitize.ts`, beside the comment sanitizer and on the same tag scanner. It keeps headings, paragraphs, emphasis, links, lists, images, code, quotations, tables, figures, details, definition lists and a few inline elements (`sub`, `sup`, `kbd`, `mark` and the like), each with only the attributes it names. A link may point at `http`, `https`, `mailto` or a relative address; an image at `http`, `https` or a relative address. Script, style, iframe, object, SVG, MathML, template, noscript and textarea are dropped with their content. Any other element is unwrapped, its text kept. Every kept tag is rebuilt from its allowed attributes, so no attribute the scanner did not read reaches the page. It filters tags without balancing them, so it can clean a fragment: one inline tag, or an HTML block that opens a `<details>` whose Markdown follows.
- **Markup Markdown cannot express.** A table, figure, details or definition list stays as an HTML block, each child of a container on its own line, with no line indented and none blank, so it is one block and never code. Newlines in a `<pre>` inside one are written as `&#10;`, so the code keeps its indentation. `sub`, `sup`, `kbd`, `mark`, `ins`, `u`, `abbr`, `q` and `small` stay as tags around converted Markdown.
- **Finding the HTML in Markdown.** An `html_block` is cleaned over its source lines. An `html_inline` is found by where it starts in its inline token, which a rule in `content/markdown.ts` records, so the same characters in a code span are not mistaken for it. The result is read again until no HTML changes, and content whose HTML cannot be found is refused, `content has HTML the site cannot clean.`, rather than stored. Converted HTML goes through this pass too, as a last check. The body is first normalised as every stored body is (`\r\n` and a lone `\r` made `\n`, edges trimmed, a NUL replaced as markdown-it replaces it), and the body about to be stored is cleaned once more and refused unless that changes nothing, so the string cleaned is always the string stored. Red-team review found both gaps this closes: trimming after cleaning turned an indented, ignored code block into a live HTML block, and a lone `\r`, which markdown-it breaks a line on and the cleaner's line offsets did not, hid a block from the cleaner.
- **Links in Markdown.** `[text](javascript:…)` is left as sent: markdown-it's `validateLink` already refuses `javascript:`, `vbscript:`, `file:` and non-image `data:` URLs, and a test proves the page carries none.
- **`q=source`** answers the stored Markdown, not the HTML that was sent.
- **The owner's own content is not cleaned.** The editor and hand-written files keep `html: true` and Eleventy compatibility. Only what a Micropub client sends is cleaned.

turndown (MIT) was chosen over node-html-markdown for its rule API, which the kept blocks and the list layout use, and over the unified/rehype stack for size. turndown-plugin-gfm was not added: it has not been released since 2017, its only use here would be pipe tables, and a table kept as HTML is always faithful, where a pipe table cannot hold a cell with two paragraphs. Strikethrough is a three-line rule.

## Amendment (2026-10-06, TASK-280)

`h-event` is no longer refused. A create with `h=event` and a `start` makes an event post, as decision-32's TASK-280 amendment describes. Every other type is still refused.
