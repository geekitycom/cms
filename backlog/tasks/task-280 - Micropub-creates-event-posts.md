---
id: TASK-280
title: Micropub creates event posts
status: To Do
assignee: []
created_date: '2026-10-06 03:54'
labels:
  - micropub
  - indieweb
dependencies:
  - TASK-200
references:
  - packages/cms/src/micropub/endpoint.ts
priority: low
type: feature
ordinal: 239800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Since TASK-200 a post with a start is an event (h-event), made in the admin editor. The Micropub endpoint creates h-entry posts only, so a client such as Quill cannot publish an event, and q=source returns an event as an h-entry without its start, end or location. Accept h=event with start, end, location, name and content, and give them back from q=source.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A Micropub create with h=event and a start makes an event post as the editor would
- [ ] #2 q=source of an event returns h-event with its start, end and location
- [ ] #3 q=config offers the event post type
<!-- AC:END -->
