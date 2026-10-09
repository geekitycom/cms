---
id: TASK-307
title: 'Reach tags keep a readable spelling, not the seed list''s lowercase'
status: To Do
assignee: []
created_date: '2026-10-09 02:00'
labels: []
dependencies: []
references:
  - packages/plugin-tag-suggest/src/index.ts
priority: low
type: enhancement
ordinal: 267800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
On shll.me (plugin-tag-suggest 0.2.0) the For this post group shows CamelCase tags (WordCampUS, TechConference) but For reach shows the seed list's lowercase names (opensource, indieweb, digitalrights), so Accept would insert them in two styles.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A reach tag is offered and accepted in a readable spelling (OpenSource, IndieWeb, DigitalRights), taken from the model when it gives one whose folded form matches the seed tag, and the seed tag's own name otherwise
- [ ] #2 The folded form is still what matches the seed list and looks up tags.pub; a site tag keeps the site's spelling
- [ ] #3 Tests cover a reach tag given in CamelCase, one given in lowercase, and the fallback
<!-- AC:END -->
