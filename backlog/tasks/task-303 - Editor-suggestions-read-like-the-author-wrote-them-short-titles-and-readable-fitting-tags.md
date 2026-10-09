---
id: TASK-303
title: >-
  Editor suggestions read like the author wrote them: short titles and readable,
  fitting tags
status: To Do
assignee: []
created_date: '2026-10-08 23:58'
updated_date: '2026-10-09 00:09'
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
- [ ] #6 Tag suggest ships a seed list of hashtags people follow, built by a repo script from a "tag,followers" CSV of tags.pub accounts followed on mastodon.social (Andrew's 2026-10-08 export): tags with at least 2 followers, minus tags.pub service accounts (names starting with "_", such as _followback and _____relay_____), minus sexual and adult tags by a reviewed denylist; the list records its source and date
- [ ] #7 Suggestions come back in two labelled groups in the editor: "For this post" (the most fitting tags, site tags first when they fit) and "For reach" (tags from the seed list that genuinely fit the post, ranked by followers); a seed tag that does not fit is never offered, and a tag in both groups is shown once
- [ ] #8 Tests cover the seed filter (service accounts and denylisted tags dropped, threshold kept), the two groups, and that the prompt gives the model the seed list and the fit rule
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
2026-10-08: Andrew supplied a CSV of tags.pub accounts followed on mastodon.social with follower counts (1769 rows; 638 with >=2 followers). Copy at /private/tmp/claude-501/-Users-andrewshell-code-geekity-cms/f2372b76-3d73-50a0-b22d-499e65ffca69/scratchpad/seed/tags-mastodon-social-2026-10-08.csv (not committed raw: it contains many sexual tags). _followback and _____relay_____ are tags.pub Service accounts, not hashtags (checked with an ActivityPub fetch; tag accounts are also type Service, so the leading underscore is the distinguishing mark). He wants tags picked either because they are very relevant to the post (good for the site) or because they are on this list (good for reach).
<!-- SECTION:NOTES:END -->
