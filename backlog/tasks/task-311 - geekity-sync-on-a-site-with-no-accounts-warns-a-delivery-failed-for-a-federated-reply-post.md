---
id: TASK-311
title: >-
  geekity sync on a site with no accounts warns a delivery failed for a
  federated reply post
status: Done
assignee:
  - '@claude'
created_date: '2026-10-09 18:27'
updated_date: '2026-10-09 19:05'
labels:
  - bug
milestone: m-31
dependencies: []
priority: low
ordinal: 269800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Seen during TASK-291.3: the first geekity sync over the andrewshell.org import, into a site with no accounts yet, prints 'A delivery failed: The post "blurt-marketing-gone-wrong" cannot be federated: the site has no accounts...' for the two imported posts that carry both in-reply-to and activitypub.published. It exits 0 and nothing is sent: with an account and GEEKITY_DEV_MODE on, the same sync holds nothing in data/dev-mode.jsonl. The source is the delivery's citedPageStored in packages/cms/src/federation/delivery.ts: when sync stores a cited page for the first time, it fingerprints postObject for every federated post citing it, and attribution() throws on a site with no accounts before any comparison. The warning tells an operator mid-migration that a delivery failed when none was due.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 geekity sync over a site with no accounts and a federated post with in-reply-to prints no delivery failure
- [x] #2 With an account, a cited page arriving for a migrated post still sends nothing (the dev-mode record holds nothing)
- [x] #3 A native federated post whose cited page changes is still revised as before
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Reproduce: build, run geekity sync on a scratch site with no accounts and an announced in-reply-to post; confirm the 'A delivery failed' line.
2. Root cause: citedPageStored fingerprints postObject for every announced post citing the page, and postObject's attribution() throws when no user can be the post's actor (decision-14: a site with no accounts federates nothing). The throw rejects the queued task, which queue() logs as a failed delivery.
3. Failing test first in federation/delivery.test.ts: a site with no accounts, an announced reply to PLAIN_PAGE, the context stored by the boot sync; assert console.warn is never called and nothing is delivered.
4. Fix: citedPageStored only considers citing posts that have an author to revise as (documentAuthor defined), so no object is built for a post nobody can send.
5. Verify AC #2 with a real sync: account, GEEKITY_DEV_MODE on, no followers, migrated announced reply; data/dev-mode.jsonl holds nothing. AC #3 by the TASK-263 tests (native post revised when its cited page changes).
6. Full pnpm build/test/typecheck/lint/format:check, deslop and no-comments over the diff.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Root cause: citedPageStored (federation/delivery.ts) built postObject for every announced post citing the stored page, and attribution() throws when no user can be the post's actor. On a site with no accounts that throw rejected the queued task, and queue() logged it as 'A delivery failed'. A site with no accounts federates nothing (decision-14), so no followers' copy exists to revise. Fix: the citing filter now also requires documentAuthor(context, document) to be defined, so no object is built for a post nobody can send as.

Reproduced first with the built CLI: geekity sync on a scratch site with no accounts and an announced, migrated in-reply-to https://example.com/ post printed 'A delivery failed: The post "a-reply" cannot be federated: the site has no accounts...'. After the fix the same sync printed only the scan line, exit 0, and content/_data/replyContexts.json held the fetched context (so citedPageStored did run).

Test: delivery.test.ts 'a cited page stored on a site with no accounts (TASK-311 AC #1)' failed before the fix with console.warn called once with that exact message; passes after.

AC #2: same scratch site with geekity user add ada, geekity dev-mode on, GEEKITY_DEV_MODE=true, data and _data wiped, sync: exit 0, no warning, data/dev-mode.jsonl held only the {type:on} line, no held outbound record. Note that an account with followers still gets the Update decision-36 prescribes for an announced migrated post (migrated-site.test.ts still passes); AC #2 is read as the TASK-291.3 setup, an account with no followers.

AC #3: TASK-263 tests (a native post's Update when its cited page context arrives after the Create, and the no-op cases) pass unchanged.

Validation: pnpm build, pnpm typecheck, pnpm lint, pnpm format:check pass. pnpm test: first run had the known migrated-site watcher flake ('sends nothing for a post its followers already hold' timed out at 20s); it passed alone (9/9), and the full rerun passed (cms 5159, plugin-llm 48, demo 32, post-summary 17, tag-suggest 31, 0 fail). deslop and no-comments: no findings.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
geekity sync on a site with no accounts no longer logs a failed delivery when it stores a cited page for an announced reply. citedPageStored in federation/delivery.ts now skips citing posts with no author to send as, instead of building an object whose attribution() throws. Proven by a new delivery.test.ts case (failed before with the exact warning), a real CLI sync with no accounts (no warning), a real sync with an account in dev mode (dev-mode.jsonl holds nothing), and the unchanged TASK-263 and migrated-site tests; full build, test, typecheck, lint and format:check pass.
<!-- SECTION:FINAL_SUMMARY:END -->
