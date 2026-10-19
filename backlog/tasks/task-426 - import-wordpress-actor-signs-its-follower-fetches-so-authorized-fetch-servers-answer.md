---
id: TASK-426
title: >-
  import wordpress-actor signs its follower fetches, so authorized-fetch servers
  answer
status: Done
assignee:
  - '@claude'
created_date: '2026-10-19 01:25'
updated_date: '2026-10-19 01:40'
labels:
  - bug
milestone: m-31
dependencies: []
references:
  - packages/plugin-wordpress/src/import.ts
priority: high
ordinal: 363800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
geekity import wordpress-actor dereferences each follower in the WordPress followers collection to read its inbox, shared inbox, handle, name and avatar. fetchAs() in import.ts sends a plain GET with only an Accept header. Servers that run Mastodon's authorized fetch (secure mode) refuse an unsigned GET of an actor with 401 Unauthorized. Today that includes mastodon.social, hachyderm.io and indieweb.social. The command lists those followers as 'could not be fetched', leaves them out of followers.json, and says to run it again once their servers answer. They never will, so after the move those followers stop getting the account's posts, although they still follow it. A --followers file only helps if it holds full actor documents (an item with an inbox is used as-is), and the saved collection holds only actor URLs. The command has just imported the key pair the followers hold, and the actor id is still served by WordPress with the matching public key, so it can sign. Proposal: sign each follower GET with the imported RSA key, using Fedify's standalone signRequest from @fedify/fedify (already a dependency; the command has no federation context, so the CMS's context.getDocumentLoader is not available). Use draft-cavage HTTP Signatures with keyId <actor-id>#main-key, the form WordPress's plugin uses and Mastodon accepts. If a server still refuses a signed fetch, report it, and stop telling the user a rerun will fix it. Open question: whether the command must also work after the DNS switch, when Geekity serves the actor id; that depends on the CMS publishing the RSA key under the same #main-key id. Either cover it or say the command runs before the switch.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A follower on a server that requires signed fetches (an unsigned GET of the actor answers 401) is fetched and written to followers.json
- [x] #2 The fetch is signed with the imported RSA key under the actor id's #main-key, so it verifies against the public key WordPress publishes before the switch
- [x] #3 A follower whose server refuses even a signed fetch is still listed and skipped, and the rest are imported
- [x] #4 A rerun after the fix adds the followers an earlier run skipped and leaves the others unchanged
- [x] #5 A test's fetch stub answers 401 to an unsigned actor GET and verifies the signature against the public key (Fedify verifyRequest), so a signed but invalid request fails it
- [x] #6 For a follower still refused after a signed fetch, the command's message no longer says a rerun will fix it; it says the server refused a signed fetch
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Tests first (import.test.ts): the fake WordPress serves the actor document at the stored actor id with publicKey {id: <actor-id>#main-key, publicKeyPem}; a strict follower server answers 401 unless Fedify verifyRequest verifies the request against that document and the key id is <actor-id>#main-key; a refusing server answers 401 to everything. A second collection URL lists Marien, the strict follower and the refuser.
2. Tests: strict follower is written to followers.json; refuser is listed as failed with refused: true and the rest imported; a run with a different (but self-consistent) key pair has the strict follower refused, proving the stub rejects bad signatures; a rerun after an earlier run that held only Marien adds the strict follower and leaves Marien unchanged.
3. Test (command.test.ts): importSummary, exported, says a refused follower's server refused a signed fetch and does not tell the user to run again; an unreachable one still gets the rerun advice.
4. Code (import.ts): fetchAs takes an optional signer {privateKey: CryptoKey, keyId: URL}; follower GETs are signed with Fedify signRequest (draft-cavage default) using the imported RSA key and keyId <actor-id>#main-key; a signed GET answered 401/403 throws a refused error; UnreachableFollower gains refused: boolean. The collection fetch stays unsigned.
5. Code (command.ts): summary splits advice: rerun for unreachable, 'refused a signed fetch; running again will not change that, a --followers file with their actor documents will' for refused.
6. Docs: docs/federation.md cutover step 3 and the plugin README's command steps mention signed fetches and the refused case.
7. Record that the CMS publishes the RSA key under <actor-id>#main-key (packages/cms/src/federation/actor.ts mainKeyId), so the signed fetch keeps verifying after the DNS switch.
8. Run pnpm build, test, test:11ty, typecheck, lint, format:check.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Follower GETs in importFollowers now go through fetchAs(url, signer): Fedify's standalone signRequest from @fedify/fedify 2.4.3 (draft-cavage-http-signatures-12, its default), the imported RSA key as a WebCrypto key (signingKeyOf, shared with privateJwkOf), keyId new URL(`${actorId}#main-key`). The collection fetch stays unsigned. A signed GET answered 401 or 403 throws RefusedSignedFetchError; UnreachableFollower gains refused: boolean. importSummary (now exported for its test) keeps the rerun advice for followers whose servers did not answer and, for refused ones, says their servers refused a fetch signed with the imported key, that running again will not bring them across, and that a --followers file with their actor documents will.

DNS-switch question: covered. The CMS publishes the RSA key as publicKey with id mainKeyId(actorId) = `${actorId.href}#main-key` (packages/cms/src/federation/actor.ts, userActor and senderKeyPairs), and actorId is the stored WordPress id, so the same key id dereferences to the same public key before and after the switch. The command does not need to run before the switch.

Tests: import.test.ts fake WordPress serves the actor id with publicKey {id: <actor-id>#main-key, publicKeyPem}; strict.example answers 401 unless Fedify verifyRequest verifies the request (key fetched through the stubbed fetch) and the verified key id is <actor-id>#main-key; refuser.example answers 401 always. Cases: strict follower imported, refuser listed refused and the rest imported (AC1-3); a run with a different self-consistent key pair is refused by strict.example (AC5 negative); a rerun after an earlier run that held only Marien adds the strict follower and leaves Marien byte-identical including followedAt (AC4). command.test.ts checks the summary text for both kinds of failure (AC6).

Not tested against a live Mastodon server: a real signed fetch needs the key published at a real actor id. Docs: docs/federation.md cutover step 3 and the plugin README's command steps updated.

Validation: pnpm build && pnpm test && pnpm test:11ty && pnpm typecheck && pnpm lint && pnpm format:check all exit 0 (plugin-wordpress 116 pass, cms 6251 pass, 0 fail).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
geekity import wordpress-actor now signs each follower GET with the imported RSA key under <actor-id>#main-key (Fedify signRequest, draft-cavage), so authorized-fetch servers such as mastodon.social answer and those followers reach followers.json. A server that still refuses a signed fetch is listed as refused, and the summary says so instead of advising a rerun. The CMS publishes the same #main-key id, so the command works after the DNS switch too. Verified with new import.test.ts cases whose fetch stub checks signatures with Fedify verifyRequest against the key WordPress publishes, a command.test.ts summary test, and the full build/test/typecheck/lint/format run.
<!-- SECTION:FINAL_SUMMARY:END -->
