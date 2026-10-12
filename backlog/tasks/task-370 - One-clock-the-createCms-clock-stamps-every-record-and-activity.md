---
id: TASK-370
title: 'One clock: the createCms clock stamps every record and activity'
status: Done
assignee:
  - '@claude'
created_date: '2026-10-12 16:29'
updated_date: '2026-10-12 16:48'
labels: []
milestone: m-37
dependencies: []
priority: medium
type: chore
ordinal: 329800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
createCms takes a now option and the content index uses it, but about 55 direct new Date() / Date.now() reads in packages/cms/src bypass it. Most are timestamps on stored records (store/: followedAt, receivedAt, attemptedAt, createdAt, updatedAt; federation/relays.ts, records.ts, quotes.ts) and some end up in output, such as the Update activity id built in federation/delivery.ts. A test that pins now through createCms therefore gets a mixed timeline: content at the pinned time, records at the real time, and output it cannot predict. Thread the one clock through so every timestamp the CMS writes or sends comes from it.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Outside the composition root and the system clock definition, no non-test module under packages/cms/src calls new Date() or Date.now() without arguments, except where the code measures elapsed wall time (timeouts, durations), and each such exception is listed in a check that fails on a new unlisted call
- [x] #2 With now pinned through createCms, the timestamps stored for followers, inbox activities, deliveries, webmentions and relay records equal the pinned time (a test proves it)
- [x] #3 With now pinned, an Update activity id for an edited post is predictable and a test asserts it exactly
- [x] #4 Public export names are unchanged apart from any additive option; existing tests pass unchanged in behaviour
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Re-measure raw clock reads (55 in 31 files, confirmed).
2. Move Clock and systemClock from content/store.ts to util/clock.ts so caches (cache.ts, dev-mode.ts) can take one; update every importer and exports.ts (name unchanged).
3. Write the check first: src/clock-boundary.test.ts scans non-test sources for new Date() / Date.now() (and systemClock references), with a listed allowance per file:line-pattern and reason (elapsed wall time; the system clock definition; public defaults). Prove it fails on a planted call and names file:line.
4. Pin coverage before changing contracts: check tests exist for each helper whose parameter becomes required (forms, served, dev-mode, tokens, uploads, users, quotes, migrations); add any missing ones first against current code.
5. Thread the clock: resolved.now (createCms now / config now) is the one clock. cms/boot passes it to openAdminDatabase and the admin store (AdminStore gains now()); cache ledger takes now; store defaults read the injected clock; federation records use admin.now(), relays/quotes use config.now(), delivery uses store.now(); dev-mode takes now; forms, served helpers, tokens, uploads, users, template 'now' filter take the clock from their callers.
6. Add AC tests: pinned now through createCms -> followers, inbox, deliveries, webmentions, relays stamped with the pinned instant; resend Update id and actor Update id asserted exactly.
7. Prove root and plugin export name lists unchanged; run pnpm build/test/typecheck/lint/format:check.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Re-measured: 55 raw reads in 31 files, as surveyed.

Clock: Clock and systemClock moved from content/store.ts to util/clock.ts (lowest layer) so cache.ts and dev-mode.ts can take one; the Clock export name is unchanged. resolveConfig turns createCms's now option into config.now; cms/boot passes it to openContentStore, openAdminDatabase and adminStoreOwning. AdminStore gains now(); each store module takes the clock at construction and per-call defaults (getSession, spendToken, ...) default to it. Federation records use admin.now(), relays and quotes config.now(), delivery store.now(). The cache migration ledger, dev-mode (enterDevMode/leaveDevMode/holdOutbound), media uploads, the template 'now' filter (createTemplateEnvironment/createMailTemplates now option), and deleteUser/revokeTokensForUser take it from their callers.

Contracts: made required where every caller has a clock: blankForm, zoneLabel (new now arg for an unreadable date), commentForm/refilledCommentForm/commentsOpen, contactForm/refilledContactForm, submitComment/submitContactMessage now, sign/readNotificationToken, hiddenReason/isGone/isFederatedDocument, activityStreamsId, authorizeQuote, createLoginThrottle now, applyMigrations/openDatabase now, openAdminDatabase, adminStoreOwning, deleteUser now. Kept optional (additive) on public exports: openAdminStore({ now? }), createUser({ now? }), isServed/isListed default; openContentStore keeps its default for tests and tools.

Check: src/clock-boundary.test.ts lists 12 allowed reads with reasons (system clock definition; config default; openContentStore/openAdminStore/isServed/isListed/createUser defaults for callers outside createCms; elapsed wall time in content/sync.ts probe, webmention/reply-contexts.ts timeout, supervisor/primary.ts windows). Also fails on a stale allowance. Planted 'export const planted = Date.now();' in federation/quotes.ts: failed naming 'federation/quotes.ts:150'; reverted, passes.

Tests added first (red against the old code): inbox.test (follower followedAt, inbox receivedAt + month file), delivery.test (attemptedAt, resend Update id, actor Update id), relays.test (createdAt/updatedAt on follow and accept), webmention/send.test (attemptedAt), cms/boot.test (both migration ledgers + dev-mode record), cache.test (ledger stamp), time.test (zoneLabel fallback), admin/uploads.test (month directory), render.test (now filter reads the environment's clock at render time; replaces the formatDate('now') test), site/users.test (createUser now).

comments/signed-in.test 'falls back to it when the session has expired' pinned now but slept 300ms for the session to lapse; with sessions on the pinned clock it now moves the clock instead of sleeping.

Docs: public-api.md Clock description, content.md scheduling note, development.md 'One clock' section.

Validation: pnpm build && pnpm test (cms 5767/5767, demo 32, plugins 48/31/22/106), pnpm typecheck, pnpm lint, pnpm format:check all pass. Root export names diffed against HEAD: identical; src/index.ts, src/plugin.ts and plugin packages untouched.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Every timestamp the CMS writes or sends now comes from the one clock createCms resolves from its now option (config.now, store.now(), admin.now()). Clock moved to util/clock.ts; the store, migration ledger, dev mode, federation records/relays/quotes/delivery ids, uploads, users, tokens, forms and the template now filter take it. A new clock-boundary test fails on any unlisted new Date()/Date.now()/systemClock() and names file:line (proved with a planted call); 12 listed reads with reasons. New tests pin now through createCms and assert exact followedAt, receivedAt, attemptedAt (deliveries, webmentions), relay createdAt/updatedAt, migration and dev-mode stamps, and exact resend and actor Update ids. Public export names unchanged; additive now options on openAdminStore and createUser. Verified with pnpm build, test, typecheck, lint, format:check.
<!-- SECTION:FINAL_SUMMARY:END -->
