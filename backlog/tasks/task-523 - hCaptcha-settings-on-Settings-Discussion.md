---
id: TASK-523
title: hCaptcha settings on Settings > Discussion
status: To Do
assignee: []
created_date: '2026-10-28T20:14:00Z'
labels: []
milestone: m-50
dependencies: []
references:
  - decision-65
ordinal: 425800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
decision-65 puts hCaptcha in core next to Akismet. Before a form can ask for a challenge, a site needs somewhere to store a site key and a secret, and an operator needs a screen to set them on. The Akismet key is the pattern: a settings namespace over a credential data file, environment overrides, and a section of Settings > Discussion that stores, checks and removes it.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 An `hcaptcha` settings namespace stores `site_key` and `secret` in `data/hcaptcha.json`, declared as a credential data file; `secret` is a secret setting and `site_key` is not
- [ ] #2 `GEEKITY_HCAPTCHA_SITE_KEY` and `GEEKITY_HCAPTCHA_SECRET` override the file, and the screen says when a value is set elsewhere, as it does for the Akismet key
- [ ] #3 Settings > Discussion has an hCaptcha section that saves both values, removes them, and never prints the stored secret back into the page
- [ ] #4 Saving checks the pair against hCaptcha where hCaptcha allows it, and the screen shows the result; a failed check still saves, as the Akismet key does
- [ ] #5 The settings golden file, the data-file census and the settings CLI cover the new namespace
- [ ] #6 docs/configuration.md and docs/comments.md describe the settings
<!-- AC:END -->
