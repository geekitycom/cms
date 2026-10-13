---
id: TASK-356
title: 'createCms is a list of services, not one long function'
status: Done
assignee:
  - '@claude'
created_date: '2026-10-11 17:01'
updated_date: '2026-10-12 00:15'
labels: []
milestone: m-34
dependencies:
  - TASK-355
type: chore
ordinal: 315800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
createCms in index.ts is about 770 lines: boot migrations, about 30 services, middleware and mounts, lifecycle and the public object. Start, stop and settle are three hand-kept lists that must agree; a missed settled() loses queued work at shutdown. 8 content change subscriptions are ordered only by file position. cited: (url) => replyContexts.read(url) is repeated 6 times, and the federation context literal is built twice. index.ts is also a 1400-line export barrel.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Services share one lifecycle shape and one ordered list drives start, stop, settle and drain
- [x] #2 Content change subscribers are declared in one ordered list
- [x] #3 The federation context is built once and shared dependencies are passed as one object
- [x] #4 Boot migrations, service construction and app assembly are separate modules; the public exports live in their own module
- [x] #5 A test shows close() waits for every service queue
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Lifecycle shape (packages/cms/src/cms/lifecycle.ts):

  type Ending = 'drain' | 'close';
  interface Service {
    start?(): void | Promise<void>;          // serve() and resume(), list order, awaited
    stop?(ending: Ending): void | Promise<void>; // take no new work; reverse list order, awaited
    settled?(ending: Ending): Promise<void>; // wait for queued work; list order
    release?(): void;                        // close() only, after every service settled
  }
  startServices(list); endServices(list, ending) = stop in reverse, then settle in order; releaseServices(list).

The one ordered list, checked against today's calls:
  content       start=content.start  stop=content.stop
  scheduler     start, stop, settled
  delivery      settled
  relays        settled
  federationQueue settled, release=close (only when the site brought no queue)
  webmentions   settled
  replyContexts start=catchUp, settled
  avatars, actorProfiles, replyBackfill, retention: start, stop, settled
  digests       start, stop, settled
  notifier      settled
  indexNow      settled (close: drop what is gathered first, as today)
  plugins       start=reconcile(enabled), stop=drain ? reconcile(empty) : close()
  mail          settled
  image variants settled, activity log settled
Start order is unchanged. Stop order: plugins, timers, content (timer stops are synchronous clears, so their relative order does not matter). Settle order is unchanged except digests moves from 2nd to after retention; nothing enqueues digest work, and mail still settles after it.

Steps:
1. Tests first: close() waits for every service queue (replace each exposed settled() with a held promise, assert close stays pending until each is released and each was called); pin the content change subscriber order and the conversation-write order.
2. cms/lifecycle.ts with the shape above.
3. cms/boot.ts: openCache, migrations, effective baseUrl, Akismet default.
4. cms/services.ts: build every service from one shared deps object ({admin, store, config} plus cited), build the federation context once, return the service list and the ordered change/conversation subscriber lists.
5. cms/app.ts: Hono app, middleware and mounts.
6. cms/create.ts: createCms, Cms, ServeContext, closeServer, serve/drain/resume/close over the list.
7. git mv index.ts to exports.ts (the public barrel); index.ts re-exports it and createCms. Public names unchanged; compare dist export keys before/after.
8. pnpm build/test/typecheck/lint/format:check.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Built as planned. Modules: src/cms/boot.ts (resolve config, open cache, migrations, effective baseUrl, Akismet default), src/cms/services.ts (every service from one `site` deps object; `federated` = site + actorProfiles + cited, the one federation context data; ordered change and conversation-write subscriber lists; the lifecycle list; SCHEDULE_* keys), src/cms/app.ts (Hono app, middleware, mounts; returns app and write gate), src/cms/lifecycle.ts (Service shape, startServices/endServices/releaseServices), src/cms/create.ts (Cms, ServeContext, createCms, closeServer). The barrel moved to src/exports.ts; src/index.ts is 4 lines re-exporting it, createCms, Cms, ServeContext and the SCHEDULE_* keys.
Behaviour: one deliberate change of order: digests settles after retention instead of second; nothing hands work to digests and mail still settles after it. Stop order is now the reverse of start (plugins, timer clears, content), which matches today for everything but the order of the synchronous timer clears. The federation context data is now one shared object rather than a fresh literal per createContext call.
Tests: src/cms/lifecycle.test.ts holds each exposed queue's settled() open and checks close() and drain() stay pending until all 13 are released; a mutation dropping webmentions from the list fails both. It also pins the change subscriber order (delivery, webmentions, replyContexts, notifier, indexNow, scheduler, then the site hook); it passed on the old code before the move.
Validation: pnpm build, pnpm test (cms 5570 pass), pnpm typecheck, pnpm lint, pnpm format:check all pass. dist export keys identical before/after (818 names); TypeScript export names including types identical (1206) comparing the old index.ts against the new one.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
createCms now boots (cms/boot.ts), builds services from one shared deps object with the federation context built once (cms/services.ts), assembles the app (cms/app.ts) and drives serve/drain/resume/close from one ordered Service list (cms/lifecycle.ts, cms/create.ts). Content change and conversation-write subscribers are each one ordered list. The public barrel lives in exports.ts; index.ts re-exports. Public API unchanged (818 runtime and 1206 type export names compared before/after). Verified with a new test that close() and drain() wait for every service queue (mutation-checked), a subscriber-order test, and pnpm build/test/typecheck/lint/format:check.
<!-- SECTION:FINAL_SUMMARY:END -->
