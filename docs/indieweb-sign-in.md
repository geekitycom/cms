# Signing in with your own site

Your site is your IndieAuth identity. Enter its URL in the sign-in form of an
IndieAuth client, such as indielogin.com or a Micropub app. The client sends
you back to your own site to sign in. No GitHub account or other `rel="me"`
provider is involved.

The URL you enter depends on the site:

- **Every user** can enter their author URL, `https://example.com/author/{username}/`.
- **On a site whose author is a user** (Site author on Settings > General),
  that user can enter the site URL, `https://example.com/`.
- **On a site with several authors** the site URL also works. You sign in as
  the user you log in as, and the client receives your author URL.

The site reads `http://`, a `www.` prefix, and a missing trailing slash as the
same URL. No other page of the site is an identity. decision-23 records the
rules.

The site root and every author archive advertise the site's authorization
server in two places:

- a `Link: <…>; rel="indieauth-metadata"` header
- a `<link rel="indieauth-metadata">` in the head

The CMS adds both to the response, so a custom theme does not need to print
them. The metadata document is served at `/_geekity/indieauth/metadata` and at
`/.well-known/oauth-authorization-server` (RFC 8414). Generic OAuth and MCP
clients look for it at the second URL.

The same pages also carry `rel="authorization_endpoint"` and
`rel="token_endpoint"`, in the `Link` header and in the head. They name the
same two URLs as the metadata document. Some Micropub apps, such as iA Writer,
look only for these older links and do not read the metadata. The IndieAuth
spec asks clients to check them for compatibility with earlier versions.

These links do not relax the PKCE rule. The site still refuses a sign-in
request that has no S256 PKCE `code_challenge`. An app that sends none cannot
sign in unless you list it under
[Apps allowed without PKCE](#apps-allowed-without-pkce).

When a client sends you to the site, you sign in to the admin if you are not
signed in already. You then see a consent screen. It shows:

- the app's name, or its URL when the app publishes no name
- the host the app will send you back to
- the URL you are signing in as
- each piece of information the app asks for

Untick anything you do not want to share, then choose Approve or Deny. You can
sign in only as yourself. If the URL names another user, the site replaces it
with your own author URL.

The site reads the app's details from its `client_id` URL. That URL can be an
IndieAuth `h-app` page or a JSON client metadata document, such as MCP clients
publish. The app can send you back only to its own origin or to an address it
lists in those details. For an `http` address on `localhost`, `127.0.0.1`, or
`[::1]`, the port is not compared, as RFC 8252 asks: an app on your own
computer, such as Claude Code, lists `http://localhost/callback` and listens on
whatever port is free. While the site is in maintenance mode, the sign-in
endpoint answers 503, as do the URLs that advertise it.

After you approve, the app posts the code it received back to the same
endpoint, with its PKCE verifier. In exchange it gets the URL you signed in as.
It also gets your name, URL, and profile picture if you left profile ticked,
and your email address if you left email ticked. It gets no access token this
way. A code works once, for five minutes, and only for the app and return
address it was issued to.

An app that acts for you, such as a Micropub client, can also ask for the
scopes create, update, delete, and media. The consent screen lists these as
creating, editing, and deleting your posts, and uploading media. The app
redeems its code at `/_geekity/indieauth/token` instead, under the same rules.
It gets a bearer access token for the scopes you approved, with the URL you
signed in as and the same profile details.

- The access token works for seven days.
- It comes with a refresh token. The app can trade the refresh token for a new
  pair, which stops the old pair working.
- A refresh token lapses after 60 days without use.
- A code approved with no scope gets no token.

The site keeps only a SHA-256 hash of each token, in
`data/indieauth-tokens.json`. Only the site's own user can read the file. Back
it up with the rest of `data/`. Deleting `geekity.db` keeps every token.
Deleting a user revokes every token they hold. A token issued for one resource,
such as the [MCP endpoint](mcp.md), works only there. decision-24 records the
rules.

An MCP client can also ask for publish, inspect, and repair, which only MCP
tools use. The consent screen lists each scope with its own checkbox, so you
can grant them one by one. [MCP](mcp.md#scopes) lists what each allows.

An app sends its token in an `Authorization: Bearer` header, or in an
`access_token` form field as Micropub allows. RFC 6750 asks for one or the
other. Quill sends the same token both ways for servers that drop the header,
so the site accepts the same token in both. The site answers as follows:

| Request                                         | Response                                                                                        |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Two different tokens                            | 400 `invalid_request`                                                                           |
| No token, or an unknown, expired or revoked one | 401                                                                                             |
| A token without the scope the route needs       | `insufficient_scope`, with 401 on the Micropub and media endpoints and 403 on every other route |

The 401 on Micropub and media follows the
[Micropub spec's error table](https://www.w3.org/TR/micropub/#error-response).
The 403 elsewhere follows RFC 6750 section 3.1.

Each refusal carries a `WWW-Authenticate: Bearer` header. Its
`resource_metadata` points at `/.well-known/oauth-protected-resource`, or at
`/.well-known/oauth-protected-resource/_geekity/mcp` for the MCP endpoint. That
RFC 9728 document names the site as its own authorization server and lists the
scopes, so an MCP client can find where to sign in. The metadata document also
lists three more endpoints:

- `/_geekity/indieauth/userinfo` returns your name, URL, and profile picture
  for a token with the profile scope. It also returns your email address when
  the token has the email scope.
- `/_geekity/indieauth/revoke` ends the connection that a posted `token`
  belongs to, access or refresh. Both tokens stop working at once. It answers
  200 whether or not the token was live.
- `/_geekity/indieauth/introspect` says whether a posted `token` is live, and
  if so returns its `me`, `client_id`, `scope`, and `exp`. The request needs a
  live token of its own in the `Authorization` header. It answers only for
  tokens held by the same person and reports any other token as inactive.

All three, and the resource metadata, answer 503 in maintenance mode.

## Connected apps

Users > Connected apps, at `/admin/users/apps`, lists every app that holds a
token for you. Your own user screen links to it. You see only your own
connections, never another user's. Each row shows:

- The app's name, linked to its `client_id` URL. An app that published no name
  is shown by that URL.
- What it can do, in the words the consent screen used.
- When you connected it.
- When it last used its token. "Not yet" means it has not called the site
  since you approved it.
- When the connection expires if the app stops using it. An app that refreshes
  its token stays connected.

The site records last use when it accepts a token. It writes the time to
`data/indieauth-tokens.json` at most once an hour per connection. The time shown
can be up to an hour early. An app that calls the API many times a minute does
not rewrite the file each time.

Each row has a Revoke button that names the app. Revoking deletes the
connection:

- Its access token and its refresh token stop working at once.
- The app's next request gets 401 `invalid_token`.
- The screen shows a confirmation message.

To reconnect, the app must ask you again through the consent screen. With no
apps connected, the screen lists the kinds of app that connect here.

## Apps allowed without PKCE

The IndieAuth spec requires PKCE. The site refuses every sign-in request
without an S256 `code_challenge`. Some apps send none. iA Writer is one. It
finds the site's endpoints and is then refused with `code_challenge must be an
S256 PKCE challenge`.

The bottom of Users > Connected apps holds a list of apps that may sign in
without PKCE. The list starts empty. Any signed-in admin can add or remove an
app. The site stores the list in `content/_data/site.json` as
`clientsWithoutPkce`.

To let iA Writer sign in, add `https://ia.net/writer`. Enter the `client_id`
the app sends, as App activity shows it. The screen refuses anything that is
not a valid `client_id` URL. It also refuses an app already on the list.

The site lets a listed app in without PKCE only when all of these are true:

- The request carries neither `code_challenge` nor `code_challenge_method`.
  A request that sends a malformed challenge is still refused.
- Its `client_id` is on the list.
- Its `redirect_uri` is `https://` on the same host as the `client_id`. For
  iA Writer that is `https://ia.net/writer/indieauth/redirect`.

The site refuses any other request without PKCE, as before. The consent screen
tells you when an app does not use PKCE and is let in only because it is on the
list. App activity records the sign-in as allowed without PKCE.

The site marks the code from such a sign-in as issued without a challenge. The
token endpoint and profile redemption redeem it without a `code_verifier`. A
code issued with a challenge still needs its verifier at both, whatever the app
is and whatever its redemption leaves out. A sign-in that began with PKCE
cannot finish without it. If a redemption leaves out the verifier for such a
code, the site refuses it with `invalid_request` and spends the code.

Listing an app gives up the protection PKCE gives. Without PKCE, an attacker
who intercepts the one-time code on its way back to the app can exchange it
for a token, because the app kept no verifier. The same-host `https` rule
limits the code to return addresses that a native app normally claims as a
verified universal link or app link. Another app on the device should not
receive the code. The risk is not zero. List only an app you trust that cannot
sign in otherwise, and remove it once it supports PKCE.

## App activity

Users > App activity, at `/admin/users/activity`, shows the last requests apps
made to sign in with your site and to post to it. When an app does not connect
or post, look here. The screen shows the reason the site refused the request,
so you do not have to guess from the app's own message. Any signed-in admin can
open it.

The site records one entry for each request to these endpoints:

- The authorization endpoint. The site records the sign-in request when it
  reaches the consent screen, before you approve it. The entry says whether the
  request carried an S256 PKCE `code_challenge` and which scopes it asked for.
  A request let in without one, because the app is on the list of
  [apps allowed without PKCE](#apps-allowed-without-pkce), is marked as such.
  The site also records an app's redemption of its code for your profile.
- The token endpoint, with the `grant_type` and, on success, the scopes the
  token was issued with.
- The Micropub endpoint, with the action or query and the properties the
  request carried.
- The media endpoint, with the file part's name, type, and size.

The list shows the newest request first, with the endpoint, the action, the
app's `client_id`, the user, and the result. A refused request is marked
Refused with its status and error code. Failures shows only refused requests.
Choose a request's time to see it in full: the error description, and every
field it sent, with each value cut to 100 characters.

The log never keeps an access token, refresh token, authorization code,
`code_verifier`, client secret, password, or cookie. A field with one of those
names is listed as sent but not recorded. The site reads no request header and
does not keep the client's address. The log holds the last 100 requests from
the past 14 days, in `data/indieauth-activity.json`, mode `0600`. Writing the
log never changes or delays the answer the app gets.
