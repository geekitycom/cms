# Security

## Login hardening

`/admin/login` counts failed sign-ins against two keys: the submitted
username, and the address the request came from. When either key reaches
`loginAttempts` failures (default five), the admin refuses further attempts
from that key for `loginLockout` seconds (default fifteen minutes). During the
lockout it answers `429` with a `Retry-After` header and a message that says
how long is left.

Three details are deliberate:

- **The lockout is checked before the password.** A correct password during a
  lockout is refused too. If the server verified the password first, an
  attacker who guessed right on the attempt that tripped the limit would get
  in.
- **The wait doubles each time the lockout trips again**, up to sixteen times
  the first wait. At the default that is four hours. The server adds no pause
  to an individual attempt. A `sleep` in the handler holds a connection open
  for as long as it lasts, so it costs the server more than the attacker.
- **The message says nothing about which accounts exist.** The server counts
  and locks out a username that has no account the same way as a real one. The
  lockout cannot be used to enumerate accounts, and a wrong password and an
  unknown username get the same message.

A successful sign-in clears both keys. A key that stops failing also expires
over time. The counts live in memory, so a restart clears them. This is
intentional: a failed login writes nothing that an anonymous caller could
make grow. A guessing attack runs over minutes, and a restart does not happen
often enough to help it. The server logs both refusals with the username and
the address.

`trustProxy` decides where the address comes from. It defaults to `false`,
and the address is the socket's own. Any client can send `X-Forwarded-For`. On
a site reached directly, trusting it would let one attacker give each guess a
different fake address and never be locked out by address. Turn `trustProxy`
on only when a reverse proxy in front of the site sets that header. The server
then uses the leftmost entry. When neither address is available, as when the
app runs in process instead of behind a server, the username is the only key.

## Session hardening

Three measures protect a signed-in session in addition to the cookie flags and
the CSRF token.

**The cookie is `__Host-geekity_session` under https.** A browser accepts a
cookie with the `__Host-` prefix only when it is `Secure`, has `Path=/` and
names no `Domain`. That binds the cookie to one host, so a page on a sibling
subdomain cannot set or overwrite it to plant a session. The prefix requires
`Secure`, and a browser drops a `Secure` cookie on a plain-http origin. A site
whose `baseUrl` is `http://localhost:3000` therefore keeps the name
`geekity_session`, and local development works as before.

**The upgrade signs people out once.** A session created before this change
lives in a cookie named `geekity_session`. Under https the server never accepts
that name as a login again. Accepting it would reopen the sibling-subdomain
attack that the prefix closes. The first admin request that carries only the
old cookie:

1. deletes its session
2. expires the old cookie
3. redirects to the login form with a message that the sign-in cookie was
   renamed and that the user must sign in again

The public site ignores the old cookie. A signed-in commenter sees the
anonymous comment form until they sign in again.

**Fetch Metadata refuses cross-site writes.** A browser sends `Sec-Fetch-Site`
with every request, and a page cannot change it. The server refuses with 403
every request under `/admin` other than `GET`, `HEAD` and `OPTIONS`, including
the login and setup forms, when that header says `cross-site` or `same-site`.
The check runs before the server reads the session or runs a handler. A comment
posted by a signed-in user gets the same check. `same-origin` and `none` pass.

A request with no `Sec-Fetch-Site`, from an older browser or a script, falls
back to the CSRF token, which every such request must still carry.

These endpoints are not checked. They accept cross-site `POST`s by design and
act on no session:

- the ActivityPub inboxes
- the WordPress-compatible inbox
- webmentions
- the contact form
- a comment from a visitor who is not signed in
- the one-click moderate and unsubscribe links in an email

**Logout clears the site's data in the browser.** The logout response sends
`Clear-Site-Data: "cache", "cookies", "storage"`. A shared computer keeps no
admin pages in its cache and nothing the site stored. Browsers honour the
header only on a secure origin, which includes `http://localhost`. The
`cookies` directive clears cookies for the whole registrable domain. Signing
out of `blog.example.com` also signs the browser out of other sites under
`example.com`.

## Forgotten passwords

`/admin/login` has a **Forgotten your password?** link to `/admin/forgot`.
That screen takes a username _or_ an email address and always answers with the
same sentence. The answer is the same when the name matched, when it did not
match, and when it matched an account with no email address. If the answer
varied, anyone could use the screen to list the site's accounts.

When the name matches an account with an address, the server sends the theme's
`password-reset` message. It carries a link to `/admin/reset?token=…`.

- The token is 256 random bits.
- The database keeps only its SHA-256, in a table beside the sessions. A copy
  of `data/geekity.db` does not contain working links.
- The token is never rendered into the page of the browser that requested it.
- The token lasts an hour and works once.

A password set through the link must meet the same rules as a password set
anywhere else. The server then invalidates:

- the link that was used
- every other reset link that user had outstanding
- every session the user was signed in on

The server then sends the theme's `password-changed` message, which has no link
back in. A user who did not request the reset finds out about it.

The server rate limits reset requests by username and by address in the same
way as sign-ins: the same limits, the same growing lockout, `429` and
`Retry-After`. Resets have their own throttle. If they shared the login
throttle, a stranger could lock a user out of signing in by requesting resets
for them over and over.

Reset tokens live in the database, which is a cache. A restart, a
`geekity rebuild` or a deleted `data/geekity.db` invalidates every outstanding
link. The user then has to click Forgot password again.

With no mail provider or credential, `/admin/forgot` shows no form. It says the
site cannot send email and links to
[`geekity user add`](cli.md#creating-an-admin-from-the-command-line). Use that
command from a shell to create a fresh admin on a site nobody can sign in to.
Saving a credential under [Settings → Email](email.md) turns the form on for
the next visitor, with no restart.

## Security headers

Every response carries `X-Content-Type-Options: nosniff`. When `baseUrl` is an
`https` URL, every response also carries
`Strict-Transport-Security: max-age=31536000; includeSubDomains`. The same test
decides whether the session cookie is `Secure`, so the two always agree.
Neither header can be turned off.

Every response also carries the headers below. This includes public pages,
feeds, uploads, ActivityPub JSON, redirects, 404s, the maintenance 503 and the
500 page.

| Header                       | Default                                                                                                                                                    |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Referrer-Policy`            | `strict-origin-when-cross-origin`                                                                                                                          |
| `Content-Security-Policy`    | `frame-ancestors 'self'`                                                                                                                                   |
| `X-Frame-Options`            | `SAMEORIGIN`                                                                                                                                               |
| `Permissions-Policy`         | `browsing-topics=(), camera=(), display-capture=(), geolocation=(), hid=(), microphone=(), midi=(), payment=(), serial=(), usb=(), xr-spatial-tracking=()` |
| `Cross-Origin-Opener-Policy` | `same-origin`                                                                                                                                              |

None of these headers limits what a public page may load. The CMS sends no
content policy: no `default-src`, `script-src` or `img-src`. A theme's HTML
belongs to the theme author, and the CMS does not decide what it may
reference. `frame-ancestors` is the only directive in the policy. It controls
who may put the page in a frame, not what the page contains.

What each header does:

- `Referrer-Policy` sends only the origin, not the full URL, when a visitor
  follows a link to another site. The path and query of the page they were on
  stay private.
- `frame-ancestors 'self'` and `X-Frame-Options: SAMEORIGIN` stop another site
  from framing a page. This matters most for a signed-in user, whose pages
  carry a comment form that posts as them. It covers every page because the
  CMS cannot tell a framed visitor from a framed signed-in user.
- `Permissions-Policy` turns off browser features a blog does not use. It
  leaves alone what an embedded video player requests: autoplay, fullscreen,
  `encrypted-media`, picture-in-picture, and the motion sensors behind a
  360-degree video. The post editor is the one response that allows more. It
  sends the site's policy with `geolocation=()` changed to
  `geolocation=(self)`, so its Use my location button can request the
  browser's location.
- `Cross-Origin-Opener-Policy: same-origin` stops a window the site opens, or
  a window that opens the site, from reaching into it through
  `window.opener`.

Two of these headers can block something a site does on purpose:

- A site meant to be framed elsewhere, such as in a portfolio or a slide deck,
  must name that host in `frame-ancestors` and remove `X-Frame-Options`, which
  cannot name another host.
- A theme that signs visitors in or takes payment through a popup on another
  origin needs `same-origin-allow-popups` for COOP.

The CMS itself does neither.

One response is framed elsewhere on purpose: the embed view at
`/_geekity/embed?url=…`. The oEmbed `html` frames this card so that WordPress
keeps it. The embed view sends its own complete policy instead of the default:
`frame-ancestors *`, `default-src 'none'`, and its one inline style and one
inline script by hash. It never sends `X-Frame-Options`, even one set in
`securityHeaders`. It shows nothing from a session, so a signed-in user in a
frame sees the same card as anyone else. Every other response keeps the
framing headers above.

To change the headers, set `securityHeaders` in the site's config. Header names
are case-insensitive. A string replaces a default or adds a header of the
site's own. `false` removes a default.

```ts
export default defineConfig({
  securityHeaders: {
    'Content-Security-Policy':
      "frame-ancestors 'self' https://portfolio.example",
    'X-Frame-Options': false,
    'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
  },
});
```

The site stops at boot when a name is not a valid header name, or when a value
is empty or contains a line break. There is no environment variable for these.

A policy that limits scripts must allow whatever the site's theme adds to every
page. For the Umami and Google Analytics snippets,
[Adding to every page](theme/adding-to-every-page.md) lists the directives each
one needs. For hCaptcha on the contact and comment forms, see
[hCaptcha](configuration.md#hcaptcha).

Every response under `/admin`, including static files and redirects, gets three
stricter values instead, whatever `securityHeaders` says:

| Header                    | Value                                         |
| ------------------------- | --------------------------------------------- |
| `Referrer-Policy`         | `same-origin`                                 |
| `X-Frame-Options`         | `SAMEORIGIN`                                  |
| `Content-Security-Policy` | `default-src 'self'` and the directives below |

The policy is `'self'` for almost everything. The stylesheet and the editor
bundle come from `/admin/_static/`. The editor's preview and upload calls are
same-origin `fetch`. The preview frame renders the site's own theme and
uploads. Four directives go further:

- `style-src 'self' 'nonce-…'`, with a fresh nonce on every response.
  CodeMirror 6 mounts its themes as `<style>` elements at runtime, and a
  browser treats those as inline styles. The server puts the nonce on the
  editor bundle's `<script>` tag. The bundle reads it back through the
  element's `nonce` property, which a browser keeps after it blanks the
  attribute, and passes it to CodeMirror through `EditorView.cspNonce`. The
  admin never needs `'unsafe-inline'`.
- `script-src 'self'`, with no nonce and no `'unsafe-inline'`. The admin has no
  inline script. The slug and permalink auto-fill is in
  `/admin/_static/slug.js`.
- `img-src 'self' data:`. A preview of a post in progress may contain a data
  URI image. Refusing it would make the preview differ from what publishing
  shows.
- `frame-ancestors 'self'`, not `'none'`. The editor's preview is a sandboxed
  `srcdoc` iframe, which inherits this policy, and its one ancestor is the
  admin page itself.

## Serving uploads

The upload endpoint accepts only the types in the upload allowlist (see
[Uploads and images](configuration.md#uploads-and-images)). Files can still reach
`content/uploads/` another way: copied in by hand, synced from a content
repository, or left by an older version. Uploads are served from the same
origin as the admin, so the server does not trust the file's extension alone.

- A file whose extension is in the allowlist is served inline under its media
  type.
- An SVG is served as `image/svg+xml`, because a site icon can be an SVG, with
  `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'self'; sandbox`.
  Script in the file does not run, and the file loads nothing, when a visitor
  opens it directly.
- Any other file, such as `.js` or `.html`, is served as
  `application/octet-stream` with `Content-Disposition: attachment`. A browser
  downloads it and does not render it.

The server does not follow a symbolic link out of the directory it serves
from. If a link under `content/uploads/`, a theme's `static/` directory or
another served directory resolves to a file outside that directory, the server
answers as if the file were not there. The served directory itself can be a
link.

## security.txt and change-password

`/.well-known/security.txt` ([RFC 9116](https://www.rfc-editor.org/rfc/rfc9116))
tells a person who finds a vulnerability in the site where to report it. The
server builds it from three settings on the Email settings page, under Security
contact. `content/_data/site.json` holds them:

| Setting             | `site.json` key     | Default | What it becomes                                                                                                   |
| ------------------- | ------------------- | ------- | ----------------------------------------------------------------------------------------------------------------- |
| Contacts            | `securityContacts`  | `[]`    | One `Contact:` line each, in order. An email address, stored as `mailto:…`, an `https://` URL or a `tel:` number. |
| Disclosure policy   | `securityPolicy`    | `""`    | A `Policy:` line. An `https://` URL, or empty for no line.                                                        |
| Preferred languages | `securityLanguages` | `""`    | A `Preferred-Languages:` line. Language tags separated by commas, or empty for no line.                           |

With no contact, the path returns 404, because the RFC requires at least one.
The server never substitutes the `contactEmail` setting, because the CMS
promises that address never appears on the public site.

The server builds the file on every request and serves it as
`text/plain; charset=utf-8`. `Expires` is 30 days after the request, so the
file never goes stale however long the site runs. `Canonical` is the path under
the base URL in effect. There is no config-file key or environment variable for
any of these. Like `contactEmail`, they are site settings that the site owner
edits on the settings screen.

`/.well-known/change-password` is where a password manager sends a user who
wants to change a saved password. It redirects with a `302` and
`Cache-Control: no-store`:

- to `/admin/users/{id}#change-password`, the form on the signed-in user's own
  page
- to the login form when nobody is signed in

Both paths answer as usual in maintenance mode. A security researcher may need
the contact most while the site is down. change-password only points into the
admin, which maintenance mode leaves open.
