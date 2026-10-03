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
