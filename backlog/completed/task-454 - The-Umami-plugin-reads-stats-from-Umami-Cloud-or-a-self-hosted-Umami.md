---
id: TASK-454
title: The Umami plugin reads stats from Umami Cloud or a self-hosted Umami
status: Done
assignee:
  - '@claude'
created_date: '2026-10-20 21:11'
updated_date: '2026-10-21 03:41'
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
- [x] #1 Umami Cloud requests send the API key; self-hosted requests sign in, reuse the token, and sign in again once when it is refused
- [x] #2 The API key and password are secret settings, never drawn on a page or logged
- [x] #3 The plugin screen has a check that reports whether Umami answered and whether the website ID was found
- [x] #4 Tests run the client against a fake Umami server for both modes, including a refused token and a timeout
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Settings: add api_mode select (cloud | self-hosted), api_key secret, username text, password secret, api_url optional override. Cloud base https://api.umami.is/v1, self-hosted <umami_url>/api.
2. src/client.ts: umamiClient({ fetch, settings, timeoutMs }) over host.fetch. Cloud sends the key as Authorization: Bearer (current docs) and x-umami-api-key (older Cloud docs). Self-hosted POSTs /auth/login {username,password}, keeps the token in memory keyed by base+username+password, shares one in-flight login, signs in again once on a 401. Each call has a timeout below the 3 s widget limit (2.5 s) and takes an AbortSignal. Failures throw UmamiError with a typed failure kind and plain words that name the host only.
3. Methods for TASK-455..458: website(), stats(range) with the previous period, pageviews(range, timezone) per day, metrics(type, range, limit) for path/referrer/country/browser/device, active(). Parse responses defensively in one place per endpoint (v2 and v3 shapes).
4. Screen: host.screen with a Statistics card (where requests go, whether credentials are set, never their values) and a Check connection action: probes GET /websites, then GET /websites/:id, and reports whether Umami answered and the website was found.
5. Tests: test/fake-umami.ts loopback server for both modes (API key, login tokens, refuse tokens, delay). Client tests: cloud key sent, login reused, 401 then re-login once, 401 twice errors, timeout. Screen tests through the site with host.fetch (site allows private addresses): check for both modes, unknown website, secrets never drawn or logged.
6. README + docs/plugins.md table if listed; verify full suite.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
API checked 2026-10-20: docs.umami.is (authentication, cloud/api-key) and the Umami source on GitHub master (src/app/api/websites/[websiteId]/{stats,pageviews,metrics,active}/route.ts, lib/schema.ts, lib/constants.ts, lib/auth.ts). Current docs say Umami Cloud takes the key as Authorization: Bearer at https://api.umami.is/v1; older Cloud docs named x-umami-api-key, so the client sends both, only to the API origin. Self-hosted: POST /api/auth/login {username,password} -> {token} or {requiresTwoFactor, partialToken} (reported as two-factor). Umami 3 stats: numbers plus comparison {same keys} (prev period by default); Umami 2 stats {key: {value, prev}} also parsed. pageviews: {pageviews:[{x,y}], sessions:[{x,y}]} with unit=day&timezone. metrics: [{x,y}], type path (Umami 2 called it url). active: {visitors} (Umami 2 {x} also parsed). Umami answers 401 for a website the account cannot see, so website() follows a 401 with GET /websites?pageSize=1 to tell not-found from refused credentials. Counts may arrive as strings (bigint columns) and are converted.
Design: src/client.ts umamiClient({fetch: host.fetch, settings, timeoutMs}); every call reads settings afresh, one 2.5 s deadline per call covers sign-in and the one retry; the token lives in memory keyed by base+username+password, one shared in-flight sign-in; failures throw UmamiError {failure: UmamiFailure} whose message names only the host. src/screen.ts adds a Statistics card (base, website ID, username or 'with the API key'; never a secret) and a Check connection action.
No live Umami was available: the proof is test/fake-umami.ts, a loopback server modelled on the Umami 3 routes, for both modes. Verified: pnpm build && pnpm test && pnpm test:11ty && pnpm typecheck && pnpm lint && pnpm format:check all pass (plugin-umami 42 tests). A mutation that removed the one retry failed the two refused-token tests.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added an Umami API client (packages/plugin-umami/src/client.ts) over host.fetch for Umami Cloud (API key as Authorization: Bearer and x-umami-api-key, base https://api.umami.is/v1) and self-hosted Umami (POST /api/auth/login, token kept in memory, one shared sign-in, signs in again once on a 401). Methods for the widgets: website, stats with the previous period, pageviews per day, metrics (path/referrer/country/browser/device), active. Every call has a 2.5 s deadline and takes an AbortSignal; failures are typed UmamiError with plain words naming only the host. New settings: api_mode, api_key (secret), username, password (secret), api_url. The screen gets a Statistics card and Check connection, which says whether Umami answered and found the website. Verified against a loopback fake Umami in both modes (refused token -> one re-login -> success; refused twice -> error; timeouts; abort; secrets absent from page, settings.json and logs) plus the full repo checks. No live Umami was tested.
<!-- SECTION:FINAL_SUMMARY:END -->
