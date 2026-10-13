---
id: TASK-261
title: 'Label an untitled like, repost, bookmark, reply or photo by what it is'
status: Done
assignee:
  - '@claude'
created_date: '2026-10-04 02:50'
updated_date: '2026-10-04 09:30'
labels:
  - theme
  - admin
  - seo
dependencies: []
priority: medium
type: bug
ordinal: 220800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
On shll.me (0.20.0) a YouTube like with no title or text (/2026/10/liked-runescape-official-4th-mmo-teaser/) shows 'Untitled · Shll.me' in the browser tab, and 'Untitled' in og:title, twitter:title and the JSON-LD headline. postLabel in packages/cms/src/content/post-type.ts returns the title, else the post's first words, else 'Untitled'; it also names the post in the admin (post list, flash messages, editor heading, comments, federation screens). For a post with no title and no text, label it by what it is: 'Liked <cited title>', 'Reposted <cited title>', 'Bookmarked <cited title>', 'Reply to <cited title>' using the stored reply context's name (TASK-244), else 'an image from <host>' or 'a page on <host>' as the citation line says (TASK-255), and 'Photo' for a photo post with no text. 'Untitled' stays the last fallback. The label is text: it is escaped wherever it is printed, like a title. Decide how postLabel reaches the stored context (an optional argument, a variant used where a context is at hand, or the rendered citation) and say why.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 An untitled like, repost, bookmark or reply's <title>, og:title, twitter:title and JSON-LD headline read as the verb plus the cited page's title, or the host form when nothing was fetched
- [x] #2 An untitled photo post with no text is labelled Photo; a post with words keeps its first words; Untitled remains the last fallback
- [x] #3 The admin's post list, flash messages and editor heading use the same label; tests cover each case with stubbed contexts
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Move the citation verb table (Reposted, Liked, Bookmarked) and citesAnImage into content/citation.ts with a structural CitedPage type, and add citedPageName(url, context), the words a citation line says for a cited page; feed-item.ts and federation/article.ts use the shared table and name, so there is one.
2. postLabel(document, cited?) takes an optional CitedPageReader of stored contexts. With no title and no words it labels by post type: like/repost/bookmark/reply as verb plus citedPageName (plus 'by <author>' when only the author is known), Photo for a photo post, Untitled last.
3. Pass the reader wherever a caller holds the reply-context service: documentContext (so every rendered page, listing entry, search hit and the editor preview carry the same label), neighbours and the archive in render.ts, admin list, flashes, editor heading, trash, dashboard, comments screen, federation screens, oEmbed, comments feed, llms.txt, comment submission and the two comment notifiers.
4. The site-wide comments feed prints each comment's post label, so its fingerprint now includes it and COMMENTS_FEED_REVISION moves to 3. Post feeds do not use postLabel; FEED_ITEM_REVISION stays.
5. Tests first per criterion with stubbed contexts: post-type unit tests, a site test of the head (title, og:title, twitter:title, JSON-LD), admin list, editor heading, save and trash flashes.
6. Verify build, test, test:11ty, typecheck, lint, format:check.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Picked up from an earlier agent. Kept its shared citation table, citedPageName, the optional reader on postLabel and its tests. Changed: the renderer no longer overrides label after documentContext (citedBy returned a second label); documentContext takes the reader instead, so search hits, the posts page and the editor preview label the same way. Wired the callers it left on the bare form: admin comments, federation delivery rows and inbox posts (optional DeliveryRowsContext.cited and localPosts third argument), comments feed, comment submission, comment notifier and digest. Comments feed fingerprint now includes the post label and COMMENTS_FEED_REVISION is 3, since the label can change when a context arrives. Fixed the theme README example host (citedHost keeps www). federation/article.ts recording attachment name stays without a reader: it needs a post with an enclosure and no words that is also a like, and threading the store into the AS builder is out of scope.
Design: an optional argument rather than a variant or the rendered citation. The caller that has the context service passes a reader; postLabel stays pure and never reaches a store. Absence means nothing was fetched, which is a real state with a defined label (the host form), so optional is honest and keeps pure callers and tests simple.
Mutation check: dropping the reader from the page render or the save flash fails the AC #1 and save-flash tests.
Validation: pnpm build && pnpm test (4058 + 30 pass) && pnpm typecheck && pnpm lint && pnpm format:check all exit 0; pnpm test:11ty 18 + 8 pass.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
An untitled post with no words is now labelled by what it is: 'Liked/Reposted/Bookmarked <cited title>' or 'Reply to <cited title>' from the stored context, else the citation line's host form ('a page on <host>', 'an image from <host>', 'a post by <author>'), 'Photo' for a photo post, 'Untitled' last. postLabel takes an optional reader of stored contexts, passed by every caller that holds the reply-context service (documentContext, render neighbours and archive, admin list, flashes, editor heading, dashboard, comments and federation screens, oEmbed, comments feed, llms.txt, comment notices). The citation verbs and the cited-page name now live once in content/citation.ts and feed into the feed citation line, the federated note and the label. Comments feed fingerprint includes post labels; COMMENTS_FEED_REVISION 3. Verified by src/content/post-type.test.ts and src/web/untitled-label.test.ts (head title, og:title, twitter:title, JSON-LD headline, escaping, admin list, editor heading, save and trash flashes), plus build, 4058 tests, test:11ty, typecheck, lint and format:check.
<!-- SECTION:FINAL_SUMMARY:END -->
