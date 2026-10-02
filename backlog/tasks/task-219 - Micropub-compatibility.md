---
id: TASK-219
title: Micropub compatibility
status: To Do
assignee: []
created_date: '2026-10-02 18:44'
updated_date: '2026-10-02 18:50'
labels:
  - micropub
  - indieauth
  - interop
dependencies: []
references:
  - 'https://github.com/barryf/micropublish'
priority: medium
type: chore
ordinal: 235800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A running record of how real Micropub clients get on with a Geekity site, collected while testing 0.16.0 on shll.me. Each client tried gets an entry in the notes: what was tried, what happened, the cause, and a proposed fix. Once the picture is clear, the fixes are grouped into follow-up tasks. Related: TASK-170 (micropub.rocks and real clients, In Progress) and TASK-217 (Quill photo[value] and photo[alt]).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Each client tried is recorded in the notes with what worked and what failed
- [ ] #2 Each failure has a cause traced to code, on our side or the client's, and a proposed fix or a reason not to fix it
- [ ] #3 The fixes worth making are filed as follow-up tasks, and this task links them
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## micropub.rocks (2026-10-02, shll.me on 0.16.0)

Result: cannot sign in. Entering https://shll.me/ goes nowhere. The URL is right: the root sends Link: <https://shll.me/_geekity/micropub>; rel="micropub" and the same <link> in the head (checked with curl).

Cause, read from the micropub.rocks source (app/Controller.php:192, indieauth/client 0.4.1 from 2017):
1. Discovery. It calls discoverAuthorizationEndpoint and discoverTokenEndpoint, which look only for rel="authorization_endpoint" and rel="token_endpoint". The site advertises only rel="indieauth-metadata" (current IndieAuth spec), so it finds the Micropub endpoint and no auth or token endpoint, and stops.
2. PKCE. Even with those rels, the client sends no code_challenge. parseAuthorizationRequest (packages/cms/src/indieauth/request.ts:91) refuses a request without an S256 challenge, as the current spec requires. Relaxing PKCE is not proposed.

Also noted: it asks for scope 'create update delete undelete'. 'undelete' is not in SCOPES and is dropped silently; undelete uses the delete scope, so that is harmless.

Workaround: micropub.rocks has a Manual tab on its dashboard that takes an endpoint (https://shll.me/_geekity/micropub) and an access token. The admin has no way to mint a token, so today one has to come from a client that completes a modern IndieAuth sign-in.

The TASK-170 pre-flight missed this because it minted tokens with issueTokens directly instead of going through micropub.rocks's sign-in.

Proposed fixes:
- A Create token action on Users > Connected apps: pick scopes, show the token once, revoke like any connected app. Unblocks micropub.rocks's Manual tab, scripts, and old clients.
- Advertise rel="authorization_endpoint" and rel="token_endpoint" beside rel="indieauth-metadata" (Link header and head). Harmless; helps older clients that do send PKCE. Does not by itself fix micropub.rocks.

## Micropublish (micropublish.net, 2026-10-02, shll.me on 0.16.0)

Result: sign-in works. Posting a note fails with 400: {"error":"invalid_request","error_description":"This endpoint does not understand visibility."}

Cause:
- visibility (public, unlisted, private) is a micropub-extensions property, not in the W3C spec. Micropublish's form has a Visibility select (views/form.erb:425) with a blank first option. It only sends a field that has a value (Post.properties_from_params, lib/micropublish/post.rb:14), so the request carried visibility because a value was picked in the select.
- createForm (packages/cms/src/micropub/create.ts) refuses any property it cannot map, by decision-27. The site has no unlisted or private posts (no such concept in the code), so visibility is not mapped.

Why Micropublish offers the field: with no per-type property list in q=config, it shows its built-in default properties for each type (post_types in lib/micropublish/server.rb:466). Our q=config post-types entries carry only {type, name}. If an entry carries 'properties' (and 'required-properties'), Micropublish shows only those fields. That is the micropub-extensions post-types convention.

Proposed fixes:
- Advertise each post type's accepted properties in q=config post-types, built from the same table createForm maps from, so a client that reads it never offers a field the site would refuse. This covers visibility and any other unmapped field (location, checkin, rsvp) in one place, for Micropublish and any other client that reads the list.
- Accept visibility=public as a no-op, since every published post here is public. Refuse unlisted and private with a message that says the site has no unlisted or private posts, not the generic 'does not understand'. Optionally advertise visibility: ["public"] in q=config, the micropub-extensions way to say which values a server supports.
- Not proposed: mapping private to draft. A draft is unpublished, not private, and a client that sends private expects the post to exist.
<!-- SECTION:NOTES:END -->
