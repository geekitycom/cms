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
