---
id: TASK-131
title: Public-site security headers that do not constrain themes
status: Done
assignee:
  - '@claude'
created_date: '2026-09-28 23:36'
updated_date: '2026-09-29 02:38'
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
- [x] #1 Public responses send Referrer-Policy: strict-origin-when-cross-origin
- [x] #2 Public responses send CSP frame-ancestors 'self' and X-Frame-Options: SAMEORIGIN (no other CSP directives by default)
- [x] #3 Public responses send a Permissions-Policy that turns off powerful features (camera, microphone, geolocation, payment, usb and similar)
- [x] #4 Public responses send Cross-Origin-Opener-Policy: same-origin
- [x] #5 A site can override or remove each header in config, and README documents the defaults and why the CMS still sends no content CSP
- [x] #6 Tests assert the headers on a page, a feed and an upload
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Data shape: a header table, lower-cased name to value. PUBLIC_SECURITY_HEADERS in src/admin/headers.ts holds the four defaults (Referrer-Policy strict-origin-when-cross-origin, Content-Security-Policy frame-ancestors 'self', X-Frame-Options SAMEORIGIN, Permissions-Policy with powerful features off but nothing embeds need, Cross-Origin-Opener-Policy same-origin).
2. Config: securityHeaders?: Record<string, string | false> on GeekityConfig. resolveConfig merges it over the defaults case-insensitively; a string replaces, false removes, an unknown name adds. Config file only, no env override (a map does not fit one variable). Validate at the boundary: a value must be a non-empty string or false.
3. baselineSecurityHeaders applies the resolved table after next(), setting a header only when the response does not already carry it, so the admin's stricter Referrer-Policy, X-Frame-Options and CSP (set by adminSecurityHeaders, which runs inside the baseline) survive. Because baseline is the outermost header middleware, redirects, the 503 maintenance page, 404s and onError 500s all pass through it.
4. Tests first: page, feed, upload, 404, 500, 503, redirect carry the defaults; admin keeps its values plus gets Permissions-Policy and COOP; config override and removal work; resolveConfig rejects bad values.
5. README: config table row, rewrite Security headers section with the public defaults and why there is still no content CSP, and what COOP and frame-ancestors break (framing the site elsewhere, opener popups).
6. Verify: pnpm build, test, typecheck, lint, format:check; curl a running demo site for a page, feed, upload, admin.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Shape: securityHeaders?: Record<string, string | false> on GeekityConfig, merged case-insensitively over DEFAULT_SECURITY_HEADERS (config.ts) into ResolvedConfig.securityHeaders (lower-case name to value). A string replaces or adds, false removes. Bad names, empty values and values with CR/LF/NUL throw at boot. No env override: a header table does not fit one variable (README says so).
baselineSecurityHeaders sets each configured header only when the response has none by that name. It is the outermost header middleware, so adminSecurityHeaders' Referrer-Policy same-origin, X-Frame-Options SAMEORIGIN and the nonce CSP win, and redirects, the maintenance 503, 404s and onError 500s all get the headers. nosniff and HSTS stay unconditional. Admin responses now also get Permissions-Policy and COOP.
Permissions-Policy turns off browsing-topics, camera, display-capture, geolocation, hid, microphone, midi, payment, serial, usb, xr-spatial-tracking. Deliberately not autoplay, fullscreen, encrypted-media, picture-in-picture, accelerometer or gyroscope, which the specification.website list disables but a YouTube or Vimeo embed in a post asks for.
Checked what the new headers could break: nothing in the CMS frames a public page (the only iframe is the editor's sandboxed srcdoc preview under /admin, which already had frame-ancestors 'self'), and nothing uses window.opener or cross-origin popups. A site framed elsewhere or using OAuth/payment popups overrides via config; README says how. Edge case not handled: a post that iframes another page of the same site renders blank in the editor preview, because the sandboxed srcdoc frame has an opaque origin that does not match 'self'. CORP was not added (not in the AC; would stop other sites hotlinking uploads).
Validation: pnpm build && pnpm test (2357 + 30 pass) && pnpm typecheck && pnpm lint && pnpm format:check all pass. Red first: new tests failed with missing headers and 'Cannot read properties of undefined (reading referrer-policy)'. Mutation check: making the baseline overwrite instead of fill in fails the admin precedence test. curl against the demo served from a scratch copy of its content on :3917: /, /feed/, an upload PNG, a 404 and an ActivityPub-negotiated 406 carry the public set; /admin/login keeps same-origin referrer and its full CSP plus COOP and Permissions-Policy.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Public responses now carry Referrer-Policy strict-origin-when-cross-origin, CSP frame-ancestors 'self' (the only directive), X-Frame-Options SAMEORIGIN, a Permissions-Policy that turns off camera, microphone, geolocation, payment, usb and similar, and COOP same-origin. The set lives in DEFAULT_SECURITY_HEADERS and a site changes, removes or adds headers with the new securityHeaders config key. baselineSecurityHeaders fills in only headers a response lacks, so the admin's stricter values survive, and its place outside every route puts the headers on redirects, 404, 503 and 500 too. Both READMEs document the defaults, what each one is for, what COOP and frame-ancestors can break, and why the CMS still sends no content CSP. Verified by new tests (page, feed, upload, 404, redirect, 503, 500, admin precedence, config merge and validation), the full build/test/typecheck/lint/format chain, and curl against a running demo.
<!-- SECTION:FINAL_SUMMARY:END -->
