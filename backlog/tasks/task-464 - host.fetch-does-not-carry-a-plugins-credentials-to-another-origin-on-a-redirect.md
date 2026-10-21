---
id: TASK-464
title: >-
  host.fetch does not carry a plugin's credentials to another origin on a
  redirect
status: Done
assignee:
  - '@claude'
created_date: '2026-10-21 03:03'
updated_date: '2026-10-21 03:07'
labels:
  - plugins
  - security
milestone: m-42
dependencies:
  - TASK-452
priority: high
ordinal: 399800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TASK-452 found that host.fetch (packages/cms/src/plugins/fetch.ts) sends the plugin headers on every redirect hop, including authorization and API-key headers when the redirect goes to a different origin. A compromised or misconfigured server could redirect a plugin request elsewhere and collect its Umami API key, LLM key or bearer token. Browsers and the fetch spec drop Authorization on a cross-origin redirect.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 On a redirect to a different origin, host.fetch drops the plugin headers that carry credentials (at least authorization, cookie, proxy-authorization and any x-*-api-key / api-key style header), and keeps them on same-origin hops
- [x] #2 Tests cover a cross-origin redirect that would leak authorization and an API-key header, and a same-origin redirect that keeps them
- [x] #3 docs/plugins.md states which headers survive a cross-origin redirect
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Rule: plugin headers go only to the origin the plugin asked for (scheme+host+port of the first URL). On a hop to any other origin, only accept, accept-language and user-agent from the plugin survive; every other plugin header (authorization, cookie, proxy-authorization, x-api-key, api-key, any custom header) is dropped. An allowlist rather than a credential denylist, so an unnamed key header like x-umami-api-key cannot slip through. http->https on the same host is a different origin, so credentials are dropped on that upgrade too (matches the fetch spec). A later hop back to the first origin gets the full headers again. content-type is core-set only with a body, which never goes cross-origin already.
2. Tests first in packages/cms/src/plugins/fetch.test.ts: cross-origin 302 drops authorization, cookie, proxy-authorization, x-api-key, x-umami-api-key, api-key and keeps accept/user-agent; same-origin redirect keeps them all; http->https upgrade drops authorization.
3. Implement in packages/cms/src/plugins/fetch.ts (headers built per hop from the hop's origin vs the first origin).
4. Update docs/plugins.md Outbound requests and the PluginHost.fetch doc comment.
5. Check plugin-tag-suggest (only host.fetch caller; sends accept + user-agent, both kept). Run build, test, test:11ty, typecheck, lint, format:check.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Rule: plugin headers go only to the origin of the URL the plugin asked for (scheme+host+port). A hop to any other origin carries only the plugin's accept, accept-language and user-agent; everything else is dropped. Chose an allowlist over a credential denylist so an unnamed key header (x-umami-api-key and the like) cannot slip through; it is also stricter than the fetch spec, which drops only Authorization. http->https on the same host counts as another origin and drops credentials (same as the fetch spec). Origin is compared with the first URL on each hop, so a later hop back to the first origin sends the full headers again. content-type stays core-set only while a body is sent, and a body never reaches another origin (TASK-452).
Existing plugins: plugin-tag-suggest is the only host.fetch caller and sends accept + user-agent, both kept; plugin-llm and plugin-wordpress use global fetch, plugin-post-summary none.
Validation: fetch.test.ts 21 pass (4 new: cross-origin drops authorization/cookie/proxy-authorization/x-api-key/x-umami-api-key/api-key and keeps accept/user-agent; same-origin keeps all; http->https drops; return to first origin resends). pnpm build, pnpm test (cms 6503 pass, demo and all plugins pass), pnpm test:11ty, pnpm typecheck, pnpm lint, pnpm format:check all pass.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
host.fetch now sends a plugin's headers only to the origin it asked for. A redirect hop to another origin (including http->https on the same host) carries only accept, accept-language and user-agent, so authorization, cookies and API-key headers never leave the first origin. Implemented in packages/cms/src/plugins/fetch.ts, documented in docs/plugins.md Outbound requests and the PluginHost.fetch comment. Verified by four new tests in packages/cms/src/plugins/fetch.test.ts and the full build/test/test:11ty/typecheck/lint/format:check run.
<!-- SECTION:FINAL_SUMMARY:END -->
