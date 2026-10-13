---
id: TASK-310
title: >-
  Suggest title offers three fresh titles to pick from instead of echoing the
  current one
status: Done
assignee:
  - '@claude'
created_date: '2026-10-09 14:17'
updated_date: '2026-10-09 15:13'
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
- [x] #1 When suggesting a title, the model is not shown the draft's current title; the site's recent titles stay as style examples. A description suggestion still sees the title
- [x] #2 When a suggestion matches the field's current value ignoring case, spacing and trailing punctuation, the editor says the model suggests keeping it (for a title or a description) and offers no Accept
- [x] #3 Tests assert the title prompt omits the current title, the description prompt keeps it, and the keep-it outcome
- [x] #4 Suggest title asks for three titles in one call, each a different approach (for example plain, specific, a little more voice), none equal to the current title; duplicates ignoring case and punctuation are dropped, and the editor lists the rest to pick one
- [x] #5 Core lets an editor action beside Title answer with choices drawn as a pick-one list (radio buttons); Accept fills the field with the chosen title (and the slug as today); choices beside Tags stay pick-many; a plugin answering choices beside Description is still refused
- [x] #6 Suggest description stays a single suggestion
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Core (packages/cms): PluginEditorSuggestion gains { ok: true, message } (a note with nothing to accept); the endpoint passes choices beside Title and still refuses them beside Description; answerOf carries the note.
2. Core editor: the choice row beside Title is a radio (name scoped per button, form=editor-suggestions) and beside Tags stays a checkbox; editor-actions.js checks the first radio, Accept fills Title with the picked one and fires input so the slug follows; a note shows in the status line with no Accept.
3. Plugin: Suggest title sends the draft without its Title line, asks for three titles (plain, specific, more voice) as { titles: string[] }, tidies, drops ones equal to the current title or each other ignoring case, spacing and trailing punctuation, answers choices or the keep-it note. Suggest description stays single, still sees the title, answers the keep-it note when it matches.
4. Tests first (core editor-actions.test.ts, plugin suggest.test.ts), then code; update doc-5, plugin README, core plugin docs.
5. Verify: build, test, typecheck, lint, format:check, pack-install-smoke, Playwright on a scratch site with a fake provider.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
2026-10-09: second example from Andrew on shll.me: with the title edited to 'My experience at WordCamp fo shizzle', Suggest title returned 'My experience at WordCamp US', an edit of the current title rather than a title from the body. Confirms the model anchors on the Title line.

2026-10-09: Andrew asked for three title options to pick from; folded into this task. Descriptions stay single.

2026-10-09: built. Core: PluginEditorSuggestion gains { ok: true, message }, a note with nothing to accept; choices beside Title are allowed and drawn as radio buttons (name = the action URL, form=editor-suggestions), the first picked; choices beside Description are still refused. Plugin: Suggest title sends the draft without its Title line, asks for three titles (plain, specific, more voice) as { titles: string[] }, drops ones equal to the current title or each other (case, spacing, trailing punctuation), answers choices or 'The model suggests keeping the current title.'; Suggest description stays single, keeps the title line, answers the keep note when it matches. Schema has no minItems/maxItems: the plugin validates replies locally, so a model giving two titles would otherwise be an error; the instruction asks for three and the plugin keeps at most three. Suggest title now needs a body (the title alone is no longer sent).

Validation: pnpm build, pnpm test (cms 5058 pass, plugin-post-summary 22 pass, others pass), typecheck, lint, format:check, scripts/pack-install-smoke.sh all pass. Playwright Chromium on a scratch site with the fake provider: three radios listed, picked the second, Accept set Title to 'Three Days of WordCamp US, 2026' and slug to three-days-of-wordcamp-us-2026, posts folder unchanged; keep-title note with no Accept and no error colour; Suggest description single value with no radios, accepted; keep-description note.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Suggest title now hides the draft's current title from the model and offers three fresh titles as a pick-one radio list; a title or description that matches the field (ignoring case, spacing, trailing punctuation) becomes a 'model suggests keeping it' note with no Accept. Core gained title choices (radio buttons) and the { ok: true, message } note answer; description choices stay refused. Verified with new core and plugin tests, the full build/test/typecheck/lint/format suite, the pack-install smoke, and a Playwright Chromium run of the editor.
<!-- SECTION:FINAL_SUMMARY:END -->
