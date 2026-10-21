---
id: TASK-459
title: >-
  Plugin page tags know whether the reader is signed in and whether the site is
  in dev mode
status: Done
assignee:
  - '@claude'
created_date: '2026-10-20 22:26'
updated_date: '2026-10-20 22:32'
labels:
  - plugins
  - themes
milestone: m-41
dependencies:
  - TASK-443
references:
  - packages/cms/src/web/page-tags.ts
priority: medium
ordinal: 396800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TASK-443 calls a plugin page-tag read() with no context, so tags draw for the signed-in owner and in dev mode. A theme partial can test signedIn and devMode; a plugin cannot. An analytics plugin (M43 Umami) must be able to leave its tracker out for the signed-in owner and in dev mode, or the owner visits get counted. Pass the reader context to read().
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 read() receives whether the request comes from a signed-in user and whether the site runs in dev mode
- [x] #2 A plugin that returns no tags for signed-in readers draws none for them and draws its tags for anonymous readers on the same page
- [x] #3 Listing ETags still change when the drawn tags differ, so a signed-in reader and an anonymous reader never share a cached 304 that carries the wrong tags
- [x] #4 docs/plugins.md documents the context with an analytics example that skips signed-in readers
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Type: add PluginPageTagsContext { signedIn, devMode } in plugin.ts; pageTags(read: (context) => ...) - an added argument, so plugins built for host API 2/3 still load; no version bump.
2. Move the pluginPageTags middleware into mountPublicSite (as an option next to adminBar), after the admin bar, so it reads c.var.signedIn (set by the admin bar from the session, the same source the theme's signedIn uses) and c.var.devMode (the same value drawnWith hands render.ts).
3. Middleware passes { signedIn: c.var.signedIn !== undefined, devMode: c.var.devMode } to every read().
4. Listing fingerprint already hashes drawn tags; add tests that a signed-in reader holding the anonymous ETag gets a 200 without the tags, and that dev mode changes the tags.
5. Tests first in src/web/plugin-page-tags.test.ts for AC #1-#3; then docs/plugins.md section with an analytics example skipping signed-in readers and dev mode.
6. Full verification: build, test, test:11ty, typecheck, lint, format:check; curl a running server signed in and anonymous.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Added PluginPageTagsContext { signedIn, devMode } (plugin.ts) and read(context). Adding an argument is backwards compatible, so HOST_API_VERSION stays 3.
The pluginPageTags middleware moved from cms/app.ts into mountPublicSite as a pageTags option, registered right after the admin bar. The admin bar sets c.var.signedIn from signedInAccount(c), the same check that makes render.ts give themes signedIn, so the middleware reads c.var.signedIn !== undefined instead of reading the session a second time. devMode comes from c.var.devMode, the value drawnWith hands render.ts.
Caching: a page drawn for a signed-in reader is personal (representationResponse never answers 304 for it) and the admin bar strips ETag/Last-Modified, so the owner neither gets nor hands out a validator. Anonymous listing fingerprints already hash devMode and the drawn tags. The new AC #3 test shows that the dev mode half fails when devMode and tags are removed from the fingerprint.
Test harness: Browser.get takes optional extra headers (used for If-None-Match).
Validation: pnpm build, typecheck, lint, format:check, test (cms 6394 pass), test:11ty all pass. Curled dist createCms + serve on :4579 with an analytics plugin that skips signed-in readers and dev mode: anonymous /tag/notes/ has <script src="/count.js" defer> and ETag, revalidates to 304; signed-in (cookie after /admin/setup) with that ETag gets 200, private no-store, no ETag, admin bar, no count.js; after a restart with devMode the old ETag gets 200 with a new ETag and no count.js.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Plugin page tags now get the reader's context: host.pageTags(read) calls read({ signedIn, devMode }) using the same values themes see, so an analytics plugin can leave its tracker out for the signed-in owner and in dev mode. The middleware now runs inside mountPublicSite after the admin bar, which settles who is signed in. Signed-in pages stay private with no validator, and listing ETags hash dev mode and the drawn tags, so readers never share a 304 with the wrong tags. docs/plugins.md documents the context with an analytics example. Verified with three new tests in src/web/plugin-page-tags.test.ts, the full build/test/test:11ty/typecheck/lint/format run, and curl against a running server signed in, anonymous, and in dev mode.
<!-- SECTION:FINAL_SUMMARY:END -->
