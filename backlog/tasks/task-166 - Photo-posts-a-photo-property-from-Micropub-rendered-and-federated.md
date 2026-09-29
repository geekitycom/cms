---
id: TASK-166
title: 'Photo posts: a photo property from Micropub, rendered and federated'
status: To Do
assignee: []
created_date: '2026-09-29 01:55'
labels:
  - micropub
  - content
  - theme
milestone: m-25
dependencies:
  - TASK-164
  - TASK-165
references:
  - 'https://www.w3.org/TR/micropub/'
  - 'https://ptd.spec.indieweb.org/'
priority: medium
type: feature
ordinal: 190800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Most mobile Micropub clients post photos. A post can carry one or more photos, each a URL with optional alt text; Micropub supplies them as a URL, as {value, alt}, or as a file part in the create request itself, which is stored through the media endpoint's path. Photos live in front matter, the admin editor shows and edits them, the default theme renders them as u-photo inside the h-entry with their alt text, Post Type Discovery gains its photo branch in spec order, and the ActivityStreams object carries them as image attachments.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A Micropub create with photo as a URL, as {value, alt} and as a multipart file each produce a post whose photos are stored in front matter with their alt text
- [ ] #2 The default theme renders each photo as an img.u-photo with its alt inside the h-entry
- [ ] #3 A post with photos and no name is typed photo by Post Type Discovery, and a reply with a photo is still a reply, proven by tests
- [ ] #4 The federated object carries each photo as an Image attachment with its alt as name
- [ ] #5 The admin editor lists a post's photos and can add, remove and edit their alt text
- [ ] #6 doc-2 documents the photo key
<!-- AC:END -->
