---
id: TASK-263
title: Send an Update when a cited page's context arrives after the Create
status: Done
assignee:
  - '@claude'
created_date: '2026-10-04 09:54'
updated_date: '2026-10-04 10:04'
labels:
  - federation
dependencies: []
priority: low
type: enhancement
ordinal: 222800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TASK-262 found that the site sends no ActivityPub Update when a reply context is stored after a post's Create: delivery reacts only to content index changes, and content/_data/replyContexts.json is not a document. A like, repost or bookmark with its own title or slug, or a file written to disk, can reach Mastodon as 'Reposted a page on giphy.com' and keep that until the next edit or a Resend. When the reply-context service stores a context whose name, author or picture changed for a URL, send an Update for each federated, served post that cites that URL (in-reply-to, like-of, repost-of, bookmark-of), through the same delivery path an edit uses (once per shared inbox, same addressing). A context that changes nothing visible in the Note sends nothing. Posts whose Create already carried the title (saves that fetched it before delivery) must not get a redundant Update.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A post whose Create went out with the host form gets an Update naming the cited title once the context is stored, delivered to the same inboxes
- [x] #2 A context store that changes nothing in the Note, or a post whose Create already named the title, sends no Update
- [x] #3 Hidden posts (drafts, scheduled, trashed, unrecognised visibility) never get an Update; tests use the stubbed remote host in delivery.test.ts
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Reply-context service takes an onStored(target, previous) callback, called after each write of a context, with the entry it replaced.
2. Delivery service remembers a fingerprint of each post object it sends (sha-256 of the object's JSON-LD) in announce and revise.
3. Delivery gains citedPageStored(target, previous): queued on the delivery chain, it walks the served, federated, announced posts citing target (in-reply-to or a citation), skips likes/reposts of fediverse objects (no content to update), renders the object now and compares it to the remembered fingerprint, else to the object rendered with the previous context (posts sent before this process started). Only a difference sends an Update through revise, whose revision is the fingerprint so the id is new yet idempotent.
4. createCms wires replyContexts' onStored to delivery.citedPageStored.
5. Tests first in delivery.test.ts with a gated page and gated inbox on the stubbed host: AC1 host-form Create then Update to the same inbox; AC2 a store that changes nothing, and a Create built after the context landed; AC3 drafted, trashed, private-visibility posts get nothing.
6. Verify pnpm build && pnpm test && pnpm typecheck && pnpm lint && pnpm format:check.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Design: the reply-context service takes an onStored(target, previous) callback, called after each write of a context with the entry it replaced; createCms hands it to delivery.citedPageStored. Delivery queues the check on its own chain, behind any Create still waiting, and walks store.listFederated() (posts whose Create went out) filtered by isFederatedDocument and by citing the target (in-reply-to or a citation). A like or repost of a fediverse object is skipped: it has no content to update. For the rest it renders postObject now and compares a sha-256 of its JSON-LD with what the followers were last sent.

What was last sent: delivery kept nothing of the content, only the delivery log and the document-hash revision. It now remembers the fingerprint of every Create or Update object it sends (sendObject, used by announce and revise), in memory, by object id. A post sent before this process started falls back to its object rendered with the replaced context. The memory is what stops a redundant Update when the context lands before a queued Create is built; the fallback covers a restart, where catchUp fetches missing contexts for posts whose Create carried the host form. The Update's revision is the fingerprint, so its id differs from the edit's hash-named Update and the same content sent twice keeps one id.

Tests: delivery.test.ts 'a cited page whose context is stored after the Create (TASK-263)'. The stub gained a gated page (SLOW_PAGE) and a gate on inbox POSTs; site() gained a host lookup that resolves the remote host only, so reply contexts are fetched from the stub (resolving every host made the reply-context service fetch the site's own post and broke the TASK-240 own-reply test). Mutations: dropping the lastSent lookup fails the queued-Create test; dropping the equality check fails both AC2 tests; dropping isFederatedDocument fails draft, private-visibility and future-dated; listAll in place of listFederated fails the never-sent test. The trashed case is also excluded by the store query.

Validation: pnpm build && pnpm test (4073 + 30 pass) && pnpm typecheck && pnpm lint && pnpm format:check all exit 0.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
A like, repost or bookmark whose Create reached the followers with the host form ('a page on giphy.com') now gets an Update naming the cited page once its context is stored, sent through the same revise/fanOut path an edit uses, once per shared inbox. The reply-context service reports each stored context with the one it replaced; the delivery service, on its own queue, re-renders each served, announced post citing that URL and sends an Update only when the object differs from what the followers were last sent. It remembers a sha-256 of each delivered object in memory, falling back to the object rendered with the replaced context for posts sent before a restart. Drafts, trashed, scheduled and unrecognised-visibility posts, posts never announced, and likes or reposts of fediverse objects get nothing. Verified by eight new tests in federation/delivery.test.ts (gated page and inbox on the stubbed host), mutation checks, and build, 4073 tests, typecheck, lint and format:check.
<!-- SECTION:FINAL_SUMMARY:END -->
