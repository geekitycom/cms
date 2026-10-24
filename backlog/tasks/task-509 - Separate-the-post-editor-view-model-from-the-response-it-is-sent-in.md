---
id: TASK-509
title: Separate the post editor view model from the response it is sent in
status: Done
assignee:
  - '@claude'
created_date: '2026-10-24 11:41'
updated_date: '2026-10-24 12:23'
labels:
  - refactor
milestone: m-49
dependencies: []
type: chore
ordinal: 420800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
packages/cms/src/admin/documents.ts:957 renderEditor (~160 lines) builds editor actions, the resume offer and a ~60-key template model, and sets c.status and headers halfway through. mountDocumentScreens (documents.ts:231) has the restore-or-conflict decision inline in the GET /:slug handler. submittedForm repeats stringOrEmpty(body[x]).trim() about 13 times.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Building the editor model is a pure function that does not touch the response; status and headers are applied in one place
- [x] #2 The restore-or-conflict decision and the editor action list are named functions
- [x] #3 Form fields are read through one trimming helper
- [x] #4 Editor screens behave the same: admin document and post tests pass without changes to their assertions
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. submittedForm and withLink read text fields through trimmedField from util/forms.ts (already the codebase's trimming helper).
2. Pull the GET /:slug restore-or-conflict branch into a named renderRestoredCopy function.
3. Split renderEditor: editorActions(document, trashed) builds the button list; resumeOffer(...) builds the resume offer; editorModel(c, options) builds the template model without touching the response, with the post-only keys in postEditorModel; renderEditor applies status and Permissions-Policy in one place and renders.
4. Run admin tests after each step, then the full verify suite.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
- Reused trimmedField from util/forms.ts rather than adding a new helper; submittedForm and withLink now read every trimmed text field through it.
- renderRestoredCopy(c, {kind, render, document, copy, rebase}) holds the GET /:slug restore-or-conflict decision.
- renderEditor is now three lines of response work: await editorModel, set status, set Permissions-Policy, render. editorModel builds the model and never writes the response; post-only keys live in postEditorModel; editorActions and resumeOffer are named.
- Awaits inside the model now run in a different order (resume's conflict check after enclosure/photo lookups); none have side effects.
- fnstats: renderEditor (~160 lines) gone from the top list; mountDocumentScreens 106 lines (was ~130).
- Validation: pnpm build, pnpm test (@geekity/cms 7481/7481), test:11ty, typecheck, lint, format:check all pass. Only documents.ts changed; no test files touched.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Split the post editor's view model from its response in admin/documents.ts: editorModel/postEditorModel build the template model without touching the response, renderEditor sets status and Permissions-Policy in one place, editorActions and resumeOffer are named, the restore-or-conflict decision moved into renderRestoredCopy, and submittedForm reads fields through trimmedField. Behaviour preserved: the full verify suite passes with @geekity/cms at 7481/7481 and no test assertions changed.
<!-- SECTION:FINAL_SUMMARY:END -->
