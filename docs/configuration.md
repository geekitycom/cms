# Configuration

Declare config in `geekity.config.ts`; `defineConfig` gives it type checking.

```ts
import { defineConfig } from '@geekity/cms';

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

Every field is optional. Relative directories resolve against the working
directory; absolute ones are used as given.

| Field              | Default                                              | Environment override         | Meaning                                                                                                                                                                                                                                                                                                      |
| ------------------ | ---------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `port`             | `3000`                                               | `GEEKITY_PORT`, then `PORT`  | Port the HTTP server listens on. `0` picks a free one.                                                                                                                                                                                                                                                       |
| `contentDir`       | `<cwd>/content`                                      | `GEEKITY_CONTENT_DIR`        | Markdown content.                                                                                                                                                                                                                                                                                            |
| `dataDir`          | `<cwd>/data`                                         | `GEEKITY_DATA_DIR`           | Derived state — the SQLite index, the image variants — and the files that are not derived and must be backed up, such as `users.json`, the actor key pairs under `keys/`, `locations.json` and `kept-properties.json`. [Two directories](content.md#two-directories-content-and-data) lists them.            |
| `themesDir`        | `<cwd>/themes`                                       | `GEEKITY_THEMES_DIR`         | The site's themes, one directory per theme, each with a `theme.json`. Which one is in use is the `theme` setting in `site.json`, not a path. Need not exist.                                                                                                                                                 |
| `pluginsDir`       | none                                                 | `GEEKITY_PLUGINS_DIR`        | A folder of plugins, `<name>/` or `@scope/<name>/`, each with a bundled `index.js` whose default export is the plugin. `geekity serve` loads them beside `plugins`, and Reload on the Plugins screen loads a changed folder without a restart. Unset, no code is loaded from a folder.                       |
| `pluginInstall`    | `true`                                               | `GEEKITY_PLUGIN_INSTALL`     | Let Admin > Plugins add, update and remove plugins in `pluginsDir`. Set it to `off` to keep plugin changes on the command line; see [Installing from the admin](plugins.md#installing-from-the-admin).                                                                                                       |
| `pluginWatch`      | `true`                                               | `GEEKITY_PLUGIN_WATCH`       | Under `geekity serve`, reload by itself when `pluginsDir` has changed and then stood still for five seconds. Set it to `off` to load changes only with Reload, the admin's changes and `geekity plugin`.                                                                                                     |
| `baseUrl`          | `http://localhost:<port>`                            | `GEEKITY_BASE_URL`           | Public origin for canonical URLs, feeds and ActivityPub ids. A trailing slash is stripped. See [The base URL](#the-base-url).                                                                                                                                                                                |
| `watch`            | `true`                                               | `GEEKITY_WATCH`              | Watch `contentDir` while serving and keep the index in step.                                                                                                                                                                                                                                                 |
| `sessionLifetime`  | `1209600` (14 days)                                  | `GEEKITY_SESSION_LIFETIME`   | How long an admin login lasts, in seconds.                                                                                                                                                                                                                                                                   |
| `loginAttempts`    | `5`                                                  | `GEEKITY_LOGIN_ATTEMPTS`     | Failed sign-ins a username or an address may make before it is locked out.                                                                                                                                                                                                                                   |
| `loginLockout`     | `900` (15 minutes)                                   | `GEEKITY_LOGIN_LOCKOUT`      | How long the first lockout lasts, in seconds. See [Login hardening](security.md#login-hardening).                                                                                                                                                                                                            |
| `trustProxy`       | `false`                                              | `GEEKITY_TRUST_PROXY`        | Believe `X-Forwarded-For` when deciding which address a sign-in came from.                                                                                                                                                                                                                                   |
| `accessLog`        | `false`; `true` under `geekity serve`                | `GEEKITY_ACCESS_LOG`         | One line per request on stdout: method, path with query, status, duration. See [The access log](#the-access-log).                                                                                                                                                                                            |
| `accessLogAddress` | `false`                                              | `GEEKITY_ACCESS_LOG_ADDRESS` | Put the client address on the end of each access-log line. `trustProxy` decides which address that is.                                                                                                                                                                                                       |
| `accessLogWriter`  | stdout                                               | —                            | Where the lines go instead. See [The access log](#the-access-log).                                                                                                                                                                                                                                           |
| `seedContent`      | `false`                                              | `GEEKITY_SEED_CONTENT`       | When `geekity serve` starts and `contentDir` is missing or has no entries at all, fill it with the starter site `geekity init` writes, its `site.json` `url` set to the base URL. A directory with anything in it, even a dotfile, is never touched. Off so a site run from npm is never written to unasked. |
| `maintenance`      | `false`                                              | `GEEKITY_MAINTENANCE`        | Keep the site in maintenance mode, answering 503, until a restart without it. `geekity maintenance on` and `off` are the everyday switch; see [Maintenance mode](public-site.md#maintenance-mode).                                                                                                           |
| `devMode`          | `false`                                              | `GEEKITY_DEV_MODE`           | Start the site in dev mode, which holds every outbound side effect until `geekity dev-mode off`. See [Dev mode](deploying.md#dev-mode).                                                                                                                                                                      |
| `compression`      | `true`                                               | `GEEKITY_COMPRESSION`        | Compress text responses with brotli or gzip. Turn it off behind a proxy that compresses. See [Compression](public-site.md#compression).                                                                                                                                                                      |
| `securityHeaders`  | [see Security headers](security.md#security-headers) | —                            | Headers every response carries. A string replaces a default or adds a header, `false` removes one.                                                                                                                                                                                                           |
| `onDocumentChange` | none                                                 | —                            | Hook run for every change to the index. See [Hooks](plugins.md#hooks).                                                                                                                                                                                                                                       |
| `onPublish`        | none                                                 | —                            | Hook run when a document becomes visible. See [Hooks](plugins.md#hooks).                                                                                                                                                                                                                                     |
| `federation`       | `{}`                                                 | —                            | Federation stores and guards. See [Federation](federation.md).                                                                                                                                                                                                                                               |
| `commentChecker`   | Akismet                                              | —                            | A spam checker of the site's own, which wins over the key in `data/akismet.json`. See [Akismet](comments.md#akismet).                                                                                                                                                                                        |
| `mail`             | `{}`                                                 | —                            | Mail provider, retries, backoff and logger. See [Email](email.md).                                                                                                                                                                                                                                           |
| `plugins`          | `[]`                                                 | —                            | The installed plugins. Which run is the `plugins` key of `site.json`, set under Admin > Plugins. A plugin's secret settings take an environment variable each; see [Plugin secrets](#plugin-secrets).                                                                                                        |

Precedence is environment variable, then config file, then default, so a host
can override anything without editing the site. A boolean environment variable
takes `true`, `1`, `yes` and `on`, or their opposites; anything else is an error
rather than a silent `false`.

## Uploads and images

The admin's uploads and the images derived from them take seven more:

| Field                 | Default                     | Environment override             | Meaning                                                                 |
| --------------------- | --------------------------- | -------------------------------- | ----------------------------------------------------------------------- |
| `uploadMaxBytes`      | `10485760` (10 MiB)         | `GEEKITY_UPLOAD_MAX_BYTES`       | Largest file the editor's upload endpoint accepts.                      |
| `uploadMediaMaxBytes` | `209715200` (200 MiB)       | `GEEKITY_UPLOAD_MEDIA_MAX_BYTES` | Largest audio or video file it accepts, in place of `uploadMaxBytes`.   |
| `uploadTypes`         | every type below            | `GEEKITY_UPLOAD_TYPES`           | Extensions it accepts, as a list (comma-separated in the env).          |
| `imageOptimization`   | `true`                      | `GEEKITY_IMAGE_OPTIMIZATION`     | Derive smaller copies of uploaded images and offer them in the pages.   |
| `imageWidths`         | `320, 640, 960, 1280, 1920` | `GEEKITY_IMAGE_WIDTHS`           | The widths those copies are made at, in pixels.                         |
| `imageFormats`        | `['webp']`                  | `GEEKITY_IMAGE_FORMATS`          | The formats besides the original's own. `avif` is opt-in.               |
| `requireAltText`      | `false`                     | `GEEKITY_REQUIRE_ALT_TEXT`       | Refuse to publish an image with no alt text, rather than warn about it. |

`uploadTypes` defaults to `.avif`, `.gif`, `.jpeg`, `.jpg`, `.md`, `.pdf`,
`.png`, `.txt` and `.webp`, the captions formats `.vtt` and `.srt`, and the
audio and video formats `.mp3`, `.m4a`, `.aac`, `.ogg`, `.oga`, `.opus`,
`.mp4`, `.m4v` and `.webm` — every type the CMS knows a media type for. Each
binary format is checked by its first bytes: an ID3 tag or an MPEG frame for
MP3, `ftyp` at offset 4 for M4A, MP4 and M4V, an ADTS header for AAC, `OggS`
for Ogg and Opus, the EBML header for WebM, and `WEBVTT` (after an optional
byte order mark) for WebVTT. SubRip has no header and is taken as text. The
dot and the case are optional: `PNG` and `.png` are the same entry. A name the
CMS has no media type for is refused at boot rather than ignored, so a typo in
an allowlist is heard about immediately.

SVG is not in that list and cannot be added: an SVG is markup that may carry
script, and an upload is served from the site's own origin, so accepting one
would be a stored cross-site scripting hole in the site's own pages. HTML is
out for the same reason, so a transcript in HTML is linked from another host
rather than uploaded.

Audio and video are held to `uploadMediaMaxBytes` and everything else to
`uploadMaxBytes`, because an episode is a hundred times the size of a photo and
raising one limit far enough for it would let every upload be that big. A proxy
in front of the site has its own limit on a request body; see
[Start it and point the proxy at it](deploying.md#3-start-it-and-point-the-proxy-at-it).
Uploads are served with their media type and answer a single `Range` request
with `206 Partial Content`, which Safari needs before it plays a file and every
player uses to seek. Location and camera metadata is removed from pictures and
videos before they are stored; see
[Location and camera metadata](media.md#location-and-camera-metadata).

## The base URL

`baseUrl` is the one field the admin's [settings screen](settings.md) also
offers. A `GEEKITY_BASE_URL` or a `baseUrl` in the config file wins, and the
form says which value is in effect and why. When neither names one, the stored
setting is used instead of the `http://localhost:<port>` fallback.
[The base URL setting](settings.md#the-base-url-setting) has the whole rule.

## Plugin secrets

A plugin's secret settings, such as an API key, can come from the environment
too, which is how a Docker site keeps a key in `.env`. The variable is the
plugin's package name, then `__`, then the setting's key, each upper-cased with
every run of other characters, underscores included, written as one `_`:

| Package               | Setting   | Variable                      |
| --------------------- | --------- | ----------------------------- |
| `@geekity/plugin-llm` | `api_key` | `GEEKITY_PLUGIN_LLM__API_KEY` |
| `@acme/plugin-llm`    | `api_key` | `ACME_PLUGIN_LLM__API_KEY`    |

A set variable wins over the value stored in
`data/plugins/<package name>/secrets.json`, and the plugin's screen shows the
setting as set by the environment, with no box to change it. The screen prints
each secret's exact variable name. Only plugin variables contain `__`, so none
can shadow a core one. Two installed packages whose names convert to the same
prefix, such as `@a/b-c` and `@a-b/c`, both refuse to load, and Admin > Plugins
names the two.

## Using the package from an entry file

An entry file exists so a site can add routes and middleware of its own. A site
that adds nothing can delete `server.ts` and run
[`geekity serve`](cli.md#how-geekity-serve-runs).

```ts
import { createCms } from '@geekity/cms';

import config from './geekity.config.ts';

const cms = createCms(config);

cms.app.get('/hello/', (c) => c.text('a route of my own'));

await cms.serve();
```

`createCms(config)` returns a `Cms`:

| Member                   | What it is                                                                                                                 |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `app`                    | The Hono app. Add routes and middleware before serving; handlers reach `c.var.store`, `c.var.config` and `c.var.renderer`. |
| `config`                 | The config after defaults and environment overrides, every path absolute.                                                  |
| `store`                  | The content index. See [The content index](content.md#the-content-index).                                                  |
| `events`                 | Index changes as they happen. See [Hooks](plugins.md#hooks).                                                               |
| `onDocumentChange(hook)` | Subscribe to every change; returns the unsubscribe.                                                                        |
| `onPublish(hook)`        | Subscribe to documents becoming visible; returns the unsubscribe.                                                          |
| `sync()`                 | One full scan of the content directory. See [Keeping the index in step](content.md#keeping-the-index-in-step).             |
| `serve()`                | Scan, start watching, listen. Resolves with the port actually bound, which matters when the configured port is `0`.        |
| `close()`                | Stop the watcher, the server and the index. Safe to call twice, and required, because the index holds an open database.    |

Booting opens the SQLite index under `dataDir`, so `close()` has to be called
to release it — the tests and the demo both do.

Routes a site registers always win over the content index. Documents are
resolved in the not-found handler, after every registered route has failed to
match, so a post whose permalink is `/hello/` cannot shadow the `/hello/` route
above — and neither can it shadow the admin and federation routes of later
milestones.

## The access log

`geekity serve` and the Docker image write one line per request to stdout,
because a server answering the internet should be able to say what it
answered. `createCms` does not: a CMS mounted inside somebody else's server has
no business writing to its stdout uninvited, so an embedder asks for it with
`accessLog: true` — in the config, no environment variable needed:

```ts
const cms = createCms({ accessLog: true });
```

The line is the method, the path with its query string, the status and how
long the request took, in that order, separated by single spaces:

```
GET / 200 4.2ms
GET /posts/hello-world/ 200 6.8ms
GET /.well-known/webfinger?resource=acct:ada@blog.example 200 1.9ms
GET /nothing-here 404 2.1ms
POST /admin/login 303 41.3ms
```

So the status is always the third field, and `grep webfinger`,
`grep ' 500 '` or `awk '$3 >= 500'` all work on it. The query string is
logged because it is the part that says what was asked for — which account a
Mastodon instance looked up, what somebody searched for.

Every route is on it — `/healthz`, the federation endpoints, the admin and the
public site — and a request whose handler threw gets its `500` line. Nothing
but the request line is ever read: no body is touched, so a password posted to
the login form cannot reach the log, and no cookie or `Authorization` header
is looked at either. The only header it can see is the forwarded address, and
only when the site is behind a proxy it has been told to believe.

With `accessLogAddress: true` the client address goes on the end, after the
duration:

```
GET /.well-known/webfinger?resource=acct:ada@blog.example 200 1.9ms 203.0.113.9
```

It is off by default: an address is personal data, and a self-hosted blog
collects it with no retention policy unless somebody decides otherwise. Which
address is right is `trustProxy`'s answer — the leftmost `X-Forwarded-For`
entry behind a proxy that sets it, the socket's own address otherwise — the
same one the login throttle counts a failed sign-in against, so the log and the
throttle can never disagree about who was asking.

The lines go to stdout because that is what a container collects, what dockge
shows and what journald keeps; a site that wants a file redirects it.
`accessLogWriter` takes the lines somewhere else, one call per line, without
the newline:

```ts
const lines: string[] = [];
const cms = createCms({
  accessLog: true,
  accessLogWriter: (line) => lines.push(line),
});
```
