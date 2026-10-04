---
id: TASK-169
title: 'Like, repost and bookmark posts'
status: Done
assignee:
  - '@claude'
created_date: '2026-09-29 01:55'
updated_date: '2026-10-02 16:56'
labels:
  - micropub
  - content
  - theme
  - indieweb
milestone: m-25
dependencies:
  - TASK-164
references:
  - 'https://ptd.spec.indieweb.org/'
  - 'https://indieweb.org/like'
  - 'https://indieweb.org/repost'
  - 'https://indieweb.org/bookmark'
priority: low
type: feature
ordinal: 193800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Micropub clients commonly send like-of, repost-of and bookmark-of, which the site has no post types for yet. Add them to front matter, Post Type Discovery (like and repost in spec order; bookmark is an IndieWeb extension that falls through to note/article in the spec, so record where it sits), the default theme (u-like-of, u-repost-of, u-bookmark-of as h-cite), webmentions to the target, and federation (Like and Announce activities for likes and reposts of fediverse objects, and a note linking the page otherwise; record the choice as a decision). Then accept them over Micropub.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A post with like-of, repost-of or bookmark-of renders the matching mf2 markup citing its target, and sends it a webmention
- [x] #2 Post Type Discovery types them in spec order, proven by tests
- [x] #3 How each federates is recorded as a decision and implemented
- [x] #4 The admin editor can set each of them
- [x] #5 Micropub create accepts like-of, repost-of and bookmark-of, and q=config lists them
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Data shape: like-of, repost-of and bookmark-of stay in Document.extra (as photo and syndicate-to do), read through one module, content/citation.ts: CITATION_PROPERTIES = ['like-of','repost-of','bookmark-of'] and citationsOf(extra) -> [{property, url}] for each valid http(s) URL. No SQLite column, no parser change.
1. Post Type Discovery: PostType gains repost, like, bookmark. Order repost, like, reply, photo, bookmark, note/article. Bookmark sits after photo so every post the spec types keeps the spec's type; bookmark only claims what the spec would call a note or article. Tests first.
2. Editor: EditorForm gains likeOf, repostOf, bookmarkOf; three url inputs under In reply to; writeDocument refuses a non-URL; resolveExtra writes or removes each key; formFor reads them; preview carries them.
3. Micropub: create SINGLE_VALUED maps like-of/repost-of/bookmark-of to the fields (drop the like-of refusal); update UPDATABLE and sourceProperties; q=config post-types via POST_TYPE_NAMES (Like, Repost, Bookmark).
4. Theme: context gains citations; partials/citations.njk renders div.cite.u-like-of.h-cite (and repost/bookmark) with a u-url link; included beside reply-context on the post page and in post-list. Unnamed-post h1 names the type.
5. Webmentions: targetsOf adds each citation target.
6. Federation: decision records it. Like/repost of a target that resolves (lookupObject) to a fediverse object sends Like/Announce to followers and the object's author; withdrawing sends Undo. Anything else (bookmark, non-fediverse target) federates as the Note it is today, its content opening with a line linking the cited page.
7. Docs: README Micropub, theme README, doc-2. Verify build/test/typecheck/lint/format and curl a running site.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Data shape: like-of, repost-of and bookmark-of stay in Document.extra under their mf2 names (no SQLite column, no parser change), read only through content/citation.ts (citationsOf, citationOf, citationText). The editor form gains likeOf/repostOf/bookmarkOf, with CITATION_FIELDS mapping property to field; writeDocument refuses a non-URL and resolveExtra writes or removes each key; the preview carries them.
Post Type Discovery: repost, like, reply, photo, bookmark, then note/article. Bookmark sits after photo so every post the spec types keeps its spec type; bookmark only claims what the spec calls note or article. Recorded in post-type.ts and doc-2.
Micropub: like-of, repost-of, bookmark-of added to create SINGLE_VALUED, update UPDATABLE and sourceProperties; q=config post-types lists Like, Repost, Bookmark. The old like-of refusal test now refuses rsvp.
Theme: context.citations [{property,url}], partials/citations.njk (div.reply-context.cite.u-<property>.h-cite with Liked/Reposted/Bookmarked and a u-url), included on the post page beside reply-context and in post-list; the hidden h1 of an untitled like/repost/bookmark names its type.
Webmentions: targetsOf adds each citation target.
Federation (decision-28): federation/citations.ts looks the target up (signed as the author); a like or repost of a fediverse object sends Like/Announce to followers, relays and the object's author inbox, id #like/{object id} or #announce/{object id}; withdrawal sends Undo; an edit that keeps the target sends nothing; a changed target or a change of shape withdraws then announces. Anything else, a bookmark included, federates as its Note/Article with a 'Liked <a>…</a>' line at the top of its content.
Known limits, recorded in decision-28: a target that stops answering between a like and its withdrawal gets a Delete instead of an Undo; the outbox still lists a like as a Create of its note. Federation was verified against a stubbed remote host in delivery.test.ts, not a live Mastodon.
Validation: pnpm build, pnpm test (3391 + 30 pass), pnpm typecheck, pnpm lint, pnpm format:check all clean. Served a scratch site built from dist on :3917 and curled /2026/09/liked/, /reposted/, /bookmarked/ and /: each page and listing entry carries its u-like-of / u-repost-of / u-bookmark-of h-cite with the target as u-url, and the kicker says Like/Repost/Bookmark. Server stopped.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added like, repost and bookmark posts. like-of, repost-of and bookmark-of live in front matter under their mf2 names (content/citation.ts is the one reader). Post Type Discovery types them repost, like, reply, photo, bookmark, note/article, with bookmark placed after photo since the spec does not type it. The default theme cites each as a u-like-of/u-repost-of/u-bookmark-of h-cite on the post page and in listings, and publishing sends the target a webmention. The admin editor has Like of, Repost of and Bookmark of fields; Micropub create, update and q=source accept them and q=config lists the three types. Federation follows decision-28: a like or repost of a fediverse object sends a Like or Announce to the followers and the object's author and an Undo on withdrawal; anything else federates as its note with a line linking the page. Verified with new tests in post-type, posts (editor), micropub create/update/endpoint, webmention send, web/citations (mf2-parsed markup) and federation delivery (stubbed remote host), the full pnpm build/test/typecheck/lint/format:check run, and curl against a served scratch site.
<!-- SECTION:FINAL_SUMMARY:END -->
