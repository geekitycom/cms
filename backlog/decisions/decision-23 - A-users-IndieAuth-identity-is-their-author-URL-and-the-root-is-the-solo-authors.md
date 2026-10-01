---
id: decision-23
title: >-
  A user's IndieAuth identity is their author URL, and the root is the solo
  author's
date: '2026-10-01 14:15'
status: accepted
---
## Context

An IndieAuth client takes the URL a person types, fetches it, and follows its `indieauth-metadata` link to the authorization server. Until TASK-157 Geekity published only `rel="me"` links, so signing in as a Geekity site depended on a third party such as GitHub through indielogin.com. decision-14 already gives every user a URL of their own at `/author/{username}/`. TASK-180 added the Solo author setting, which makes the homepage speak for the user the author setting names. TASK-192 folded that switch into the author setting itself (decision-25): a site whose `author` names a user is a solo author site. This decision settles which URLs are identities, how a typed URL maps to a user, and what a client is handed back.

## Decision

**Every user's identity is their author URL**, `{baseUrl}/author/{username}/`, on every site and whatever the settings say. It is the URL decision-14 makes their actor and their archive, so a person has one URL for following, reading and signing in.

**The site root is the identity of the site author, and only on a solo author site.** The root names a user when `author` in `site.json` resolves to a user, by the same rule that puts the author's bio and `rel="me"` claims on the homepage (`render.ts`). That is a solo author site; decision-25 records the shape. On a site with several authors, which has no `author`, the root names nobody.

**Nothing else is an identity.** That includes posts and pages, a second page of an archive, feeds, `/@name`, and a stored ActivityPub id such as `?author=2`. A stored actor id is federation identity under decision-14. It is not a sign-in identity.

**A typed URL is canonicalised before it is matched.** It must parse as an absolute `http` or `https` URL. Its host is compared without case and with a leading `www.` taken off both sides. Its port must be the base URL's. It may carry no username, password, query or fragment. Its path must sit under the base URL's path, and a missing trailing slash is added. So `http://www.example.com` and `https://example.com/` are the same URL, and `https://example.com/author/ada` is `https://example.com/author/ada/`. The matching is lenient because a typed URL is only a hint: the server always hands back a canonical URL, and the client checks that URL by discovery. `userForMe` in `src/indieauth/identity.ts` is the rule, and its tests are the table.

**The me handed back is always canonical and always built from the base URL.** When the URL the person typed resolves to the user who signs in, that URL is the answer. The root is the answer for the solo author who typed the root. Otherwise the answer is the signed-in user's author URL.

**The root is advertised on every site.** On a multi-author site, a person who types the root still reaches this server and signs in as whoever they log in as. The client is handed that user's author URL, which shares the host and advertises the same server, so the client accepts it under the IndieAuth spec's rule for a differing profile URL.

**One metadata document, two URLs.** The document is at `/_geekity/indieauth/metadata`, which identity URLs advertise, and at RFC 8414's `/.well-known/oauth-authorization-server`, which generic OAuth and MCP clients probe. Its issuer is the base URL with no trailing slash, the one issuer whose RFC 8414 well-known URL is exactly that path. The `Link` header and the `<link>` in the head are added to the response by the CMS rather than printed by a layout, so every theme carries them. Besides the authorization and token endpoints, the document names the introspection, revocation and userinfo endpoints and sets `client_id_metadata_document_supported`, so an MCP client can identify itself by a client metadata URL without dynamic registration. Resource servers point refused clients at a second document, `/.well-known/oauth-protected-resource`, which names the whole site as the resource and this server as its authorization server.

## Consequences

- A person types their site URL on a solo author site, and their author URL anywhere.
- Choosing Several authors for Site author on Settings > General takes the root's identity away. A client that stored the root as somebody's me is handed their author URL at the next sign-in, which it may treat as a different account. Choosing a user does the reverse, and choosing a different user moves the root's identity to them.
- Changing the base URL changes every identity, as it changes every actor id.
- In maintenance mode the identity URLs, the metadata and every IndieAuth endpoint answer 503, so no client can start or finish a sign-in. The consent screen stays reachable because `/admin` is exempt, but nothing can reach it from a client.
- A resource server with its own identifier, such as an MCP endpoint at `/mcp`, needs its own protected resource document under `/.well-known/oauth-protected-resource/`.
