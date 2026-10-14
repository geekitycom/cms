# Configuration

Declare config in `geekity.config.ts`. `defineConfig` type checks it.

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
| `trustProxy`       | `false`                                              | `GEEKITY_TRUST_PROXY`        | Trust `X-Forwarded-For` to give the address a sign-in came from.                                                                                                                                                                                                                                                         |
| `accessLog`        | `false`; `true` under `geekity serve`                | `GEEKITY_ACCESS_LOG`         | One line per request on stdout: method, path with query, status, duration. See [The access log](#the-access-log).                                                                                                                                                                                                        |
| `accessLogAddress` | `false`                                              | `GEEKITY_ACCESS_LOG_ADDRESS` | Add the client address to the end of each access-log line. `trustProxy` decides which address is used.                                                                                                                                                                                                                   |
| `accessLogWriter`  | stdout                                               | —                            | Where the lines go instead. See [The access log](#the-access-log).                                                                                                                                                                                                                                                       |
| `seedContent`      | `false`                                              | `GEEKITY_SEED_CONTENT`       | When `geekity serve` starts and `contentDir` is missing or empty, fill it with the starter site that `geekity init` writes, with the `site.json` `url` set to the base URL. A directory with any entry in it, even a dotfile, is never touched. Off by default, so a site run from npm is not written to unless you ask. |
| `maintenance`      | `false`                                              | `GEEKITY_MAINTENANCE`        | Keep the site in maintenance mode, answering 503, until it restarts without this field. For everyday use, run `geekity maintenance on` and `off`, or use Tools > Maintenance. See [Maintenance mode](public-site.md#maintenance-mode).                                                                                   |
| `devMode`          | `false`                                              | `GEEKITY_DEV_MODE`           | Start the site in dev mode. Dev mode holds every outbound side effect until `geekity dev-mode off` or the switch at Tools > Dev mode. See [Dev mode](deploying.md#dev-mode).                                                                                                                                             |
| `compression`      | `true`                                               | `GEEKITY_COMPRESSION`        | Compress text responses with brotli or gzip. Turn it off behind a proxy that compresses. See [Compression](public-site.md#compression).                                                                                                                                                                                  |
| `securityHeaders`  | [see Security headers](security.md#security-headers) | —                            | Headers on every response. A string replaces a default or adds a header. `false` removes a header.                                                                                                                                                                                                                       |
| `onDocumentChange` | none                                                 | —                            | Hook run for every change to the index. See [Hooks](plugins.md#hooks).                                                                                                                                                                                                                                                   |
| `onPublish`        | none                                                 | —                            | Hook run when a document becomes visible. See [Hooks](plugins.md#hooks).                                                                                                                                                                                                                                                 |
| `federation`       | `{}`                                                 | —                            | Federation stores and guards. See [Federation](federation.md).                                                                                                                                                                                                                                                           |
| `commentChecker`   | Akismet                                              | —                            | The site's own spam checker. It takes precedence over the `akismet.key` setting. See [Akismet](comments.md#akismet).                                                                                                                                                                                                     |
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

## The base URL

`baseUrl` is the only field that the admin's [settings screen](settings.md)
also offers. A `GEEKITY_BASE_URL` or a `baseUrl` in the config file takes
precedence, and the form shows which value is in effect and why. When neither
sets a value, the site uses the stored setting instead of the
`http://localhost:<port>` fallback.
[The base URL setting](settings.md#the-base-url-setting) has the full rule.

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
  entry of that header.
- Otherwise, the socket's own address.

The login throttle counts failed sign-ins against the same address, so the log
and the throttle always agree on the client.

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
