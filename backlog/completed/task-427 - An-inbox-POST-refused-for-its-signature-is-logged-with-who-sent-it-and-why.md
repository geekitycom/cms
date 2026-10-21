---
id: TASK-427
title: An inbox POST refused for its signature is logged with who sent it and why
status: Done
assignee:
  - '@claude'
created_date: '2026-10-19 12:36'
updated_date: '2026-10-19 13:12'
labels:
  - enhancement
milestone: m-31
dependencies: []
references:
  - packages/cms/src/federation
  - packages/plugin-wordpress/src/federation.ts
priority: medium
ordinal: 364800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
When an inbox (the actor inbox, the shared inbox, or a plugin's inbox route such as plugin-wordpress's /wp-json/activitypub/1.0/inbox) refuses a POST because its HTTP signature doesn't verify, the server log shows only the request line and the status, for example 'POST /wp-json/activitypub/1.0/inbox 401 557.1ms'. Nothing records the claimed actor, the keyId, the activity type or id, or why verification failed. Many refusals are expected (an account deletion is signed by an actor whose key is gone), but an operator can't tell those from a real fault, such as a relay's Accept, a follower's Follow, or replies being refused after a move.

Fedify (2.4.3) verifies every signature and exposes the failure through InboxListenerSetters.onUnverifiedActivity(ctx, activity, reason), which nothing uses yet. Its own LogTape error line goes nowhere because no LogTape sink is configured. reason is keyFetchError (with the HTTP status or the error), invalidSignature, or noSignature; a date outside the window is reported as invalidSignature, so telling it apart needs our own check of the request's Date header against the signature time window. The handler only runs when the body parses; otherwise Fedify answers 400.

The site inbox (packages/cms/src/federation/federation.ts) and plugin-wordpress's inbox (packages/plugin-wordpress/src/federation.ts) are separate Fedify federations, so both need the hook. Core owns the formatting and rate limiting, and hands plugins a callback on PluginFederationContext, as it does with receive.

Out of scope: keeping recent refusals for the admin's inbox log page.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A POST to the site inbox, the shared inbox, or plugin-wordpress's inbox whose signature fails to verify writes one warn-level log line naming the keyId and the reason, plus the activity's actor, type and id when the body parses
- [x] #2 The reasons are distinguishable for: key not fetchable (with the HTTP status or the error), date out of range (from the request's Date header), signature mismatch, and missing signature
- [x] #3 A burst of refusals from one keyId doesn't flood the log
- [x] #4 Refused requests keep the status they get today, and accepted activities log as they do today
- [x] #5 The formatting and rate limiting live in core; plugin-wordpress reaches them through a callback on PluginFederationContext
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. New core module packages/cms/src/federation/refusals.ts: createInboxRefusals({ now, write }) returns refused(request, activity JSON-LD, reason). It classifies Fedify's VerifyRequestFailureReason into key not fetchable (HTTP status or error), date out of range (Date header or Signature-Input created outside Fedify's default one-hour window), signature mismatch and missing signature; formats one warn line with the inbox path, reason, keyId, actor, type and id; and rate-limits per keyId (first refusal in a 5-minute window logs, the rest are counted and the count rides on the next logged line).
2. Site inbox: createSiteFederation takes the refusals and registers .onUnverifiedActivity, returning void so Fedify keeps its 401.
3. PluginFederationContext gains refused(activity, reason), with a plain-data reason type in plugin.ts; web/plugin-federation.ts wires it to the same instance, so both federations share one rate limit.
4. plugin-wordpress registers .onUnverifiedActivity and hands the activity's JSON-LD and the reason to context.data.refused.
5. services.ts builds one instance on the system clock (Fedify checks dates against real time, not the site clock) and passes it to both.
6. Tests first: unit tests for classification, formatting and rate limiting; integration tests in federation/inbox.test.ts (site and shared inbox) and plugin-wordpress/test/federation.test.ts capturing console.warn; status stays 401 and accepted activities log nothing new.
7. Short note in docs/federation.md. Verify with the full pnpm suite and real curl POSTs against a running demo site.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Built as planned. New core module packages/cms/src/federation/refusals.ts (createInboxRefusals). One instance per CMS, built in cms/services.ts on systemClock because Fedify checks dates against real time, and a pinned site clock (tests pin one) would misclassify. The site inbox registers .onUnverifiedActivity in federation/federation.ts. PluginFederationContext gains refused(activity, reason), with a plain-data InboxRefusalReason type exported from @geekity/cms/plugin and the root entry (documented in docs/public-api.md). web/plugin-federation.ts wires it to the same instance, so the site's inboxes and the plugin's share one rate limit. plugin-wordpress registers .onUnverifiedActivity and passes the activity JSON-LD and Fedify's reason through. Handlers return void, so Fedify keeps answering 401.

Date out of range: Fedify reports it as invalidSignature. The log checks the Date header, or the RFC 9421 Signature-Input created time when there is no Date header, against Fedify's default one-hour signatureTimeWindow. Neither federation overrides that window. If a site set federationOptions.signatureTimeWindow, the classification would not follow it.

Rate limit: the first refusal for a keyId logs. Refusals within the next 5 minutes are counted. The count is written as one 'Suppressed N more inbox refusals for keyId=...' line on the first refusal from any keyId after the window. Unsigned deliveries are keyed by actor. A burst that is never followed by another refusal never reports its count.

Docs: docs/federation.md (new log line), docs/plugins.md (refused callback), docs/public-api.md (new type). Adding a context method keeps HOST_API_VERSION, per its rule in plugin.ts.

Validation: pnpm build, test (cms 6268 pass, plugin-wordpress 123 pass, all others pass), test:11ty, typecheck, lint, format:check all green. Real curl POSTs against a running createCms + plugin-wordpress server (a scratchpad script with a stub peer on localhost) gave a 401 for each refused POST and the expected log line: unsigned at the personal inbox (no signature), key 404 at the shared inbox (key not fetchable (HTTP 404)), unreachable key host (key not fetchable (TypeError: fetch failed)), wrong key at the plugin's shared inbox (signature mismatch), and a 2-hour-old Date at the plugin's personal inbox and at the site inbox (date out of range (Date ...)). Correctly signed POSTs answered 202 and logged nothing. Four repeat POSTs from the 404 keyId logged nothing.

Burst check, live: six POSTs from one 404 keyId logged one line. After 5 minutes one more POST (to the plugin's inbox) wrote 'Suppressed 5 more inbox refusals for keyId=http://localhost:3901/keys/gone#main-key after the one logged at 2026-10-19T13:07:32.746Z' and then its own line. Test server stopped.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Inbox POSTs refused for their HTTP signature now write one warn line with the inbox path, the reason (key not fetchable with HTTP status or error, date out of range from Date or created, signature mismatch, no signature), the keyId, and the activity's actor, type and id. Both the site federation (personal and shared inbox) and plugin-wordpress's federation register Fedify's onUnverifiedActivity. Core owns the formatting and a per-keyId 5-minute rate limit (federation/refusals.ts). plugin-wordpress reaches them through the new PluginFederationContext.refused callback. Responses stay 401 and accepted activities are unchanged. Verified by unit tests (refusals.test.ts), integration tests in cms inbox.test.ts and plugin-wordpress federation.test.ts, the full pnpm build/test/test:11ty/typecheck/lint/format:check run, and real curl POSTs against a running site, including the suppressed-count line after the window.
<!-- SECTION:FINAL_SUMMARY:END -->
