---
id: TASK-142
title: Tie form errors to their fields for assistive technology
status: To Do
assignee: []
created_date: '2026-09-28 23:36'
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
- [ ] #1 A field that fails validation has aria-invalid=true and aria-describedby pointing at its error message
- [ ] #2 After a failed submission, focus moves to an error summary that links to each invalid field
- [ ] #3 The login error is announced (role=alert)
- [ ] #4 Holds for the comment form, the contact form, login, password recovery and every admin form built from the field macros
<!-- AC:END -->
