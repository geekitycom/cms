# MCP

The site runs a Model Context Protocol (MCP) server, so an MCP client such as
Claude Code can call tools on the site as you. The server is at
`/_geekity/mcp`. It needs a token bound to that endpoint. You approve one on
the site's consent screen, or create one in the admin.

## Connect a client

A client connects in one of two ways. It signs in through the site's consent
screen and gets a token for the scopes you approve, or it sends a token you
create in the admin. The steps below use Claude Code.
[Other MCP clients](#other-mcp-clients) lists what any other client needs.

### Connect Claude Code by signing in

1. Add the site with its MCP URL:

   ```sh
   claude mcp add --transport http my-site https://example.com/_geekity/mcp
   ```

2. Run `/mcp` in Claude Code, choose the site, and choose to authenticate.
   Claude Code opens the site's consent screen in your browser. On a machine
   with no browser, run `claude mcp login --no-browser my-site` instead. It
   prints the address of the consent screen and asks you to paste the address
   your browser ends up on after you approve.
3. On the consent screen, sign in to the admin if you are not signed in.
   Claude Code asks for every scope in [Scopes](#scopes). Untick each scope
   you do not want the agent to have.
4. Choose **Approve**.

The connection is listed on Users > Connected apps under the name Claude
Code. Revoke it there to cut the agent off. To grant a scope you left out,
run `/mcp` again and sign in again.

### Connect Claude Code with a token you create

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

### Check the connection

Run `claude mcp list`. The site shows as `Connected` once Claude Code holds a
token the endpoint takes. Before you sign in, it shows `Needs
authentication`.

Then ask the agent to call `whoami`. It answers with the user the connection
acts as, the client name or token name, and the scopes the token holds.

### Other MCP clients

Any MCP client that speaks the Streamable HTTP transport can connect. It
needs:

- The URL, `https://example.com/_geekity/mcp`.
- The transport, Streamable HTTP. Some clients call it `http`. The server
  does not offer the older HTTP with SSE transport.
- One way to get a token. Either the client signs in by OAuth, using the
  discovery in [How a client finds where to sign in](#how-a-client-finds-where-to-sign-in),
  or you give it a token you create, sent as `Authorization: Bearer <token>`.

A client that signs in must name itself with a client metadata document URL
and use S256 PKCE. The site has no dynamic client registration, so a client
that can only register itself cannot sign in. Give that client a token you
create.

Many clients read servers from JSON in the shape of Claude Code's
`.mcp.json`. For a token you create:

```json
{
  "mcpServers": {
    "my-site": {
      "type": "http",
      "url": "https://example.com/_geekity/mcp",
      "headers": { "Authorization": "Bearer <token>" }
    }
  }
}
```

Leave out `headers` for a client that signs in. A client that can start only
local stdio servers cannot connect to the site.

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
| `create`  | Create drafts as you.                                                          |
| `update`  | Read and edit your posts. Editing a published post also needs `publish`.       |
| `media`   | Upload media.                                                                  |
| `publish` | Publish drafts and change posts that are already public.                       |
| `inspect` | Read the site's federation and delivery records, inbox and followers included. |
| `repair`  | Resend posts, retry failed deliveries and refresh remote actors.               |

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
| `remote_lookup`     | `inspect` | Fetches a handle's WebFinger result and the actor it names, or the object at a URL, signed as a local user, with each status, the headers that matter and the body.           |
| `resend_post`       | `repair`  | Queues the `resend` job for one post, as the Resend button on the federation screen does.                                                                                     |
| `retry_deliveries`  | `repair`  | Finds the deliveries that failed for a post, at an inbox, or both, and queues a job that sends each post again to those recipients only.                                      |
| `refresh_actor`     | `repair`  | Fetches a remote actor again and updates each follower record of it with the inbox, shared inbox, name and avatar it publishes now.                                           |
| `create_draft`      | `create`  | Writes a new post as a draft through the Micropub create path, for any kind Micropub covers. Never publishes, federates or sends webmentions.                                 |
| `get_post_source`   | `update`  | One of your posts as Micropub `q=source` answers it: its type and properties, and the `hash` that `update_post` needs.                                                        |
| `update_post`       | `update`  | Changes named properties of one of your posts, as a Micropub update does. A published post also needs `publish`.                                                              |
| `publish_post`      | `publish` | Publishes one of your drafts as the editor's Publish button does: it goes public, federates a `Create` and sends its webmentions.                                             |
| `upload_media`      | `media`   | Stores a base64-encoded file in the media library with its alt text, and answers its address.                                                                                 |

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

`remote_lookup` shows the other side of a federation problem: what a remote
server answers the site. Given `@user@host`, it asks the host's WebFinger
endpoint for the handle and then fetches the ActivityPub actor the answer
links with `rel="self"`. Given an `http` or `https` URL, it fetches the actor
or object at that URL. The actor or object fetch is an HTTP Signature GET,
signed with the RSA key of a local user, so servers in authorized fetch mode
answer as they answer the site. By default the tool signs as the site author,
or as the first user when the site has several authors. To sign as another
user, give that user's username as `actor`. The WebFinger request is not
signed. The answer has one entry for each request. Each entry gives the URL
asked for, the URL that answered after redirects, the HTTP status, the
response headers that matter for debugging, and the body. The body is in
`json` when it is a JSON object and in `text` when it is not. A server's
refusal, such as 401 or 410, is part of the answer and not a tool error.

`remote_lookup` makes outbound requests, so it is annotated `openWorldHint`
and has these limits:

- It reaches public addresses only. It refuses loopback, private,
  link-local and reserved addresses, written as an IP address or resolved
  from a name, and it checks every redirect hop the same way. It does not
  follow the federation's `allowPrivateAddress` setting.
- It stops after 10 seconds, for WebFinger and the object fetch together.
- It reads at most 256 KiB of each body and sets `truncated` when it cuts
  a body short.

The tools cannot show the access log, which is written only to standard
output, or refused inbox signatures, which are only logged. See
[Federation](federation.md).

### The repair tools

The `repair` tools fix the common federation problems that the `inspect`
tools find. They change what the site has sent or stored, so each one is
annotated with `readOnlyHint` set to false and `openWorldHint` set to true. None
of them removes anything, so `destructiveHint` is false. Each one is
annotated `idempotentHint`, because a second call does not add more work:

- A second `resend_post` or `retry_deliveries` call while the first job waits
  or runs queues nothing. The answer names the job that waits or runs.
- After a retry job finishes, `retry_deliveries` finds only the deliveries
  that failed again.
- A second `refresh_actor` call writes the same records again.

`resend_post` and `retry_deliveries` do not send anything during the call.
They queue a job on the jobs queue, which the server runs one at a time (see
[Admin jobs](configuration.md#admin-jobs)), and answer with the job's id and
state. The deliveries go through the federation queue, which records each
outcome as it settles. Read the outcomes with `post_federation`, or read the
job with `federation_status`.

`resend_post` names a post by its slug, its permalink, or any object id it
was federated under. It queues the same `resend` job, with the same payload,
as the Resend button on a post's row on the federation screen. The job sends
the post as it reads now: an `Update` when followers have it, a `Create` when
it was never announced, and a `Delete` when it is a draft or in the trash.
The job also sends the post's webmentions again unless `webmentions` is
false. See [Federation](federation.md) for what a resend sends.

`retry_deliveries` takes a `post`, an `inbox`, or both. It finds each
recipient whose newest delivery about a post has the status `failed`. A
delivery that is `queued` or `retrying` is still in the federation queue, so
the tool skips it. The newest delivery to a recipient counts across every
inbox the recipient was sent to. So, with `inbox`, a recipient that failed at
that inbox and was later reached at a new inbox is not retried. The answer
lists each post and its recipients with the recorded error. The tool then
queues a `retry-deliveries` job. When the job runs, it reads the failures
again and sends each post as it reads now, to those recipients only. A
recipient whose newest `Create` for the post failed never stored the post, and
a server such as Mastodon drops an `Update` of a status it does not hold. So
that recipient is sent the `Create` again, and the answer marks it with
`missedAnnouncement`. The other recipients are sent an `Update`, as a resend
would. Each recipient gets the post at the inbox its follower record names at
that time.
The job waits 2 seconds between posts, so that many posts to one server do
not trigger the server's bot protection. Activities that are not about a
post, such as a profile `Update`, are not retried.

`refresh_actor` takes an actor id. It fetches the actor document, signed as
the site's first user, and updates every follower record of that actor in
`followers.json` and in the database. Each record gets the inbox, the shared
inbox, the name and the avatar that the actor publishes now, and keeps the
time of the follow. When the site stores a profile for an actor that is not a
follower, the tool updates that profile too. Run it when deliveries to a
follower fail because the follower's server moved its inbox. Then run
`retry_deliveries` to send the posts that failed. A changed key needs no
refresh: when a signature does not verify with the cached key, Fedify fetches
the key again.

### The authoring tools

The authoring tools write posts through the same code as Micropub and the
editor, so a post from an agent is the same file that a Micropub client or
the editor writes, and it federates the same way. Posts use the Micropub
property mapping: `properties` holds each microformats2 property as a list of
values, such as `{"content": ["Hello"], "category": ["a", "b"]}`. Every kind
of post that Micropub takes works, including notes, articles, photos,
replies, likes, reposts, bookmarks, RSVPs, events and reviews. A tool acts
only on posts that are yours or that name no author the site knows, as
Micropub does.

An agent that reads untrusted pages can be steered by prompt injection. So
`create_draft` always writes a draft, and making a post public needs the
`publish` scope, which you grant on the consent screen as its own box:

- `create_draft` takes an optional `type` (`h-entry` unless given, or
  `h-event` or `h-review`) and `properties`. It refuses a `post-status`
  other than `draft`. A draft is not served, federated or mentioned.
- `get_post_source` answers what Micropub `q=source` answers for the post,
  and the post's `hash`.
- `update_post` takes the post, the `hash` from `get_post_source`, and the
  changes: `replace` and `add` as Micropub has them, `delete` as a list of
  property names to take away, and `deleteValues` for values to take out of
  a property. Every other property stays as it is. When the post changed
  after it was read, the tool writes nothing and answers with an error. Read
  the post again and retry. Changing a published post publishes: the post is
  stamped updated, federates an `Update` and sends webmentions. Setting
  `post-status` to `published` publishes a draft. Either one needs the
  `publish` scope as well as `update`, and is refused with 403 and an
  `insufficient_scope` challenge without it.
- `publish_post` publishes a draft as it reads now. It is annotated with
  `destructiveHint` set to true, because the post becomes public and goes to
  your followers. A post that is already published is left as it is.
- `upload_media` takes a `filename`, whose extension says what the file is,
  the file's bytes as base64 in `data`, and optional `alt` text. The media
  library's rules apply, as for the admin's uploads and the Micropub media
  endpoint: the allowed types, the size limits and the removal of location
  data. The answer is the file's address, to use as a `photo` value or in a
  post's content. The request body limit in [The transport](#the-transport)
  is sized to fit the largest file.

Words written through these tools do not count toward anyone's writing
goal. See [Writing goals](writing-goals.md#what-counts-as-writing).

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

## Debug federation from an agent

An agent with the `inspect` scope can answer a federation question from the
site's own records, and with `repair` it can fix the common causes. Ask in
plain words, such as "my reply to @alice@social.example did not show on her
server, find out why". These tools answer it, in this order:

1. `federation_status` lists the messages waiting in the federation queue,
   the retrying deliveries, recent failures and the newest jobs.
2. `post_federation` with `post` set to the post's slug or permalink shows
   the object a peer gets for the post, every activity sent about it, and each
   delivery with its error. Add `status: "failed"` to list only the failures.
3. `inbox_search` shows what came in from the other side. Filter by `actor`
   for one remote account, or by `inReplyTo` with the post's id for the
   replies that reached the site.
4. `remote_lookup` with `target` set to `@alice@social.example` shows what
   her server answers the site, such as an actor whose inbox moved, or a 401
   or 410.
5. When deliveries to a follower fail because their server moved its inbox,
   `refresh_actor` with `actor` set to their actor id stores the inbox the
   actor publishes now.
6. `retry_deliveries` with `post`, `inbox`, or both queues a job that sends
   the post again to each recipient whose newest delivery failed.
7. `post_federation` again, once the job has run, shows each delivery's new
   status.

## Write and publish a post from an agent

An agent with the `media`, `create` and `update` scopes can write a draft.
Publishing it needs `publish` as well. To keep the last step yourself, leave
`publish` unticked and publish the draft from the editor.

1. `upload_media` with `filename`, the file as base64 in `data`, and `alt`
   stores an image and answers its address.
2. `create_draft` with `properties` writes the draft and answers its `url`
   and `slug`. Put the image address in `photo`, as in
   `{"content": ["Text"], "photo": ["<address>"]}`. The draft is not
   served, federated or mentioned.
3. Review the draft in the editor, or ask the agent to read it with
   `get_post_source`, which answers the properties and the `hash`.
4. `update_post` with `post`, that `hash`, and the changes, such as
   `{"replace": {"content": ["New text"]}}`, edits the draft.
5. `publish_post` with `post` makes the draft public. The site federates a
   `Create` and sends the post's webmentions.

With `@geekity/plugin-umami` enabled, an agent with `inspect` can then ask
how a post did. `geekity_plugin_umami__post_stats` takes `path`, the post's
permalink such as `/2026/10/hello/`, and `days`, 30 unless given. It answers
views, visitors, visits and the top referrers, beside the same number of days
before.

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

A request body can be as large as an `upload_media` call that carries the
largest file the site accepts: the base64 length of the larger of
[`uploadMaxBytes` and `uploadMediaMaxBytes`](configuration.md#uploads-and-images),
plus 8 KiB. With the default limits, that is about 267 MiB. The server answers
a larger body with 413 and does not parse it. It checks the `Content-Length`
header first. A body that has no `Content-Length` is read only up to the limit.
The server checks the bearer token before it reads the body, so a request with
no valid token gets 401 and its body is not read.

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
