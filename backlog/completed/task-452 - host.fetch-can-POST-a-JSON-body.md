---
id: TASK-452
title: host.fetch can POST a JSON body
status: Done
assignee:
  - '@claude'
created_date: '2026-10-20 21:11'
updated_date: '2026-10-21 03:01'
labels:
  - plugins
milestone: m-42
dependencies: []
references:
  - packages/cms/src/plugins/fetch.ts
priority: medium
ordinal: 389800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
host.fetch is GET only. Self-hosted Umami issues an API token from POST /api/auth/login with a username and password, so the Umami plugin cannot sign in. Let host.fetch send POST with a JSON body, keeping the same redirect limit and private-address block.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 host.fetch accepts method POST and a JSON body, and sends Content-Type application/json
- [x] #2 The private-address block and redirect limit apply to POST as to GET, and a redirect after POST does not resend the body to another host
- [x] #3 docs/plugins.md documents the option
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Add optional method ('GET' | 'POST') and json to PluginFetchInit in plugin.ts; json serialises with JSON.stringify and sets content-type application/json; json on a GET throws. No HOST_API_VERSION bump (optional fields).
2. pluginFetch: send method and body on the first hop. On a redirect: 301/302/303 after POST continue as GET with no body and no content-type (fetch standard); 307/308 keep method and body only when the target has the same origin, otherwise reject with an error before asking the other host. Same 5-hop limit and public-address check on every hop.
3. Tests first in src/plugins/fetch.test.ts: POST sends body + content-type; 303 turns into GET without body; 307 same origin resends body; 307 to other origin rejects without reaching it; POST redirect to private address refused; POST redirect limit.
4. Document host.fetch, the POST option and the redirect rule in docs/plugins.md; update the PluginHost.fetch doc comment.
5. Run build, test, test:11ty, typecheck, lint, format:check.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
PluginFetchInit gains optional method ('GET' | 'POST') and json; HOST_API_VERSION stays 3 since both are optional. json is sent as JSON.stringify with content-type application/json (Headers.set, so it replaces a plugin-supplied content-type); json without method POST rejects before any request.
Redirect after POST: 301/302/303 continue as GET with no body (fetch standard); 307/308 keep method and body to the same origin; a 307/308 carrying a body to another origin REJECTS with an error and that origin is never asked (chosen over silently dropping the body, since a 307 means the server wants the body). Every hop keeps the public-address check and the five-redirect limit. Plugin headers still go on every hop, as before.
docs/plugins.md gains an 'Outbound requests' paragraph (host.fetch had no section before), including a note that an older core ignores method/json and sends GET, so a posting plugin should start its @geekity/cms peer range at the release that has them.
Validation: fetch.test.ts 17 pass (12 new); pnpm build, pnpm test (cms 6499 pass, plugins and demo pass), pnpm test:11ty, pnpm typecheck, pnpm lint, pnpm format:check all pass.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
host.fetch can POST a JSON body: new optional method and json options on PluginFetchInit, sent with content-type application/json. Redirects after POST follow fetch semantics (301/302/303 become GET without body, 307/308 keep it) but a body is never resent to another origin; that redirect rejects. Public-address block and five-hop limit apply on every hop. Documented under Outbound requests in docs/plugins.md. Verified with new tests in packages/cms/src/plugins/fetch.test.ts and the full build/test/typecheck/lint/format run.
<!-- SECTION:FINAL_SUMMARY:END -->
