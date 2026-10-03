---
id: TASK-230
title: Create an access token from Connected apps
status: To Do
assignee: []
created_date: '2026-10-03 01:32'
labels:
  - indieauth
  - admin
dependencies: []
priority: low
type: feature
ordinal: 245800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Some clients and scripts cannot complete IndieAuth sign-in but accept a pasted token: micropub.rocks's Manual tab takes an endpoint and a token (TASK-219, TASK-170). The admin has no way to mint one. Add a Create token action on Users > Connected apps: pick scopes, name it, show the token once, store only its hash like other tokens (data/indieauth-tokens.json), list it with the connected apps and revoke it the same way. TASK-225's allowlist lets micropub.rocks sign in directly, so this is now a convenience for scripts and testing.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A signed-in admin creates a named token with chosen scopes on Users > Connected apps and sees it once
- [ ] #2 The token works as a bearer token on the Micropub endpoint with exactly those scopes, and its plain value is stored nowhere
- [ ] #3 The token is listed with the connected apps and revoking it makes the next request answer 401
<!-- AC:END -->
