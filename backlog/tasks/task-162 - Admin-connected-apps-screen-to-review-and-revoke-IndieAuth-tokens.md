---
id: TASK-162
title: 'Admin: connected apps screen to review and revoke IndieAuth tokens'
status: To Do
assignee: []
created_date: '2026-09-29 01:53'
labels:
  - indieauth
  - admin
milestone: m-24
dependencies:
  - TASK-161
priority: medium
type: feature
ordinal: 186800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Once the site hands out tokens, each user needs to see which apps can act as them and cut one off. Add a screen under the user's profile listing their live tokens: the client name and URL, the scopes, when it was issued, when it was last used and when it expires, with a Revoke button per row. Record last use cheaply enough that serving an API request does not rewrite the token file on every call.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A signed-in user sees only their own tokens, each with client, scopes, issued, last used and expiry
- [ ] #2 Revoke removes the token, the next API request with it gets 401, and the screen confirms with a flash message
- [ ] #3 A user with no tokens sees an empty state that says what connects here
- [ ] #4 The screen meets the admin accessibility conventions (table caption, labelled buttons, visible focus)
- [ ] #5 README documents the screen and what revoking does
<!-- AC:END -->
