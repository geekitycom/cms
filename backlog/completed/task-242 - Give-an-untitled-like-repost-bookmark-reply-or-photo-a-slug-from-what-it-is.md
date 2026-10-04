---
id: TASK-242
title: 'Give an untitled like, repost, bookmark, reply or photo a slug from what it is'
status: Done
assignee:
  - '@claude'
created_date: '2026-10-03 16:32'
updated_date: '2026-10-03 17:40'
labels:
  - micropub
  - content
dependencies: []
references:
  - packages/cms/src/admin/documents.ts
priority: low
type: enhancement
ordinal: 257800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A Quill like of http://scripting.com/ on shll.me (0.18.0) was filed at /2026/10/untitled/. The slug chain in writeDocument (packages/cms/src/admin/documents.ts, the const slug = ... fallbacks: typed slug, title, existing slug, noteSlug(body), the read's title, then 'untitled') has nothing to go on for a post with no title and no text, which is every like, repost and bookmark from Quill and many replies and photo posts.

Before falling back to 'untitled', derive the slug from the post's type and target: liked-, reposted-, bookmarked- or reply-to- followed by the target's words (host without www, then path segments that contain a letter; segments that are only digits are dropped; a few words at most), and 'photo' for a photo post with no text. Examples: like-of http://scripting.com/ gives liked-scripting-com; like-of https://indieweb.social/@andrewshell/117249870148068466 gives liked-indieweb-social-andrewshell. The usual -2 suffix handles repeats. Only a new post's slug is derived this way; an existing post keeps its permalink.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A new like, repost or bookmark with no title or text gets liked-/reposted-/bookmarked- plus its target's words as its slug, from Micropub and from the editor
- [x] #2 A reply with no text gets reply-to- plus its target's words, and a photo post with no text gets photo
- [x] #3 Numeric path segments are dropped, the slug is capped at a few words, and a repeat gets -2
- [x] #4 An existing post's slug is not changed by a save; 'untitled' remains the last fallback
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Failing tests first: editor (admin/posts.test.ts) and Micropub (micropub/create.test.ts) creates of an untitled like/repost/bookmark/reply/photo, numeric-segment dropping, word cap, -2 on repeat, existing post keeps slug, empty post still untitled.
2. In writeDocument, add one link to the slug chain after the read's title and before 'untitled': typeSlug(kind, form, photos), which runs discoverPostType over the form's citing fields and resolved photos so the slug names what the post is in the same precedence the site types it (repost, like, reply, photo, bookmark).
3. targetWords(url): host without www, then decoded path segments containing a letter, slugified and capped at NOTE_SLUG_WORDS words.
4. Existing posts keep their slug because document.slug sits earlier in the chain; freeSlug supplies -2.
5. Update doc-2's slug rule and the README where it describes the fallback; run build/test/typecheck/lint/format:check and curl a running site.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Built typeSlug in admin/documents.ts as one link in writeDocument's slug chain, after the read's title and before 'untitled'. It runs discoverPostType over the form's citing fields and resolved photos, so a post is named for the type the site gives it (a reply with a photo is reply-to-..., as its type is). targetWords takes the host without www., then decoded path segments containing a letter, slugified and capped at 4 words. Pages never take it. An existing post keeps its slug because document.slug sits earlier in the chain; freeSlug gives the -2. A checkin's venue is still never used.
Tests: admin/posts.test.ts 'the slug of a post with no title and no text (TASK-242)' (like/repost/bookmark/reply/photo, numeric segments, word cap, percent-decoding, -2, existing post unchanged, text still wins) and micropub/create.test.ts 'files a like with no content under what it likes'. Each failed before the change.
Verification: pnpm build, pnpm test (3717 + 30 pass), typecheck, lint, format:check all pass. A scratch server on :4242 took real HTTP Micropub creates and wrote liked-scripting-com, liked-scripting-com-2, liked-indieweb-social-andrewshell, reposted-peer-example-notes-a, bookmarked-peer-example, reply-to-peer-example-hello, photo and (empty content) untitled; GET /2026/10/liked-scripting-com-2/ answered 200. Server stopped.
Docs: doc-2 permalink rules and the README mp-slug row describe the fallback.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
A new post with no title and no text is now named after what it is instead of 'untitled': liked-, reposted-, bookmarked- or reply-to- plus up to four words of the cited address (host without www., then path segments holding a letter), or photo. Same path for Micropub and the editor, since both go through writeDocument. Existing posts keep their slug, repeats get -2, 'untitled' stays last. Verified with new editor and Micropub tests, the full build/test/typecheck/lint/format suite, and HTTP Micropub creates against a running scratch site.
<!-- SECTION:FINAL_SUMMARY:END -->
