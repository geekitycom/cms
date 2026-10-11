# Signing in with your own site

Your site is your IndieAuth identity. Type its URL into the sign-in form of an
IndieAuth client, such as indielogin.com or a Micropub app, and the client
sends you back to your own site to sign in. No GitHub account or other
`rel="me"` provider is involved.

Which URL you type depends on the site:

- **Every user** can type their author URL, `https://example.com/author/{username}/`.
- **On a site whose author is a user** (Site author on Settings > General),
  that user can type the site URL, `https://example.com/`.
- **On a site with several authors** the site URL also works. You sign in as whoever
  you log in as, and the client is told your author URL.

`http://`, a `www.` prefix and a missing trailing slash are all read as the
same URL. Any other page of the site is nobody's identity. decision-23 records
the rules.

The site root and every author archive advertise the site's authorization
server with a `Link: <…>; rel="indieauth-metadata"` header and a
`<link rel="indieauth-metadata">` in the head. The CMS adds both to the
response, so a custom theme carries them without printing anything. The
metadata document itself is served at `/_geekity/indieauth/metadata` and at
`/.well-known/oauth-authorization-server` (RFC 8414), where generic OAuth and
MCP clients look for it.

The same pages also carry `rel="authorization_endpoint"` and
`rel="token_endpoint"`, in the `Link` header and in the head, naming the same
two URLs as the metadata document. Some Micropub apps, such as iA Writer, look
only for these older links and do not read the metadata, and the IndieAuth spec
asks clients to check them for compatibility with earlier versions. The links
relax nothing: the site still refuses a sign-in request that has no S256 PKCE
`code_challenge`, so an app that sends none still cannot sign in unless you list
it under [Apps allowed without PKCE](#apps-allowed-without-pkce).

When a client sends you to the site, you sign in to the admin if you are not
signed in already, and then see a consent screen. It names the app (or its
URL when the app publishes no name), the host it will send you back to, the
URL you are signing in as and each piece of information it asks for. Untick
anything you do not want to share, then choose Approve or Deny. You can only
ever sign in as yourself: a URL that names another user is replaced with your
own author URL.

The site reads the app's details from its `client_id` URL, which can be an
IndieAuth `h-app` page or a JSON client metadata document such as MCP clients
publish. An app may send you back to its own origin, or to an address it lists
in those details, and to nothing else. While the site is in maintenance mode
the sign-in endpoint answers 503, like the URLs that advertise it.

After you approve, the app exchanges the code it was sent for the URL you
signed in as, by posting it back to the same endpoint with its PKCE
verifier. It also gets your name, URL and profile picture if you left
profile ticked, and your email address if you left email ticked. It gets no
access token this way. A code works once, for five minutes, and only for the
app and return address it was issued to.

An app that wants to act for you, such as a Micropub client, can also ask for
the scopes create, update, delete and media, which the consent screen lists as
creating, editing and deleting your posts and uploading media. It redeems its
code at `/_geekity/indieauth/token` instead, under the same rules, and gets a
bearer access token for the scopes you approved, with the URL you signed in as
and the same profile details. The access token works for seven days. It comes
with a refresh token that the app can trade for a new pair, which stops the old
pair working. A refresh token lapses after 60 days without use. A code
approved with no scope gets no token.

The site keeps only a SHA-256 hash of each token, in
`data/indieauth-tokens.json`, written so only the site's own user can read it.
Back it up with the rest of `data/`. Deleting `geekity.db` keeps every token,
and deleting a user revokes every token they hold. A token issued for one
resource, such as an MCP endpoint, works only there. decision-24 records the
rules.

An app sends its token in an `Authorization: Bearer` header, or in an
`access_token` form field as Micropub allows. RFC 6750 asks for one or the
other, but Quill sends the same token both ways for servers that drop the
header, so the same token in both is accepted. Two different tokens get 400
`invalid_request`. A request with no token, or
with one that is unknown, expired or revoked, gets 401. A token without the scope a
route needs gets `insufficient_scope`, with 401 on the Micropub and media endpoints,
as the [Micropub spec's error table](https://www.w3.org/TR/micropub/#error-response)
says, and 403 on every other route, as RFC 6750 section 3.1 says. Each refusal carries a
`WWW-Authenticate: Bearer` header whose `resource_metadata` points at
`/.well-known/oauth-protected-resource`. That RFC 9728 document names the site
as its own authorization server and lists the scopes, so an MCP client can find
out where to sign in. The metadata document also lists three more endpoints:

- `/_geekity/indieauth/userinfo` answers your name, URL and profile picture
  for a token with the profile scope, and your email address when it also has
  the email scope.
- `/_geekity/indieauth/revoke` ends the connection a posted `token` belongs
  to, access or refresh, so both stop working at once. It answers 200 whether
  or not the token was live.
- `/_geekity/indieauth/introspect` says whether a posted `token` is live, and
  if so its `me`, `client_id`, `scope` and `exp`. The request needs a live
  token of its own in the `Authorization` header, and it answers only for
  tokens held by the same person. Any other token is reported inactive.

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

The site records last use when it accepts a token, but writes it to
`data/indieauth-tokens.json` at most once an hour per connection. So the time
shown can be up to an hour early, and an app that calls the API many times a
minute does not rewrite the file each time.

Each row has a Revoke button that names the app. Revoking deletes the
connection: its access token and its refresh token stop working at once, the
app's next request gets 401 `invalid_token`, and the screen confirms with a
message. The app has to ask you again through the consent screen to reconnect.
With no apps connected, the screen says what kinds of app connect here.

## Apps allowed without PKCE

The IndieAuth spec requires PKCE, and the site refuses every sign-in request
without an S256 `code_challenge`. Some apps send none. iA Writer is one. It
finds the site's endpoints and is then refused with `code_challenge must be an
S256 PKCE challenge`. The bottom of Users > Connected apps holds a list of apps
that may sign in without PKCE anyway. The list starts empty. Any signed-in
admin can add or remove an app, and the list is kept in
`content/_data/site.json` as `clientsWithoutPkce`.

To let iA Writer sign in, add `https://ia.net/writer`. Enter the `client_id`
the app sends, as App activity shows it. The screen refuses anything that is
not a valid `client_id` URL, and an app already on the list.

A listed app is let in without PKCE only when all of these hold:

- The request carries neither `code_challenge` nor `code_challenge_method`.
  A request that sends a malformed challenge is still refused.
- Its `client_id` is on the list.
- Its `redirect_uri` is `https://` on the same host as the `client_id`. For
  iA Writer that is `https://ia.net/writer/indieauth/redirect`.

Any other request without PKCE is refused as before. The consent screen tells
you when an app does not use PKCE and is let in only because it is on the
list, and App activity records the sign-in as allowed without PKCE.

The code such a sign-in earns is marked as issued without a challenge, and the
token endpoint and profile redemption redeem it without a `code_verifier`. A
code issued with a challenge still needs its verifier at both, whatever the
app is and whatever its redemption leaves out, so a sign-in that began with
PKCE cannot finish without it. A redemption that leaves out the verifier for
such a code is refused with `invalid_request` and spends the code.

Listing an app gives up the protection PKCE gives. Without it, somebody who
intercepts the one-time code on its way back to the app can exchange it for a
token, because the app kept no verifier to stop them. The same-host
`https` rule narrows that to return addresses a native app normally claims as
a verified universal link or app link, so another app on the device should not
receive the code. The risk is not zero. List only an app you trust that cannot
sign in otherwise, and remove it once it supports PKCE.

## App activity

Users > App activity, at `/admin/users/activity`, shows the last requests apps
made to sign in with your site and to post to it. Look here when an app will
not connect or post: the reason it was refused is on the screen, so you do not
have to guess from the app's own message. Any signed-in admin can open it.

The site records one entry for each request to these endpoints:

- The authorization endpoint. The sign-in request is recorded when it reaches
  the consent screen, before you approve it, with whether it carried an S256
  PKCE `code_challenge` and the scopes it asked for. A request let in without
  one because the app is on the list of
  [apps allowed without PKCE](#apps-allowed-without-pkce) is marked as such. An app's redemption of
  its code for your profile is recorded too.
- The token endpoint, with the `grant_type` and, on success, the scopes the
  token was issued with.
- The Micropub endpoint, with the action or query and the properties the
  request carried.
- The media endpoint, with the file part's name, type and size.

The list shows the newest request first, with the endpoint, the action, the
app's `client_id`, the user and the result. A refused request is marked
Refused with its status and error code. Failures shows only those. Choose a
request's time to see it in full: the error description, and every field it
sent with its value cut to 100 characters.

The log never keeps an access token, refresh token, authorization code,
`code_verifier`, client secret, password or cookie. A field with one of those
names is listed as sent but not recorded, and no request header is read. The
client's address is not kept. The log holds the last 100 requests from the past
14 days, in `data/indieauth-activity.json`, mode `0600`. Writing it never
changes or delays the answer the app gets.
