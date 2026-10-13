---
id: TASK-307
title: 'Reach tags keep a readable spelling, not the seed list''s lowercase'
status: Done
assignee:
  - '@claude'
created_date: '2026-10-09 02:00'
updated_date: '2026-10-09 02:49'
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
- [x] #1 A reach tag is offered and accepted in a readable spelling (OpenSource, IndieWeb, DigitalRights), taken from the model when it gives one whose folded form matches the seed tag, and the seed tag's own name otherwise
- [x] #2 The folded form is still what matches the seed list and looks up tags.pub; a site tag keeps the site's spelling
- [x] #3 Tests cover a reach tag given in CamelCase, one given in lowercase, and the fallback
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Root cause: the reach value is already the model's spelling, but the prompt lists the seed in tags.pub's folded lowercase and the model copies it. Tell the model the list is folded and to write the reach tags it picks in CamelCase too (opensource as OpenSource).
2. Give the reach choice an explicit spelling rule: the site's spelling when the site uses the tag; else the model's spelling when it is readable (not just the folded key) and folds to the seed tag; else the seed tag's own name.
3. Tests in test/suggest.test.ts: reach tag given in CamelCase, given in lowercase words (open source, digital-rights) made readable, and the folded fallback to the seed name; prompt asks for CamelCase reach tags; folded key still used for tags.pub lookups.
4. Verify: package tests, then pnpm build/test/typecheck/lint/format:check.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Root cause: candidatesFrom already offered the model's spelling for reach tags, but the prompt lists the seed in tags.pub's folded lower case and the model copied it. The prompt now says the list is lower case and asks for the picked ones in CamelCase (OpenSource for opensource). A reach tag the model still gives folded (modelSpelling === key) falls back to the seed's own name, which is readable for the seed's mixed-case entries (HashtagGames, ActivityPubAPI, Pottery); for the rest it is the same folded word, since the seed carries nothing better. Candidate.modelSpelling became Candidate.spelling, set per group. Test first: the new reach test failed with value 'hashtaggames' where 'HashtagGames' was expected, and the prompt assertion failed on the old text; both pass after. Validation: pnpm build, test (cms 5001, tag-suggest 31, all pass), typecheck, lint, format:check all exit 0.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Reach tags now offer a readable spelling. The prompt tells the model the follow list is folded to lower case and asks for its picks in CamelCase; a site tag keeps the site's spelling, a model spelling that is more than the folded key is kept, and a folded one falls back to the seed's own name. The folded key still admits the tag against the seed and looks it up on tags.pub. New test in test/suggest.test.ts covers CamelCase (OpenSource), lowercase words (digital-rights to DigitalRights), the seed fallback (hashtaggames to HashtagGames, linux stays linux) and the folded lookups; it failed before the change and passes after. Full pnpm build/test/typecheck/lint/format:check passed.
<!-- SECTION:FINAL_SUMMARY:END -->
