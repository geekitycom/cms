---
id: TASK-310
title: >-
  Suggest title offers three fresh titles to pick from instead of echoing the
  current one
status: To Do
assignee: []
created_date: '2026-10-09 14:17'
updated_date: '2026-10-09 14:20'
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
- [ ] #4 Suggest title asks for three titles in one call, each a different approach (for example plain, specific, a little more voice), none equal to the current title; duplicates ignoring case and punctuation are dropped, and the editor lists the rest to pick one
- [ ] #5 Core lets an editor action beside Title answer with choices drawn as a pick-one list (radio buttons); Accept fills the field with the chosen title (and the slug as today); choices beside Tags stay pick-many; a plugin answering choices beside Description is still refused
- [ ] #6 Suggest description stays a single suggestion
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
2026-10-09: second example from Andrew on shll.me: with the title edited to 'My experience at WordCamp fo shizzle', Suggest title returned 'My experience at WordCamp US', an edit of the current title rather than a title from the body. Confirms the model anchors on the Title line.

2026-10-09: Andrew asked for three title options to pick from; folded into this task. Descriptions stay single.
<!-- SECTION:NOTES:END -->
