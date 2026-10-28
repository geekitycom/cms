---
id: TASK-526
title: Privacy page and docs for hCaptcha
status: To Do
assignee: []
created_date: '2026-10-28T20:14:00Z'
labels: []
milestone: m-50
dependencies:
  - TASK-525
references:
  - decision-65
ordinal: 428800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
decision-65: a site that turns hCaptcha on loads a third-party script on its form pages and sends hCaptcha the visitor address, so its privacy page has to say so. A site with its own Content-Security-Policy has to allow hCaptcha, and operators need to know what a missing token does.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The starter privacy page written by `geekity init` and `apps/demo/content/pages/privacy.md` gain an optional hCaptcha section beside the Akismet one, saying what is sent and linking hCaptcha privacy policy
- [ ] #2 docs/comments.md lists the challenge in the contact form and comment form defence tables, in order, with what a missing or failed token does
- [ ] #3 docs/configuration.md says which origins a site-set Content-Security-Policy must allow for hCaptcha
- [ ] #4 `pnpm lint` passes, including the doc link check
<!-- AC:END -->
