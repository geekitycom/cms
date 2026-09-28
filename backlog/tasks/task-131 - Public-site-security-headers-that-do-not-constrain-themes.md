---
id: TASK-131
title: Public-site security headers that do not constrain themes
status: To Do
assignee: []
created_date: '2026-09-28 23:36'
labels:
  - security
milestone: m-19
dependencies: []
references:
  - 'https://specification.website/spec/security/referrer-policy/'
  - 'https://specification.website/spec/security/frame-ancestors/'
  - 'https://specification.website/spec/security/permissions-policy/'
  - 'https://specification.website/spec/security/cross-origin-isolation/'
priority: high
type: feature
ordinal: 155800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The public site sends only nosniff and HSTS (src/admin/headers.ts). By design it sends no CSP, because a theme is somebody else's HTML and the CMS should not decide what it loads. Several headers restrict nothing a theme loads but still protect readers and signed-in admins: pages drawn for a signed-in admin can be framed by any site today, and full URLs leak to every outbound link. The goal is a safe baseline with no content restrictions that a site can override in config.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Public responses send Referrer-Policy: strict-origin-when-cross-origin
- [ ] #2 Public responses send CSP frame-ancestors 'self' and X-Frame-Options: SAMEORIGIN (no other CSP directives by default)
- [ ] #3 Public responses send a Permissions-Policy that turns off powerful features (camera, microphone, geolocation, payment, usb and similar)
- [ ] #4 Public responses send Cross-Origin-Opener-Policy: same-origin
- [ ] #5 A site can override or remove each header in config, and README documents the defaults and why the CMS still sends no content CSP
- [ ] #6 Tests assert the headers on a page, a feed and an upload
<!-- AC:END -->
