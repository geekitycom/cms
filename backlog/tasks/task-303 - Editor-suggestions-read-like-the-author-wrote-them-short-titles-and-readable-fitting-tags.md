---
id: TASK-303
title: >-
  Editor suggestions read like the author wrote them: short titles and readable,
  fitting tags
status: In Progress
assignee:
  - '@claude'
created_date: '2026-10-08 23:58'
updated_date: '2026-10-09 00:28'
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
- [x] #1 Suggest title asks for a short title (about 60 characters at most) in the way the author would write it, and gives the model a few of the site's recent titles as examples of its style when there are any
- [x] #2 A suggested tag keeps a readable spelling (CamelCase for several words, such as WordCampUS) as the value the author accepts; the folded form is used only to look the tag up on tags.pub and to match the site's existing tags
- [x] #3 The model is told to use an existing site tag only when the post is about that subject, and a test shows an unrelated existing tag is not forced in by the prompt wording alone (prompt text asserted)
- [x] #4 Tag suggest asks for 3 to 5 specific tags, most fitting first, and avoids generic words; the list ranks by followers only among tags the model put in its top group, or otherwise keeps the model's order when follower counts do not separate them
- [x] #5 Tests cover the new prompt text, the readable spelling surviving accept, and the ranking rule
- [x] #6 Tag suggest ships a seed list of hashtags people follow, built by a repo script from a "tag,followers" CSV of tags.pub accounts followed on mastodon.social (Andrew's 2026-10-08 export): tags with at least 2 followers, minus tags.pub service accounts (names starting with "_", such as _followback and _____relay_____), minus sexual and adult tags by a reviewed denylist; the list records its source and date
- [ ] #7 Suggestions come back in two labelled groups in the editor: "For this post" (the most fitting tags, site tags first when they fit) and "For reach" (tags from the seed list that genuinely fit the post, ranked by followers); a seed tag that does not fit is never offered, and a tag in both groups is shown once
- [x] #8 Tests cover the seed filter (service accounts and denylisted tags dropped, threshold kept), the two groups, and that the prompt gives the model the seed list and the fit rule
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Core (feat(cms)): PluginEditorContext gains recentTitles (titles of the latest published posts, newest first, at most 10, the draft's own left out); PluginEditorChoice gains optional group; the endpoint passes group through and editor-actions.js draws a heading row when the group changes. Tests in editor-actions.test.ts.
2. post-summary (feat): title asked for in about 60 characters, in the author's own way, with up to 5 of recentTitles as style examples when there are any. Tests assert the prompt text and the examples.
3. tag-suggest seed: scripts/build-seed.ts turns a tag,followers CSV into src/seed.ts (>=2 followers, no leading _, minus scripts/denylist.txt entries; records source and date). Denylist curated from the 2026-10-08 export. Unit tests of the filter. Raw CSV not committed.
4. tag-suggest prompt and shape: model returns { forThisPost, forReach }; asks for 3-5 specific CamelCase tags, site tags only when the post is about that subject, reach tags only from the seed list and only when they fit. Readable spelling kept as the value (site spelling for site tags); hashtagKey only for lookup and matching. forReach filtered to seed keys, deduped against forThisPost.
5. Ranking: For this post keeps site tags first, then reorders by followers only where counts separate (>=2), else model order; For reach ranked by followers (tags.pub count, seed count when unknown). Choices carry group labels.
6. Tests: prompt text, readable spelling through accept, ranking, two groups, seed filter, prompt carries the seed list.
7. Verify: pnpm build/test/typecheck/lint/format:check, pack-install smoke, Playwright screenshot of the two groups against a scratch site with fakes.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
2026-10-08: Andrew supplied a CSV of tags.pub accounts followed on mastodon.social with follower counts (1769 rows; 638 with >=2 followers). Copy at /private/tmp/claude-501/-Users-andrewshell-code-geekity-cms/f2372b76-3d73-50a0-b22d-499e65ffca69/scratchpad/seed/tags-mastodon-social-2026-10-08.csv (not committed raw: it contains many sexual tags). _followback and _____relay_____ are tags.pub Service accounts, not hashtags (checked with an ActivityPub fetch; tag accounts are also type Service, so the leading underscore is the distinguishing mark). He wants tags picked either because they are very relevant to the post (good for the site) or because they are on this list (good for reach).

2026-10-09 build:
Core (feat(cms)): PluginEditorContext.recentTitles (latest published titled posts, newest first, at most 10, the draft's own title left out) and optional PluginEditorChoice.group; the endpoint passes group through; editor.njk adds a data-editor-choice-group template and editor-actions.js draws a heading row wherever the group changes. Plugins get the new core through their workspace:^ peer on @geekity/cms, so no range edit was needed.
post-summary: title asked for 'the way its author would write it', about 60 characters at most, with up to 5 recentTitles as 'Recent titles on this site, to match their style'; none when the site has no titled posts; description prompt unchanged.
tag-suggest: model answers { forThisPost, forReach }. forThisPost: 3 to 5 specific tags, generic words avoided, site tag only when the post is about that subject (the old 'Prefer a tag the site already uses' is gone). forReach: up to 5 from the seed list, only ones that fit, empty when none. Tags asked for in CamelCase; readableTag keeps that spelling as the value (site spelling for a site tag); hashtagKey only for the tags.pub lookup and matching. Reach tags off the seed list are dropped; a tag in both groups shows once, under For this post. Ranking: For this post puts site tags first, then reorders by tags.pub followers only where a count is 2 or more, else the model's order; For reach by the larger of the tags.pub and seed counts.
Seed: scripts/seed.ts (filter), scripts/build-seed.ts (pnpm --filter @geekity/plugin-tag-suggest seed <csv> --source .. --date ..), scripts/denylist.txt (names plus *fragment* entries). src/seed.ts: 551 tags from the 2026-10-08 mastodon.social export (638 with >=2, minus 2 service accounts, minus 85 denylisted). Raw CSV not committed.
Verification: pnpm build, typecheck, lint, format:check, test (cms 4964, llm 48, post-summary 17, tag-suggest 30, wordpress 36, demo 32; all pass); scripts/pack-install-smoke.sh passed. Mutations (no follower threshold, no seed filter on reach, no site-tags-first) each fail 2 tests. Playwright Chromium against a scratch site with the fake LLM and fake tags.pub drew 'For this post' (WordPress, Phoenix, WordCampUS, Conferences) and 'For reach' (Fediverse, OpenSource) with WordPress shown once; ticking WordCampUS and Fediverse and pressing Accept put 'WordCampUS, Fediverse' in Tags.
AC #7 left open: the groups, labels, dedupe and the off-seed drop are proven, but whether gpt-4.1-mini only picks seed tags that genuinely fit needs a real call. On shll.me after release, press Suggest tags on the WordCamp US post and the Hello World post: For reach should be empty or clearly on-topic, 'introductions' should not appear on the WordCamp post, and tags should read WordCampUS-style. Press Suggest title on Hello World: expect 60 characters or fewer in Andrew's style.
<!-- SECTION:NOTES:END -->
