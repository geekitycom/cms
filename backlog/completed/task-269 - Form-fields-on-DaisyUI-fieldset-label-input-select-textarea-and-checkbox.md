---
id: TASK-269
title: 'Form fields on DaisyUI fieldset, label, input, select, textarea and checkbox'
status: Done
assignee:
  - '@claude'
created_date: '2026-10-04 11:12'
updated_date: '2026-10-05 01:45'
labels:
  - admin
  - daisyui
milestone: m-29
dependencies:
  - TASK-266
references:
  - >-
    backlog/decisions/decision-30 -
    The-admin-is-DaisyUI-on-Tailwind-compiled-at-build-time-in-DaisyUIs-own-themes-chosen-per-user-drawn-from-Nunjucks-component-macros-under-one-shadow-rooted-admin-bar-on-both-sides.md
documentation:
  - backlog/docs/doc-5 - Admin-UI.md
priority: medium
type: feature
ordinal: 228800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
decision-30: the seven macros in admin/components/fields.njk emit DaisyUI markup (fieldset, fieldset-legend, label, input, select, textarea, checkbox, and validator for a refused field), which converts the 160 field sites across the settings pages, the users screens, the account screens and the editor in one step. What the macros promise today stays: a visible label bound by for and id, the error before the hint, aria-invalid and aria-describedby on a refused control, value always written, and the refused-form summary, which becomes an alert. Take the markup from the MCP server's syntax expert for each component.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Every macro in fields.njk emits DaisyUI markup for its control, with the label bound by for/id, the error paragraph before the hint, and aria-invalid plus aria-describedby on a refused control, and fields.test.ts passes updated to the new markup
- [x] #2 The refused-form summary (field.summary) is a DaisyUI alert with role=alert that still takes focus on load and links to each refused field
- [x] #3 Every settings page, the users screens and the account screens render through the macros with no per-page field CSS; the form-errors, settings and users test files pass
- [x] #4 The checkbox macro keeps the sentence beside the tick, and a disabled or readonly control keeps its attribute and is visibly so in both a light and a dark theme
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Data shape: the seven macros (text, password, textarea, select, checkbox, summary, problem) keep the old signatures exactly; every caller's keyword arguments were read with a script over admin/ and daisyui/ (text: type min step inputmode autocomplete placeholder spellcheck required autofocus readonly disabled error hint errorHtml; password; textarea rows; select errorHtml; checkbox checked value). No caller changes.
2. DaisyUI shape per field: a div.fieldset holding the label (fieldset-legend, bound by for/id), the control (input/select/textarea input-sm sizes, full width, validator only when refused), the error as p.validator-hint with id {id}-error, any errorHtml inside a text-error wrapper, then the hint as p.label. Checkbox: the canonical label.label wrapping a checkbox with the sentence beside it, validator on the label when refused. Readonly text and textarea boxes take read-only:bg-base-200 so they read as not editable.
3. Summary: field.summary calls the alert macro (color error) with two new alert arguments, labelledby and focus (tabindex=-1 autofocus, no script, so the CSP is untouched); problem links carry the link class.
4. Tests first: fields.test.ts runs its contract over both admins (old and DaisyUI roots) plus DaisyUI markup tests; components.test.ts covers the alert's new arguments; form-errors.test.ts renders every refused form under both admins and checks a refused login and settings save over HTTP with GEEKITY_ADMIN=daisyui in a child process.
5. Verify: full build/test/typecheck/lint/format; over HTTP with the switch on, a settings page, users screens, login, a refused save; headless Chrome computed styles for disabled and readonly controls and visible errors in light and dark themes, and focus on the summary at load.
6. doc-5: a line on the field macros' DaisyUI markup in the Components section.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Data shape: the seven macros keep the old fields.njk signatures; every caller's keyword arguments were read with a script over admin/ and daisyui/, so no caller changes. Each field is one div.fieldset (the class, not the element: a fieldset element is a group named by its legend, and one box has no group to name; DaisyUI's validator example puts the class on a label and a form). The label is a label element with fieldset-legend, bound by for/id. Controls are input/textarea/select input-sm etc., w-full, class written last in the tag so tests that pin name/type/value/checked runs still match. A refused control gets validator; the error is p.validator-hint id={id}-error, its later sibling, which DaisyUI shows and colours only after an aria-invalid validator. errorHtml is wrapped in div.text-error so the Reading page's old <p class=admin-field-error> paragraphs read as errors without a caller change. The hint is p.label block whitespace-normal: DaisyUI's label is a nowrap inline-flex, which splits a sentence around its <code>. Checkbox is the canonical label.label wrapping the tick with the sentence beside it (text-base-content, wraps); validator goes on the label when refused. Read-only text and textarea boxes take read-only:bg-base-200 read-only:border-dashed: in the dark theme base-100 and base-200 differ by about 0.02 lightness, so the fill alone did not read as read-only.
Summary: field.summary calls the alert macro with color=error and two new alert arguments, labelledby and focus (tabindex=-1 autofocus). No script, so the CSP is untouched.
Tests: fields.test.ts runs its whole contract over both admins (explicit roots: admin/ alone, and daisyui/ over admin/), plus DaisyUI markup tests and the old admin's checkbox and class checks; components.test.ts covers the alert's new arguments; form-errors.test.ts renders every refused form under both admins and, through __testing__/fields-probe.ts in a child process with GEEKITY_ADMIN=daisyui, checks a refused login, settings save and add-user form over HTTP and that every settings page, the users edit/new/apps screens and login draw their fields through the macros. Those HTTP checks fail (15) with daisyui/components/fields.njk removed.
Browser proof: headless Chrome over CDP against a sandbox site with GEEKITY_ADMIN=daisyui, prefers-color-scheme light and dark. The alert is document.activeElement after a refused login, settings save and token form. Refused errors are visibility visible in --color-error, the refused box and checkbox borders are the error colour. Base URL (disabled+readonly): attributes kept, base-200 fill, 40% text, cursor not-allowed, dashed. Created token (readonly): base-200 fill vs base-100 editable, dashed vs solid edge, full-strength text. No page or fieldset overflow at 390px on settings, reading, users/new, users/1.
DaisyUI quality inspector (workflow m30-admin-fields): manual checks pass; two automated findings are false positives kept on purpose: list-disc is Tailwind's list-style utility (it has a rule in the compiled sheet), and validator-hint's root validator sits on the preceding sibling control, which is the structure DaisyUI's selector .validator ~ .validator-hint requires.
Validation: pnpm build, pnpm test (4342 + 30 pass), typecheck, lint, format:check all pass from the root. With GEEKITY_ADMIN=daisyui the settings, users, form-errors, fields and indexnow test files pass; 52 old-admin tests elsewhere (keyboard, At a glance, assets cache, admin-theme, admin-bar, rebuild, records) fail with the switch on with or without this task's templates, so they predate it.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
daisyui/components/fields.njk shadows the old field macros by name, so every settings page, the users screens, the account screens and the editor draw their fields in DaisyUI with GEEKITY_ADMIN=daisyui and no caller change. Each field is a fieldset (label as fieldset-legend bound by for/id, the input/textarea/select/checkbox, the error as a validator-hint after a refused validator control, the hint as a label); the checkbox keeps its sentence beside the tick; read-only boxes get a base-200 fill and a dashed edge. The refused-form summary is the alert macro in error colour, which gained labelledby and focus arguments and takes focus on load with no script. Verified by fields.test.ts over both admins, form-errors.test.ts over both admins plus HTTP checks in a child process with the switch on, the full suite, typecheck, lint and format, and headless Chrome computed styles in light and dark (focus on the alert, visible red errors, disabled and read-only boxes visibly so).
<!-- SECTION:FINAL_SUMMARY:END -->
