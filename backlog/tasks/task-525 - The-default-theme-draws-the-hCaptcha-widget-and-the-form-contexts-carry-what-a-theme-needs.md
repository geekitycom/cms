---
id: TASK-525
title: >-
  The default theme draws the hCaptcha widget, and the form contexts carry what
  a theme needs
status: To Do
assignee: []
created_date: '2026-10-28T20:14:00Z'
labels: []
milestone: m-50
dependencies:
  - TASK-524
references:
  - decision-65
ordinal: 427800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
decision-65: a theme has to be able to draw the challenge. The default theme partials currently promise no script, and a site without hCaptcha should keep that. A site that replaces either partial needs the same data to draw the widget itself, or its stranger submissions all count as spam.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 `contactForm` and `commentForm` carry the challenge when one is on: the provider, the site key, the script URL and the field name; without one, nothing extra is on the context
- [ ] #2 The default theme renders the hCaptcha widget and loads its script only when the challenge is on and only for a stranger; a signed-in comment form and a site without hCaptcha get no script
- [ ] #3 The widget follows the site colour mode (light, dark or the visitor preference) and the page language
- [ ] #4 With JavaScript off, the form says the message may need a manual check and still submits
- [ ] #5 The widget is reachable by keyboard and labelled in the form order, and the accessibility checks still pass
- [ ] #6 docs/theme/comment-form.md and docs/theme/contact-form.md document the new context fields and say what happens to a replaced partial that draws no widget
<!-- AC:END -->
