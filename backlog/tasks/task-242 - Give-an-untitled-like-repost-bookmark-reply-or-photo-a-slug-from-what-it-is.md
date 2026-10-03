---
id: TASK-242
title: 'Give an untitled like, repost, bookmark, reply or photo a slug from what it is'
status: To Do
assignee: []
created_date: '2026-10-03 16:32'
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
- [ ] #1 A new like, repost or bookmark with no title or text gets liked-/reposted-/bookmarked- plus its target's words as its slug, from Micropub and from the editor
- [ ] #2 A reply with no text gets reply-to- plus its target's words, and a photo post with no text gets photo
- [ ] #3 Numeric path segments are dropped, the slug is capped at a few words, and a repeat gets -2
- [ ] #4 An existing post's slug is not changed by a save; 'untitled' remains the last fallback
<!-- AC:END -->
