---
id: TASK-467
title: Admin form buttons sit clear of the last field
status: Done
assignee:
  - '@claude'
created_date: '2026-10-21 13:24'
updated_date: '2026-10-21 13:30'
labels:
  - admin
dependencies: []
priority: medium
ordinal: 401800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
On many admin forms the card-actions row (the submit buttons drawn by packages/cms/admin/components/card.njk actions) sits right under the last field with almost no space, for example the Add plugin form. Give the actions row consistent top spacing everywhere it follows form fields.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Every card-actions row that follows form fields has visible space above it, the same on every admin form
- [x] #2 Cards whose actions follow plain text or a table keep a sensible gap and do not get double spacing
- [x] #3 Checked in a headless browser on at least the Add plugin form, a settings form and the user form, at desktop and phone widths
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Root cause: card-body spaces only its direct children (gap 0.5rem); a cardActions row inside a <form> sits after the last fieldset with only the fieldset's 0.25rem bottom padding, 4px.
2. Give the cardActions macro itself a top margin (mt-2), so after a field the row is 4+8 = 12px, the same as the existing <div class="mt-2"> submit rows on the user, email, menu and media forms; after text it becomes 8+8 = 16px, no double gap.
3. Update the card component test first, then card.njk; rebuild admin css.
4. Measure the gap before/after with Playwright on Plugins (Add plugin), settings and user pages at 1280 and 390 px; run the full check suite.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Cause: card-body is a flex column with gap 0.5rem, which only spaces its direct children. Nearly every cardActions row sits inside a <form>, so under the last field it got just the fieldset's 0.25rem bottom padding (4px). Fix in the macro: card-actions now carries mt-2.

Measured with Playwright on a scratch site (gap from the last field's last line, or the text above, to the top of the buttons), 1280 and 390 px alike:
- Plugins > Add plugin: after the password field 4px -> 12px; Updates card, after text: 8px -> 16px.
- Tools > Maintenance: after the field 4px -> 12px; after text 8px -> 16px.
- Users > edit: Save theme (cardActions) 12px, the same as Save email address and Save profile (existing div.mt-2 rows); Delete card after text 16px.
- Settings > General and Discussion: the TMDb/Akismet Save key rows (div.mt-2) are 12px, the same as cardActions after a field now.
Not changed: the page-level Save settings button in layouts/settings-page.njk (not a card) sits 28px below the last field (form gap-2 + mt-4); a few non-card forms use mt-4 rows.

Checks: pnpm build, test (cms 6520 pass), test:11ty, typecheck, lint, format:check all pass.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
The cardActions macro (packages/cms/admin/components/card.njk) now draws card-actions mt-2, so a button row inside a form sits 12px below the last field instead of 4px, matching the existing mt-2 submit rows on the user and settings cards; rows after text get 16px (was 8px), no double gap. Component test added first (failed, then passed). Verified with Playwright measurements and screenshots of Plugins, Settings (General, Discussion, Email), Users edit, Maintenance and Personal data at 1280 and 390 px, plus the full build/test/typecheck/lint/format suite.
<!-- SECTION:FINAL_SUMMARY:END -->
