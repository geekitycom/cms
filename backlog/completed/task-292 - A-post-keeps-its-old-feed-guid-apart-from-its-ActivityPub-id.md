---
id: TASK-292
title: A post keeps its old feed guid apart from its ActivityPub id
status: Done
assignee:
  - '@claude'
created_date: '2026-10-08 11:00'
updated_date: '2026-10-09 14:55'
labels: []
milestone: m-31
dependencies: []
priority: high
ordinal: 252800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A feed item's guid is the post's activitypub.id when set, else its permalink. WordPress keeps the two apart: on andrewshell.org, post 813 federated as https://andrewshell.org/?p=813 but its RSS guid is https://andrewshell.org/2026/08/meet-me-at-wordcamp/, and posts carried over from the Eleventy site have guids like https://blog.andrewshell.org/essays/<slug>/. After a migration Geekity changes those guids, and every feed reader shows those posts again as new. A post needs a way to keep the guid its readers already have, whatever its federated id is.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A front matter key (named in doc-2) sets the guid the RSS, Atom and JSON feeds publish for a post, independent of activitypub.id
- [x] #2 Without that key the guid is unchanged: activitypub.id, else the permalink
- [x] #3 The key does not change the ActivityPub object id, the permalink or any redirect
- [x] #4 The editor keeps the key on save, and doc-2 documents it
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Name the key `guid` (top-level front matter, as WordPress names the field). It lands in Document.extra, so the admin editor's extra copy keeps it with no editor change.
2. feeds.test.ts: failing tests that a post with `guid` and a stored activitypub.id prints the guid as RSS guid, Atom id and JSON Feed id, with isPermaLink true only when it equals the permalink; that its ActivityStreams object id, permalink, link and the /?p=N redirect are unchanged and the guid URL gets no redirect; that a value that is not an absolute URL is ignored.
3. posts.test.ts: failing test that an editor save keeps `guid`.
4. feed-item.ts: FeedItem.id reads the `guid` key first (a string URL.canParse accepts, trimmed), then activityStreamsId, then the permalink. No FEED_ITEM_REVISION bump: a post without the key prints the same bytes, and adding the key changes the file hash that already keys the ETag.
5. doc-2 front matter table: document `guid`; doc-3 identity paragraph: note the override.
6. pnpm build/test/typecheck/lint/format:check; curl the demo with a guid post; deslop + no-comments.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Key is top-level `guid`, read in feed-item.ts feedGuidOf: a string that URL.canParse accepts after trimming wins over activityStreamsId, then the permalink. Anything else (a number, plain words) is ignored. RSS isPermaLink stays item.id === item.link, so a guid equal to the permalink (WordPress post 813's case) prints true. No FEED_ITEM_REVISION bump: a post without the key prints the same bytes, and adding it changes document.hash, which the feed ETag already covers. The editor needed no change: it copies Document.extra, which holds unknown keys. Tests: feeds.test.ts 'a post's feed guid (TASK-292)' covers seven posts across all three formats (guid with stored id, guid equal to permalink, guid alone, stored id alone, neither, guid: 77, guid: 'not a url'); article.test.ts proves the object id, the /?p=813 Article and 301, the permalink and a 404 at the guid's path; posts.test.ts proves an editor save keeps the key. The AC#3 and AC#4 tests passed before the code change: they guard existing behaviour rather than drive new code. Also updated doc-3's identity paragraph and the comments in feed-rss.ts and mount.ts that said RSS subscribers hold activitypub.id.
Verified: pnpm build, test (cms 5036 pass, 0 fail), typecheck, lint, format:check all pass. Curled a built server (packages/cms/dist) with a post carrying guid + activitypub.id ?p=813: /feed/ guid isPermaLink=false https://blog.example.com/essays/old-news/, Atom <id> and JSON Feed id the same, links the permalink; Accept activity+json at the permalink gives id http://localhost:3917/?p=813, url the permalink; /?p=813 as a browser 301s to the permalink; /essays/old-news/ 404s for browser and peer. Server stopped.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added a `guid` front matter key that sets the id the RSS, Atom and JSON feeds publish for a post, ahead of activitypub.id and the permalink, so a migrated post keeps the guid its feed readers already hold. The object id, permalink and redirects do not change, and the editor keeps the key on save. Documented in doc-2 (and doc-3's identity paragraph). Verified with new tests in feeds.test.ts, article.test.ts and posts.test.ts, the full build/test/typecheck/lint/format suite, and curl against a running server.
<!-- SECTION:FINAL_SUMMARY:END -->
