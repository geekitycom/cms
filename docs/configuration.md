# Configuration

Declare config in `geekity.config.ts`. `defineConfig` type checks it.

```ts
import { defineConfig } from '@geekity/cms/config';

export default defineConfig({
  port: 3000,
  contentDir: 'content',
  dataDir: 'data',
  themesDir: 'themes',
  baseUrl: 'http://localhost:3000',
  watch: true,
  sessionLifetime: 60 * 60 * 24 * 14,
  loginAttempts: 5,
  loginLockout: 15 * 60,
  trustProxy: false,
});
```

`@geekity/cms/config` exports `defineConfig` and the config types without
loading the rest of the CMS. Every `geekity` command reads the config, and a
command such as `geekity settings list` does not need the CMS core, sharp or
Fedify. A config that imports `defineConfig` from `@geekity/cms` still works,
but it loads the whole CMS on every command, which adds about a quarter of a
second.

Every field is optional. Relative directories resolve against the working
directory. Absolute directories are used as given.

| Field              | Default                                              | Environment override         | Meaning                                                                                                                                                                                                                                                                                                                  |
| ------------------ | ---------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `port`             | `3000`                                               | `GEEKITY_PORT`, then `PORT`  | Port the HTTP server listens on. `0` picks a free one.                                                                                                                                                                                                                                                                   |
| `contentDir`       | `<cwd>/content`                                      | `GEEKITY_CONTENT_DIR`        | Markdown content.                                                                                                                                                                                                                                                                                                        |
| `dataDir`          | `<cwd>/data`                                         | `GEEKITY_DATA_DIR`           | The SQLite index, the image variants and other derived state, and the files that are not derived and must be backed up, such as `users.json`, the actor key pairs under `keys/`, `locations.json` and `kept-properties.json`. [Two directories](content.md#two-directories-content-and-data) lists them.                 |
| `themesDir`        | `<cwd>/themes`                                       | `GEEKITY_THEMES_DIR`         | The site's themes, one directory per theme, each with a `theme.json`. The `theme` setting in `site.json` picks the one in use, by name, not by path. The directory need not exist.                                                                                                                                       |
| `pluginsDir`       | none                                                 | `GEEKITY_PLUGINS_DIR`        | A folder of plugins, `<name>/` or `@scope/<name>/`, each with a bundled `index.js` whose default export is the plugin. `geekity serve` loads them beside `plugins`. Reload on the Plugins screen loads a changed folder without a restart. When unset, no code is loaded from a folder.                                  |
| `pluginInstall`    | `true`                                               | `GEEKITY_PLUGIN_INSTALL`     | Let Admin > Plugins add, update and remove plugins in `pluginsDir`. Set it to `off` to allow plugin changes only from the command line. See [Installing from the admin](plugins.md#installing-from-the-admin).                                                                                                           |
| `pluginWatch`      | `true`                                               | `GEEKITY_PLUGIN_WATCH`       | Under `geekity serve`, reload when `pluginsDir` has changed and then not changed for five seconds. Set it to `off` to load changes only through Reload, the admin's changes and `geekity plugin`.                                                                                                                        |
| `baseUrl`          | `http://localhost:<port>`                            | `GEEKITY_BASE_URL`           | Public origin for canonical URLs, feeds and ActivityPub ids. A trailing slash is stripped. See [The base URL](#the-base-url).                                                                                                                                                                                            |
| `watch`            | `true`                                               | `GEEKITY_WATCH`              | Watch `contentDir` while serving and keep the index in step.                                                                                                                                                                                                                                                             |
| `sessionLifetime`  | `1209600` (14 days)                                  | `GEEKITY_SESSION_LIFETIME`   | How long an admin login lasts, in seconds.                                                                                                                                                                                                                                                                               |
| `loginAttempts`    | `5`                                                  | `GEEKITY_LOGIN_ATTEMPTS`     | Failed sign-ins a username or an address may make before it is locked out.                                                                                                                                                                                                                                               |
| `loginLockout`     | `900` (15 minutes)                                   | `GEEKITY_LOGIN_LOCKOUT`      | How long the first lockout lasts, in seconds. See [Login hardening](security.md#login-hardening).                                                                                                                                                                                                                        |
| `trustProxy`       | `false`                                              | `GEEKITY_TRUST_PROXY`        | Trust `X-Forwarded-For` to give the address a sign-in came from, and a PROXY protocol header to give a Gemini client's. See [The Gemini listener](#the-gemini-listener).                                                                                                                                                 |
| `accessLog`        | `false`; `true` under `geekity serve`                | `GEEKITY_ACCESS_LOG`         | One line per request on stdout: method, path with query, status, duration. See [The access log](#the-access-log).                                                                                                                                                                                                        |
| `accessLogAddress` | `false`                                              | `GEEKITY_ACCESS_LOG_ADDRESS` | Add the client address to the end of each access-log line. `trustProxy` decides which address is used.                                                                                                                                                                                                                   |
| `accessLogWriter`  | stdout                                               | —                            | Where the lines go instead. See [The access log](#the-access-log).                                                                                                                                                                                                                                                       |
| `seedContent`      | `false`                                              | `GEEKITY_SEED_CONTENT`       | When `geekity serve` starts and `contentDir` is missing or empty, fill it with the starter site that `geekity init` writes, with the `site.json` `url` set to the base URL. A directory with any entry in it, even a dotfile, is never touched. Off by default, so a site run from npm is not written to unless you ask. |
| `maintenance`      | `false`                                              | `GEEKITY_MAINTENANCE`        | Keep the site in maintenance mode, answering 503, until it restarts without this field. For everyday use, run `geekity maintenance on` and `off`, or use Tools > Maintenance. See [Maintenance mode](public-site.md#maintenance-mode).                                                                                   |
| `devMode`          | `false`                                              | `GEEKITY_DEV_MODE`           | Start the site in dev mode. Dev mode holds every outbound side effect until `geekity dev-mode off` or the switch at Tools > Dev mode. See [Dev mode](deploying.md#dev-mode).                                                                                                                                             |
| `compression`      | `true`                                               | `GEEKITY_COMPRESSION`        | Compress text responses with brotli or gzip. Turn it off behind a proxy that compresses. See [Compression](public-site.md#compression).                                                                                                                                                                                  |
| `geminiCert`       | none                                                 | `GEEKITY_GEMINI_CERT`        | Your own PEM certificate for Gemini, instead of the one the site generates. Needs `geminiKey`. See [The Gemini certificate](#the-gemini-certificate).                                                                                                                                                                    |
| `geminiKey`        | none                                                 | `GEEKITY_GEMINI_KEY`         | The PEM private key for `geminiCert`.                                                                                                                                                                                                                                                                                    |
| `geminiPort`       | `1965`                                               | `GEEKITY_GEMINI_PORT`        | Port the Gemini listener uses while Gemini is on. `0` picks a free one. See [The Gemini listener](#the-gemini-listener).                                                                                                                                                                                                 |
| `securityHeaders`  | [see Security headers](security.md#security-headers) | —                            | Headers on every response. A string replaces a default or adds a header. `false` removes a header.                                                                                                                                                                                                                       |
| `onDocumentChange` | none                                                 | —                            | Hook run for every change to the index. See [Hooks](plugins.md#hooks).                                                                                                                                                                                                                                                   |
| `onPublish`        | none                                                 | —                            | Hook run when a document becomes visible. See [Hooks](plugins.md#hooks).                                                                                                                                                                                                                                                 |
| `federation`       | `{}`                                                 | —                            | Federation stores and guards. See [Federation](federation.md).                                                                                                                                                                                                                                                           |
| `jobs`             | `{}`                                                 | —                            | The admin job queue's transport and record store, and jobs the site adds. See [Admin jobs](#admin-jobs).                                                                                                                                                                                                                 |
| `commentChecker`   | Akismet                                              | —                            | The site's own spam checker. It takes precedence over the `akismet.key` setting. See [Akismet](comments.md#akismet).                                                                                                                                                                                                     |
| `formChallenge`    | hCaptcha                                             | —                            | The challenge a stranger answers before the contact form or the comment form is sent. It takes precedence over the `hcaptcha` site key and secret. A missing or failed answer files the submission as spam.                                                                                                              |
| `mail`             | `{}`                                                 | —                            | Mail provider, retries, backoff and logger. See [Email](email.md).                                                                                                                                                                                                                                                       |
| `plugins`          | `[]`                                                 | —                            | The installed plugins. The `plugins` key of `site.json`, set under Admin > Plugins, picks which ones run. Each setting of a plugin takes an environment variable. See [Plugin settings](#plugin-settings).                                                                                                               |

An environment variable takes precedence over the config file, and the config
file over the default. A host can override any field without editing the site.
A boolean environment variable takes `true`, `1`, `yes` and `on`, or their
opposites. Any other value is an error. It is not read as `false`.

## Uploads and images

Seven more fields control the admin's uploads and the images derived from them:

| Field                 | Default                     | Environment override             | Meaning                                                                  |
| --------------------- | --------------------------- | -------------------------------- | ------------------------------------------------------------------------ |
| `uploadMaxBytes`      | `10485760` (10 MiB)         | `GEEKITY_UPLOAD_MAX_BYTES`       | Largest file the editor's upload endpoint accepts.                       |
| `uploadMediaMaxBytes` | `209715200` (200 MiB)       | `GEEKITY_UPLOAD_MEDIA_MAX_BYTES` | Largest audio or video file it accepts, in place of `uploadMaxBytes`.    |
| `uploadTypes`         | every type below            | `GEEKITY_UPLOAD_TYPES`           | Extensions it accepts, as a list (comma-separated in the env).           |
| `imageOptimization`   | `true`                      | `GEEKITY_IMAGE_OPTIMIZATION`     | Derive smaller copies of uploaded images and offer them in the pages.    |
| `imageWidths`         | `320, 640, 960, 1280, 1920` | `GEEKITY_IMAGE_WIDTHS`           | The widths those copies are made at, in pixels.                          |
| `imageFormats`        | `['webp']`                  | `GEEKITY_IMAGE_FORMATS`          | The formats besides the original's own. `avif` is opt-in.                |
| `requireAltText`      | `false`                     | `GEEKITY_REQUIRE_ALT_TEXT`       | Refuse to publish an image with no alt text. When `false`, warn instead. |

`uploadTypes` defaults to every type the CMS knows a media type for:

- `.avif`, `.gif`, `.jpeg`, `.jpg`, `.md`, `.pdf`, `.png`, `.txt` and `.webp`.
- The captions formats `.vtt` and `.srt`.
- The audio and video formats `.mp3`, `.m4a`, `.aac`, `.ogg`, `.oga`, `.opus`,
  `.mp4`, `.m4v` and `.webm`.

The CMS checks each binary format by its first bytes:

| Format        | First bytes                                 |
| ------------- | ------------------------------------------- |
| MP3           | An ID3 tag or an MPEG frame                 |
| M4A, MP4, M4V | `ftyp` at offset 4                          |
| AAC           | An ADTS header                              |
| Ogg, Opus     | `OggS`                                      |
| WebM          | The EBML header                             |
| WebVTT        | `WEBVTT`, after an optional byte order mark |

SubRip has no header and is accepted as text. The dot and the case are
optional, so `PNG` and `.png` are the same entry. The CMS refuses to boot on a
name it has no media type for. It does not ignore the name, so a typo in an
allowlist shows up at once.

You cannot add SVG to the list. An SVG is markup that can carry script, and the
site serves uploads from its own origin. An uploaded SVG would be a stored
cross-site scripting hole in the site's own pages. HTML is excluded for the
same reason. Host a transcript in HTML on another site and link to it.

Audio and video are limited by `uploadMediaMaxBytes`. Every other file is
limited by `uploadMaxBytes`. The limits are separate because an episode is a
hundred times the size of a photo. One limit large enough for an episode would
let every upload be that big. A proxy in front of the site has its own limit on
a request body. See
[Start it and point the proxy at it](deploying.md#3-start-it-and-point-the-proxy-at-it).

The site serves uploads with their media type. It answers a single `Range`
request with `206 Partial Content`. Safari needs this before it plays a file,
and every player uses it to seek. The CMS removes location and camera metadata
from pictures and videos before it stores them. See
[Location and camera metadata](media.md#location-and-camera-metadata).

A request for an upload that is not there gets the site's 404 page, unless a
declared redirect or a document's `redirect_from` names that path. See
[Declared redirects](public-site.md#declared-redirects).

## The base URL

`baseUrl` is the only field that the admin's [settings screen](settings.md)
also offers. A `GEEKITY_BASE_URL` or a `baseUrl` in the config file takes
precedence, and the form shows which value is in effect and why. When neither
sets a value, the site uses the stored setting instead of the
`http://localhost:<port>` fallback.
[The base URL setting](settings.md#the-base-url-setting) has the full rule.

## The Gemini certificate

Gemini is off until `site.gemini` is on. Turn it on with **Serve over
Gemini** on Settings > Reading, with `"gemini": true` in
`content/_data/site.json`, or with `GEEKITY_SITE__GEMINI=on`.

Gemini clients do not check a certificate against a certificate authority.
A client trusts the certificate it sees on its first visit, and it keeps that
certificate (trust on first use, or TOFU). If the certificate changes later,
the client warns the reader that the capsule may be an impostor. Keep the same
certificate for as long as the site exists.

When the site starts with Gemini on and has no certificate, it generates one:

- `data/gemini/cert.pem` is a self-signed X.509 certificate for the host of
  the base URL in effect. It uses an ECDSA P-256 key and is valid for 50 years.
- `data/gemini/key.pem` is its private key, at mode `0600` in a folder of mode
  `0700`.

Turning Gemini on from the admin generates the pair at once. Every later start
uses the same pair. Both files are `kept` data, so a backup of `data/` and
`geekity export` carry them, and `geekity import` restores them with their
modes. A site moved with its archive keeps its identity.

A changed base URL does not replace the certificate. `geekity gemini cert`
says when the certificate does not name the host of the base URL. To replace
it, run `geekity gemini new-cert` and restart the site. Every client that
visited before then warns about the new certificate.

```
$ geekity gemini cert
Certificate: /srv/site/data/gemini/cert.pem
Subject: CN=shll.me
Expires: 2076-10-23T12:00:00.000Z
SHA-256 fingerprint: 3F:9A:…:C2
```

Settings > Reading shows the same fingerprint below **Serve over Gemini**.
Publish it where readers can compare it with what their client shows.

To use your own certificate, set `geminiCert` and `geminiKey`, or
`GEEKITY_GEMINI_CERT` and `GEEKITY_GEMINI_KEY`, to PEM files. Set both or
neither. The site does not generate a certificate while they are set, and
`geekity gemini new-cert` refuses to replace your files. When a file is
missing, cannot be read, is not a PEM certificate or key, or the key does not
belong to the certificate, the site still starts and serves HTTP. It does not
serve Gemini, and it logs one line that names the file and the problem.
Settings > Reading and `geekity gemini cert` show the same problem.

## The Gemini listener

While `site.gemini` is on and the certificate is usable, the site answers
`gemini://` requests on `geminiPort` (default `1965`), in the same process as
HTTP. Turning Gemini on or off in the admin starts or stops the listener
without a restart. Under `geekity serve`, a reload keeps the port open, as it
does the HTTP port. `geekity serve` prints the port when it starts:

```
Geekity CMS is serving https://shll.me on port 3000
Gemini is on port 1965 for shll.me
```

The listener answers only for the host of the base URL in effect, the host
the certificate names. A request for another host or another scheme gets `53`.
Each request is one absolute URL of at most 1024 bytes, ending in CR LF, that
arrives within 10 seconds. Anything else gets `59`.

Each request is answered from the same page HTTP serves for it:

| Request                                     | Answer                                                                                                         |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `gemini://host/path/`                       | `20 text/gemini` with the body of `/path/index.gmi`                                                            |
| `gemini://host/path/index.gmi`              | the same                                                                                                       |
| `gemini://host/uploads/…`, an image variant | `20` with the file's media type                                                                                |
| a moved page                                | `31` (permanent) or `30` (temporary), to a path on the capsule                                                 |
| a page that does not exist                  | `51`                                                                                                           |
| a deleted page                              | `52`                                                                                                           |
| maintenance mode                            | `41`, with the back-by time when one is set                                                                    |
| a server error                              | `40`                                                                                                           |
| `gemini://host/search/`                     | `10`, asking for a query. The client sends it back as the query string, and the answer is the search's gemtext |

Every gemtext page links to the site's pages by root-relative `.gmi` paths, so
a reader who follows a link stays on the capsule. Links to other sites are
unchanged.

Each client address may make 60 requests a minute. A request over that gets
`44` with the seconds to wait.

Behind a layer-4 proxy, the socket's address is the proxy's. With `trustProxy`
on, a connection may open with a PROXY protocol header, version 1 or 2, and
the client address in it is the one the throttle counts and the access log
shows. The header is optional: a connection without one is the client itself.
A header that cannot be read, is longer than 2 KiB, or is not complete
within 10 seconds closes the connection. Only a proxy whose own address is
loopback (127.0.0.0/8, `::1`), private (10.0.0.0/8, 172.16.0.0/12,
192.168.0.0/16, `fc00::/7`) or link-local (169.254.0.0/16, `fe80::/10`) may
send the header, IPv4-mapped IPv6 forms included. That covers a proxy on the
same host and one that reaches the container over the Docker bridge. A
connection from any other address that opens with a PROXY header is closed,
so a proxy on another host with a public address is not trusted, and a
visitor cannot name a different client address. With `trustProxy` off, a
connection that opens with a PROXY header is closed. [Serving Gemini](deploying.md#serving-gemini) has
proxy configurations for Caddy and nginx.

While Gemini is on, the site links to its capsule. Each HTML page that has
gemtext carries `<link rel="alternate" type="text/gemini">` with its
gemini:// URL, its Markdown ends with a `Gemini` section linking the same URL,
and the generated `/llms.txt` names the capsule. A gemini:// URL has the host
of the base URL in effect and `geminiPort`, left out when it is 1965.

## hCaptcha

The hCaptcha site key and secret are runtime settings, not config fields. They
are kept in `data/hcaptcha.json` at mode `0600`, set on Settings > Discussion,
and can come from the environment instead:

| Setting             | Variable                     | What it is                                                      |
| ------------------- | ---------------------------- | --------------------------------------------------------------- |
| `hcaptcha.site_key` | `GEEKITY_HCAPTCHA__SITE_KEY` | The site key, printed in every page that shows the challenge.   |
| `hcaptcha.secret`   | `GEEKITY_HCAPTCHA__SECRET`   | The secret that checks a token with hCaptcha. A secret setting. |

A set variable takes precedence over the file. Settings > Discussion then shows
the value as set by that variable, with no box to change it. Both values are
read on every call, so a change to the file takes effect without a restart. A
change to a variable needs one, as every variable does. See
[hCaptcha](comments.md#hcaptcha).

The public site sends no content policy by default, so hCaptcha needs no
change to the headers. A site that sets its own `Content-Security-Policy`
through [`securityHeaders`](security.md#security-headers) must allow
`https://hcaptcha.com` and `https://*.hcaptcha.com` in `script-src`,
`frame-src`, `style-src` and `connect-src`. These are the origins
[hCaptcha's documentation](https://docs.hcaptcha.com/#content-security-policy-settings)
asks for. Name the wildcard rather than single hosts: hCaptcha serves its
assets from subdomains that change. The theme's `/theme/hcaptcha.js` is on the
site's own origin, and the default theme adds no inline script, so the policy
needs no nonce or hash for it. The `siteverify` call is made by the server and
is not covered by the policy.

```ts
export default defineConfig({
  securityHeaders: {
    'Content-Security-Policy': [
      "default-src 'self'",
      "script-src 'self' https://hcaptcha.com https://*.hcaptcha.com",
      "frame-src 'self' https://hcaptcha.com https://*.hcaptcha.com",
      "style-src 'self' https://hcaptcha.com https://*.hcaptcha.com",
      "connect-src 'self' https://hcaptcha.com https://*.hcaptcha.com",
      "frame-ancestors 'self'",
    ].join('; '),
  },
});
```

## Plugin settings

A plugin's settings are kept in its folder under `data/plugins/`:

- `data/plugins/<package name>/settings.json` holds the public settings.
- `data/plugins/<package name>/secrets.json` holds the secrets, such as an API
  key, at mode `0600`.

Any plugin setting, public or secret, can also come from the environment. A
Docker site uses this to keep a key in `.env`. To build the variable name,
take the plugin's package name, then `__`, then the setting's key. Upper-case
each part, and replace every run of other characters, underscores included,
with one `_`:

| Package               | Setting         | Variable                            |
| --------------------- | --------------- | ----------------------------------- |
| `@geekity/plugin-llm` | `api_key`       | `GEEKITY_PLUGIN_LLM__API_KEY`       |
| `@geekity/plugin-llm` | `default_model` | `GEEKITY_PLUGIN_LLM__DEFAULT_MODEL` |
| `@acme/plugin-llm`    | `api_key`       | `ACME_PLUGIN_LLM__API_KEY`          |

A set variable takes precedence over the value stored in the file. The
plugin's screen then shows the setting as set by the environment, with no box
to change it, and a save leaves it alone. The screen prints the exact variable
name for each setting.

A plugin cannot load if its package name is a core settings namespace, such as
`site`, or if its variables would start the way core's do, such as
`@geekity/maintenance`. If two installed packages have names that convert to
the same prefix, such as `@a/b-c` and `@a-b/c`, neither loads. Admin > Plugins
names the reason in each case.

### Moving plugin settings out of site.json

Before this layout, public plugin settings were kept in
`content/_data/site.json`, beside `enabled` under `plugins.<package name>`.
When the site starts, it moves every key except `enabled` to the plugin's
`settings.json` and logs each plugin it moved. A value that is already in
`settings.json` is kept. `enabled` stays in `site.json`. A site under git sees
the change in `site.json` the first time it starts on the new version.

To move the settings with the site stopped, run:

```sh
geekity settings migrate-plugins
```

It prints one line for each plugin it moved. Running it again, or after an
interrupted run, moves nothing more and leaves the same files.

## Using the package from an entry file

Use an entry file to add your own routes and middleware. A site that adds
nothing can delete `server.ts` and run
[`geekity serve`](cli.md#how-geekity-serve-runs).

```ts
import { createCms, settleConfig } from '@geekity/cms';

import config from './geekity.config.ts';

const cms = createCms(await settleConfig(config));

cms.app.get('/hello/', (c) => c.text('a route of my own'));

await cms.serve();
```

`settleConfig(config)` resolves the config and takes the base URL from the
site's settings when the environment and the config file set none. See
[The base URL setting](settings.md#the-base-url-setting).

`createCms(config)` returns a `Cms`:

| Member                   | What it is                                                                                                                 |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `app`                    | The Hono app. Add routes and middleware before serving; handlers reach `c.var.store`, `c.var.config` and `c.var.renderer`. |
| `config`                 | The config after defaults and environment overrides, every path absolute.                                                  |
| `store`                  | The content index. See [The content index](content.md#the-content-index).                                                  |
| `events`                 | Index changes as they happen. See [Hooks](plugins.md#hooks).                                                               |
| `onDocumentChange(hook)` | Subscribe to every change; returns the unsubscribe.                                                                        |
| `onPublish(hook)`        | Subscribe to documents becoming visible; returns the unsubscribe.                                                          |
| `onSettled(listener)`    | Run after each scan, and after each run of watched changes once their `events` listeners finish; returns the unsubscribe.  |
| `sync()`                 | One full scan of the content directory. See [Keeping the index in step](content.md#keeping-the-index-in-step).             |
| `serve()`                | Scan, start watching and listen. Resolves with the bound port. Use it when the configured port is `0`.                     |
| `close()`                | Stop the watcher, the server and the index. Required, because the index holds an open database. Safe to call twice.        |

Booting opens the SQLite index under `dataDir`. Call `close()` to release it.
The tests and the demo both do.

Routes that a site registers always take precedence over the content index. The
not-found handler resolves documents, after no registered route has matched. A
post whose permalink is `/hello/` cannot shadow the `/hello/` route above. It
also cannot shadow the admin and federation routes of later milestones.

## The access log

`geekity serve` and the Docker image write one line per request to stdout.
`createCms` does not, because a CMS mounted inside another server must not
write to that server's stdout unless asked. To turn the log on when you embed
the CMS, set `accessLog: true` in the config. No environment variable is
needed:

```ts
const cms = createCms({ accessLog: true });
```

Each line has four fields, separated by single spaces: the method, the path
with its query string, the status and the request duration.

```
GET / 200 4.2ms
GET /posts/hello-world/ 200 6.8ms
GET /.well-known/webfinger?resource=acct:ada@blog.example 200 1.9ms
GET /nothing-here 404 2.1ms
POST /admin/login 303 41.3ms
```

The status is always the third field, so `grep webfinger`, `grep ' 500 '` and
`awk '$3 >= 500'` all work. The log includes the query string because it says
what was asked for, such as which account a Mastodon instance looked up or what
a visitor searched for.

The log covers every route, including `/healthz`, the federation endpoints, the
admin and the public site. A request whose handler threw gets a `500` line. The
logger reads only the request line. It does not read the body, so a password
posted to the login form cannot reach the log. It does not read cookies or the
`Authorization` header. The only header it reads is the forwarded address, and
only when `trustProxy` is on.

With `accessLogAddress: true`, the client address goes at the end, after the
duration:

```
GET /.well-known/webfinger?resource=acct:ada@blog.example 200 1.9ms 203.0.113.9
```

The address is off by default. An address is personal data, and a self-hosted
blog keeps it with no retention policy unless the site owner sets one.
`trustProxy` decides which address is logged:

- When `trustProxy` is on and the proxy sets `X-Forwarded-For`, the leftmost
  entry of that header. For a Gemini request, the address in the PROXY
  protocol header the connection opened with.
- Otherwise, the socket's own address.

The login throttle counts failed sign-ins against the same address, so the log
and the throttle always agree on the client.

A Gemini request gets one line in the same order, with `GEMINI` as the method
and the Gemini status as the third field. A request that cannot be read has `-`
as its path:

```
GEMINI /2026/10/hello-world/ 20 5.3ms
GEMINI /nothing-here/ 51 1.8ms
GEMINI - 59 0.4ms
```

Gemini has no forwarded header, so its address is always the socket's own.

The lines go to stdout because a container collects stdout, dockge shows it
and journald keeps it. To write to a file, redirect stdout. `accessLogWriter`
sends the lines somewhere else, with one call per line and no newline:

```ts
const lines: string[] = [];
const cms = createCms({
  accessLog: true,
  accessLogWriter: (line) => lines.push(line),
});
```

## Admin jobs

Long admin actions run as jobs, outside the request that started them, so a
proxy cannot time them out. A job is a registered name and a JSON payload of at
most 64 KB. The admin and the CLI queue jobs on `cms.jobs`, and the admin reads
a job's progress and result from there. The CMS registers these jobs of its
own, among others:

- `strip-metadata`, which **Tools > Maintenance** and `geekity strip-metadata`
  queue (see
  [Location and camera metadata](media.md#location-and-camera-metadata))
- `resend`, which the federation screen and `geekity resend` queue (see
  [The federation screen](federation.md#the-federation-screen))
- `retry-deliveries`, which the `retry_deliveries` [MCP tool](mcp.md#the-repair-tools)
  queues
- `fetch-font`, which downloads a hosted Google Fonts family again when its
  files are missing (see [Hosted Google Fonts](settings.md#hosted-google-fonts))

`geekity serve` runs one job at a time, in the server process. A job runs at
least once:

- When the server drains for a reload or closes, the running job is told to
  stop. It goes back to the queue with the same attempt number, and the next
  server runs it.
- When the server process dies during a job, the next server runs the job
  again as the next attempt. After three attempts the job is marked
  `interrupted` and does not run again.
- A failed job is not retried. Queue it again to run it again.

A CLI command queues its job and runs it in its own process. It never takes
over jobs that the server is running.

The server looks for cut-off jobs when it starts, after each reload, when a
failed reload is undone, each time it finishes a job and has nothing else
running, and each time the admin reads a job's status, which the **Media** and
federation screens do when they show the latest job and before they queue a new
one. So a job cut off while the server runs is picked up without a restart,
once the admin looks at it or the server finishes its current job.

Each time, it looks at every job recorded as running and decides whether that
job was cut off. A job counts as cut off,
and runs again as the next attempt, unless the process that claimed it is
still running it. The claiming process is still running it when all of these
hold:

- The record names the process (`claimer`). Records written before the CMS
  recorded one do not.
- The process ran on the same host as the server.
- It is not the server process itself.
- A process with that id is alive, and it started at the time the record
  gives. A process id that the system gave to a new process after the
  claimer died does not count.

So a job that `geekity strip-metadata` or `geekity resend` is running is left
to that command when the server starts or reloads beside it. If the command
is killed, the server runs the job again as the next attempt the next time it
looks, and the admin can then queue that job again once the attempt ends.

When it looks and has no job running, the server also sends every queued job
to its transport again. A job queued by a process that died before running it,
or handed back by a new server that failed to boot during a reload, then runs.
A queued job whose message is still on its way is not run twice: the first
worker to claim it runs it, and the second message finds it already claimed.

When a reload fails, the supervisor stops the new server and waits for it to
exit before the old server carries on, so a job the new server had started
counts as cut off, and the old server runs it again as the next attempt.

### Where job records are stored

Job records are in `data/jobs.json`, a JSON list with the oldest job first.
Each record holds:

- `id`, `name` and `payload`: the job and what it was queued with.
- `queuedAt`: when it was queued.
- `state`: `queued`, `running`, `finished`, `failed` or `interrupted`.
- `attempt`: which run this is, starting at 1.
- For a running job: `owner`, the queue that runs it, `claimer`, the process
  that runs it (`host`, `pid`, and `since`, when the process started),
  `startedAt` and the last `progress` (`done`, and optionally `total` and
  `note`).
- For a finished job: `finishedAt` and the handler's `result`.
- For a failed job: `finishedAt` and the `error` message.
- For an interrupted job, and for a job queued again after a crash:
  `interruptedAt`.

Every queued and running job is kept, and the newest five finished, failed or
interrupted jobs of each name. Older ones are removed when the file is next
written. The site writes the file by renaming a finished copy over it, and
holds `data/jobs.json.lock` while it does, so the server and a CLI command can
write it at the same time. A lock whose process has died, or that is over ten
seconds old, is taken over. Only one waiting process takes it over: it holds
`data/jobs.json.lock.takeover` while it removes the old lock. A process
releasing the lock also holds the takeover file, and removes the lock only if
it is still its own, so a process that held the lock past ten seconds never
removes the lock of the process that took it over. `geekity rebuild` does not
touch the file. If you
delete it, queued jobs and the history are lost, and nothing else.

### Swapping the transport and the record store

`jobs.transport` carries each job's id to the server, and `jobs.records`
stores the records. Both have defaults: an in-process transport and
`data/jobs.json`. Any Fedify `MessageQueue` works as a transport. Give it a
queue of its own, not the one `federation.queue` uses. The federation queue is
the table `federation_messages` in `data/queue.sqlite`, so a transport in the
same file needs a table of its own:

```ts
import { DatabaseSync } from 'node:sqlite';
import { SqliteMessageQueue } from '@fedify/sqlite';
import { defineConfig } from '@geekity/cms/config';

export default defineConfig({
  jobs: {
    transport: new SqliteMessageQueue(new DatabaseSync('data/queue.sqlite'), {
      tableName: 'geekity_job',
    }),
  },
});
```

A record store implements `JobRecords`. Each of its transitions must be a
compare-and-set on the job's state and attempt, because that is what stops two
workers from running one job. It stores the state it is given as it is,
`claimer` included, because start-up recovery reads `claimer` to tell a job
another process is running from one that was cut off. `create` takes an
optional check and must run it against the newest job of the same name in the
same step as the write: when the check holds, it records nothing and returns
that job. That is what stops two admin presses, or a press and a CLI command,
from both queuing a job of one name. `jobs.definitions` registers jobs beside
the CMS's own.
