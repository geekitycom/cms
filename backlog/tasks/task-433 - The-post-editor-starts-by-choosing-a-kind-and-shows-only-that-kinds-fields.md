---
id: TASK-433
title: The post editor starts by choosing a kind and shows only that kind's fields
status: To Do
assignee: []
created_date: '2026-10-20 01:15'
labels:
  - admin
milestone: m-40
dependencies:
  - TASK-432
references:
  - _local/editor-mockups/a-picker.html
  - _local/editor-mockups/shared/forms.js
  - packages/cms/admin/pages/documents/editor.njk
priority: high
ordinal: 370800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The editor at /admin/posts/new and /admin/posts/{slug} shows every property at once: photos, location, recording, responding to, event, read, and more. That is hard to use and invites mistakes. Replace it with the layout chosen from _local/editor-mockups (option A, a-picker.html): "+ New" opens a grid of kinds; choosing one opens a short form with only that kind's fields. A "Change type" menu in the heading switches it. Fields every kind shares move to a slimmer sidebar.

Kinds: Note (an optional title makes it an article), Photo, Link (replies to, likes, reposts or bookmarks), RSVP, Event, Check-in, Episode (audio or video with an enclosure), Review (from the review task) and Page. Pages > Add new opens the Page form directly.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 /admin/posts/new shows the kinds as a grid, each with a name and one line saying what it is for, and each opens its own form
- [ ] #2 Each kind's form shows only its own fields, as in the mockup; a Read section is gone and Photo has a library picker with alt text per photo
- [ ] #3 The sidebar holds Publish (save draft, publish or update, when, visibility, author), Tags and categories, Location (except Check-in and Event), Address, Summary and language, Syndicate to, and Display and discussion
- [ ] #4 Change type switches the form and keeps the title, body, tags and other shared values
- [ ] #5 Editing an existing post opens on the kind post type discovery gives it
- [ ] #6 A post with properties from more than one kind (such as a Micropub reply with photos) still shows and saves every property it has; nothing is dropped by editing it
- [ ] #7 Plugin editor actions (title, description and tag suggestions) still appear next to their fields
- [ ] #8 The chooser and every form work with JavaScript switched off
- [ ] #9 doc-5 and the admin docs describe the new editor
<!-- AC:END -->
