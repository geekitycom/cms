---
id: TASK-125
title: 'Quote posts: let Mastodon users quote a post, and approve the quote'
status: In Progress
assignee:
  - '@claude'
created_date: '2026-09-24 12:33'
updated_date: '2026-09-28 23:55'
labels:
  - federation
dependencies: []
references:
  - 'https://docs.joinmastodon.org/spec/activitypub/'
  - 'https://codeberg.org/fediverse/fep/src/branch/main/fep/044f/fep-044f.md'
ordinal: 149800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Mastodon 4.5 shows "You are not allowed to quote this post" on every post from this site. Mastodon implements quote posts through FEP-044f: a post advertises who may quote it in `interactionPolicy.canQuote`, and a post with no policy is treated as quotable by nobody. The objects built in packages/cms/src/federation/article.ts carry no interactionPolicy. Advertising a policy is not enough on its own: even with automatic approval, the quoting server sends a `QuoteRequest` to the quoted author, whose server must reply with an `Accept` whose `result` is a `QuoteAuthorization` stamp (interactingObject, interactionTarget, attributedTo), and the stamp must be dereferenceable by everyone who can see the post. A quote without that stamp is unapproved, and other servers should not display it. The inbox in packages/cms/src/federation/federation.ts (and the WordPress-compatible inbox in wordpress.ts) has no QuoteRequest listener today. @fedify/vocab 2.3.7 already provides InteractionPolicy, InteractionRule and QuoteAuthorization. Mastodon keeps the policy it saw when it fetched a post, so posts already federated need an Update to become quotable. Who may quote (public, followers, nobody) and whether a quote notifies the author are product choices to settle while planning.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Every federated Note and Article carries an interactionPolicy.canQuote rule, with the gts context terms, that Mastodon reads as quotable
- [x] #2 A QuoteRequest for one of this site's public posts is answered with an Accept whose result is a QuoteAuthorization naming the quote, the post and the post's author
- [x] #3 Each QuoteAuthorization is stored and served at its own URL as ActivityStreams JSON to anyone who can see the post
- [x] #4 A QuoteRequest the policy does not allow, or for a post this site does not federate, is rejected and no authorization is stored
- [x] #5 Undoing or deleting a quote leaves no authorization served for it
- [x] #6 Posts federated before this change can be made quotable (an Update per post, sent on republish or by a one-off resend), and the README says how
- [ ] #7 Verified end to end against a real Mastodon 4.5+ account: the quote button is offered, the quote is approved, and the quote shows the post
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Data shape: a QuoteAuthorization record { id (uuid, the path segment), quote (interactingObject), post (interactionTarget), request (QuoteRequest id), actor (quoter), authorizedAt }, kept per quoted author in content/_data/federation/{username}/quotes.json (decision-9: files are the truth; no SQLite index, the file is read per request).

1. article.ts: every Note and Article carries interactionPolicy.canQuote { automaticApproval: as:Public }. Every federated post is addressed to Public, so every federated post is quotable by anyone; nothing else federates. Test: the served object and the delivered Create carry it, with the gotosocial.org/ns context (AC #1).
2. quotes.ts: read/add/revoke records under withFileLock, idempotent per (post, quote); federatedPostById(store, objectId, baseUrl) resolves a stored id or a permalink to a federated post (permalinkOfObjectId moves from conversation.ts to web/documents.ts).
3. inbox.ts handleQuoteRequest on both inboxes (federation.ts, wordpress.ts): log it; if the object is a federated post and the instrument shares the requester's origin, store the authorization and send Accept { object: the QuoteRequest, result: the QuoteAuthorization } as the post's author; otherwise send Reject and store nothing (AC #2, #4).
4. Fedify object dispatcher for QuoteAuthorization at /author/{identifier}/quotes/{id}/, answering only while the record exists and the post still federates, unsigned fetch allowed (AC #3).
5. handleUndo of a QuoteRequest and handleDelete of the quoting post (same actor only) remove the record, so the URL 404s (AC #5).
6. geekity resend <slug>... | --all: boots the CMS with no queue, resends every announced, still-published post as an Update (which now carries the policy); README documents it (AC #6).
7. Full gates, curl a running site, notes; AC #7 left for a manual Mastodon 4.5 check.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Product decisions (set by the orchestrator; recorded here because `backlog decision create` takes only a title and cannot hold a body):
- Who may quote: every federated post is public (to: Public), so every Note and Article advertises interactionPolicy.canQuote { automaticApproval: as:Public }. Drafts, scheduled, trashed posts and pages do not federate and are quotable by nobody: a QuoteRequest for them is answered Reject. The site has no followers-only posts, so that case does not arise.
- Approval is automatic; there is no manual approval UI.
- No quote notification. The notifier (src/notify.ts, src/notifications/) is driven by comments and inbox replies; a quote notice would need a new notice kind, template and settings toggle, which is not trivial. Follow-up candidate.
- AC #6 mechanism: a new CLI command, `geekity resend (--all | <slug>...)`, that runs cms.delivery.resend for every announced post (store.listFederated) with no queue, so each activity is posted before exit. Editing a post also sends an Update.

Design:
- Approvals are files (decision-9): content/_data/federation/{username}/quotes.json, one { id, quote, post, request, actor, authorizedAt } per quote, under the author who granted it. No SQLite index; the file is read per request. Keyed by (quote, post), so a second request for the same quote gets the same stamp.
- Stamp URL: {baseUrl}/author/{username}/quotes/{id}/ via a Fedify object dispatcher (QUOTE_AUTHORIZATION_PATH). It answers only while the record exists and the quoted post still federates; unsigned fetches are allowed.
- handleQuoteRequest (inbox.ts) runs on the canonical and the WordPress-compatible inboxes. It refuses a quote whose instrument lives on a different origin from the requester, as Mastodon does for any activity, so nobody can get a stamp for another person's post. Accept embeds the QuoteRequest as object and the QuoteAuthorization as result. Mastodon reads result by value_or_id, so either form works.
- Revocation: an Undo whose object id is the stored request id, or a Delete whose object id is the stored quote, from the same actor, removes the record. The URL then 404s.
- permalinkOfObjectId moved from web/conversation.ts to web/documents.ts. postByObjectId in article.ts resolves a stored id or a permalink to a post.
- Checked against Mastodon main source on 2026-09-28: StatusParser#quote_subpolicy accepts as:Public, Public or the full URI; ActivityPub::Activity::Accept#accept_quote! takes result by value_or_id and requires its host to match the actor; VerifyQuoteService checks the stamp's type, interactingObject, interactionTarget and attributedTo, and needs the ActivityStreams context.

Validation:
- pnpm build, pnpm test (2278 + 30 pass), pnpm typecheck, pnpm lint and pnpm format:check all pass.
- New tests: federation/quotes.test.ts (13, AC #2-#5, Mastodon-shaped JSON over signed HTTP), article.test.ts 'the quote policy' (AC #1), cli-resend.test.ts (AC #6, a real subprocess delivering to a loopback inbox). A mutation check (accept any origin; skip Delete revocation) made the matching tests fail.
- End to end on a scratch site served by `geekity serve` at 127.0.0.1:4817, with a signing peer on 4818: curl of the post as AS JSON showed interactionPolicy and the gotosocial.org/ns context. A signed QuoteRequest got an Accept with the QuoteAuthorization result. curl of the stamp URL, unsigned, returned 200 application/activity+json. A QuoteRequest for a draft got Reject and stored nothing. `geekity resend --all`, run while the server was up, delivered an Update carrying the policy and exited 0. A Delete of the quote made the stamp URL 404 and emptied quotes.json. The server was stopped afterwards.

AC #7 is not verified: it needs a Mastodon 4.5+ account and this site deployed on a public https host, which this session does not have. Manual steps:
1. Deploy this branch, or expose a local site on https (see 'Testing federation against a real Mastodon account' in packages/cms/README.md).
2. Run `geekity resend --all` in the site directory, or publish a new post.
3. On Mastodon 4.5+, search the post URL. Check that the quote button is offered and that 'You are not allowed to quote this post' is gone.
4. Quote it. Check that the inbox log shows the QuoteRequest and that content/_data/federation/{username}/quotes.json gains an entry.
5. Check that the quote shows the quoted post, not 'post unavailable' or 'pending', on the quoting instance and on a third instance that fetches the quote.
6. curl -H 'Accept: application/activity+json' the stamp URL from quotes.json and confirm the QuoteAuthorization.
7. Delete the quote on Mastodon. Check that the entry leaves quotes.json and the stamp URL 404s.

Follow-ups, not done here: doc-4's Inbox and Storage sections do not yet list QuoteRequest or quotes.json. A quote notification. `resend --all` resolves posts by slug, so when two announced posts share a slug across years, only the newer is resent (the delivery service's existing slug lookup).

Correction to the notification note above: the email notices in src/notifications/comments.ts cover a comment or webmention waiting in moderation and an approved reply to a subscribed comment. Nothing there is driven by the ActivityPub inbox, so a quote notification would be a new notice kind, template and preference.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Posts are now quotable from Mastodon 4.5 (FEP-044f). Every federated Note and Article advertises canQuote for anyone. The inbox (canonical and WordPress-compatible) answers a QuoteRequest for a federated post with an Accept carrying a QuoteAuthorization, stored in content/_data/federation/{username}/quotes.json and served unsigned at /author/{username}/quotes/{id}/. Anything else gets a Reject. Undo or Delete of the quote withdraws the stamp. `geekity resend --all | <slug>...` sends an Update so posts already federated pick up the policy, documented in packages/cms/README.md under Quote posts. Verified by unit and HTTP tests, a CLI subprocess test, and an end-to-end run against a served scratch site. AC #7 (a real Mastodon 4.5+ account) is still open, and the manual steps are in the notes.
<!-- SECTION:FINAL_SUMMARY:END -->
