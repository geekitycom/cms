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

**Tokens live in `data/indieauth-tokens.json`, written 0600 like `users.json`.** The file holds one record per connection, meaning one approval of one client: an id, the user, the me URL, the client, the client's name when its metadata gave one, the scopes, the resource when one was named, when the person approved it, when a resource server last accepted it, and for each of the access token and the refresh token a SHA-256 hash and an expiry. The tokens themselves exist only in the response that hands them out. A token is 32 random bytes, so an unsalted hash cannot be reversed by guessing. Writes go through `updateFileAtomically`, and each write drops connections whose refresh token has expired. `src/indieauth/tokens.ts` owns the file.

**An access token works for seven days.** The answer carries `expires_in`. Seven days is short enough that a leaked token stops working on its own and long enough that a Micropub client that never refreshes asks the person to sign in again about once a week rather than every hour.

**Every token comes with a refresh token, and a refresh rotates both.** A refresh token works for 60 days from its own issue, so a client that refreshes at least that often stays connected indefinitely, and one left unused for two months is forgotten. A refresh replaces both hashes in the same record, so the old access token and the old refresh token stop working at once, and the connection keeps its id and approval time for the connected-apps screen (TASK-162). The refresh must come from the client the token was issued to. The scopes and resource stay those the person approved; a `scope` in a refresh request is ignored, and the answer names the scope the token holds.

**A token is bound to the resource it was approved for.** A token issued with a `resource` is accepted only by the resource server with that identifier. A token issued with none is accepted only by a resource server that opts in to unbound tokens: the Micropub endpoint will, because Micropub clients do not send `resource`, and the MCP endpoint will not. A `resource` at the token request must equal the one the person approved.

**A code approved with no scope earns no token**, as the IndieAuth spec requires. It can still be redeemed for the profile at the authorization endpoint.

**Deleting a user revokes every token they hold.** `deleteUser` does it, so every caller of it does.

**Authorization codes and pending consents stay in memory.** A code lives five minutes and a pending consent thirty, each is single use and keyed by 32 random bytes, and neither is written to `data/`. decision-9 covers state that must survive; a restart that drops one costs the person a retry, not a connection. `src/indieauth/grants.ts` owns them.

**Last use is written at most once an hour per connection.** `requireBearer` records it after accepting a token, and `recordUse` rewrites the file only when the stored `lastUsedAt` is missing or more than an hour old, so a busy client costs one write an hour, and the time survives a restart. It updates the record inside the current file, so it never brings back a connection revoked during the request.

**A connection can be revoked by a token or by its id.** `revokeToken` takes either the access or the refresh token, for RFC 7009 revocation, which always answers 200. `revokeConnection` takes a record id and the user's id, for the connected-apps screen, which shows the refresh expiry as the date a connection lapses. Both check the file first, so an unknown token or id writes nothing.

**Introspection answers only for the caller's own tokens.** The request must carry a live token of its own, and a token held by another user is reported `active: false`. This needs no new secret, at the cost that an outside resource server cannot introspect a user's tokens with a token of its own.

## Consequences

- Backup still means copying `data/`. Deleting `geekity.db` loses no token.
- A token check reads the file on each request, as the users file is read. That is fine at blog scale. Recording last use adds at most one write an hour per connection.
- A connected app's name is the one its metadata gave at consent. An app that renames itself shows its old name until it is approved again, and a record with no name shows the client id URL.
- A client that cannot refresh and is left idle for a week must sign in again.
- A refresh token presented a second time is refused, but its connection is not revoked. Reuse detection would need the spent hashes kept, and can be added if a client is ever seen leaking one.
- Changing either lifetime affects only tokens issued afterwards, because each record stores its own expiry.
