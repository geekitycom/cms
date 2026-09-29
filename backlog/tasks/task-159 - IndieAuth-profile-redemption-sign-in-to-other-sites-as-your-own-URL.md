---
id: TASK-159
title: 'IndieAuth profile redemption: sign in to other sites as your own URL'
status: To Do
assignee: []
created_date: '2026-09-29 01:52'
labels:
  - indieauth
  - indieweb
milestone: m-24
dependencies:
  - TASK-158
references:
  - 'https://indieauth.spec.indieweb.org/'
priority: medium
type: feature
ordinal: 183800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Completes phase 1. A client that only needs to know who the person is redeems its code with a POST to the authorization endpoint (grant_type=authorization_code, code, client_id, redirect_uri, code_verifier) and receives the canonical me URL, plus the profile (name, url, photo) and email when those scopes were granted. No access token is issued on this path. Verify end to end against a real client, indielogin.com, on a deployed site.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A correct redemption returns JSON with me, and profile and email only when those scopes were approved
- [ ] #2 A wrong code_verifier, client_id or redirect_uri, an expired code or a code already redeemed returns invalid_grant, and a replayed code is refused, proven by tests
- [ ] #3 The returned me shares a host with the URL the person typed, so clients accept it
- [ ] #4 An end-to-end test drives a simulated client from discovery through consent to redemption against the running app
- [ ] #5 Signing in to indielogin.com with the deployed site URL succeeds with no rel="me" provider involved, and the result is noted on the task
<!-- AC:END -->
