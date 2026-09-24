---
id: TASK-125
title: 'Quote posts: let Mastodon users quote a post, and approve the quote'
status: To Do
assignee: []
created_date: '2026-09-24 12:33'
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
- [ ] #1 Every federated Note and Article carries an interactionPolicy.canQuote rule, with the gts context terms, that Mastodon reads as quotable
- [ ] #2 A QuoteRequest for one of this site's public posts is answered with an Accept whose result is a QuoteAuthorization naming the quote, the post and the post's author
- [ ] #3 Each QuoteAuthorization is stored and served at its own URL as ActivityStreams JSON to anyone who can see the post
- [ ] #4 A QuoteRequest the policy does not allow, or for a post this site does not federate, is rejected and no authorization is stored
- [ ] #5 Undoing or deleting a quote leaves no authorization served for it
- [ ] #6 Posts federated before this change can be made quotable (an Update per post, sent on republish or by a one-off resend), and the README says how
- [ ] #7 Verified end to end against a real Mastodon 4.5+ account: the quote button is offered, the quote is approved, and the quote shows the post
<!-- AC:END -->
