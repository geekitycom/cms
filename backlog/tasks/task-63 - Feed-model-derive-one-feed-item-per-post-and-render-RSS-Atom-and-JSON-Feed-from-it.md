---
id: TASK-63
title: >-
  Feed model: derive one feed item per post and render RSS, Atom and JSON Feed
  from it
status: To Do
assignee: []
created_date: '2026-09-05 13:08'
updated_date: '2026-09-05 13:15'
labels:
  - web
milestone: m-10
dependencies:
  - TASK-62
  - TASK-65
references:
  - packages/cms/src/web/feeds.ts
  - packages/cms/src/web/routes.ts
  - packages/cms/src/web/documents.ts
documentation:
  - backlog/docs/doc-3 - Content-Negotiation.md
type: task
ordinal: 97000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
web/feeds.ts has no feed model: FeedSource is a bag of inputs and rssItem, atomEntry and jsonFeedItem each read the Document again. They already disagree. RSS keys an item by its ActivityStreams object id where Atom and JSON Feed use the permalink; RSS lists categories and tags where the others list tags only; RSS falls back to an excerpt of the HTML where the others print the description or nothing. Introduce a feed item: one shape derived once per document and site (both ids, title, link, published and updated instants, author, categories, tags, summary, content HTML) with the three serialisers rendering from it and the envelope (channel, cloud and hub elements, headers, fingerprint) unchanged. This task is the refactor only: each format keeps the id, terms and summary it prints today, so every feed is byte-identical before and after, and TASK-64 then changes what the item says. The comments feed keeps rendering the Conversation module's entries (TASK-62) and is not part of the post item.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 One function derives a feed item from a document and the site, and rssItem, atomEntry and jsonFeedItem take an item rather than a document
- [ ] #2 The feed item and the three serialisers are tested directly on fixtures: the item's derivation in one test file, and each serialiser given the same item
- [ ] #3 Every feed the site serves is byte-identical to before the change for the same content, including ETags, proved by feeds.test.ts passing without a changed expectation and by a snapshot of the three formats over the demo content taken before and after
- [ ] #4 web/feeds.ts is split so the item, the serialisers and the XML plumbing are separate modules
- [ ] #5 doc-3's feeds section names the item
<!-- AC:END -->
