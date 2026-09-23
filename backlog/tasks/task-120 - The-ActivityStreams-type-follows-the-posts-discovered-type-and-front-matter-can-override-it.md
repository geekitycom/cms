---
id: TASK-120
title: >-
  The ActivityStreams type follows the post's discovered type, and front matter
  can override it
status: Done
assignee:
  - '@claude'
created_date: '2026-09-20 21:00'
updated_date: '2026-09-23 12:55'
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
- [x] #1 A post discovered as a note federates as an ActivityStreams `Note`; one discovered as an article federates as an `Article`
- [x] #2 A `Note` carries its text in `content` and does NOT set `summary` to an excerpt, because Mastodon renders a Note's `summary` as a content warning
- [x] #3 A `Note` does not rely on `name` to carry meaning, because Mastodon never reads it on a Note
- [x] #4 An `activitypub.type` key in front matter overrides the derived type
- [x] #5 An unrecognised `activitypub.type` value falls back to the derived type and logs a warning rather than failing the request, matching how an invalid `theme` setting already behaves
- [x] #6 An admin save preserves an author-written `activitypub.type` and never rewrites it
- [x] #7 The `Create`, `Update` and `Delete` activities all name the same object type for a given post
- [x] #8 doc-4 no longer claims every published post is an `Article`, and its activity table is updated
- [x] #9 A decision record captures that a post's ActivityStreams type is derived by Post Type Discovery rather than fixed, and supersedes the relevant part of doc-4
- [x] #10 Tests cover a note, an article, a valid override, and an invalid override
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Content model: ActivityPubMetadata gains type (the author's raw string, kept verbatim even when unrecognised); parser reads it, writer writes it, so an admin save and the delivery stamp carry it through untouched.
2. Federation: one table in federation/article.ts maps PostType to its AS2 class (note -> Note, article -> Article). postObjectType(document) answers the override when it names a key of that table, else warns and falls back to postTypeOf. The override stays in federation and does not reach postTypeOf, because the task says a theme has no business branching on the wire type.
3. postArticle becomes postObject: builds a Note (content only, no summary, no name; a title the text does not start with is prepended to content so it is not lost) or an Article (name, summary excerpt, content). Create, Update and the Delete Tombstone formerType all use the same resolved type.
4. Tests first (article.test.ts over HTTP, parser/writer/save round trip): note, article, valid override, invalid override with warning, Delete formerType, admin save preserves type.
5. Docs: doc-4 objects + delivery tables, doc-2 front-matter table, README federation section, new decision record.
6. Verify: pnpm build, test, typecheck, lint, format:check; curl the demo for a note and an article.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Decisions:
- The override is federation's alone. postTypeOf (theme, feeds) stays the derived type, because the task says a theme has no business branching on the wire type. The resolution lives in postObjectType in federation/article.ts: a table OBJECT_TYPES {Note, Article} plus OBJECT_TYPE_OF mapping PostType to it.
- Override values are the AS2 names, Note and Article, case-sensitive. Anything else is kept in the file, console.warn names the file, the value and the type sent instead, and the derived type is used. It warns each time the object is built (a fetch or an activity); no dedup.
- A Note sends no summary and no name. A title the note's text does not open with (only possible through an override, or a titled post with an empty body) goes in as a first <p> of content so it is not lost.
- ActivityPubMetadata gained type, parsed and written verbatim, so the admin save (which passes document.activitypub through) and the delivery stamp (which spreads the existing block) keep it.
- postArticle is renamed postObject and returns Article | Note. It is a public export of @geekity/cms, so this is a breaking API change.
- decision-17 created with the CLI; the CLI has no body option for decisions, so its body was written into the template file, as decision-16 was. doc-4 and doc-2 updated with backlog doc update. README federation section updated.
- Not done: no admin UI for the override exists, so there is nothing to caveat there yet. Whether remote servers re-render a status whose type changed is still unestablished; doc-4, the README and decision-17 say so.

Validation:
- pnpm build && pnpm test (2187 + 30 pass) && pnpm typecheck && pnpm lint && pnpm format:check: all pass.
- pnpm fed:smoke passes (its fixture post still derives as an Article).
- Live: demo server on a scratch copy of its content, curl with accept application/activity+json: untitled post -> Note, no name, no summary; titled article -> Article with name and summary; activitypub.type Note -> Note with the title as first paragraph; activitypub.type Photo -> 200 Article, and the log line 'posts/2026-09-22-bad-override.md names activitypub.type "Photo", which is not one of Note, Article. It is federated as Article instead.' Server stopped.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
A post now federates as the ActivityStreams type Post Type Discovery gives it: a note is a Note, an article an Article. A Note carries everything in content and sends no summary (Mastodon would show it as a content warning) and no name (Mastodon never reads it); a title its text does not open with becomes its first paragraph. An activitypub.type of Note or Article in front matter overrides the derived type; any other value is logged and ignored. The key is modelled in ActivityPubMetadata, so admin saves and delivery stamps keep it verbatim. Create, Update and the Delete Tombstone's formerType all use the one resolved type. postArticle is renamed postObject (public export, breaking). decision-17 records the rule; doc-4, doc-2 and the README follow it. Verified with new tests in article.test.ts, delivery.test.ts, parser.test.ts and writer.test.ts, the full gate run, pnpm fed:smoke, and curl against a running demo server.
<!-- SECTION:FINAL_SUMMARY:END -->
