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

| Tool     | Scope     | What it does                                                                     |
| -------- | --------- | -------------------------------------------------------------------------------- |
| `whoami` | `profile` | Names the user the connection acts as, its client or token name, and its scopes. |

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
  version, the endpoint, the transport, how to authenticate, and the tools. The
  server card is a draft convention and may change.
- The home page sends `Link: </.well-known/mcp/server-card.json>; rel="mcp"`.
- The generated [`/llms.txt`](public-site.md#llmstxt) names the endpoint and
  the server card.
