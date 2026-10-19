---
id: TASK-428
title: The admin's followers table shows follower avatars its own CSP allows
status: Done
assignee:
  - '@claude'
created_date: '2026-10-19 12:38'
updated_date: '2026-10-19 12:51'
labels:
  - bug
milestone: m-31
dependencies: []
references:
  - packages/cms/src/admin
  - packages/cms/src/avatars/avatars.ts
  - packages/cms/src/store/profiles.ts
priority: low
ordinal: 365800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Federation in the admin lists an account's followers with their avatars. Each row's <img> points straight at the follower's iconUrl on its own server, for example https://files.mastodon.social/accounts/avatars/…/original/….gif. The admin sends Content-Security-Policy img-src 'self' data:, so the browser blocks every one: every follower with an avatar shows a broken image, and only those without one show the placeholder circle. The account's own avatar renders, because it's an upload on the site's origin. The public site already shows remote people's avatars from its own avatar cache (data/avatars), as it does for reactions. Proposal: render follower avatars through that cache (or the same proxy), so they're served from the site's origin and satisfy the CSP. Fall back to the placeholder when there's none or the fetch fails. Loosening img-src to remote hosts would make the admin load third-party images on every view, so prefer the cache.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 On the followers table, a follower with an iconUrl shows its avatar, with no CSP violation in the browser console
- [x] #2 The image is served from the site's own origin (the avatar cache), not the follower's server
- [x] #3 A follower whose avatar can't be fetched yet or at all shows the cache's placeholder image, and one with no iconUrl shows the placeholder circle; never a broken image
- [x] #4 The admin's CSP is unchanged
- [x] #5 Every follower's iconUrl is a servable avatar source, including followers that have no row in the inbox log (plugin API, WordPress import, cleared inbox)
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Failing tests: admin federation screen renders follower img src as avatarHref(iconUrl), never the remote URL; no-icon follower keeps the placeholder circle; avatar route serves a follower with no inbox row (image and placeholder); admin CSP header unchanged.
2. store/profiles.ts: drop the ap_inbox condition for followers in isAvatarSource and listAvatarSources; keep actor_profiles and comments conditions; update the doc comment.
3. admin/federation.ts followerRow: iconUrl -> avatarHref(iconUrl) or null; fix the stale 'initial' comment.
4. Update avatars.test.ts: the idle follower is now servable and swept.
5. Verify: full build/test/typecheck/lint/format; run the demo site, curl the followers page and avatar route, headless Chromium for CSP console errors.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Failing first: federation.test.ts 'shows a follower's avatar from the site's own avatar cache' (actual false: src was the remote URL); avatars.test.ts 'serves any follower's avatar, one with no inbox activity too' and the placeholder case (actual 404, expected 200); sweep test missed the idle follower's icon.
Fix: profiles.ts isAvatarSource/listAvatarSources count every follower's icon_url (ap_inbox condition dropped for followers only; actor_profiles and comments conditions kept). followerRow wraps iconUrl in avatarHref; stale 'initial' comment fixed. docs/theme/conversation.md lists which pictures the route serves.
Consequence: the sweep now fetches and keeps every follower's avatar, not just those who interacted.
Validation: pnpm build, test (cms 6256 pass), test:11ty, typecheck, lint, format:check all green. Live: a sandbox site on localhost:8787 with three followers and no inbox rows, signed in through headless Chrome for Testing (Playwright 1.56): CSP header img-src 'self' data: unchanged; withicon img src=/_geekity/avatars/<key>, complete, naturalWidth 80 (webp); broken (remote 404) img loads the svg placeholder, naturalWidth 80; noicon renders .avatar-placeholder and no img. Only console message was a 404 for /favicon.ico (sandbox site has none); no CSP violations. curl: 200 image/webp and 200 image/svg+xml. Server stopped.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
The admin's followers table now loads follower avatars through the site's avatar cache (/_geekity/avatars/<key>) instead of hotlinking them, so they satisfy the unchanged admin CSP img-src 'self' data:. Every follower's iconUrl is now an avatar source, whether or not the inbox log names them. A fetch that fails shows the cache's placeholder, and a follower with no icon keeps the placeholder circle. Verified with new and updated tests in admin/federation.test.ts and avatars/avatars.test.ts, the full build/test/typecheck/lint/format run, and a headless Chrome check of the live followers table: no CSP violations, and every image loaded.
<!-- SECTION:FINAL_SUMMARY:END -->
