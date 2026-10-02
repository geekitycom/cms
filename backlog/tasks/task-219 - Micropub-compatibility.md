---
id: TASK-219
title: Micropub compatibility
status: To Do
assignee: []
created_date: '2026-10-02 18:44'
updated_date: '2026-10-02 18:59'
labels:
  - micropub
  - indieauth
  - interop
dependencies: []
references:
  - 'https://github.com/gRegorLove/indiebookclub'
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

## Decision: visibility (2026-10-02)

Support public and unlisted. Skip private.

- public: what the site does today. Accept visibility=public as a no-op.
- unlisted: build it properly. Split isPublicDocument (packages/cms/src/web/documents.ts:20), which today decides both served and listed, and the SQL predicate the content index answers with, into two rules: served and listed. An unlisted post keeps its page (with noindex) and drops out of the home page, archives, tag and category pages, feeds, sitemap, search, llms.txt and IndexNow. It federates with to: followers and cc: Public (the swap of today's to: Public, cc: followers in packages/cms/src/federation/article.ts:230), so Mastodon shows it as unlisted. Webmentions still go out, since the page is public. Micropub accepts visibility=unlisted, the admin editor gets the same choice, and q=source and update round-trip it.
- private: refused with a message saying the site has no private posts, not the generic 'does not understand'. Not built because: the website cannot tell a visitor who follows from one who does not, so a followers-only post could have no public page and every public path would have to skip it; the content is Markdown files that may sit in a public git repo, so a private post would not be private; and Micropub's 'private' (only the author) and Mastodon's 'private' (followers-only) mean different things. Revisit only after deciding the content directory can hold non-public posts.
- Advertise the accepted values in q=config as visibility: ["public", "unlisted"], the micropub-extensions convention, alongside the per-type property lists proposed above.

## indiebookclub (indiebookclub.biz, 2026-10-02, shll.me on 0.16.0)

Result: sign-in works. Posting fails with 400: {"error":"invalid_request","error_description":"This endpoint does not understand read-status, read-of, visibility."}

What it sends, from its source (build_micropub_request, app/Controller/IbcController.php:664, and its documentation page), always as JSON:
- summary: a human sentence, e.g. 'Want to read: Title by Author, ISBN: 123'
- read-status: to-read, reading or finished
- read-of: an embedded h-cite object, not a URL: {type: [h-cite], properties: {name, author?, uid?}}, where uid is 'isbn:...' or 'doi:...'
- post-status: published or draft
- visibility: always sent, whatever the user picked, so it fails even when only public is offered
- published and category when given
No content and no name.

Causes:
1. visibility: covered by the visibility decision above. Accepting visibility=public fixes this part. indiebookclub reads 'visibility' from q=config (AuthController.php:215) at sign-in to decide which values to offer, so advertising ["public", "unlisted"] there shapes its form too.
2. read-of and read-status: the read post type (IndieWeb 'read' posts) is not modelled. PostType has no read, createForm has no mapping, and TASK-169's citations (like-of, repost-of, bookmark-of) take a URL, while read-of is an h-cite object with a name, an author and an ISBN or DOI uid, usually with no URL.
3. Body: with no content, the only text is summary, which createForm maps to the description. Once read-of is accepted, the page would print an empty body unless the theme renders the read itself.

Proposed fix: a read post type.
- Front matter: read-of as {name, author?, uid?, url?} and read-status as one of to-read, reading, finished, set from Micropub and from the admin editor.
- Post Type Discovery gains read (read-of present), checked where the other citing types are.
- The default theme prints the IndieWeb markup indiebookclub itself uses: <data class="p-read-status" value="to-read">Want to read</data> and a p-read-of h-cite with p-name, p-author and p-uid (an ISBN linked if the site wants). q=source and update round-trip both.
- Federation: a Note whose content is the same sentence the page prints. A read has no fediverse object to Like or Announce.
- Advertise read in q=config post-types, with its property list, so clients that read the list know it is accepted.
<!-- SECTION:NOTES:END -->
