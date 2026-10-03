---
id: TASK-227
title: 'Unlisted posts: served at their URL, left out of every list'
status: To Do
assignee: []
created_date: '2026-10-03 01:32'
labels:
  - micropub
  - federation
  - interop
dependencies: []
priority: medium
type: feature
ordinal: 242800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TASK-219's visibility decision: support public and unlisted, refuse private. An unlisted post keeps its page (with noindex) and drops out of the home page, archives, tag and category pages, feeds, sitemap, search, llms.txt and IndexNow. It federates with to: followers and cc: Public, the swap of the public addressing in packages/cms/src/federation/article.ts, so Mastodon shows it as unlisted. Webmentions still go out. Today isPublicDocument (packages/cms/src/web/documents.ts) and the SQL predicate the content index answers with decide served and listed as one rule; split them. TASK-222 accepts visibility=public and refuses unlisted with 'does not publish unlisted posts yet' in packages/cms/src/micropub/create.ts, and advertises visibility ["public"] in q=config.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A post can be unlisted from the admin editor and from Micropub (visibility=unlisted on create and update), stored as front matter, and q=source returns it
- [ ] #2 An unlisted post's page answers 200 with a noindex robots meta, and the post is absent from the home page, archives, tag and category pages, every feed, the sitemap, search, llms.txt and IndexNow pings
- [ ] #3 An unlisted post federates with to: followers and cc: Public on Create and Update
- [ ] #4 q=config advertises visibility ["public", "unlisted"] and decision-27's amendment says so
- [ ] #5 README and doc-2 document unlisted posts
<!-- AC:END -->
