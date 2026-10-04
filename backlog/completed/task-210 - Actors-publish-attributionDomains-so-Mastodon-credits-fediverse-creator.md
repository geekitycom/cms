---
id: TASK-210
title: 'Actors publish attributionDomains so Mastodon credits fediverse:creator'
status: Done
assignee:
  - '@claude'
created_date: '2026-10-01 21:47'
updated_date: '2026-10-02 06:58'
labels:
  - federation
  - activitypub
milestone: m-27
dependencies:
  - TASK-202
references:
  - packages/cms/src/federation/actor.ts
  - 'https://blog.joinmastodon.org/2024/07/highlighting-journalism-on-mastodon/'
priority: medium
type: feature
ordinal: 226800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TASK-202 prints <meta name="fediverse:creator" content="@username@host"> naming the user's own actor on this site. Mastodon shows the author credit in a link preview only when the named account's actor lists the link's domain in attributionDomains (read in ActivityPub::ProcessAccountService#set_immediate_attributes!). Geekity's actors do not publish that property, and Fedify's Person has no typed field for it, so the tag currently has no visible effect. Publish attributionDomains: [the site's host] on every user's actor, extending the actor JSON-LD (with the toot: context term) so Mastodon parses it. Then TASK-202's AC #4 can be checked.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Every user's actor JSON carries attributionDomains containing the site's host, with a @context that maps the term the way Mastodon reads it
- [x] #2 A remote Mastodon instance that fetches the actor stores the domain as an attribution domain (or the notes record what was checked)
- [x] #3 Sharing a post link on Mastodon shows the author credit card, and TASK-202 AC #4 is checked
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Failing tests: federation.test.ts reads the actor at /author/ada/ with Accept: application/activity+json and expects a top-level attributionDomains array holding the site's hostname, and a @context entry mapping attributionDomains to {@id: toot:attributionDomains, @container: @set} (Mastodon's context_helper.rb); the stored-actor-id route answers the same. delivery.test.ts: the Update of the actor that updateActor sends carries object.attributionDomains as well, because Mastodon's Update handler hands the embedded object to ProcessAccountService, which reads json['attributionDomains'] raw and would otherwise reset the list to [].
2. The host is new URL(baseUrl).hostname, not handleHost: Mastodon compares against Addressable normalized_host of the shared link's canonical URL, which has no port.
3. actor.ts: a Person subclass carrying the domains, overriding toJsonLd (expand: add the toot IRI to the node; compact: add the property and the context term) and clone; an Update subclass for the actor Update that renames the toot:attributionDomains key Fedify's activity compaction produces to the term and adds the term to its @context. userActor returns the subclass; delivery.updateActor sends the Update subclass.
4. README: replace the 'does not publish attributionDomains yet' paragraph under Site author.
5. Verify: build, test, typecheck, lint, format:check; a scratch site on a free port, curl the actor JSON, and expand it with jsonld (Fedify's own dependency) to show the term expands to http://joinmastodon.org/ns#attributionDomains. AC #2 and #3 need a remote Mastodon and a public deployment, so they stay unchecked.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Mastodon side, read from mastodon/mastodon main: ProcessAccountService#set_immediate_attributes! reads @json['attributionDomains'] off the raw actor JSON (no compaction), so the key must be the bare term. context_helper.rb defines it as 'attributionDomains' => {'@id' => 'toot:attributionDomains', '@container' => '@set'}; the actor carries that definition. FetchLinkCardService compares can_be_attributed_from?(Addressable normalized_host of the card's canonical URL), which has no port, so the listed domain is new URL(baseUrl).hostname (attributionDomainOf in paths.ts), not federationOrigin's handleHost. ActivityPub::Activity::Update#update_account passes the embedded actor to ProcessAccountService, where a missing attributionDomains resets the list to [], so the profile Update must carry it too.

Built: userActor returns an AttributedPerson (actor.ts), a Person subclass that adds attributionDomains: [attributionDomainOf(baseUrl)] to what Fedify builds, because Fedify 2.3.8's Person has no such property and its toJsonLd drops unknown fields. As the document it appends Mastodon's term definition {toot, attributionDomains: {@id: toot:attributionDomains, @container: @set}} to @context and the bare attributionDomains key; expanded inside an activity it adds the toot IRI. clone is overridden so a copy keeps the list (Fedify clones through new this.constructor). The actor dispatcher, the stored-actor-id route in mount.ts and the WordPress-path dispatcher all serve userActor, so all three carry it. delivery.updateActor now sends an ActorUpdate: Fedify compacts the activity with contexts that know toot: but not the term, giving object['toot:attributionDomains'], which Mastodon would not read and would treat as an empty list; ActorUpdate renames it to the term and adds the definition (same RDF).

Verified: pnpm build, test (3103 + 30 pass), typecheck, lint, format:check clean. Failing first: federation.test.ts 'lists the site host as an attribution domain' (author URL and stored /?author=2 URL) and delivery.test.ts 'keeps the attribution domain on the actor it sends' failed with actual: undefined, expected: [ 'blog.example' ]; attributionDomainOf unit test covers dropping the port. Live: scratch site on port 3472 (baseUrl http://localhost:3472); curl -H 'Accept: application/activity+json' /author/ada/ answered 200 application/activity+json with attributionDomains ['localhost'] and the term in @context; jsonld 9.0.0 expansion with Fedify's preloaded contexts gave http://joinmastodon.org/ns#attributionDomains: [{@value: localhost}]. The delivered profile Update body expanded the same way (object attributionDomains ['blog.example']), and its RsaSignature2017 LD signature, which Mastodon checks, verified with Fedify's verifyJsonLd against the actor's own key, as it did on a control Update with no domains. Server stopped.

AC #2 and #3 not checked: they need a public deployment and a remote Mastodon instance, which this run did not have. Nothing was checked against a real Mastodon; the Mastodon behaviour above is read from its source.

2026-10-02, after 0.14.0 deployed: curl -H 'Accept: application/activity+json' https://shll.me/author/a/ | jq .attributionDomains returned ["shll.me"] on production. AC #2/#3 still wait on a Mastodon instance fetching the actor and a fresh link preview.

2026-10-02: me.dm toot https://me.dm/@andrewshell/117370013142466994 linking https://shll.me/: the API's card.authors lists account a@shll.me and the card shows 'More from Andrew Shell'. Mastodon only attaches that account when its attribution_domains include the link's host, so me.dm stored shll.me from the actor. AC #2 is proven by that effect; there was no console access to read Account#attribution_domains directly.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Every user's actor publishes attributionDomains with the site's hostname, under Mastodon's own term definition, and profile Updates keep the bare key so a save does not clear it. Verified by tests that failed first, JSON-LD expansion, curl of the production actor (['shll.me']), and a me.dm link preview of https://shll.me/ crediting a@shll.me.
<!-- SECTION:FINAL_SUMMARY:END -->
