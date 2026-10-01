---
id: decision-24
title: >-
  IndieAuth tokens are hashed in data/indieauth-tokens.json, live seven days,
  and rotate on refresh
date: '2026-10-01 14:50'
status: accepted
---
## Context

TASK-160 adds the token endpoint, where a Micropub or MCP client redeems an approved code for a bearer token. Three questions were left open: where an issued token is kept, how long it works, and whether the site issues refresh tokens. decision-9 makes files the truth for irreducible state and the database a cache that may be deleted. A token is irreducible: a client that holds one cannot be handed it again, so losing the store signs the person out of every app.

Micropub clients such as Quill were written for servers whose tokens never expire, and many never refresh. MCP clients follow OAuth 2.1, which expects short-lived access tokens and rotating refresh tokens, and the MCP spec requires a resource server to accept only tokens issued for it (RFC 8707).

## Decision

**Tokens live in `data/indieauth-tokens.json`, written 0600 like `users.json`.** The file holds one record per connection, meaning one approval of one client: an id, the user, the me URL, the client, the scopes, the resource when one was named, when the person approved it, and for each of the access token and the refresh token a SHA-256 hash and an expiry. The tokens themselves exist only in the response that hands them out. A token is 32 random bytes, so an unsalted hash cannot be reversed by guessing. Writes go through `updateFileAtomically`, and each write drops connections whose refresh token has expired. `src/indieauth/tokens.ts` owns the file.

**An access token works for seven days.** The answer carries `expires_in`. Seven days is short enough that a leaked token stops working on its own and long enough that a Micropub client that never refreshes asks the person to sign in again about once a week rather than every hour.

**Every token comes with a refresh token, and a refresh rotates both.** A refresh token works for 60 days from its own issue, so a client that refreshes at least that often stays connected indefinitely, and one left unused for two months is forgotten. A refresh replaces both hashes in the same record, so the old access token and the old refresh token stop working at once, and the connection keeps its id and approval time for the connected-apps screen (TASK-162). The refresh must come from the client the token was issued to. The scopes and resource stay those the person approved; a `scope` in a refresh request is ignored, and the answer names the scope the token holds.

**A token is bound to the resource it was approved for.** A token issued with a `resource` is accepted only by the resource server with that identifier. A token issued with none is accepted only by a resource server that opts in to unbound tokens: the Micropub endpoint will, because Micropub clients do not send `resource`, and the MCP endpoint will not. A `resource` at the token request must equal the one the person approved.

**A code approved with no scope earns no token**, as the IndieAuth spec requires. It can still be redeemed for the profile at the authorization endpoint.

**Deleting a user revokes every token they hold.** `deleteUser` does it, so every caller of it does.

## Consequences

- Backup still means copying `data/`. Deleting `geekity.db` loses no token.
- A token check reads the file on each request, as the users file is read. That is fine at blog scale. TASK-162 records last use, and must do so without rewriting the file on every API call.
- A client that cannot refresh and is left idle for a week must sign in again.
- A refresh token presented a second time is refused, but its connection is not revoked. Reuse detection would need the spent hashes kept, and can be added if a client is ever seen leaking one.
- Changing either lifetime affects only tokens issued afterwards, because each record stores its own expiry.
