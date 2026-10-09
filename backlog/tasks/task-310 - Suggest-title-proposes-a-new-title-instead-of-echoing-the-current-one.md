---
id: TASK-310
title: Suggest title proposes a new title instead of echoing the current one
status: To Do
assignee: []
created_date: '2026-10-09 14:17'
labels: []
dependencies: []
references:
  - packages/plugin-post-summary/src/index.ts
priority: medium
type: bug
ordinal: 270800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
On shll.me with z-ai/glm-5.3-flash, Suggest title answered in a couple of seconds with the exact title the post already had. The title prompt sends the draft with its current title ("Title: …") and asks for a title written the way its author would write it, so the current title is the strongest evidence and a cautious model returns it.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 When suggesting a title, the model is not shown the draft's current title; the site's recent titles stay as style examples. A description suggestion still sees the title
- [ ] #2 When a suggestion matches the field's current value ignoring case, spacing and trailing punctuation, the editor says the model suggests keeping it (for a title or a description) and offers no Accept
- [ ] #3 Tests assert the title prompt omits the current title, the description prompt keeps it, and the keep-it outcome
<!-- AC:END -->
