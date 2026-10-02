---
id: TASK-219
title: Micropub compatibility
status: To Do
assignee: []
created_date: '2026-10-02 18:44'
updated_date: '2026-10-02 20:45'
labels:
  - micropub
  - indieauth
  - interop
dependencies: []
references:
  - 'https://micropub.rocks/'
  - 'https://github.com/aaronpk/micropub.rocks/blob/main/app/Controller.php'
  - packages/cms/src/indieauth/request.ts
  - packages/cms/src/indieauth/discovery.ts
  - 'https://github.com/barryf/micropublish'
  - 'https://github.com/gRegorLove/indiebookclub'
  - 'https://github.com/inklings-io/inkstone'
  - 'https://getindiekit.com/introduction'
  - 'https://indieauth.spec.indieweb.org/'
  - 'https://github.com/aaronpk/Quill'
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

## Inkstone (inklings.io/inkstone, 2026-10-02, shll.me on 0.16.0)

Result: cannot sign in. Entering https://shll.me/ answers 'You do not seem to have a IndieAuth Endpoint.'

Cause, from its source (last commit 2017-12-28, indieauth/client ^0.1.16): the same two gaps as micropub.rocks.
1. Discovery. php/discoverEndpoints.php:17 calls discoverAuthorizationEndpoint, which looks only for rel="authorization_endpoint"; php/token.php:10 likewise for rel="token_endpoint". The site advertises only rel="indieauth-metadata".
2. PKCE. The authorization URL it builds (src/micropub.js:42) carries me, redirect_uri, state, client_id, scope and response_type=code, and no code_challenge, so parseAuthorizationRequest would refuse it even once discovery worked.

Pattern so far: two of four clients (micropub.rocks, Inkstone) predate PKCE and the metadata endpoint. Adding the legacy rels alone fixes neither; both also need an authorization request without PKCE to be accepted. That is a security trade-off to decide on its own: the current IndieAuth spec requires PKCE, and these are public clients, so accepting requests without it removes the protection against an intercepted code. If it is ever allowed, it should be narrow (for example, opt-in per site, and only for a client_id whose redirect_uri is on the same host) and documented as a legacy mode. The Create token proposal from the micropub.rocks entry does not help Inkstone, which has no manual token entry.

## Decision: no legacy IndieAuth (2026-10-02)

Clients that predate the IndieAuth metadata endpoint and PKCE are not supported. Inkstone's repository has issues open since 2016 and no commit since 2017; micropub.rocks pins an IndieAuth client from 2017. Supporting them would mean accepting authorization requests without PKCE, which the current spec requires.

- PKCE stays required.
- The legacy rel="authorization_endpoint" and rel="token_endpoint" links are dropped from the proposals too: without relaxing PKCE they help no client tried so far.
- Inkstone: closed as unsupported.
- micropub.rocks: its sign-in is unsupported. Its Manual tab (endpoint plus pasted token) still works with a token from a modern client, so the Create token proposal stays open as a testing and scripting aid, not as legacy support.

## iA Writer (2026-10-02, shll.me on 0.16.0)

Result: cannot sign in. 'IndieAuth Not Found: Make sure that IndieAuth meta tags of link headers are present.'

Cause (inferred from the message; iA Writer is closed source): it discovers the authorization endpoint through rel="authorization_endpoint" (and likely rel="token_endpoint") links and does not read rel="indieauth-metadata". The site publishes only the metadata link.

Unknown: whether iA Writer sends a PKCE code_challenge. Nothing public says. If it does, adding the two rel links is the whole fix and PKCE stays required. If it does not, it falls under the no-legacy decision.

This revisits one part of the no-legacy decision. iA Writer is maintained, unlike micropub.rocks and Inkstone. The current IndieAuth spec says a client should look for rel=authorization_endpoint and rel=token_endpoint for compatibility with earlier revisions, and Indiekit (getindiekit.com/introduction) publishes both beside indieauth-metadata 'for compatibility with older Micropub applications'. Publishing the links costs nothing and relaxes nothing: an authorization request without PKCE is still refused, with 'code_challenge must be an S256 PKCE challenge' on the redirect.

Proposed: publish rel="authorization_endpoint" and rel="token_endpoint" in the Link header and head beside rel="indieauth-metadata" (advertiseIdentityEndpoints in packages/cms/src/indieauth/discovery.ts), then try iA Writer again. Its next error settles the PKCE question.

## Quill (quill.p3k.io, 2026-10-02, shll.me on 0.16.0)

Result: sign-in works. A note with no image fails with 400: {"error":"invalid_request","error_description":"Send the access token in the header or the body, not both."}

Cause: our own refusal, added in c9add8f (TASK-170) for micropub.rocks test 805, which follows RFC 6750 section 3.1 strictly. Quill (maintained, last commit 2026-09-17) sends the token in the Authorization header and, on every form-encoded post, again as an access_token field (micropub_post, lib/helpers.php:157-163), on purpose: its comment links Quill issue #4 (2015) about servers that strip the Authorization header.

Fix: branch fix-accept-same-token-in-header-and-body. requireBearer accepts the same token sent both ways and refuses only two different tokens. Consequence: micropub.rocks 805 (same token both ways, expects refusal) now fails, and 802 now passes. Quill is the reference Micropub client; 805 only matters through micropub.rocks, whose sign-in is unsupported anyway.

## Quill follow-up (2026-10-02)

Decision: support Quill fully, as a maintained client that does modern IndieAuth with PKCE.

- Photo alt text: Quill sends photo: [{value, alt}] as JSON to a site with a media endpoint, already accepted (TASK-166). TASK-217 closed as not needed.
- p3k-content-type: refused today as an unknown property. Quill adds it to a note when its content-type selector is shown (views/new-post.php:849; shown by switchToMarkdown at :552 or the ctrl+shift+c easter egg), with text/plain or text/markdown. Proposed: accept it. text/markdown and text/plain both map to the Markdown body the site stores. Anything else (text/html) is refused with a message naming the type.
- Token in header and body: fixed in PR #95.
- A full inventory of every Quill editor's request against the create mapping follows.

## Quill inventory (2026-10-02, aaronpk/Quill 691cee2, read from source)

How Quill talks to the site: form posts carry the token in the header and as access_token (fixed by PR #95); JSON posts and media uploads carry it in the header only; media uploads use field 'file' (accepted). From q=config Quill reads syndicate-to {uid,name} (works), media-endpoint (so the note editor uploads first and posts only URLs), post-types (it hides its event, weight, itinerary and review editors when not listed), and visibility (the exact key; we send none, so its Visibility select never shows today).

Accepted today (once #95 lands): note content, name, in-reply-to, category, mp-syndicate-to, mp-slug, photo (URL or [{value, alt}]), published (Quill's 'YYYY-MM-DD hh:mm:ss +zz:zz' parses); article name, content (HTML string or [{html}], stored as HTML in the Markdown body), category, post-status=draft, published; bookmark-of with name and content; like-of; repost-of; editing likes and reposts through q=source (bare properties=like-of works) and JSON replace.

Gaps, most common first:
1. Token in header and body: PR #95.
2. Legacy field names: Quill accounts created before its migrations 0002/0004 send 'slug' and 'syndicate-to' instead of mp-slug and mp-syndicate-to, and get 'does not understand slug'. Fix: accept both as aliases.
3. Media q=source&limit=1: Quill's 'last photo' asks the media endpoint for {items: [{url, published}]} (controllers.php:87) and gets 400 'does not answer q=source', so it silently attaches nothing. media.ts answers q=last, which Quill does not use (its docstring is wrong). Fix: answer q=source with the stored last upload, with published, since Quill only applies its 15-minute freshness check when published is present (controllers.php:93); micropub-media.json needs the upload time.
4. p3k-content-type: sent when Quill's content-type selector is shown, automatically for a github.com reply containing a backtick, and on every Code post. Fix: accept text/plain and text/markdown (both land in the Markdown body); keep refusing code/* until a Code post type exists. Amends decision-27, since the property is accepted and not stored.
5. visibility: not sent until q=config advertises it; once advertised, Quill always sends the select's first value. Accept visibility=public in create and update before advertising visibility in q=config.
6. Photo without alt text on a requireAltText site: refused by policy. Typing alt text in Quill's photo modal makes it send JSON {value, alt}, which works. Docs only.
7. Legacy 'post' scope: Quill offers it as a radio at sign-in; request.ts drops it silently, so every create then fails insufficient_scope. Rare.

Need a data-model decision first (not filed): location (geo: URI from the note editor, opt-in in Quill), rsvp (replies to h-events; Post Type Discovery treats rsvp as its own type), code posts (p3k-content-type code/<lang>), and the editors Quill already hides for this site: event (h-event, sends some properties not in lists), review (h-review), itinerary, exercise, weight.
<!-- SECTION:NOTES:END -->
