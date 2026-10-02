---
id: TASK-217
title: 'Accept Quill''s photo[value] and photo[alt] form fields in a Micropub create'
status: To Do
assignee: []
created_date: '2026-10-02 17:16'
labels:
  - micropub
  - accessibility
milestone: m-25
dependencies: []
priority: medium
type: enhancement
ordinal: 233800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Quill sends a photo with alt text form-encoded as photo[value] and photo[alt], a client convention outside the Micropub spec. The endpoint refuses it with 400 'does not understand photo[value], photo[alt]' (decision-27 refuses what it cannot map). Without alt text Quill's photo post works, but a site with requireAltText on cannot take a Quill photo at all, and alt text is the point of M22. Found by reading Quill's source and reproduced with curl while building TASK-170. Decide whether to accept the form convention and map it onto the existing {value, alt} photo shape from TASK-166.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A form-encoded create with photo[value] and photo[alt] stores the photo with its alt text
- [ ] #2 decision-27's mapping notes record the accepted convention
<!-- AC:END -->
