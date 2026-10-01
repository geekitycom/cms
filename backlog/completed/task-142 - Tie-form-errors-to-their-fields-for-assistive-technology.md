---
id: TASK-142
title: Tie form errors to their fields for assistive technology
status: Done
assignee:
  - '@claude'
created_date: '2026-09-28 23:36'
updated_date: '2026-09-30 03:36'
labels:
  - accessibility
milestone: m-21
dependencies: []
references:
  - 'https://specification.website/spec/accessibility/form-errors/'
  - 'https://specification.website/spec/accessibility/form-labels/'
priority: medium
type: enhancement
ordinal: 166800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Form errors are shown as text, but no field is marked aria-invalid or linked to its message with aria-describedby. This applies to the comment form, the contact form and the admin field macros (admin/components/fields.njk). The admin login error has no role, so a screen reader does not announce it.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A field that fails validation has aria-invalid=true and aria-describedby pointing at its error message
- [x] #2 After a failed submission, focus moves to an error summary that links to each invalid field
- [x] #3 The login error is announced (role=alert)
- [x] #4 Holds for the comment form, the contact form, login, password recovery and every admin form built from the field macros
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Test helper (src/__testing__/form-errors.ts): reads rendered HTML and checks the contract. Every control with aria-invalid=true has aria-describedby naming an element that holds its message; the error summary is role=alert, tabindex=-1, autofocus, is the first autofocus on the page, and links (#id) to exactly the invalid controls.
2. Failing tests first: field macros mark the control and id the error; a summary/problem macro pair; every admin page that imports fields.njk rendered with every problem set satisfies the contract; login, forgot, setup and reset render a role=alert summary; comment and contact forms over HTTP after a refused submission satisfy the contract.
3. fields.njk: error paragraph gets id {id}-error, control gets aria-invalid + aria-describedby when error is set; new summary(heading) macro (optional caller body of problem(id, message) links) and problem macro.
4. Replace every <p class=admin-error>/<p class=error> form-level line on macro-built forms with field.summary: settings-page layout (new settingsProblems block filled by each settings page), users new/edit, menus, personal-data, login, forgot, setup, reset (reset problem moves onto the password field).
5. Default theme comment-form and contact-form partials: same contract inline (theme cannot import admin macros); style the summary in style.css and admin.css; document the contract in the theme README.
6. Verify: pnpm build/test/typecheck/lint/format:check, then curl the running demo for a refused login, a refused comment and a refused contact message.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Contract: a refused form leads with one summary (role=alert, tabindex=-1, autofocus, aria-labelledby its heading) that links to each invalid field; each invalid control has aria-invalid=true and aria-describedby=<id>-error. Focus moves with the HTML autofocus attribute, no script, so the no-JS public forms get it too; the summary comes before the form so its autofocus wins over any field's.

Admin: fields.njk gained summary(heading) (optional call body) and problem(id, message); the field macros mark their control and id the error paragraph. errorHtml (Reading's 'page no longer published') is a standing note, not a refusal, so it is not named by aria-describedby. settings-page layout wraps a new settingsProblems block each settings page fills. Reset's problem now sits on the New password field as well as in the summary. Login, forgot and setup errors are form-level: summary headed by the message, no links. The documents editor does not use the field macros and keeps its <p class=admin-error>; out of scope here.

Public: the default theme's comment and contact partials carry the same contract inline (a theme cannot import admin macros); README documents it for replacement partials.

Lever: src/__testing__/form-errors.ts (tiedErrors) asserts the contract on any HTML. src/admin/form-errors.test.ts discovers every admin page that imports fields.njk and renders it with a problem on every key (Proxy), so a new macro form is held to the contract without being listed. Mutation check: deleting one settingsProblems line fails it.

Validation: pnpm build, test (2582 + 31 pass), typecheck, lint, format:check all clean. curl against the running demo: failed login and refused contact return the summary and the tied fields. Refused comment verified with curl against a scratch site with comments open (the demo's posts are closed). Headless Chrome over CDP: after a refused comment and a failed login, document.activeElement is the role=alert summary (login's username autofocus loses to it).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Refused forms now tell assistive technology what went wrong. Each invalid field carries aria-invalid=true and aria-describedby pointing at its message; a summary with role=alert, tabindex=-1 and autofocus leads the form, headed by the error and linking to each invalid field, so focus lands on it after a failed submission with no script. Applied through new summary/problem macros and the field macros for every admin form built from them (settings pages via a settingsProblems block, users new/edit, menus, personal data, login, forgot, setup, reset), and inline in the default theme's comment and contact partials, documented in the theme README. Verified by a shared tiedErrors test helper, an auto-discovering test over every macro-built admin page, HTTP tests for login, settings, comment and contact, curl against running sites, and headless Chrome confirming focus lands on the summary.
<!-- SECTION:FINAL_SUMMARY:END -->
