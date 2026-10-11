# Security

## Login hardening

`/admin/login` counts failed sign-ins against two keys: the username that was
typed, and the address the request came from. Once either has failed
`loginAttempts` times — five by default — the admin refuses further attempts
from that key for `loginLockout` seconds, fifteen minutes by default, and
answers `429` with a `Retry-After` header and a message saying how long is
left.

Three things about that are deliberate:

- **The lockout is checked before the password is.** A correct password during
  a lockout is refused too. Verifying first would hand the site to whoever
  guessed right on the attempt that tripped the limit.
- **The wait doubles each time the lockout is tripped again**, up to sixteen
  times the first one — four hours at the default. There is no artificial pause
  on an individual attempt: a `sleep` in the handler holds a connection open for
  as long as it lasts, so it would cost the server more than the attacker.
- **The message says nothing about who exists.** A username nobody has is
  counted and locked out exactly as a real one is, so the lockout cannot be used
  to enumerate accounts, and a wrong password and an unknown username still read
  the same.

A sign-in that works clears both keys, and so does time: a key that stops
failing is forgotten. The counts live in memory, so a restart clears them.
That is the point — a failed login writes nothing an anonymous caller could
grow, and the run of guesses this defends against happens over minutes, which
no restart interrupts. Both refusals are logged with the username and the
address.

`trustProxy` decides where the address comes from. It is `false` by default and
the address is the socket's own, because anybody may send `X-Forwarded-For`: on
a site reached directly, believing it would let one attacker put every guess on
a different make-believe address and never be locked out by address at all. Turn
it on — and only on — when a reverse proxy in front of the site sets that
header; the leftmost entry is then used. With neither available, which is what
happens when the app is driven in process rather than served, the username is
the only key.

## Session hardening

Three things protect a signed-in session beyond the cookie flags and the CSRF
token.

**The cookie is `__Host-geekity_session` under https.** A browser accepts a
cookie with the `__Host-` prefix only when it is `Secure`, has `Path=/` and
names no `Domain`. That binds it to the exact host, so a page on a sibling
subdomain cannot set or overwrite it to plant a session. The prefix needs
`Secure`, and a browser drops a `Secure` cookie on a plain-http origin, so a
site whose `baseUrl` is `http://localhost:3000` keeps the name
`geekity_session` and local development works as before.

**The upgrade signs people out once.** A session made before this change is in
a cookie named `geekity_session`. Under https that name is never accepted as a
login again, because accepting it would give a sibling subdomain the way in
that the prefix closes. The first admin request that carries only the old
cookie deletes its session, expires the old cookie, and sends the browser to
the login form with a message that the sign-in cookie was renamed and asks the
person to sign in again. On the public site the old cookie is ignored, so a
signed-in commenter sees the stranger's form until they sign in again.

**Fetch Metadata refuses cross-site writes.** A browser sends
`Sec-Fetch-Site` with every request, and a page cannot change it. Every
request under `/admin` other than `GET`, `HEAD` and `OPTIONS`, including the
login and setup forms, is refused with 403 when that header says `cross-site`
or `same-site`, before the session is read or a handler runs. A comment posted
by somebody signed in gets the same check. `same-origin` and `none` pass. A
request with no `Sec-Fetch-Site`, from an older browser or a script, falls back
to the CSRF token, which every such request still has to carry. Nothing else
is checked: the ActivityPub inboxes, the WordPress-compatible inbox,
webmentions, the contact form, a stranger's comment, and the one-click
moderate and unsubscribe links in an email take cross-site `POST`s by design,
and they act on no session.

**Logout clears the site's data in the browser.** The logout response sends
`Clear-Site-Data: "cache", "cookies", "storage"`, so a shared computer does not
keep admin pages in its cache or anything the site stored. Browsers honour it
only on a secure origin, which includes `http://localhost`. The `cookies`
directive clears cookies for the whole registrable domain, so signing out of
`blog.example.com` also signs the browser out of other sites under
`example.com`.

## Forgotten passwords

`/admin/login` carries a **Forgotten your password?** link to `/admin/forgot`,
which takes a username _or_ an email address and always answers with the same
sentence — whether the name matched, did not match, or matched somebody who has
no address on their account. That is the point of the screen: an answer that
varied with what it found would be a list of which accounts the site has,
handed to anybody who asked for it.

A match with an address is sent the theme's `password-reset` message, carrying
a link to `/admin/reset?token=…`. The token is 256 random bits; the database
keeps only its SHA-256, in a table beside the sessions, so a copy of
`data/geekity.db` is not a stack of working links, and the token is never
rendered into the page of the browser that asked for it. It lasts an hour and
works once.

Setting a password through the link holds it to the same rules every other door
does, then closes everything else: the link that was used, every other reset
that user had outstanding, and every session they were signed in on. The
theme's `password-changed` message goes out afterwards, with no link back in,
so a reset somebody did not ask for is something they hear about.

Requests are rate limited by username and by address exactly as sign-ins are —
same limits, same growing lockout, same `429` and `Retry-After` — on a throttle
of its own. Sharing the login one would let a stranger lock somebody out of
signing in by asking for their password to be reset over and over.

Reset tokens live in the database, which is a cache: a restart, a
`geekity rebuild` or a deleted `data/geekity.db` invalidates every link in
flight, and the cost of that is a second click on Forgot password.

With no mail provider or credential, `/admin/forgot` offers no form at all. It
says the site cannot send email and points at
[`geekity user add`](cli.md#creating-an-admin-from-the-command-line), which is how a
site nobody can sign in to gets a fresh admin from a shell. Saving a credential
under [Settings → Email](email.md) turns the form on for the next visitor, with
no restart.

## Security headers

Every response the CMS sends carries `X-Content-Type-Options: nosniff`, and
`Strict-Transport-Security: max-age=31536000; includeSubDomains` when `baseUrl`
is an `https` URL — the same test that decides whether the session cookie is
`Secure`, so the two cannot disagree. Neither can be turned off.

Every response also carries these, public pages, feeds, uploads, ActivityPub
JSON, redirects, 404s, the maintenance 503 and the 500 page alike:

| Header                       | Default                                                                                                                                                    |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Referrer-Policy`            | `strict-origin-when-cross-origin`                                                                                                                          |
| `Content-Security-Policy`    | `frame-ancestors 'self'`                                                                                                                                   |
| `X-Frame-Options`            | `SAMEORIGIN`                                                                                                                                               |
| `Permissions-Policy`         | `browsing-topics=(), camera=(), display-capture=(), geolocation=(), hid=(), microphone=(), midi=(), payment=(), serial=(), usb=(), xr-spatial-tracking=()` |
| `Cross-Origin-Opener-Policy` | `same-origin`                                                                                                                                              |

None of them limits what a page may load, and that is the line the CMS holds
on the public site. There is no content policy, no `default-src`, `script-src`
or `img-src`, because a theme is somebody else's HTML and the CMS has no
business deciding what it may reference. `frame-ancestors` is the only
directive in the policy, and it is about who may put the page in a frame, not
what is in it. Each header does something else:

- `Referrer-Policy` sends only the origin, not the full URL, when a reader
  follows a link to another site, so the path and query of the page they were
  on stay on the site.
- `frame-ancestors 'self'` and `X-Frame-Options: SAMEORIGIN` stop another site
  from framing a page. That matters most for a signed-in user, whose pages carry
  a comment form that posts as them, but it covers every page because the CMS
  cannot tell a framed reader from a framed user.
- `Permissions-Policy` turns off browser features a blog has no use for. It
  leaves alone what an embedded video player asks for: autoplay, fullscreen,
  `encrypted-media`, picture-in-picture, and the motion sensors behind a
  360-degree video.
  The post editor is the one response that allows more: it sends the site's
  policy with `geolocation=()` changed to `geolocation=(self)`, so its Use my
  location button can ask the browser where it is.
- `Cross-Origin-Opener-Policy: same-origin` keeps a window the site opens, or a
  window that opens the site, from reaching into it through `window.opener`.

Two of them can get in the way of something a site does on purpose. A site that
is meant to be framed elsewhere, such as in a portfolio or a slide deck, has to
name that host in `frame-ancestors` and remove `X-Frame-Options`, which cannot
name another host. A theme that signs readers in or takes payment through a
popup on another origin needs `same-origin-allow-popups` for COOP. The CMS
itself does neither.

One response is framed elsewhere on purpose: the embed view at
`/_geekity/embed?url=…`, the card that the oEmbed `html` frames so that
WordPress keeps it. It sends a complete policy of its own instead of the
default: `frame-ancestors *`, `default-src 'none'`, and its one inline style and
one inline script by hash. It never sends `X-Frame-Options`, even one set in
`securityHeaders`. It shows nothing from a session, so a signed-in user who is
framed sees the same card as anyone else. Every other response keeps the
framing headers above.

A site changes them with `securityHeaders` in its config. Names are matched
without regard to case. A string replaces a default or adds a header of the
site's own, and `false` removes a default:

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

A name that is not a header name, or a value that is empty or has a line break
in it, stops the site at boot. There is no environment variable for these.

A policy that limits scripts has to allow whatever the site's theme adds to
every page. For the Umami and Google Analytics snippets,
[Adding to every page](theme/adding-to-every-page.md) lists
the directives each one needs.

Every response under `/admin`, static files and redirects included, gets three
stricter values in their place, whatever `securityHeaders` says:

| Header                    | Value                                         |
| ------------------------- | --------------------------------------------- |
| `Referrer-Policy`         | `same-origin`                                 |
| `X-Frame-Options`         | `SAMEORIGIN`                                  |
| `Content-Security-Policy` | `default-src 'self'` and the directives below |

The policy is `'self'` almost everywhere: the stylesheet and the editor bundle
come from `/admin/_static/`, the editor's preview and upload calls are
same-origin `fetch`, and the preview frame renders the site's own theme and
uploads. Four directives say more than that:

- `style-src 'self' 'nonce-…'` — a fresh nonce on every response. CodeMirror 6
  mounts its themes as `<style>` elements at runtime, which is an inline style
  however it is written. The nonce is put on the editor bundle's `<script>` tag
  and read back through the element's `nonce` property, which a browser keeps
  after blanking the attribute, and handed to CodeMirror through
  `EditorView.cspNonce`. So the admin never says `'unsafe-inline'`.
- `script-src 'self'` — no nonce and no `'unsafe-inline'`, because there is no
  inline script in the admin at all. The slug and permalink auto-fill lives in
  `/admin/_static/slug.js`.
- `img-src 'self' data:` — a preview of a post somebody is writing may hold a
  data URI image, and refusing it would make the preview lie about what
  publishing would show.
- `frame-ancestors 'self'` rather than `'none'` — the editor's preview is a
  sandboxed `srcdoc` iframe, which inherits this policy, and its one ancestor is
  the admin page itself.

## security.txt and change-password

`/.well-known/security.txt` ([RFC 9116](https://www.rfc-editor.org/rfc/rfc9116))
tells somebody who finds a vulnerability in the site where to report it. It is
built from three settings on the Email settings page, under Security contact,
which `content/_data/site.json` holds:

| Setting             | `site.json` key     | Default | What it becomes                                                                                                   |
| ------------------- | ------------------- | ------- | ----------------------------------------------------------------------------------------------------------------- |
| Contacts            | `securityContacts`  | `[]`    | One `Contact:` line each, in order. An email address, stored as `mailto:…`, an `https://` URL or a `tel:` number. |
| Disclosure policy   | `securityPolicy`    | `""`    | A `Policy:` line. An `https://` URL, or empty for no line.                                                        |
| Preferred languages | `securityLanguages` | `""`    | A `Preferred-Languages:` line. Language tags separated by commas, or empty for no line.                           |

With no contact the path is a 404: the RFC requires at least one. The
`contactEmail` setting is never used in its place, because that address is
promised never to appear on the public site.

The file is built on every request and served as `text/plain; charset=utf-8`.
`Expires` is 30 days after the request, so it never goes stale however long the
site runs, and `Canonical` is the path under the base URL in effect. There is no
config-file key or environment variable for any of these: like `contactEmail`,
they are site settings a person edits on the settings screen.

`/.well-known/change-password` is where a password manager sends somebody who
wants to change a saved password. It redirects with a `302` and
`Cache-Control: no-store`: to `/admin/users/{id}#change-password`, the form on
the signed-in user's own page, or to the login form when nobody is signed in.

Both paths answer as usual in maintenance mode. A researcher may need the
security contact most while the site is down, and change-password only points
into the admin, which maintenance mode leaves open.
