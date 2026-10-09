---
id: TASK-312
title: A site with no accounts stamps activitypub.published on posts it never sent
status: Done
assignee:
  - '@claude'
created_date: '2026-10-09 20:49'
updated_date: '2026-10-09 20:56'
labels:
  - bug
milestone: m-31
dependencies: []
priority: medium
ordinal: 271800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
On a site with no accounts (decision-14: such a site federates nothing), geekity serve stamps `activitypub.published` into a post file whenever the watcher sees a published post change: an edited post, a new post file, or a draft becoming published. The stamp is written by stamp() in packages/cms/src/federation/delivery.ts before the queued send, and the send then throws because no user can be the actor, which logs "A delivery failed: The post ... cannot be federated: the site has no accounts". geekity resend <slug> does the same: it stamps, then exits 1. The stamp is the record that followers hold the post, so once an account exists the file lies: geekity resend sends an Update for a post no follower was sent a Create for, the federation screen lists it as announced, and a rename of a draft leaves redirects as if the post had been promised. Reproduced with the built CLI on a scratch site; found while checking TASK-311 (same root, a different entry point).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 With no accounts, editing a published post, adding a new post file, or publishing a draft under geekity serve leaves the file without `activitypub.published` and logs no delivery failure
- [x] #2 With no accounts, geekity resend <slug> leaves the file without `activitypub.published` and still says why it cannot send
- [x] #3 With an account, a published post is still stamped and announced as before
- [x] #4 A regression test in federation/delivery.test.ts fails without the fix
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Failing tests in federation/delivery.test.ts on a site with no accounts: a watched change announcing and revising a published post leaves the file unstamped and warns nothing; resend rejects with the no-accounts reason and leaves the file unstamped.
2. Root cause: handle() and resend() call stamp() before asking whether any user can be the actor; send() asks only afterwards and throws. Fix: decide the sender before the stamp. handle() returns when documentAuthor is undefined (decision-14: such a site federates nothing); resend() throws the no-accounts error before stamping.
3. Re-run the built-CLI repro (serve + watcher edits, new file, draft published, resend) on a scratch site.
4. Full gate, deslop, no-comments.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Root cause: handle() and resend() in federation/delivery.ts called stamp() before anything asked whether a user could be the post's actor; send() asked only afterwards and threw, so the file was written and the queued task then logged "A delivery failed". Fix: handle() returns as soon as documentAuthor is undefined for the changed document (decision-14: a site with no accounts federates nothing, including withdrawals), and resend() calls requireSender (the throw send() already had, extracted) before stamping, so it still reports the no-accounts reason.

Reproduced first with the built CLI on a scratch site (geekity init, no accounts): under geekity serve, appending a line to the published post, adding a new post file, and flipping a draft to draft: false each logged "A delivery failed: The post ... cannot be federated: the site has no accounts..." and wrote activitypub.published into the file; geekity resend hello-world exited 1 and also stamped. A migrated post already carrying activitypub.published logged the failure on edit (no file change). ap_deliveries held 0 rows.

After the fix, same steps: no log line, no file gained activitypub (only the migrated file, which had it from the start), ap_deliveries 0; resend exits 1 with "cannot be delivered: the site has no accounts" and the file is unchanged. With geekity user add ada and dev mode on, editing the post under serve still stamps activitypub.published (AC #3), as do the existing delivery tests with an account.

Tests: delivery.test.ts "a published post on a site with no accounts (TASK-312)" (two cases) failed before the fix with the file containing "activitypub:\n  published: 2026-03-04T10:00:00Z"; pass after.

Validation: pnpm build, typecheck, lint, format:check pass (one format:check run exited 1 right after build and passed on three reruns with no file change); pnpm test passed in full (cms 5187, demo 32, plugin-llm 48, post-summary 22, tag-suggest 31, wordpress 90, 0 fail). deslop no findings; no-comments deleted one added comment and the bare guard call was renamed sender -> requireSender so it reads without one; delivery.test.ts 73/73 after the rename.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
A site with no accounts no longer writes activitypub.published into posts it never sent. The delivery service now decides who sends a post before stamping it: a watched change on a site with no accounts is ignored outright, and geekity resend throws its no-accounts reason before touching the file. Verified by two new delivery.test.ts cases that failed before, the built CLI on a scratch site (serve edits, new file, draft published, resend), a dev-mode site with an account that still stamps, and the full build/test/typecheck/lint/format gate.
<!-- SECTION:FINAL_SUMMARY:END -->
