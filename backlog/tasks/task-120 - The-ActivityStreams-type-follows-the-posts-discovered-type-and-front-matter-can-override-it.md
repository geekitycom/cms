---
id: TASK-120
title: >-
  The ActivityStreams type follows the post's discovered type, and front matter
  can override it
status: To Do
assignee: []
created_date: '2026-09-20 21:00'
updated_date: '2026-09-20 21:06'
labels: []
milestone: m-17
dependencies:
  - TASK-119
  - TASK-118
references:
  - 'https://www.w3.org/TR/post-type-discovery/'
documentation:
  - backlog/docs/doc-4 - ActivityPub-Federation.md
modified_files:
  - packages/cms/src/federation/article.ts
type: feature
ordinal: 144800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
doc-4 currently says "Every published post is an `Article`", and `postArticle` in `packages/cms/src/federation/article.ts` hard-codes that. Once a post can be a note (TASK-119), the ActivityStreams type should follow what the post actually is.

The Post Type Discovery note carries its own non-normative AS2 mapping in section 6. The two rows in scope here:

| discovered type | AS2 |
| --- | --- |
| note | `Note` |
| article | `Article` |

The remaining rows — event/`Event`, rsvp/Event RSVP, repost/`Announce`, like/`Like`, reply/`Note` with `inReplyTo`, video/`Video`, photo/`Image` — are out of scope and land with their own tasks.

**`Note` and `Article` are not the same object with a different label.** Verified in Mastodon's source (`app/lib/activitypub/parser/status_parser.rb`):

- For `Note`, `processed_text` returns `content` verbatim and **`name` is never read at all** — a titled Note silently loses its title. `processed_spoiler_text` returns `summary`, which Mastodon renders as a **content warning**.
- For `Article`, `content` is discarded and the body is built from `name` + `summary` + the linkified `url`; `processed_spoiler_text` returns `''`, so `summary` is body text and not a CW.

So the summary added in TASK-118 is correct for an `Article` and **wrong for a `Note`** — putting a teaser excerpt in a Note's `summary` would collapse the post behind a spurious content warning on Mastodon. A note must carry everything it has to say in `content`, and must not set `summary` as a teaser. This is the single most important correctness detail in this task.

Per-post override: an `activitypub.type` key in the existing `activitypub` front matter block overrides the derived type. That block is currently documented as machine-written state (the CMS stamps `id` and `published` into it after delivery), so its contract needs restating as "everything federation, whether the author set it or the CMS wrote it back", and an admin save must never rewrite an author's `type` the way it stamps the other two.

The override goes in that block rather than at the top level because `type` is already taken — `Document.type` means post-or-page — and because an unrecognised top-level `type:` currently falls through to `Document.extra` and is preserved verbatim, so claiming it would be a breaking change for an existing Eleventy site. The `activitypub` block is also ignored by Eleventy, which is right: a theme has no business branching on the wire type.

A decision was taken not to add a site-wide object-type setting. Derivation decides the type and the per-post override is strictly more precise, so a site-wide switch would exist only to defeat the algorithm.

Changing the type of an already-published post produces an `Update`. Whether remote servers re-render a status whose object type changed is not established; if they do not, the override is effectively publish-time-only for existing posts and the admin UI should say so rather than imply otherwise.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A post discovered as a note federates as an ActivityStreams `Note`; one discovered as an article federates as an `Article`
- [ ] #2 A `Note` carries its text in `content` and does NOT set `summary` to an excerpt, because Mastodon renders a Note's `summary` as a content warning
- [ ] #3 A `Note` does not rely on `name` to carry meaning, because Mastodon never reads it on a Note
- [ ] #4 An `activitypub.type` key in front matter overrides the derived type
- [ ] #5 An unrecognised `activitypub.type` value falls back to the derived type and logs a warning rather than failing the request, matching how an invalid `theme` setting already behaves
- [ ] #6 An admin save preserves an author-written `activitypub.type` and never rewrites it
- [ ] #7 The `Create`, `Update` and `Delete` activities all name the same object type for a given post
- [ ] #8 doc-4 no longer claims every published post is an `Article`, and its activity table is updated
- [ ] #9 A decision record captures that a post's ActivityStreams type is derived by Post Type Discovery rather than fixed, and supersedes the relevant part of doc-4
- [ ] #10 Tests cover a note, an article, a valid override, and an invalid override
<!-- AC:END -->
