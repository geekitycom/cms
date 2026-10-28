---
id: TASK-524
title: >-
  A form challenge seam with hCaptcha verification on the contact and comment
  forms
status: To Do
assignee: []
created_date: '2026-10-28T20:14:00Z'
labels: []
milestone: m-50
dependencies:
  - TASK-523
references:
  - decision-65
ordinal: 426800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
decision-65: the public forms get a challenge step, built into core behind a seam a site can replace, as `commentChecker` is replaceable. hCaptcha is the one core ships. The operator chose to keep the forms working with JavaScript off, so a missing or failed token makes the submission spam rather than refusing it, and an unreachable hCaptcha counts as no opinion.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A config option names a form challenge; with none named, core uses hCaptcha, which does nothing while the site key or the secret is empty
- [ ] #2 With hCaptcha configured, a contact submission and a stranger comment submission are verified against hCaptcha siteverify with the secret, the token, the site key and the client address
- [ ] #3 A submission with no token, or one hCaptcha rejects, is stored with the `spam` status (the Spam list on Messages for contact, a spam comment for comments) and sends no email or notice
- [ ] #4 A verification call that errors or times out is treated as no opinion, and the submission goes on exactly as it would with hCaptcha off
- [ ] #5 The honeypot, form age and rate limit still run first, and Akismet still runs on whatever the challenge passes
- [ ] #6 A signed-in commenter is never challenged; webmentions and moderator replies are never challenged
- [ ] #7 The verification call is not held in dev mode, and the dev-mode site test still passes
- [ ] #8 Storing or removing the keys takes effect on the next submission without a restart
- [ ] #9 Tests cover pass, missing token, rejected token, unreachable hCaptcha, signed-in, and hCaptcha off, for both forms, with no real network call
<!-- AC:END -->
