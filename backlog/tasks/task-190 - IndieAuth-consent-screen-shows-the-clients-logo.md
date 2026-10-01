---
id: TASK-190
title: IndieAuth consent screen shows the client's logo
status: To Do
assignee: []
created_date: '2026-10-01 15:43'
labels:
  - indieauth
  - admin
dependencies:
  - TASK-158
references:
  - packages/cms/src/indieauth/client.ts
  - packages/cms/src/admin/headers.ts
  - packages/cms/admin/pages/indieauth/consent.njk
priority: low
type: enhancement
ordinal: 206800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The IndieAuth spec lets a client publish a logo_uri (JSON metadata) or an h-app u-logo, and a consent screen that shows it helps a person recognise the app. TASK-158 reads the client's name but not its logo, because the admin Content-Security-Policy allows only same-origin images. Show the logo without loosening img-src for the whole admin: either widen img-src only on the consent response (as cspFormAction already does for form-action), or fetch the logo server-side with the existing size and timeout limits and serve it from a same-origin path or a data: URI. A missing, oversized or unreachable logo shows the screen without one.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A client whose metadata names a logo shows it on the consent screen
- [ ] #2 The admin CSP is unchanged on every page but the consent screen, or unchanged everywhere if the logo is served same-origin
- [ ] #3 A missing, non-image, oversized or unreachable logo leaves the consent screen working without a logo
<!-- AC:END -->
