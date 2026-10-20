---
id: TASK-454
title: The Umami plugin reads stats from Umami Cloud or a self-hosted Umami
status: To Do
assignee:
  - '@claude'
created_date: '2026-10-20 21:11'
labels:
  - plugins
  - umami
milestone: m-42
dependencies:
  - TASK-452
  - TASK-453
references:
  - 'https://umami.is/docs/api'
priority: medium
ordinal: 391800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A small Umami API client for the widgets: Umami Cloud with an API key, or a self-hosted Umami with a username and password exchanged for a token. Credentials are secret settings. Check the current Umami API docs for endpoints and auth before building.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Umami Cloud requests send the API key; self-hosted requests sign in, reuse the token, and sign in again once when it is refused
- [ ] #2 The API key and password are secret settings, never drawn on a page or logged
- [ ] #3 The plugin screen has a check that reports whether Umami answered and whether the website ID was found
- [ ] #4 Tests run the client against a fake Umami server for both modes, including a refused token and a timeout
<!-- AC:END -->
