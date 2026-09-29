---
id: TASK-133
title: Serve /.well-known/security.txt and /.well-known/change-password
status: Done
assignee:
  - '@claude'
created_date: '2026-09-28 23:36'
updated_date: '2026-09-29 03:12'
labels:
  - security
  - well-known
milestone: m-19
dependencies: []
references:
  - 'https://specification.website/spec/security/security-txt/'
  - 'https://specification.website/spec/well-known/change-password/'
priority: low
type: feature
ordinal: 157800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Neither well-known file is served. security.txt (RFC 9116) tells researchers how to report a vulnerability in a site. change-password points password managers at the admin's password screen, which makes sense because the CMS has user accounts.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 /.well-known/security.txt is served as text/plain from site config (Contact at minimum, Expires computed so it never goes stale, optional Policy and Preferred-Languages) and returns 404 when no contact is configured
- [x] #2 /.well-known/change-password redirects to the admin screen where a signed-in user changes their password
- [x] #3 packages/cms/README.md documents the config
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Settings: add securityContacts (list, one per line: an email becomes mailto:, or an https:// or tel: URI), securityPolicy (https URL) and securityLanguages (comma-separated language tags) to SiteSettings in site.json, edited on Settings > Email beside the contact address, validated like the other fields. No fallback to contactEmail: that one is promised never to appear publicly.
2. src/web/well-known.ts: a pure securityTxt(settings, now, canonical) that returns the RFC 9116 body or undefined when there is no contact; Expires is now + 30 days, computed per request. GET /.well-known/security.txt answers text/plain; charset=utf-8, or 404 with no contact.
3. GET /.well-known/change-password: 302 to /admin/users/<id>#change-password for a live session, else to the login form (no return-to exists on login). Add id=change-password to the form. no-store, since the target depends on the cookie.
4. Maintenance: exempt both paths (a researcher may need the contact most during an outage; change-password only leads into the admin, which is already exempt). Test both.
5. README rows for the three settings and the two paths.
6. Verify: pnpm build, test, typecheck, lint, format:check; curl a running site.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Where the settings live: content/_data/site.json, edited on Settings > Email under a Security contact heading, beside contactEmail. That is how the existing contact address works, security.txt is public by definition (so the public site.json suits it), and it is something a site owner edits rather than a deployment fact, so there is no geekity.config.ts key and no GEEKITY_* env override. Keys: securityContacts (array of mailto:/https:/tel: URIs; a bare address is stored as mailto:), securityPolicy (https URL or empty), securityLanguages (tags joined by ', ' or empty). Hand-edited values go through the same normalisers on read, so a line break cannot inject a field into security.txt.
No fallback to contactEmail: that address is promised never to appear on the public site.
Expires is request time + 30 days (config.now()), so it never goes stale; Canonical is the effective base URL + the path.
change-password: 302 + Cache-Control no-store to /admin/users/<id>#change-password (the form got id=change-password) for a live session naming an existing user, else /admin/login. The login form has no return-to, so a signed-out user lands on the dashboard after signing in, not back on the form; adding return-to was out of scope.
Maintenance: both paths are exempt in isExempt (security contact matters most during an outage; change-password only points into the already-exempt admin). Tested.
Validation: pnpm build && pnpm test (2386 pass) && pnpm typecheck && pnpm lint && pnpm format:check all exit 0. Curl against geekity serve on :4317 with GEEKITY_BASE_URL=https://curl.example: security.txt 200 text/plain; charset=utf-8 with Contact/Expires(+30d)/Preferred-Languages/Canonical; 404 with no contacts; change-password 302 to /admin/login signed out and /admin/users/1#change-password signed in, X-Redirect-By from middleware; with maintenance on, / was 503 while security.txt was 200 and change-password 302. Server stopped.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Serves /.well-known/security.txt (RFC 9116) from three new site.json settings edited on Settings > Email (securityContacts, securityPolicy, securityLanguages), with Expires computed per request as now + 30 days and a 404 when no contact is set; and /.well-known/change-password, a no-store 302 to the signed-in user's own change-password form (/admin/users/<id>#change-password) or to the login form. Both stay reachable in maintenance mode. README documents the settings and both routes. Verified by src/web/well-known.test.ts (11 tests), the full build/test/typecheck/lint/format suite, and curl against a running geekity serve.
<!-- SECTION:FINAL_SUMMARY:END -->
