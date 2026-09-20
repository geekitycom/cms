---
id: TASK-119
title: >-
  Post Type Discovery: a post with no title is a note, on the page and in the
  feeds
status: To Do
assignee: []
created_date: '2026-09-20 20:59'
updated_date: '2026-09-20 21:06'
labels: []
milestone: m-17
dependencies: []
references:
  - 'https://www.w3.org/TR/post-type-discovery/'
  - 'http://ptd.spec.indieweb.org/'
  - 'https://microformats.org/wiki/h-entry'
type: feature
ordinal: 143800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Every post on this site is currently an article with a title. The IndieWeb distinguishes a *note* — a short, untitled post — from an *article*, and the distinction is not declared by the author but derived from the post's own properties.

Post Type Discovery is a W3C Working Group Note (18 January 2018, ed. Tantek Celik), maintained as a living spec at ptd.spec.indieweb.org. Its stated purpose:

> "Post type discovery defines explicit algorithms for inferring the type of a post from other properties of that post. Inferring the type of a post helps provide a bridge between formats and protocols without explicit post types (e.g. h-entry, jf2, micropub, Atom, RSS) to those with explicit post types (e.g. ActivityPub, AS2)."

The note/article tail of the Post Type Algorithm, verbatim:

> - If the post has a "content" property with a non-empty value, Then use its first non-empty value as the content
> - Else if the post has a "summary" property with a non-empty value, Then use its first non-empty value as the content
> - Else it is a **note** post.
> - If the post has no "name" property or has a "name" property with an empty string value (or no value) Then it is a **note** post.
> - Take the first non-empty value of the "name" property
> - Trim all leading/trailing whitespace
> - Collapse all sequences of internal whitespace to a single space (0x20) character each
> - Do the same with the content
> - If this processed "name" property value is NOT a prefix of the processed content, Then it is an **article** post.
> - Else it is a **note** post.

The prefix rule matters: a post whose "title" is just the opening words of its own body is a note, not an article.

This task is the content and rendering half. `Document.title` is typed `string` and an empty title is already a well-formed state — `fallbackSlug` in `packages/cms/src/content/parser.ts` already falls back to the filename when `slugify(title)` is empty — so notes need no change to the type. What they need is for everything downstream of an empty title to behave.

The derived type belongs on the Document as a computed value, not a stored one, in the spirit of decision-1: the files are the source of truth and the type is derived from them.

Scope is deliberately the note/article boundary only. Reply, photo, like, repost, event and rsvp posts are separate work; the module should be shaped so those branches can be added in front of this one in the spec's order, since the algorithm is ordered and earlier branches win.

The full algorithm order is: event, rsvp, repost, like, reply, video, photo, then the note/article tail above. Note that the reference implementation used by granary (`mf2util`) diverges from the spec — it puts reply ahead of repost and like, and has no video branch. Follow the spec and record the divergence, because it only bites once more than one branch exists.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A pure function implements the note/article tail of the W3C Post Type Algorithm, including whitespace normalisation and the name-is-a-prefix-of-content rule
- [ ] #2 The derived post type is exposed on the Document as a computed value, not stored in front matter or the index
- [ ] #3 A post with an empty or absent title is a note; a post whose title is a prefix of its body is a note; a post with a distinct title is an article
- [ ] #4 The post layout renders a note without an empty heading and without an empty `p-name`
- [ ] #5 Listings render a note by its content rather than by a missing title
- [ ] #6 RSS, Atom and JSON Feed each render a titleless note in a way their format permits (RSS requires a title or a description; Atom requires a title element)
- [ ] #7 The admin editor accepts and saves a post with no title
- [ ] #8 A titleless post still gets a working slug and permalink
- [ ] #9 Tests cover the algorithm's cases directly, including the prefix rule and whitespace collapsing
<!-- AC:END -->
