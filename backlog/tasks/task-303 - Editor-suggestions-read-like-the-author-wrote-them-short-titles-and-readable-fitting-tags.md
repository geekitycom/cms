---
id: TASK-303
title: >-
  Editor suggestions read like the author wrote them: short titles and readable,
  fitting tags
status: To Do
assignee: []
created_date: '2026-10-08 23:58'
labels: []
dependencies: []
references:
  - packages/plugin-post-summary/src/index.ts
  - packages/plugin-tag-suggest/src/index.ts
  - packages/plugin-tag-suggest/src/followers.ts
priority: medium
type: enhancement
ordinal: 263800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Tried on shll.me with openai/gpt-4.1-mini. Suggest title was very wordy on https://shll.me/2026/01/hello-world/ (the prompt allows 90 characters and asks for "the words a reader would search for"). Suggest tags gave poor results: tags are asked for as words run together and shown in tags.pub's folded lowercase form, so "WordCamp US" became "wordcampus" and others "contentorganization", "blogstructure"; "prefer a tag the site already uses" made the model add the site's only tag, introductions, to two unrelated posts; asking for 8 padded the list with generic tags (experience, posts, networking); and tags.pub follower counts are mostly 0 or 1, so the model's own order decides most of the ranking.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Suggest title asks for a short title (about 60 characters at most) in the way the author would write it, and gives the model a few of the site's recent titles as examples of its style when there are any
- [ ] #2 A suggested tag keeps a readable spelling (CamelCase for several words, such as WordCampUS) as the value the author accepts; the folded form is used only to look the tag up on tags.pub and to match the site's existing tags
- [ ] #3 The model is told to use an existing site tag only when the post is about that subject, and a test shows an unrelated existing tag is not forced in by the prompt wording alone (prompt text asserted)
- [ ] #4 Tag suggest asks for 3 to 5 specific tags, most fitting first, and avoids generic words; the list ranks by followers only among tags the model put in its top group, or otherwise keeps the model's order when follower counts do not separate them
- [ ] #5 Tests cover the new prompt text, the readable spelling surviving accept, and the ranking rule
<!-- AC:END -->
