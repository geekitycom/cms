---
id: TASK-119
title: >-
  Post Type Discovery: a post with no title is a note, on the page and in the
  feeds
status: Done
assignee:
  - '@claude'
created_date: '2026-09-20 20:59'
updated_date: '2026-09-23 12:45'
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
- [x] #1 A pure function implements the note/article tail of the W3C Post Type Algorithm, including whitespace normalisation and the name-is-a-prefix-of-content rule
- [x] #2 The derived post type is exposed on the Document as a computed value, not stored in front matter or the index
- [x] #3 A post with an empty or absent title is a note; a post whose title is a prefix of its body is a note; a post with a distinct title is an article
- [x] #4 The post layout renders a note without an empty heading and without an empty `p-name`
- [x] #5 Listings render a note by its content rather than by a missing title
- [x] #6 RSS, Atom and JSON Feed each render a titleless note in a way their format permits (RSS requires a title or a description; Atom requires a title element)
- [x] #7 The admin editor accepts and saves a post with no title
- [x] #8 A titleless post still gets a working slug and permalink
- [x] #9 Tests cover the algorithm's cases directly, including the prefix rule and whitespace collapsing
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. content/post-type.ts: pure discoverPostType({name, content, summary}) implementing the PTD note/article tail (trim + collapse whitespace, name-is-a-prefix-of-content rule); postTypeOf(document) maps title / text of the rendered body / description onto it; postLabel(document) is the link text (title, else the first ten words of the body). The module doc records the spec order and mf2util's divergence.
2. Exposure: postTypeOf is the computed accessor over any Document; documentContext() carries postType and label for templates. Nothing is stored in front matter or the index, and no Document literal can carry a type its properties contradict.
3. Parser/writer: a post may omit title (a page still needs one); the writer leaves an empty title out of the front matter.
4. Theme: post.njk (and the demo theme's post.njk) drop the heading and p-name for a note; post-list.njk draws a note whole as e-content with its date as the u-url; search.njk, archive, previous/next, <title>, og:title and the comments feed name a note by its label.
5. Feeds: FeedItem.title is absent for a note; RSS omits <title> and keeps <description>, Atom writes an empty <title></title>, JSON Feed omits title. FEED_ITEM_REVISION 2 -> 3.
6. Admin: posts save without a title (pages keep the rule, and the title input is required only for pages); the slug falls back to the first five words of the body, then untitled; list, dashboard, flash, editor heading, comments and federation screens and comment emails use postLabel.
7. Tests first for each, then the full gate and a live curl of a demo copy with an untitled post.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Decisions:
- AC #2 is read as 'derived from the Document, never stored'. The type is postTypeOf(document), a pure function over title, rendered body and description, and the template context (DocumentContext.postType) carries it on every render. A required postType field on the Document interface was rejected: every Document literal (parser, index rehydration, ~20 test fixtures) would have to state it, and a literal could state a type its title contradicts.
- Everything keys off the discovered type, not off an empty title, so a post whose title only repeats its opening words is also drawn as a note, per the spec. No existing demo or fixture post changes type (checked by parsing every file under apps/demo/content/posts and test/fixtures/content/posts: 6 and 4 articles, 0 notes).
- Atom: RFC 4287 requires exactly one atom:title per entry and allows it to be empty, so a note writes <title></title>. An excerpt as the title was considered and rejected because it would give the note a name it does not have.
- RSS 2.0 needs a title or a description on an item; a note keeps its description (the excerpt) and loses the title. JSON Feed 1.1 makes title optional; it is left out.
- FEED_ITEM_REVISION went 2 -> 3 because a prefix-titled post now loses its feed title, which the ETag fingerprint does not see.
- Spec order recorded in post-type.ts: event, rsvp, repost, like, reply, video, photo, then note/article. granary's mf2util puts reply ahead of repost and like and has no video branch; the module follows the spec.
- Pages still require a title in the parser and the admin; the task is about posts.
- The federated Article of a note still carries name '' (federation/article.ts). That is TASK-120's (the ActivityStreams type follows the discovered type).

Validation: pnpm build, pnpm test (2176 + 30 pass, 0 fail), pnpm typecheck, pnpm lint, pnpm format:check all exit 0. New tests: src/content/post-type.test.ts (algorithm cases incl. prefix rule, character-level prefix, whitespace collapse, summary fallback), src/web/notes.test.ts (page, listing, search, archive, neighbours, head, comments feed, RSS/Atom/JSON over HTTP), parser/writer/admin posts/pages tests. Each failed first for the predicted reason (article vs note, 'needs a non-empty title', <h1 class="p-name"></h1>, <title></title> in RSS, title key in JSON, required on the input, 400 on save).
Live: ran a copy of apps/demo (content, themes, fresh data dir in the scratchpad, no federation data) on port 3917 with an untitled post. /2026/09/coffee/ answered 200 with no heading and <title>Coffee first. Then the inbox, and after that a long … · Geekity Demo</title>; /posts/ drew it as e-content with a dated u-url; /search/?q=coffee linked it by its first words; /feed/ item had no <title> and a description; /feed/atom/ entry had <title></title> and a summary; /feed/json/ item had no title. The server was stopped afterwards.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
A post with no title is now a note. content/post-type.ts implements the note/article tail of the W3C Post Type Algorithm (whitespace normalisation, name-is-a-prefix-of-content rule) as a pure function, and postTypeOf derives a Document's type from its title, rendered text and description on every read; nothing is stored. The parser and the admin accept an untitled post (pages still need a title), the writer leaves the empty title out, and the admin gives a new note a slug from its first five words. The default and demo post layouts draw a note without a heading or p-name, listings draw it whole as e-content with a dated permalink, and search, archive, neighbours, the page head and the comments feed name it by its first words. RSS drops the item title, Atom writes the empty title it requires, JSON Feed drops title; FEED_ITEM_REVISION is 3. Verified with new tests (post-type.test.ts, web/notes.test.ts, parser, writer, admin posts and pages), the full build/test/typecheck/lint/format gate, and curl against a running copy of the demo with an untitled post.
<!-- SECTION:FINAL_SUMMARY:END -->
