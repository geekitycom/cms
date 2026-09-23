---
id: decision-17
title: >-
  A post's ActivityStreams type is derived by Post Type Discovery, and front
  matter can override it
date: '2026-09-23 12:54'
status: accepted
---
## Context

doc-4 said every published post is an `Article`, and `postArticle` hard-coded it. TASK-119 gave a post a type of its own, derived by Post Type Discovery (the W3C note of 18 January 2018): a post with no title, or whose text opens with its title, is a note, and any other is an article. That note carries a non-normative AS2 mapping in section 6, note to `Note` and article to `Article`.

The two types are not the same object with a different label. In Mastodon's `status_parser.rb`, a `Note`'s status is its `content` verbatim, `name` is never read and `summary` is the content warning. An `Article`'s `content` is dropped for `name`, `summary` and the linked `url`, and `summary` is body text. So the excerpt TASK-118 put in `summary` is right for an `Article` and would put every note behind a spurious content warning.

## Decision

A post's ActivityStreams object type is derived, not fixed: the post's discovered type, mapped through section 6. A note is a `Note`, and an article is an `Article`.

A `Note` carries everything it has to say in `content`. It sends no `summary`, and no `name`. A title its text does not already open with goes in as the first paragraph of `content`. An `Article` keeps its `name`, its `summary` excerpt and its `content`.

An author can override the derived type per post with `activitypub.type` in front matter, `Note` or `Article`. The key lives in the `activitypub` block rather than at the top level, for three reasons. A top-level `type` is taken, because `Document.type` means post or page. An unknown top-level `type:` already falls through to `extra` and is kept verbatim, so claiming it would break an existing Eleventy site. And Eleventy ignores the `activitypub` block, which is right, because a theme has no business branching on the wire type. That block's contract becomes everything about how a post federates, whether the author set it or the CMS wrote it back. A delivery still writes only `activitypub.published`, and no save rewrites an author's `type`.

The override is federation's alone. `postTypeOf`, which the theme and the feeds read, stays the derived type.

A value other than `Note` or `Article` is kept in the file, logged as a warning that names the file, the value and the type sent instead, and the derived type is used. That is how an unusable theme choice already behaves: one typo does not stop a post reaching anybody.

There is no site-wide object-type setting. Derivation decides, and the per-post override is strictly more precise, so a site-wide switch would exist only to defeat the algorithm.

Supersedes doc-4's "Every published post is an `Article`" and its `Create(Article)`, `Update(Article)` and `Delete(Article)` rows.

## Consequences

- `Create`, `Update` and the `Delete` `Tombstone`'s `formerType` all name the post's object type, because each is built from the file through one rule.
- `postArticle` is now `postObject`, and it returns a `Note` or an `Article`. That changes a public export of `@geekity/cms`.
- The remaining rows of the mapping (event, rsvp, repost, like, reply, video and photo) are new branches in front of the note-or-article tail of `discoverPostType`, and new rows in the object-type table, each with its own task.
- Changing the type of a post that has already been announced sends an `Update` with the new type. Nobody has shown that a remote server re-renders a status whose object type changed. If they do not, the override only counts at first publish for a post already out, and any admin UI for it should say so.
