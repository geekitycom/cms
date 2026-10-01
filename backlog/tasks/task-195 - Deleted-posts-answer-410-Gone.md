---
id: TASK-195
title: Deleted posts answer 410 Gone
status: To Do
assignee: []
created_date: '2026-10-01 17:01'
updated_date: '2026-10-01 17:04'
labels:
  - indieweb
  - webmention
  - federation
milestone: m-28
dependencies: []
references:
  - packages/cms/src/web/routes.ts
  - packages/cms/src/federation/article.ts
  - packages/cms/src/webmention/receive.ts
priority: medium
type: feature
ordinal: 211800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
IndieMark level 5 asks for deleting your own posts in a way other sites can see. Deleting a post already re-sends webmentions to everything it linked and federates a Delete with a Tombstone, but the post's URL then answers 404, so a receiver that re-fetches cannot tell a deleted post from a mistyped URL, and Webmention receivers are told to treat 410 as deletion. Keep a record of deleted posts' URLs (in files, per decision-9; decision-20 already keeps old URLs for moved posts) and answer 410 Gone at those URLs with a short page, until the URL is used again. Its ActivityPub id should answer a Tombstone with 410.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A deleted post's URL answers 410 Gone with a small HTML page, not 404
- [ ] #2 Its ActivityPub id answers 410 with a Tombstone object to an activity+json request
- [ ] #3 Publishing a new post at the same URL replaces the 410 with the post
- [ ] #4 The record of deleted URLs is kept in files and survives deleting the database
- [ ] #5 Webmentions sent on deletion reach targets that then see 410 when they verify
<!-- AC:END -->
