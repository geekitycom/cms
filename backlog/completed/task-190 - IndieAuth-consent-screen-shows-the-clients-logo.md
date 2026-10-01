---
id: TASK-190
title: IndieAuth consent screen shows the client's logo
status: Done
assignee:
  - '@claude'
created_date: '2026-10-01 15:43'
updated_date: '2026-10-01 15:57'
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
- [x] #1 A client whose metadata names a logo shows it on the consent screen
- [x] #2 The admin CSP is unchanged on every page but the consent screen, or unchanged everywhere if the logo is served same-origin
- [x] #3 A missing, non-image, oversized or unreachable logo leaves the consent screen working without a logo
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Data shape: ClientInformation gains logo?: string, an absolute http(s) URL read from JSON logo_uri or the h-app's u-logo (resolved against the fetched URL).
2. fetchClientLogo(url, options) in indieauth/client.ts fetches the logo through fetchPublic (public hosts, redirects checked, 5 s timeout, 64 KiB cap, image/* content types only) and returns a data: URI, or undefined on any failure.
3. The consent GET fetches the logo after the client information and passes it to consent.njk, which shows <img> only when present.
4. CSP stays unchanged everywhere: img-src already allows data:, so the admin never loads the client's URL and the client never sees the admin's IP or sign-in time (no tracking pixel).
5. Tests first: client.test.ts for logo parsing (HTML u-logo, JSON logo_uri, bad logo_uri) and fetchClientLogo (image ok, non-image, oversized, unreachable); consent.test.ts for the logo on the page, absent for broken logos, and the CSP header unchanged.
6. Verify with pnpm build/test/typecheck/lint/format:check and curl a running site on a spare port.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Choice: the logo is fetched server-side and embedded as a data: URI, not linked. The admin CSP already allows img-src 'self' data:, so it is unchanged on every page including the consent screen. A remote <img> would be a tracking pixel telling the client the admin's IP and when they reviewed the request; the server-side fetch tells the client only the server's IP, which it already learns from the client_id fetch.

How: ClientInformation gains logo (an absolute http/https URL) from JSON logo_uri or the h-app's u-logo (resolved against the fetched URL; javascript:, data: and unparseable values are dropped via fetch-public's webUrl). fetchClientLogo(url, options) in indieauth/client.ts goes through fetchPublic (public hosts, every redirect hop checked, CLIENT_FETCH_TIMEOUT_MS) with CLIENT_LOGO_MAX_BYTES = 64 KiB and only png/jpeg/gif/webp/avif/svg+xml/icon content types, and returns a data: URI or undefined. SVG is accepted because an <img> renders it without scripts or subresource loads. The consent GET fetches the logo only after the request is validated, so a refused request costs no second fetch. The worst case adds one more 5 s timeout to a consent page whose client is slow.

Validation: TDD; client.test.ts covers logo_uri, u-logo, rejected schemes, image ok, non-image, oversized, down and private host. consent.test.ts covers the data: URI on the page with img-src unchanged and the screen without a logo for a client with no logo, a non-image logo, an oversized logo and an unreachable one. Mutation check: passing the raw logo URL to the template fails 4 consent tests. pnpm build, test (3004 + 30 pass), typecheck, lint, format:check all pass. Live: a throwaway site on :3417 signed in by curl and opened the consent screen for https://quill.p3k.io/; it showed Quill's real 144px PNG as data:image/png;base64,..., with no reference to quill.p3k.io/images, and img-src 'self' data: on both the consent page and /admin. A client with no h-app (https://example.com/) rendered with no img and the Approve button. Server stopped.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
The IndieAuth consent screen now shows a client's logo from JSON logo_uri or h-app u-logo. The server fetches it through fetchPublic (public hosts, 5 s, 64 KiB, image types only) and embeds it as a data: URI, so the admin CSP is unchanged everywhere and the client never sees the approver's browser. A missing, non-image, oversized or unreachable logo leaves the screen as before. Verified with new client and consent tests (plus a mutation check), the full build/test/typecheck/lint/format gate, and a live curl of the consent page for Quill showing its real logo inline.
<!-- SECTION:FINAL_SUMMARY:END -->
