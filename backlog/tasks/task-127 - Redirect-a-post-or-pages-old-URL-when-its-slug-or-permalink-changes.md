---
id: TASK-127
title: Redirect a post or page's old URL when its slug or permalink changes
status: To Do
assignee: []
created_date: '2026-09-28 23:36'
labels:
  - seo
  - urls
milestone: m-18
dependencies: []
references:
  - 'https://specification.website/spec/agent-readiness/stable-urls/'
  - 'https://specification.website/spec/seo/redirects/'
priority: high
type: feature
ordinal: 151800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Editing a post or page slug, or anything else its permalink is built from (date, permalink pattern), leaves the old URL returning 404. Backlinks, bookmarks, search results and copies other servers hold go dead. Only taxonomy renames are redirected today (src/web/taxonomy.ts). The specification treats URLs as public contracts. Under decision-9 the record of old URLs must live in the content files, not only in SQLite. Under decision-13 a post's ActivityStreams id is its permalink, so the plan has to settle what the old id serves: a redirect, or the object with its new id followed by an Update.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Changing a published post's or page's slug makes the old URL answer 301 (or 308) with the new URL
- [ ] #2 Chains collapse: after two renames, both earlier URLs redirect straight to the current one
- [ ] #3 The old URLs are recorded in the document's file, so deleting the SQLite cache keeps them working
- [ ] #4 A new document that claims an old URL takes it over, and the redirect stops
- [ ] #5 .md and .json representations of the old URL redirect too
- [ ] #6 Federation behaviour for a renamed post is decided, recorded as a decision, and tested
<!-- AC:END -->
