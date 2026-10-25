# MCP

The site runs a Model Context Protocol (MCP) server, so an MCP client such as
Claude Code can call tools on the site as you. The server is at
`/_geekity/mcp`. It needs a token that you approve on the site's own consent
screen.

## Connect Claude Code

Add the site with its MCP URL:

```sh
claude mcp add --transport http my-site https://example.com/_geekity/mcp
```

Then run `/mcp` in Claude Code and choose the site to sign in. Claude Code
opens the site's consent screen in your browser. Sign in to the admin if you
are not signed in, untick each scope you do not want the agent to have, and
approve.

### With a token you create

A client that cannot sign in, or a machine where you would rather paste a
token, can use a token you create in the admin:

1. Open Users > Connected apps, at `/admin/users/apps`.
2. Under Create a token, enter a name such as Claude Code on my laptop.
3. Under Works with, choose MCP. A Micropub token does not work at the MCP endpoint.
4. Tick the scopes the agent needs, and choose when the token expires.
5. Choose Create token, and copy the token. The site shows it once.

Then add the site with the token in an `Authorization` header:

```sh
claude mcp add --transport http my-site https://example.com/_geekity/mcp \
  --header 'Authorization: Bearer <token>'
```

The token is listed on Connected apps with the badge For MCP. Revoke it there
to cut the agent off.

## How a client finds where to sign in

A request with no token, or with a token the endpoint does not take, gets
401 with a `WWW-Authenticate: Bearer` header. Its `resource_metadata` names
`/.well-known/oauth-protected-resource/_geekity/mcp`. That RFC 9728 document
names the MCP endpoint as the resource, the site as its authorization server,
and the scopes the tools use.

The client signs in at the site's IndieAuth server, which
[Signing in with your own site](indieweb-sign-in.md) describes. The server has
no dynamic client registration. A client names itself by the URL of its client
metadata document, which the authorization server metadata advertises with
`client_id_metadata_document_supported`. Every client must use an S256 PKCE
challenge.

## Which tokens the endpoint takes

The endpoint is a resource of its own, `{base}/_geekity/mcp`. It takes only a
token issued for that resource. It refuses a token issued with no resource and
a token issued for the site, which is what a Micropub app holds. A token issued
for the MCP endpoint does not work at Micropub.

## Scopes

Each tool needs one scope. The registry checks the scope before the tool runs.
The scopes are fixed by the CMS. A plugin's tool picks one of them and cannot
add its own. decision-64 records the set.

| Scope     | What it allows                                                                 |
| --------- | ------------------------------------------------------------------------------ |
| `profile` | Your name, URL and photo. `whoami` needs it.                                   |
| `create`  | Create posts as you.                                                           |
| `update`  | Edit your posts.                                                               |
| `media`   | Upload media.                                                                  |
| `publish` | Publish drafts and change posts that are already public.                       |
| `inspect` | Read the site's federation and delivery records, inbox and followers included. |
| `repair`  | Resend posts and retry federation deliveries.                                  |

A tool call whose token lacks the scope gets 403 with
`WWW-Authenticate: Bearer error="insufficient_scope"`. Its `scope` names the
scopes the token holds and the one it lacks, so the client can ask you for
them in one sign-in. The body is a JSON-RPC error that names the missing scope.

## Tools

| Tool                | Scope     | What it does                                                                                                                                                                  |
| ------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `whoami`            | `profile` | Names the user the connection acts as, its client or token name, and its scopes.                                                                                              |
| `federation_status` | `inspect` | Each user's actor with its follower count and key files, relays by state, messages waiting in the federation queue, retrying deliveries, recent failures and the newest jobs. |
| `inbox_search`      | `inspect` | Searches the inbox log. Each row names the site post it was about, or null when no post has that id. Returns each activity's full JSON with `includeJson`.                    |
| `post_federation`   | `inspect` | For one post: the object a peer gets when it fetches the post's id, every activity sent about it, and each delivery with its error.                                           |
| `followers`         | `inspect` | The followers of the site's users, with the inbox and shared inbox each delivery goes to.                                                                                     |
| `relays`            | `inspect` | The relay subscriptions, their state, and the last delivery to each.                                                                                                          |
| `quote_approvals`   | `inspect` | The quotes of the site's posts that the site approved, from each user's `quotes.json`.                                                                                        |
| `webmentions`       | `inspect` | The webmentions one post sent, with each endpoint and error, or the webmentions it received.                                                                                  |

### The inspect tools

The `inspect` tools read what the site recorded and change nothing. Each one
is annotated `readOnlyHint`, declares an output schema, and answers with
structured content and a one-line summary. The inbox, the followers and the
deliveries hold other people's data, so every one of them needs the `inspect`
scope, and none of them is public.

They share one convention for lists:

- `limit` (1 to 100, 20 by default) and `offset` choose the page.
- Each answer carries `total`, the number of matches across every page, and
  `nextOffset`, the offset of the next page or `null` on the last one.
- `since` and `until` take an ISO 8601 date or instant wherever the records
  carry a time. `since` includes the instant and `until` excludes it.
- A filter on an id matches it exactly.

`post_federation` and `webmentions` name a post by its slug, its permalink,
or any object id it was federated under. `post_federation` builds the object
with the same code that answers a peer's fetch, so it shows the post as it
reads now. `peerState` says whether a peer gets the object, a `Tombstone`
with 410, or 404.

The tools cannot show the access log, which is written only to standard
output, or refused inbox signatures, which are only logged. See
[Federation](federation.md).

Enabled plugins add tools of their own. A plugin's tool name starts with the
plugin's prefix and `__`, such as `geekity_plugin_umami__post_stats` from
`@geekity/plugin-umami`, so it never collides with a core tool or with
another plugin's tool. Core checks the scope of a plugin's tool, counts the
call toward the rate limit, and records it, as it does for its own tools. When
a plugin is disabled, its tools leave the list and a call to one is refused.
When it is enabled again, they come back. The site does not need a restart.
The server sends no notice when the list changes, so a client sees the change
the next time it lists the tools.
[MCP tools](plugins.md#writing-a-plugin) in the plugin guide describes how a
plugin declares one.

| Tool                               | Plugin                  | Scope     | What it does                                                                                           |
| ---------------------------------- | ----------------------- | --------- | ------------------------------------------------------------------------------------------------------ |
| `geekity_plugin_umami__post_stats` | `@geekity/plugin-umami` | `inspect` | A post's views, visitors, visits and referrers over the last days, from Umami, beside the span before. |

## The record of tool calls

The site records every tool call, whichever tool it is, core or plugin. A tool
does not opt in: the registry records the call before it answers. Each entry
keeps:

- When the call came.
- The user it acted as.
- The app's `client_id`, or the name of a token you created.
- The connection it came through.
- The tool it named.
- The arguments, each value cut to 100 characters. An argument named
  `access_token`, `refresh_token`, `code`, `code_verifier`, `client_secret`,
  `password` or `cookie` is listed as sent but not recorded.
- How the call ended: it ran, the tool answered with an error, the tool
  failed on the server, the token lacked the scope, no tool has that name, or
  the call was over the rate limit.

A tool that fails on the server answers the client with a tool error that
says so, and the entry keeps the reason. The client does not see the reason.

Users > App activity, at `/admin/users/activity`, lists the calls with the
IndieAuth and Micropub requests, under the endpoint MCP, the tool as the
action. Choose a call's time to see its arguments and its outcome. Users >
Connected apps lists each connection's five latest requests and tool calls
under Recent activity.

The record holds the last 500 calls from the past 14 days, in
`data/mcp-activity.json`, mode `0600`. An older call is dropped when the next
one is written, and is never shown. It is a separate file from the IndieAuth
and Micropub requests, so an agent's calls never push a failed sign-in out of
the record. Writing the record never changes or delays the answer the client
gets.

## Rate limit

Each token may make 60 tool calls a minute. The minute starts at the token's
first call. A call over the limit is not run. It gets a JSON-RPC error with
code `-32002`, a message that says how many seconds to wait, and
`data.retryAfter`, the same wait in seconds. The HTTP status is 200. Each token
has its own limit, so one agent's loop does not stop another connection.

The record keeps the first refused call in each minute, not every one, so a
client that keeps calling cannot fill the record. The limit is kept in memory,
and a restart clears it. `initialize`, `tools/list` and `ping` are not limited.

## The transport

The server uses MCP's Streamable HTTP transport and keeps no session. Each
`POST` carries one JSON-RPC message and is answered with one JSON object, or
202 for a notification. `GET` and `DELETE` answer 405, because the server opens
no stream and keeps no session to end. A request with an `Origin` header from
another origin gets 403. A request whose `MCP-Protocol-Version` header names a
version the server does not speak gets 400. The server speaks 2025-11-25,
2025-06-18 and 2025-03-26. Claude Code 2.1 first tries a newer revision, gets
the 400, and then connects with `initialize` at 2025-11-25.

In maintenance mode the endpoint answers 503, like the authorization and token
endpoints.

## Discovery

- `/.well-known/mcp/server-card.json` describes the server: its name and
  version, the endpoint, the transport, how to authenticate, and the tools,
  those of enabled plugins included. The server card is a draft convention and
  may change.
- The home page sends `Link: </.well-known/mcp/server-card.json>; rel="mcp"`.
- The generated [`/llms.txt`](public-site.md#llmstxt) names the endpoint and
  the server card.
