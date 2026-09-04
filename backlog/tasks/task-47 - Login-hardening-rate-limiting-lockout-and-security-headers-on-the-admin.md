---
id: TASK-47
title: 'Login hardening: rate limiting, lockout, and security headers on the admin'
status: To Do
assignee: []
created_date: '2026-09-04 01:34'
labels:
  - admin
  - security
milestone: m-5
dependencies:
  - TASK-9
references:
  - backlog/docs/doc-5 - Admin-UI.md
  - >-
    https://owasp.org/www-project-cheat-sheets/cheatsheets/Authentication_Cheat_Sheet.html
type: feature
ordinal: 27950
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Before a public deployment, `/admin/login` needs to resist guessing and the admin needs defensive headers. Throttle failed logins per username and per client address with a growing delay and a temporary lockout after a configurable number of failures, kept in memory (a restart clears it, which is fine) and logged. Send `Content-Security-Policy` (self only, with what the editor bundle and CodeMirror need), `X-Content-Type-Options: nosniff`, `Referrer-Policy`, and `X-Frame-Options`/`frame-ancestors` on every admin response, and `Strict-Transport-Security` when the base URL is https. Keep the public site's headers minimal so themes are not constrained. Check that the session cookie already carries HttpOnly, Secure (under https) and SameSite=Lax and add a test if none pins it. Document the limits and how to tune them.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 After the configured number of failed logins for a username or address, further attempts are refused for the lockout period with a clear message, and a correct password during lockout is also refused
- [ ] #2 Every admin response carries CSP, nosniff, referrer and frame headers, and HSTS under an https base URL; the editor, preview iframe and uploads still work under that CSP
- [ ] #3 The session cookie's HttpOnly, Secure and SameSite attributes are pinned by a test
- [ ] #4 Limits are configurable and documented
<!-- AC:END -->
