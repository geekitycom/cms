---
id: TASK-363
title: Delivery and reply-context code have seams
status: Done
assignee:
  - '@claude'
created_date: '2026-10-11 17:01'
updated_date: '2026-10-12 01:57'
labels: []
milestone: m-35
dependencies:
  - TASK-362
type: chore
ordinal: 322800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
federation/delivery.ts createDeliveryService is a 500-line closure whose stamp, target and fan-out logic share closure state. webmention/reply-context.ts (890 lines) puts page fetch, microformats, JSON-LD, oEmbed and fediverse lookups in one file, with known oEmbed endpoints as code.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Delivery target selection, stamping and fan-out are pure functions tested directly
- [x] #2 Reply-context sources live in one module each, joined only by merge
- [x] #3 Known oEmbed endpoints are a data table
- [x] #4 Federation and reply-context tests pass unchanged
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Federation: move the delivery rules out of the createDeliveryService closure into federation/delivery-plan.ts as pure functions that take data and return values: deliveryChange (scan/migrated/federated gating of a DocumentChange), stampFor (the activitypub.published a post should carry, or undefined), followerTargets/relayTargets/fanOutTargets/objectTargets/citedAuthor (target selection and fan-out, with mentioned accounts and followers passed in as data), deliveryRows (one outcome row per actor behind a target), revisionStep (announce/revise/replace/nothing from the old and new shapes) and pinChange (pin/unpin/nothing). deliveryTargets(admin, username) and groupByInbox keep their public signatures and read the store, then call the pure functions. The closure keeps the queue, sentThisProcess, contexts, saveDocument and sendActivity.
2. Test each pure function directly in federation/delivery-plan.test.ts (written first, failing on the missing module); delivery.test.ts unchanged.
3. Reply context: split webmention/reply-context.ts into webmention/reply-context/{source,page,json-ld,oembed,fediverse}.ts, each source returning a partial Source; reply-context.ts keeps fetchReplyContext, readReplyContext, heldReplyContext and the join through merge (in source.ts). Re-export FediversePost/FediverseLookup/Oembed so public imports stay the same.
4. Known oEmbed endpoints: a data table (host pattern, path pattern, endpoint, params, title suffix) read by one lookup; test the lookup against the table directly.
5. Verify with pnpm build, test, typecheck, lint, format:check; existing federation and reply-context tests unchanged.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
federation/delivery-plan.ts holds the delivery rules as pure functions: followerTargets, relayTargets, groupByInbox, fanOutTargets, citedAuthor, objectTargets (reply author + mentioned accounts passed in as data), deliveryRows, stampFor, wasAnnounced, deliveryChange, revisionStep, pinChange. createDeliveryService keeps the queue, sentThisProcess, contexts, saveDocument, sendActivity and recordDelivery. deliveryTargets(admin, username, {relays}) keeps its public signature and reads the store before calling followerTargets/relayTargets; groupByInbox is exported from federation/index.ts out of delivery-plan.ts, so the package exports are unchanged. delivery-plan.test.ts (23 tests) first failed with ERR_MODULE_NOT_FOUND for delivery-plan.ts, then passed.
webmention/reply-context/ holds source.ts (Source, Limits, merge, text helpers), page.ts (readPage, h-entry/h-event and page metadata, canonical and syndication links), json-ld.ts, oembed.ts (KNOWN_OEMBED_PROVIDERS table with hosts, path, endpoint, params, titleSuffix; knownEndpoint; link discovery; fetchOembed) and fediverse.ts. reply-context.ts keeps fetchReplyContext, readReplyContext, heldReplyContext and joins sources only through merge in described(); it re-exports FediversePost, FediverseLookup and Oembed. Every fetch still goes through fetchPublic. reply-context/oembed.test.ts checks lookups against the table.
Validation: pnpm build && pnpm test && pnpm typecheck && pnpm lint && pnpm format:check all pass (cms 5643 tests). delivery.test.ts and the reply-context tests have no diff.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Moved delivery target selection, stamping, fan-out, change gating, revision and pin decisions out of the createDeliveryService closure into pure functions in federation/delivery-plan.ts, tested directly in delivery-plan.test.ts. Split webmention/reply-context.ts into one module per source under webmention/reply-context/ (page, json-ld, oembed, fediverse) plus source.ts with the shared Source type and merge; known oEmbed endpoints are a data table with per-provider params. Behaviour and package exports are unchanged. Verified with pnpm build, test, typecheck, lint and format:check; delivery.test.ts and the reply-context tests are unchanged and pass.
<!-- SECTION:FINAL_SUMMARY:END -->
