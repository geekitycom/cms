# Geekity CMS

A file-first CMS. Content is Markdown on disk, laid out so Eleventy can build
the same directory unchanged. One Node process is both the editor and the public
website. Everything a site cannot afford to lose is a file; SQLite is a cache
over those files that may be deleted at rest and is rebuilt on the next boot.

This repository is a pnpm workspace. The CMS ships to npm as `@geekity/cms`; a
site is its own repository that depends on the package.

This file is the contributor guide: the workspace, the gates, CI and releasing.
If you are **building a site** on the package, read
[`packages/cms/README.md`](packages/cms/README.md) instead — it covers
`geekity init`, the config options, the CLI, hooks and theme overrides. To
run a site from the published Docker image, see
[Deploying with Docker](#deploying-with-docker).

## Workspace layout

```
packages/cms/          published as @geekity/cms
  src/
    index.ts           public API: createCms(config), defineConfig, types
    config.ts          config schema, defaults, environment overrides
    cli.ts             the `geekity` bin
    *.test.ts          node:test suites, run through tsx, excluded from the build
  editor/              the admin editor's browser code, bundled by esbuild
  admin/               admin templates and static files, editor.js among them
    pages/             one folder per admin menu section, a file per screen
    layouts/           the chrome a page extends: base, shell, settings-page
    components/        DaisyUI component macros, the flash and the admin bar
    src/admin.css      its stylesheet's Tailwind and DaisyUI source;
                       static/admin.css is the compiled output, gitignored
  themes/default/      default theme, shipped inside the package
    src/style.css      its stylesheet's Tailwind source; static/style.css is
                       the compiled output, gitignored
  templates/site/      files `geekity init` copies into a new site
  dist/                tsc output (JS + .d.ts), gitignored
apps/demo/             private site that consumes the package via workspace:*
  geekity.config.ts
  server.ts
  content/           the seed: six posts, three pages and _data/site.json
    _includes/       the two layouts an Eleventy build of the same files needs
  playground/        the copy of content/ that `pnpm dev` serves, gitignored
  playground.ts      makes playground/ when it is missing; --reset remakes it
  themes/demo/       a theme to activate in Appearance: post.njk, style.css, theme.json
  eleventy.config.js re-exports the documented example config
  test/              boots the demo over HTTP, and builds it with Eleventy
scripts/               pack-install-smoke.sh and docker-smoke.sh, the bodies of those CI jobs,
                       and docker-build-push.sh, which publishes the image
deploy/compose.yaml    the compose file a Docker deployment starts from
backlog/               tasks, docs and decisions (Backlog.md)
```

## Requirements

Node 24 or newer and pnpm. Node 24 is the active LTS line, and it is the first
one where `node:sqlite`, which the content index is built on, boots without an
`ExperimentalWarning`. It is also the development target: `.node-version` pins
24, so fnm, nvm and similar tools pick it in this checkout, and CI reads the same
file. CI also runs the suite on the current line so the next LTS holds no
surprises. The pnpm version is pinned in `packageManager`, so
Corepack picks the right one:

```sh
corepack enable
pnpm install
```

## Commands

Run from the repository root.

| Command                  | What it does                                                                                                                                                                                                                                                                                              |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm install`           | Installs both workspace packages and links `apps/demo` to `packages/cms`.                                                                                                                                                                                                                                 |
| `pnpm dev`               | Starts the demo site with `tsx watch` (`pnpm --filter demo dev`). It listens on every interface and prints the network address a phone on the same Wi-Fi can open; set `GEEKITY_BASE_URL` to that address when testing feeds, IndieAuth or Micropub from the phone, since those links carry the base URL. |
| `pnpm start`             | Starts the demo site once, without watching.                                                                                                                                                                                                                                                              |
| `pnpm demo:reset`        | Replaces the demo's `playground/` with a fresh copy of `content/`.                                                                                                                                                                                                                                        |
| `pnpm build`             | Compiles `packages/cms`, bundles the editor, compiles theme and admin CSS.                                                                                                                                                                                                                                |
| `pnpm test`              | Builds every package once, then runs the `node:test` suites in every package through `tsx`.                                                                                                                                                                                                               |
| `pnpm test:coverage`     | The same build and suites with `--experimental-test-coverage`.                                                                                                                                                                                                                                            |
| `pnpm test:11ty`         | Builds the fixtures and the demo content with Eleventy, comparing URLs.                                                                                                                                                                                                                                   |
| `pnpm typecheck`         | `tsc --noEmit` across the workspace, tests included.                                                                                                                                                                                                                                                      |
| `pnpm lint`              | Fans out to each package's lint script.                                                                                                                                                                                                                                                                   |
| `pnpm lint:fix`          | The same, with eslint's fixes applied.                                                                                                                                                                                                                                                                    |
| `pnpm format`            | Rewrites every file prettier owns.                                                                                                                                                                                                                                                                        |
| `pnpm format:check`      | Fails if any of them is not already formatted.                                                                                                                                                                                                                                                            |
| `pnpm clean`             | Removes build output.                                                                                                                                                                                                                                                                                     |
| `pnpm docker:dry-run`    | Prints the image tags a Docker publish would push, and builds nothing.                                                                                                                                                                                                                                    |
| `pnpm docker:build-push` | Builds the image for amd64 and arm64 and pushes it to ghcr.io.                                                                                                                                                                                                                                            |
| `pnpm docker:smoke`      | Builds the image locally, boots it on empty volumes and checks it serves.                                                                                                                                                                                                                                 |
| `pnpm npm:dry-run`       | Prints the package, version and tag a publish needs, and publishes nothing.                                                                                                                                                                                                                               |
| `pnpm npm:publish`       | Publishes `@geekity/cms` to npm from the commit carrying its version tag.                                                                                                                                                                                                                                 |
| `pnpm release:dry-run`   | Prints every step of a release, and checks, publishes and builds nothing.                                                                                                                                                                                                                                 |
| `pnpm release`           | Publishes to npm and pushes the image, with the quality gates run once.                                                                                                                                                                                                                                   |

Package-scoped variants work too, for example
`pnpm --filter @geekity/cms test` or `pnpm --filter demo dev`. A plugin package and the demo test against the built `@geekity/cms`,
so run `pnpm build` before testing one of them on its own.

## Quality gates

The three checks of decision-8 run the same way locally and in CI:
`pnpm lint` (eslint 9 flat config with typescript-eslint's type-checked rules,
`eslint-config-prettier` last), `pnpm typecheck`, and `pnpm test`.

`pnpm install` installs husky's hooks through the root `prepare` script, and
they run the checks where they are cheapest:

| Hook         | What it runs                                                 |
| ------------ | ------------------------------------------------------------ |
| `commit-msg` | commitlint, so every message is a Conventional Commit.       |
| `pre-commit` | lint-staged: eslint and prettier over the staged files only. |
| `pre-push`   | `pnpm typecheck` only; the test suite is CI's gate.          |

The suite is not in the hook because it takes about fourteen minutes, longer
than GitHub keeps an idle push connection open, so a push that ran it first
died after the tests had passed (decision-21). CI runs the suite on every push
and pull request as a required check, and that is the gate.

Commit messages are Conventional Commits and drive release-please; the format
and the allowed scopes are in [`CLAUDE.md`](CLAUDE.md) and
`commitlint.config.js`.

The same gates run in GitHub Actions on every pull request and every push to
`main`; see [Continuous integration](#continuous-integration).

One wrinkle to know about: TypeScript 7 is a native compiler and no longer
ships the JavaScript compiler API that typescript-eslint reads types through,
so the workspace root keeps TypeScript 6 as a lint-only dependency while each
package builds and type checks with TypeScript 7. This is the side-by-side
arrangement TypeScript 7 documents, and the root pin goes away once
typescript-eslint supports TypeScript 7.

## Configuration

A site declares its config in `geekity.config.ts` and gets type checking from
`defineConfig`:

```ts
import { defineConfig } from '@geekity/cms';

export default defineConfig({
  port: 3000,
  contentDir: 'content',
  dataDir: 'data',
  themesDir: 'themes',
  baseUrl: 'http://localhost:3000',
  watch: true,
});
```

Every field is optional. Relative directories resolve against the working
directory; absolute ones are used as given.

| Field              | Default                                   | Environment override         | Meaning                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------ | ----------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `port`             | `3000`                                    | `GEEKITY_PORT`, then `PORT`  | Port the HTTP server listens on.                                                                                                                                                                                                                                                                                                                                                           |
| `contentDir`       | `<cwd>/content`                           | `GEEKITY_CONTENT_DIR`        | Markdown content.                                                                                                                                                                                                                                                                                                                                                                          |
| `dataDir`          | `<cwd>/data`                              | `GEEKITY_DATA_DIR`           | Derived state — the SQLite index, the image variants — and the files that are not derived and must be backed up, such as `users.json`, the actor key pairs under `keys/`, `locations.json` and `kept-properties.json`. [Two directories](#two-directories-content-and-data) lists them.                                                                                                    |
| `themesDir`        | `<cwd>/themes`                            | `GEEKITY_THEMES_DIR`         | The site's themes, one directory per theme. Which one is in use is the `theme` setting, not a path. Need not exist.                                                                                                                                                                                                                                                                        |
| `pluginsDir`       | none                                      | `GEEKITY_PLUGINS_DIR`        | A folder of plugins, `<name>/` or `@scope/<name>/`, each with a bundled `index.js` whose default export is the plugin. `geekity serve` loads them beside `plugins`, and Reload on the Plugins screen loads a changed folder without a restart. Unset, no code is loaded from a folder.                                                                                                     |
| `baseUrl`          | `http://localhost:<port>`                 | `GEEKITY_BASE_URL`           | Public origin for canonical URLs, feeds and ActivityPub ids. A trailing slash is stripped.                                                                                                                                                                                                                                                                                                 |
| `watch`            | `true`                                    | `GEEKITY_WATCH`              | Watch `contentDir` while serving and keep the index in step.                                                                                                                                                                                                                                                                                                                               |
| `accessLog`        | `false`, but `true` under `geekity serve` | `GEEKITY_ACCESS_LOG`         | Write one line per request to stdout: the method, the path with its query string, the status and how long it took. `geekity serve` and the Docker image turn it on, because a server answering the internet should be able to say what it answered; `createCms` leaves it off, so a CMS embedded in another app never writes to its stdout unasked. See [The access log](#the-access-log). |
| `accessLogAddress` | `false`                                   | `GEEKITY_ACCESS_LOG_ADDRESS` | Put the client address at the end of each access-log line. Off unless asked for: an address is personal data and needs a reason and a retention policy. Which address is right is `trustProxy`'s answer.                                                                                                                                                                                   |
| `seedContent`      | `false`                                   | `GEEKITY_SEED_CONTENT`       | When `geekity serve` starts and `contentDir` is missing or has no entries at all, fill it with the starter site `geekity init` writes, its `site.json` `url` set to the base URL. A directory with anything in it, even a dotfile, is never touched. Off so a site run from npm is never written to unasked.                                                                               |
| `maintenance`      | `false`                                   | `GEEKITY_MAINTENANCE`        | Keep the site in maintenance mode until a restart without it. `geekity maintenance on` and `off` are the everyday switch; see [Maintenance mode](#maintenance-mode).                                                                                                                                                                                                                       |
| `compression`      | `true`                                    | `GEEKITY_COMPRESSION`        | Compress text responses (HTML, CSS, JavaScript, feeds, JSON, Markdown, SVG, sitemaps) with brotli, or gzip for a client without it. Turn it off when a proxy in front already compresses; see [Compression](packages/cms/README.md#compression).                                                                                                                                           |

The admin adds nine more:

| Field                 | Default                     | Environment override             | Meaning                                                                    |
| --------------------- | --------------------------- | -------------------------------- | -------------------------------------------------------------------------- |
| `uploadMaxBytes`      | `10485760` (10 MiB)         | `GEEKITY_UPLOAD_MAX_BYTES`       | Largest file the editor's upload endpoint accepts.                         |
| `uploadMediaMaxBytes` | `209715200` (200 MiB)       | `GEEKITY_UPLOAD_MEDIA_MAX_BYTES` | Largest audio or video file it accepts, in place of `uploadMaxBytes`.      |
| `uploadTypes`         | every type below            | `GEEKITY_UPLOAD_TYPES`           | Extensions it accepts, as a list (comma-separated in the env).             |
| `imageOptimization`   | `true`                      | `GEEKITY_IMAGE_OPTIMIZATION`     | Derive smaller copies of uploaded images and offer them in the pages.      |
| `imageWidths`         | `320, 640, 960, 1280, 1920` | `GEEKITY_IMAGE_WIDTHS`           | The widths those copies are made at, in pixels.                            |
| `imageFormats`        | `['webp']`                  | `GEEKITY_IMAGE_FORMATS`          | The formats besides the original's own. `avif` is opt-in.                  |
| `requireAltText`      | `false`                     | `GEEKITY_REQUIRE_ALT_TEXT`       | Refuse to publish an image with no alt text, rather than warn about it.    |
| `loginAttempts`       | `5`                         | `GEEKITY_LOGIN_ATTEMPTS`         | Failed sign-ins a username or an address may make before it is locked out. |
| `loginLockout`        | `900` (15 minutes)          | `GEEKITY_LOGIN_LOCKOUT`          | How long the first lockout lasts, in seconds.                              |
| `trustProxy`          | `false`                     | `GEEKITY_TRUST_PROXY`            | Believe `X-Forwarded-For` when deciding which address a sign-in came from. |

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
[Start it and point the proxy at it](#3-start-it-and-point-the-proxy-at-it).
Uploads are served with their media type and answer a single `Range` request
with `206 Partial Content`, which Safari needs before it plays a file and every
player uses to seek. Location and camera metadata is removed from pictures and
videos before they are stored; see
[the media library](packages/cms/README.md#the-media-library).

Precedence is environment variable, then config file, then default, so a host
can override anything without editing the site.

`baseUrl` is the one field the admin's [settings screen](#site-settings) also
offers. A `GEEKITY_BASE_URL` or a `baseUrl` in the config file wins: a base URL
is a deployment fact — it decides the absolute URLs in the feeds, the
ActivityPub ids and whether the session cookie is `Secure` — so a host that
names one is not overridden from a form. When neither names one, the stored
setting is used instead of the `http://localhost:<port>` fallback, and the
settings form is where it is edited. The form always says which value is in
effect and, when it is not the stored one, why.

## Using the package

```ts
import { createCms } from '@geekity/cms';

const cms = createCms({ baseUrl: 'https://example.com' });

cms.app.get('/hello', (c) => c.text('a route of my own'));

await cms.serve();
```

`createCms(config)` returns `{ app, config, store, events, sync(), serve(),
close() }`. `app` is a Hono app, so a site can add routes or middleware before
serving; every handler also reaches the index and the config as `c.var.store`
and `c.var.config`. `config` is the config after defaults and environment
overrides. `store` is the content index, described below. `events` and `sync()`
are the sync, described after it. `serve()` scans the content directory, starts
watching it and then listens, resolving with the port actually bound, which
matters when the configured port is `0`.

Booting opens the SQLite index under `dataDir`, so `close()` has to be called
to release it — the tests and the demo both do. `close()` stops the watcher
first.

Sites that add nothing of their own can skip the entry file and run the bin:

```sh
geekity serve --config geekity.config.ts
```

`geekity serve` runs as a small supervisor. It owns the port and runs the CMS
in one worker process, which it respawns, with a growing delay, if it crashes.
When the plugins folder (`pluginsDir`) differs from what the running worker
loaded, Admin > Plugins names the folders added, removed and updated, and
offers Reload. Reload works in this order:

1. The running worker stops taking writes. It answers GET and HEAD and answers
   any other method `503` with `Retry-After: 5`. It lets the writes already in
   flight finish, then stops its timers, its watcher and its plugins.
2. The running worker sends what its queues hold and stops writing to the
   database, `data/` and `content/`.
3. A new worker boots, runs the boot migrations alone and starts listening.
4. The old worker stops accepting connections and exits once its open ones end.

The port stays open throughout, so no request is refused. If the new worker
fails to boot, the old one carries on and the Plugins screen shows why.
SIGTERM and SIGINT close the worker the way `close()` does, and the supervisor
exits 0.

## Plugins

A plugin adds to the CMS what only some sites need, such as the WordPress
compatibility paths or a language model behind the editor (decision-33). Each
is an npm package, such as `@geekity/plugin-llm`. Every installed plugin loads
when the site starts, and Admin > Plugins enables and disables each one for
the site with no restart.

A site with its own entry file installs a plugin with npm and lists it in
`plugins` in its config. A site on Docker has no npm and no `package.json`, so
it installs a plugin into the plugins folder with `geekity plugin add`.

> [!WARNING]
> A plugin runs inside the site process. It can read and write everything the
> site can, including every file under `data/`: the accounts, the actor key
> pairs and other plugins' secrets. Install only plugins you trust.

### Installing a plugin on Docker

The image sets `GEEKITY_PLUGINS_DIR` to `/site/plugins`, and
[`deploy/compose.yaml`](deploy/compose.yaml) mounts `./plugins` there. The
folder holds one folder per plugin, named by its package:
`plugins/@geekity/plugin-llm/`.

1. Install the package into the folder:

   ```sh
   docker compose exec geekity geekity plugin add @geekity/plugin-llm
   ```

   `plugin add` fetches the package's tarball from the npm registry, checks it
   against the integrity hash the registry published, and unpacks its bundle
   and manifest into the folder. Give a version, a dist-tag or a range after
   the name to choose one: `@geekity/plugin-llm@0.1.0`. With no version, it
   takes `latest`. Running it again for the same version changes nothing, and
   a newer version replaces the old folder in one step. `npm_config_registry`
   names another registry.

2. Open Admin > Plugins and press **Reload**. The screen offers Reload whenever
   the folder differs from what the running site loaded. Reload starts a new
   worker with the folder as it is now and retires the old one, with no
   container restart and no refused request.

3. Enable the plugin on the same screen.

`plugin add` installs only the package it is given. When that plugin requires
other plugins, the command names each one that is missing or out of range,
and so does the plugin's row on the Plugins screen. Add each one the same way.
Nothing is installed or enabled on your behalf.

`plugin add` refuses, and leaves the folder as it was, when:

- the tarball does not match the registry's integrity hash
- the package has no bundle (`dist/bundle/index.js` and `plugin.json`). Such a
  plugin installs only with npm, on a site with its own entry file.
- the bundle targets a newer host API version than this core provides

To remove a plugin, delete its folder and press Reload:

```sh
docker compose exec geekity geekity plugin remove @geekity/plugin-llm
```

A plugin that is not on npm installs the same way by hand: copy its bundle
folder, `index.js` and `plugin.json`, to `plugins/<package name>/` and press
Reload.

A folder that cannot load does not stop the site. Its row on the Plugins screen
says why: the bundle failed to import, it exports no plugin, it targets a
newer host API, or its manifest names a range of `@geekity/cms` or of a
required plugin that is not met. The commands a folder plugin adds, such as
`geekity import wordpress-actor`, run with `docker compose exec` the same way
as core's.

### Writing a plugin

A plugin package imports only `@geekity/cms/plugin`, and only its types and
`definePlugin`. Its default export is the plugin:

```ts
import { definePlugin } from '@geekity/cms/plugin';

export default definePlugin({
  name: '@acme/plugin-hello',
  version: '0.1.0',
  label: 'Hello',
  description: 'Says hello.',
  hostApi: 1,
  requires: {},
  register(host) {
    host.get('/hello', () => new Response('hello'));
  },
});
```

`register` runs once when the site starts, enabled or not, and declares what the
plugin adds through `host`: public routes (`get`), federation middleware, one
admin screen, commands, editor actions, settings and one service. `start` and
`stop`, if present, run when the plugin is enabled and disabled. The `host` is
the plugin's only door into the CMS, so a bundle needs no runtime import of
`@geekity/cms`.

**The package shape.** `package.json` marks the package a plugin, names the
host API version it targets and the plugins it requires, in a `geekity` field.
Each required plugin and `@geekity/cms` are also peer dependencies, with a
range:

```json
{
  "name": "@acme/plugin-hello",
  "version": "0.1.0",
  "type": "module",
  "files": ["dist"],
  "geekity": {
    "plugin": true,
    "hostApi": 1,
    "requires": { "@geekity/plugin-llm": "^0.1.0" }
  },
  "peerDependencies": {
    "@geekity/cms": "^0.24.0",
    "@geekity/plugin-llm": "^0.1.0"
  }
}
```

The plugin's `requires` holds the same names and ranges as the `geekity` field.

**Requires and services.** A plugin provides at most one service, named by its
package name, with `host.provide(service)` in `register`. A plugin that lists
another in `requires` reaches its service with `host.use('<package name>')`
when it handles a request, a command or a job. `use` throws during `register`.
A plugin cannot be enabled until everything it requires is installed, in range
and enabled. Pass plain data across a service, never an object built by a
library: each bundle carries its own copy of its dependencies.

**Settings and secrets.** `host.settings([...])` declares fields of type
`text`, `url`, `select`, `checkbox` and `secret`, and the plugin's admin screen
draws them as a form. Public values are kept in `site.json` under the
package's name. A `secret` is kept in `data/plugins/<package name>/secrets.json`,
mode `0600`, and an environment variable overrides it, as the
[package README](packages/cms/README.md#configuration) describes.
`host.data` reads and writes other files in that folder.

**The host API version and the peer range.** `HOST_API_VERSION` in
`@geekity/cms/plugin` is the version of the host API this core provides. A
plugin that targets a newer one is unavailable, with the reason on the Plugins
screen. The peer range of `@geekity/cms` says which releases of core the
package works with: npm checks it for a site that installs with npm, and the
registry checks the copy in `plugin.json` for a folder install.

**The bundle.** A folder install has no `node_modules`, so each plugin package
also ships one self-contained ES module with every dependency inlined. The
plugin packages in this repository build it with the shared script after `tsc`:

```json
"build": "tsc -p tsconfig.build.json && node ../../scripts/build-plugin-bundle.js"
```

It writes `dist/bundle/index.js` and `dist/bundle/plugin.json`, which holds the
package's name, version, host API version and the peer ranges of
`@geekity/cms` and of each required plugin. The build fails when the package
is not marked a plugin, when a required plugin is not a peer dependency, when
the plugin's name, version, `hostApi` or `requires` differ from `package.json`,
and on a native module, which a bundle cannot carry. A plugin that needs a
native module is installed with npm only.

## Content

A Markdown file and a `Document` convert both ways. The file is the source of
truth, so front-matter keys the CMS does not model survive an admin save:

```ts
import { parseDocument, serializeDocument } from '@geekity/cms';

const document = parseDocument(source, { path: 'posts/2026-09-02-hello.md' });
document.title; // 'Hello, World!'
document.html; // rendered with markdown-it

await writeFile(file, serializeDocument({ ...document, draft: false }));
```

`parseDocument` reads the type from the directory (`posts/` or `pages/`), fills
in a default permalink when the file has none, normalises dates to ISO 8601
strings and hashes the document's canonical text. `serializeDocument` writes
front matter in a fixed key order, so an unchanged document writes the same
bytes and a real edit produces a small diff.

`slugify(title)` and `defaultPermalink({ type, slug, date })` are what the admin
form proposes: `/{yyyy}/{mm}/{slug}/` for a post, `/{slug}/` for a page.
`renderMarkdown(body)` is markdown-it with Eleventy's `html: true`, plus
footnotes, heading ids and a language class on fenced code.

Fixtures that both this package and the Eleventy compatibility test build from
live in `packages/cms/test/fixtures/content/`.

## Two directories: `content/` and `data/`

Everything a site cannot afford to lose is a file, and every one of those files
is in one of two directories (decision-9). Nothing else has to be backed up,
and nothing else has to be preserved across a deploy.

`content/` is what the site publishes. It belongs in git, an Eleventy build
reads the same directory, and everything in it is meant to be public:

| Path                                                 | What it holds                                      |
| ---------------------------------------------------- | -------------------------------------------------- |
| `content/posts/`, `content/pages/`                   | The Markdown documents, `_trash/` included.        |
| `content/uploads/`                                   | Uploaded files, with location and camera stripped. |
| `content/_data/site.json`                            | Every site setting.                                |
| `content/_data/media.json`                           | The media library's alt text, keyed by upload.     |
| `content/_data/federation/{username}/followers.json` | Who follows that user.                             |
| `content/_data/federation/inbox/{yyyy}-{mm}.jsonl`   | Every activity the inbox was handed, one per line. |

`data/` is private. It is never in git, and it is the half that has to be
copied somewhere safe:

| Path                        | What it holds                                                                                                                                   |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `data/users.json`           | Usernames and argon2id password hashes, mode 0600.                                                                                              |
| `data/keys/`                | Each user's key pairs as JWK files, mode 0600. **Losing these breaks federation.**                                                              |
| `data/locations.json`       | Where each post was written, keyed by permalink, mode 0600. Never in `content/`, so a public repository never carries it (decision-29).         |
| `data/kept-properties.json` | The Micropub properties a post was sent that the site does not understand, such as an `itinerary`, keyed by permalink, mode 0600 (decision-27). |

And three things under `data/` may be deleted at any time the site is stopped:

| Path              | What it is                                                                                      |
| ----------------- | ----------------------------------------------------------------------------------------------- |
| `data/geekity.db` | The SQLite cache, `-wal` and `-shm` with it. See below.                                         |
| `data/images/`    | Image variants derived from `content/uploads/` (decision-10), with their `image.json` sidecars. |
| `data/avatars/`   | Remote avatars fetched and shrunk so a reader's browser never asks the server they live on.     |

Deleting any of them is safe with the site stopped: the next boot builds the
database back out of the files with no manual step, and a request for a variant
that is not there derives it and serves it, and an avatar is fetched again. `geekity rebuild` does the database
half on demand, and **Tools > Content index** in the admin does it [without
stopping the site](#rebuilding-the-index-from-the-admin). There is no command
for the images, because there is nothing to do: `rm -r data/images`.

### Personal data

Commenter emails are in `data/comments/`, address hashes are in the comment
files under `content/_data/comments/`, and contact messages are in
`data/contact/`. Emails that a site committed while they were still in the
comment files stay in its git history until that history is rewritten. A sweep
removes each once it outlives the period set on **Settings > Discussion**. A
site keeps everything until its owner sets a period, so upgrading deletes
nothing; a new site from `geekity init` starts with 180 days for an email, 30
for an address hash and 365 for a contact message.
**Tools > Personal data** erases one person's data on request. The package
README lists [every piece of personal data the CMS stores and
where](packages/cms/README.md#personal-data).

The author's own location on a post is personal data too. A Micropub app or
the editor may attach where a post was written; the site keeps it in
`data/locations.json` and publishes nothing of it until **Settings > Privacy**
says otherwise. [Location on posts](#location-on-posts) describes the choice.
A Micropub checkin is a location like any other. A Micropub property the site
does not understand, such as an itinerary, is kept the same way in `data/kept-properties.json` and published nowhere.

### What is in the database, and what a rebuild loses

No table holds anything that is not either read back from the files or
something a site is told it may lose.

| Table                                               | Where it comes back from                                                 |
| --------------------------------------------------- | ------------------------------------------------------------------------ |
| `documents`, `document_tags`, `document_categories` | The boot scan of `content/`.                                             |
| `followers`, `ap_inbox`                             | `content/_data/federation/`, emptied and read back on every boot.        |
| `sessions`                                          | Nothing. Everybody signed in is signed out.                              |
| `ap_deliveries`                                     | Nothing. The federation screen shows the posts with "Nothing recorded."  |
| `ap_relays`                                         | The relay list in `site.json`: boot sends each of them a fresh `Follow`. |
| `cms_state`                                         | Nothing. It holds one key, the scheduler's watermark.                    |
| `migrations`, `admin_migrations`                    | The package. They record which schema versions have run.                 |

Three consequences worth knowing before deleting one:

- **Logins go.** Everybody signed in has to sign in again. The accounts
  themselves are in `data/users.json` and are untouched.
- **Relay subscriptions are re-requested.** A relay named in the settings but
  not in the database is followed again on boot, so a rebuild sends every one of
  them a new `Follow` — and the reason a relay gave for rejecting the last one
  is lost, so a relay that refuses the site will be asked again on each rebuild.
- **A scheduled post that came due while the site was down is never announced.**
  The scheduler treats an absent watermark as "start from here", precisely so a
  rebuilt database cannot re-announce the whole archive to every follower. The
  post is public on the next boot; no `Create` is delivered for it. Resend it
  from `/admin/federation` if it should have gone out.

The one capability decision-9 gives up is narrower than any of those: a post
whose **file is gone entirely** cannot be withdrawn from followers' timelines,
because the permalink a `Delete` names was in the file. Trashing a post
in the admin keeps the file under `_trash/`, so the ordinary way of
unpublishing still sends the `Delete`.

### A database this version cannot use

Two cases refuse the boot rather than being cleaned up automatically, and both
name the file and say what to do:

- **Written by a newer `@geekity/cms`.** Its migration ledger records a schema
  version this package does not ship. Upgrading the package back is usually what
  was meant; `geekity rebuild` throws it away if it was not.
- **Damaged.** SQLite will not open it. `geekity rebuild` is the fix.

A database _older_ than the migrations the package still ships is the one case
that is thrown away and rebuilt without asking, because there is by definition
no path forward from it and nothing in it is anything but a reading of the
files.

## The content index

Markdown files are the source of truth; SQLite is a derived index over them, so
deleting `data/geekity.db` is safe and the next boot rebuilds it. The same is
true of the two federation indexes:
`content/_data/federation/{username}/followers.json` and
`content/_data/federation/inbox/{yyyy}-{mm}.jsonl` are the source, and the
`followers` and `ap_inbox` tables are emptied and read back from them on every
boot.
`createCms` opens it against `dataDir` (creating the directory) and applies the
migrations the package ships. Migrations are versioned and recorded, so
applying them again does nothing.

```ts
const cms = createCms({ dataDir: 'data' });

cms.store.upsert(parseDocument(source, { path: 'posts/2026-09-02-hello.md' }));

cms.store.getByPermalink('/2026/09/hello/'); // the same Document back
cms.store.listPosts({ limit: 10, offset: 0 }); // published, newest first
cms.store.listByTag('eleventy', { type: 'post' });
cms.store.listByCategory('general'); // the second taxonomy, same shape
cms.store.listAll({ draft: true }); // the admin's view
cms.store.counts(); // { total, posts, pages, drafts, scheduled, trashed }
```

A row round-trips to the `Document` it came from: optional fields stay absent
rather than becoming `undefined`, and `extra` is stored as JSON, so anything
JSON can hold survives.

A few rules worth knowing:

- **Dates.** `date` is kept verbatim, offset and all, because that is what the
  file says. Listings sort on a second column holding the same instant in UTC,
  so `2026-06-01T09:00:00-05:00` correctly sorts after `2026-06-01T12:00:00Z`.
  A document with no date sorts last; ties break on path, descending.
- **Trash.** A document under a `_trash/` directory is trashed. The flag comes
  from the path, not from the front matter, so moving a file in or out of the
  trash is all it takes. `listPosts`, `listByTag` and `listByCategory` exclude
  drafts and trash;
  `listAll` shows drafts but hides trash unless asked with `{ trashed: true }`.
- **Scheduling.** A non-draft document whose `date` has not arrived is not
  public yet, so every listing above excludes it too; `listAll` shows it, and
  `{ scheduled: true }` shows only those. The index reads the clock through
  `store.now()`, which `createCms` gives it from the `now` config option — one
  clock, so the listings, the permalink and the scheduler cannot disagree.
- **Permalinks** are unique and indexed. Indexing a second document at a URL
  another file already claims throws `DuplicatePermalinkError`, which names
  both paths.

## Keeping the index in step

`serve()` scans `contentDir` before it listens, then watches it, so the index
never serves a document the files disagree with. `cms.sync()` runs the same
scan on its own, which is what a one-shot command wants.

```ts
const result = await cms.sync();
// { scanned, created, updated, removed, unchanged, failed }
```

A scan parses every `.md` and `.markdown` file under a `posts/` or `pages/`
directory, writes the ones whose hash differs from the indexed row, and drops
rows whose file has gone. The watcher does the same for one path at a time,
debounced 100 ms so a burst of writes costs one re-parse.

- **What is a document.** Only Markdown under `posts/` and `pages/`. Uploads,
  `posts.json`, `README.md` at the top level and anything else is skipped.
- **Underscore directories.** Eleventy ignores them and so does the scan, with
  one exception: `_trash/` still holds documents, which stay indexed as trashed
  and out of every public listing so the admin can restore them. `_data/` is
  never indexed, however deep it goes — `_data/site.json` is the settings and
  `_data/federation/` is the followers and the inbox log, and all three are
  data a theme and an Eleventy build read rather than documents.
- **No-op writes.** A file rewritten with the same content hashes the same, so
  nothing is written to the index and no event is emitted. That is what makes
  an admin save — which writes the file and updates the index itself — cost
  one index write rather than two.
- **A file that will not parse** is logged and skipped. Its old row is left
  alone, and neither the scan nor the watcher stops.
- **Renames**, which is what trashing and restoring are, briefly leave two rows
  claiming one permalink. The row whose file is gone gives way.

Subscribe through `cms.events`:

```ts
cms.events.on('published', (change) => {
  deliverToFollowers(change.next);
});

const stop = cms.events.on('change', (change) => {
  console.log(change.type, change.path, change.origin);
});
stop(); // `on` returns the unsubscribe
```

| Event         | When                                                                                               |
| ------------- | -------------------------------------------------------------------------------------------------- |
| `created`     | A file was indexed for the first time.                                                             |
| `updated`     | An indexed file's content changed.                                                                 |
| `deleted`     | An indexed file is gone.                                                                           |
| `published`   | A document became visible: created live, a draft published, or a document restored from the trash. |
| `unpublished` | The reverse: published to draft, trashed, or deleted while live.                                   |
| `change`      | Every `created`, `updated` and `deleted`.                                                          |

Every change carries `previous` and `next` — the whole documents, so a
subscriber can compare them itself — plus `path` and `origin`, which is `scan`
for a scan (including the one on boot), `watch` for a live edit, `admin` for a
write the editor made, and `schedule` for a post whose date arrived. A cold
index reports its whole first scan as `created`, so a subscriber that must not
act on a rebuild should check `origin`. A `schedule` change carries no
`previous`: nothing had ever been told about the post, so its arrival is a
creation to everything downstream.

Set `watch: false` (or `GEEKITY_WATCH=false`) to scan on boot and stop there.

### Rebuilding the index from the admin

A scan leaves a row alone when its hash matches the file, which is the right
rule almost always and the wrong one after the index and the files have come
apart: content edited over ssh while the site was down, a `git pull` the
watcher never saw, a database that was restored from an older backup than the
content. **Tools > Content index** in the admin is the repair. It shows what
the index holds — documents, followers, inbox activities, comments — and one
button empties it and reads every file again, on the site as it is running.

It is behind a confirm step, because between the emptying and the end of the
scan the site answers 404 for documents whose files are perfectly fine: well
under a second on a small site, longer on a large one, and it is serving the
whole time. A second rebuild asked for while one is running is refused rather
than started.

Nothing is deleted and no connection is replaced, so the rebuild costs a site
much less than the command below: you stay signed in, the delivery log, the
relay handshakes and the scheduler's watermark are all kept, and a post that
comes due during it is still announced. It also tells nobody: every change a
scan makes carries `origin: 'scan'`, which delivery, the webmentions and the
feed pings all ignore, so no follower, no linked page and no feed server hears
about a post that was only re-indexed.

`geekity rebuild` at the command line stays for the one case a screen cannot
be the door for: a database this version refuses to open, where there is no
site running to press a button in. See [A database this version cannot
use](#a-database-this-version-cannot-use).

## The public site

`createCms` mounts the public site on the app:

| Route                  | What it serves                                                                 |
| ---------------------- | ------------------------------------------------------------------------------ |
| `/`                    | Published posts, newest first.                                                 |
| `/page/2/` and up      | Later pages of the same archive.                                               |
| a document's permalink | The post or the page, through the theme.                                       |
| `/tag/{tag}/`          | Everything published carrying that tag, paginated at `/tag/{tag}/page/2/`.     |
| `/category/{name}/`    | The second taxonomy, paginated the same way at `/category/{name}/page/2/`.     |
| `/feed/`               | The recent posts as RSS 2.0; `/feed/atom/` and `/feed/json/` are its siblings. |
| an archive's `feed/`   | The same three over one tag or category, e.g. `/tag/{tag}/feed/atom/`.         |
| `/sitemap.xml`         | Every public URL with its `lastmod`, split into an index past 50,000 of them.  |
| `/robots.txt`          | Everything but `/admin/`, the sitemap, and the site's AI-crawler rules.        |
| `/healthz`             | 200 when the site can serve, 503 when it cannot; see below.                    |
| `/theme/…`             | The theme's own files, from its `static/` directory, cacheable and validated.  |
| `/uploads/…`           | Files under `content/uploads/`, at the URLs an Eleventy build copies them to.  |
| `/author/{username}/`  | One person's archive, paginated at `/author/{username}/page/2/`.               |
| an author's `feed/`    | The same three formats over their posts, e.g. `/author/ada/feed/atom/`.        |
| anything else          | The theme's 404.                                                               |

`author` and `inbox` are reserved top-level paths: every user is an ActivityPub
actor at their author URL, and an id a settings field could move would be a
different account to everybody following it. The federation routes are:

| Route                                    | What it serves                                                                                    |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `/author/{username}/`                    | The archive to a browser, the `Person` to an ActivityStreams request.                             |
| `/author/{username}/inbox/`              | That user's inbox. `POST` only, signature-verified.                                               |
| `/author/{username}/outbox/`             | Their posts as `Create` activities, paged.                                                        |
| `/author/{username}/followers/`          | Who follows them, paged.                                                                          |
| `/author/{username}/following/`          | Always empty; a relay is a subscription rather than a relationship.                               |
| `/inbox/`                                | The instance-wide shared inbox, which addresses the actor in the body.                            |
| `/@{username}`                           | A 301 to their archive, the short URL WordPress publishes; a 404 for a handle nobody answers to.  |
| `/.well-known/webfinger`                 | `acct:{username}@{host}`, the author URL or `/@{username}`, all four resolving to the same actor. |
| `/.well-known/nodeinfo`, `/nodeinfo/2.1` | What software this is, and how much of it there is.                                               |

A post's ActivityStreams object is its permalink rather than a route of its own
(decision-13), served by the permalink with an `Accept` of
`application/activity+json`.

Drafts, documents in the trash and posts whose date is still ahead 404 and
appear in no listing; a future-dated post is published on its date without a
restart. Trailing
slashes are canonical, and a request that arrives without one redirects 301 —
but only when the canonical URL resolves, so a missing address 404s straight
away instead of bouncing first. `/page/1/` redirects to `/`.

The two archive bases are settings. `tag` and `category` are WordPress's, so a
site imported from it keeps the URLs it published; the Permalinks settings page
moves either one, and every link, feed and hashtag follows.

Documents are resolved after every registered route has failed to match, so
routes a site adds — and the admin and federation routes of later milestones —
always win over a permalink that would collide with them.

How many posts a listing page holds comes from `postsPerPage` in
`content/_data/site.json`, and defaults to 10. The same file is the `site`
global in every template.

### Health check

`GET /healthz` is the one URL a Docker `HEALTHCHECK`, dockge or an uptime
monitor needs. It runs two checks: one query against the content index in
`data/geekity.db`, and opening the content directory for reading. When both
pass it answers 200:

```json
{
  "status": "ok",
  "maintenance": false,
  "checks": { "database": "ok", "content": "ok" }
}
```

When either fails it answers 503, with that check reading `"fail"` and
`status` reading `"fail"`. A checker looks only at the status code, which is
why a failure is never a 200 carrying `"fail"`. The body names each check and
its outcome and nothing else: no paths, versions or error messages, since
anybody can request it.

The route is registered before federation, the admin and the public site, so a
post or page whose permalink is `/healthz/` cannot shadow it. The response
carries `Cache-Control: no-store`, sets no cookie, and the login throttle does
not count it, so probing it every few seconds costs nothing but the two checks.
The older `/_geekity/health` still answers `{ "status": "ok" }` without
checking anything.

`maintenance` says whether the site is in maintenance mode. It does not change
the status code: a site that is down on purpose is still healthy, and a
container orchestrator that restarted it would be fighting the operator.

### Maintenance mode

Maintenance mode takes the public site down on purpose, for an upgrade or a
restore, in a way browsers, crawlers and fediverse servers all read as
temporary.

```
$ geekity maintenance on --until 2026-09-28T14:00:00Z
Maintenance mode is on (/srv/site/data/maintenance.json). Expected back by Mon, 28 Sep 2026 14:00:00 GMT.
$ geekity maintenance status
$ geekity maintenance off
```

While it is on, every public page, feed, sitemap, `robots.txt` and ActivityPub
endpoint answers `503 Service Unavailable` with `Retry-After` and
`Cache-Control: no-store`. `Retry-After` is the `--until` time as an HTTP date
while that time is ahead, and 600 seconds otherwise. A page answers with the
theme's `layouts/503.njk`, and a `.json` or `.md` request answers in that
format. A crawler keeps the page in its index, and a server whose inbox delivery
was refused queues it for a retry instead of dropping it.

Some requests are let through:

- `/healthz` and `/_geekity/health`, which report `"maintenance": true`.
- The admin, the login page included, so an admin can sign in and work.
- The theme's files under `/theme/`, so the maintenance page is styled.
- Every request from a signed-in user, so an admin can check the site before
  turning maintenance off. These responses carry `Cache-Control: private,
no-store`, so no shared cache keeps one and hands it to a stranger.

The switch is the file `data/maintenance.json`. `on` writes it and `off`
removes it, and the running site looks at it at most once a second, so neither
needs a restart. It lives in `data/` and not in `content/` because it is
operational state: `content/` is published and committed, and a flag that
travelled with it would take down every checkout of the site.

`GEEKITY_MAINTENANCE=on`, or `maintenance: true` in the config, keeps the site
in maintenance from boot for the life of the process, for a site that must come
up already down. Removing the file does not lift it; restarting without the
setting does.

### The access log

With `accessLog` on — `geekity serve` and the Docker image turn it on — every
request the site answers writes one line to stdout:

```
GET / 200 4.2ms
GET /posts/hello-world/ 200 6.8ms
GET /.well-known/webfinger?resource=acct:ada@blog.example 200 1.9ms
GET /nothing-here 404 2.1ms
POST /admin/login 303 41.3ms
```

The fields are always in that order and separated by single spaces: the
method, the path with its query string, the status, and how long the request
took. So the status is always the third field, and `grep webfinger`,
`grep ' 500 '` or `awk '$3 >= 500'` all work on it. The query string is
logged because it is the part that says what was asked for — which account a
Mastodon instance looked up, what somebody searched for.

Nothing else is ever on the line. No request body is read, so a password
posted to the login form cannot reach it; no cookie and no `Authorization`
header are looked at either. The only header it can see is the forwarded
address, and only when the site is behind a proxy it has been told to believe.

With `accessLogAddress` on, the client address goes on the end, after the
duration:

```
GET /.well-known/webfinger?resource=acct:ada@blog.example 200 1.9ms 203.0.113.9
```

It is off by default: an address is personal data, and a self-hosted blog
collects it with no retention policy unless somebody decides otherwise. Which
address is the right one is `trustProxy`'s answer — the leftmost
`X-Forwarded-For` entry behind a proxy, the socket's own address otherwise —
so the log and the login throttle can never disagree about who was asking.

Every route is on it: `/healthz`, the federation endpoints, the admin and the
public site, and a request whose handler fell over gets its `500` line too.
The lines go to stdout because that is what a container collects, what dockge
shows and what journald keeps; a site that wants a file redirects it.

## The admin editor

The editor at `/admin/posts/{slug}` is a plain form. The body is a
`<textarea>`, the Preview button submits that form to `/admin/preview` in a new
tab, and both work with JavaScript switched off — which is the shape everything
below has to preserve.

`packages/cms/admin/static/editor.js` upgrades it when it loads. CodeMirror 6
in Markdown mode takes over the textarea's _view_ while the textarea itself
stays in the form as the value that is submitted; the Preview button becomes a
Write/Preview tab that posts the current body and shows the answer in a
sandboxed frame; and an "Add file…" button, or a file dropped on the editor,
posts to `/admin/uploads` and pastes the Markdown it gets back at the cursor.

That file is a build product, not source. The source is
`packages/cms/editor/main.ts`, which has a `tsconfig.json` of its own — the DOM
lib, no node types — and is bundled by esbuild in `scripts/build-editor.js`.
`pnpm build` runs the bundler after `tsc`, so an install (through the root
`prepare` script), a CI job and a publish all produce it; `admin/` is already in
the package's `files`, so it ships. It is gitignored, and CodeMirror is a
devDependency: nothing is fetched from a CDN, and the admin works offline.

`POST /admin/preview` renders through the same `renderMarkdown` and the same
theme layout the public site uses, so what the preview shows is what publishing
would put on the site, theme overrides included. It writes nothing.

A post the site does not publish yet can also be read at its own permalink
while you are signed in: a draft, a scheduled post, or one whose visibility the
site does not recognize. That is the URL a Micropub app such as iA Writer opens
after it posts a draft. The page is drawn by the theme as it will be published,
under a banner that says why it is not published and that only signed-in users
can see it. It answers `Cache-Control: private, no-store`,
`X-Robots-Tag: noindex` and a robots `noindex` meta, with no `ETag` or
`Last-Modified`, so no shared cache keeps it and no later request revalidates
against it. Only the HTML page is served this way. Its `.md` and `.json`
representations and its ActivityStreams object still answer 404, and it stays
off every list, feed, the sitemap and search, for you as for everybody. To
anybody not signed in the permalink answers exactly as a URL nothing lives at
does, with the same 404, body and headers. A post in the trash answers 404 to
everybody.

`POST /admin/uploads` stores one file at
`content/uploads/{yyyy}/{mm}/{slug}{ext}` and answers with `{ url, markdown }`.
A name is never overwritten: a second `photo.png` becomes `photo-2.png`. Three
things have to agree before anything is written — the extension is on the
site's allowlist, the media type the browser declared is one that extension may
have, and the file's first bytes are that format's — and a file that is too
big gets a 413 and one of the wrong type a 415, both as JSON. See
[`uploadMaxBytes`, `uploadMediaMaxBytes` and `uploadTypes`](#configuration). The
check on `Content-Length` that runs before the body is read lets through
anything the larger of the two limits would, and the file is then held to its
own kind's limit. The same rules run behind
[the media library](#the-media-library), which is a form rather than a `fetch`,
so a body over the limit posted from a browser gets that 413 as plain text
instead.

Both endpoints are behind the admin's guard and need the session's CSRF token,
like every other POST in the admin.

The editor's Visibility field chooses Public or Unlisted. An unlisted post or
page is served at its URL with a `noindex`, federates to the followers with
Public in `cc`, and is left off the home page, every archive and feed, the
sitemap, search, `llms.txt` and IndexNow. A value the site does not recognize,
such as a hand-typed `visibility: private`, hides the post like a draft until
you choose one. The package README's
[Unlisted posts](packages/cms/README.md#unlisted-posts) has the whole table.

### The admin's stylesheet

The admin is drawn in DaisyUI on Tailwind (decision-30). Its stylesheet is a
build product, like the default theme's. The source is
`packages/cms/admin/src/admin.css`: Tailwind in full, Preflight included, and
the DaisyUI 5 plugin with every built-in theme, `light` as the default and
`dark` when the system prefers dark. `pnpm build`, and the package's
`pretest`, compile it to `packages/cms/admin/static/admin.css`, which is
gitignored. `pnpm --filter @geekity/cms build:admin` compiles it alone.
Tailwind reads class names from the templates under `admin/` and from
`editor/look.ts`.

### Login hardening and security headers

`/admin/login` counts failed sign-ins per username and per client address.
After `loginAttempts` failures — five by default — that key is locked out for
`loginLockout` seconds, fifteen minutes by default, and the wait doubles each
time the lockout is tripped again, up to sixteen times the first one. The
lockout is checked _before_ the password is verified, so a correct password
during a lockout is refused too, and the message says nothing about whether the
username exists: an unknown one is counted and locked out exactly as a real one
is. A sign-in that works clears both keys. The counts live in memory — a
restart clears them, which is the right trade for state an anonymous caller can
create — and both refusals are logged. `trustProxy` says whether
`X-Forwarded-For` may be believed for the address; it is off by default,
because on a site reached directly anybody could set it and never be locked out
by address at all.

Every response carries `X-Content-Type-Options: nosniff`, plus
`Strict-Transport-Security` when `baseUrl` is https. Every response under
`/admin` also carries `Referrer-Policy: same-origin`,
`X-Frame-Options: SAMEORIGIN` and a `Content-Security-Policy` that is `'self'`
almost everywhere — with a per-response nonce on `style-src` for the styles
CodeMirror injects at runtime, `data:` on `img-src` for a preview of a post
holding a data URI image, and `frame-ancestors 'self'` because the editor
frames its own preview. There is no inline script in the admin, so `script-src`
is a bare `'self'`. The public site gets none of that. It gets a
`Referrer-Policy` of `strict-origin-when-cross-origin`, framing by the site
itself only (`frame-ancestors 'self'` and `X-Frame-Options: SAMEORIGIN`), a
`Permissions-Policy` that turns off the camera, microphone, geolocation,
payments, USB and similar, and `Cross-Origin-Opener-Policy: same-origin`. The
post editor alone allows geolocation to the site itself, for its Use my
location button. None
of them limits what a page loads, so a theme is still free to reference whatever
it likes, and a site can change or remove each one with `securityHeaders`. The
package README has
[the whole table and the reasoning](packages/cms/README.md#security-headers).

## The media library

`/admin/media` is everything under `content/uploads`, newest first: a thumbnail
for a picture and its extension for anything else, the size, the date, the
public URL, the ready-made Markdown, and the documents that point at the file.
The list is the directory itself, walked on every request rather than read out
of a table — the filesystem is the truth (decision-1, decision-9) — so a file
copied in over ssh, pulled in by git or written by an Eleventy build is on the
screen without a restart, and one deleted the same way is off it.

The upload form on the screen goes through the same `storeUpload` the editor's
"Add file…" does, so what a site accepts is one answer given in
one place: the same allowlist, the same signature check, the same
`{yyyy}/{mm}/{slug}{ext}`, and the same refusals.

The URL and the Markdown are readonly text fields, which select and copy like
any other text. `packages/cms/admin/static/copy.js` adds a Copy button beside
each of them and does nothing else; the buttons are rendered hidden and the
script reveals them, so a browser with JavaScript switched off — or an insecure
origin, where there is no clipboard API — is never shown a button that would
not work.

Delete is two steps when it needs to be. A file nothing references goes
straight away. A file a document still points at brings back a page naming
every document that does, each linked to its editor and marked when it is in
the trash, and only a confirmed form deletes it — deleting the bytes does not
change the documents, and a trashed post can be restored tomorrow. Whatever was
derived from the file goes with it, which is the hook the image variants hang
on. The paths the form carries are resolved against `content/uploads` and
refused if they land outside it.

### Alt text

Every picture in the library has an alt-text field and a Decorative checkbox.
What they say is kept in `content/_data/media.json`, keyed by the file's path
under `content/uploads`, because it is public and cannot be rebuilt from
anything else (decision-9):

```json
{
  "2026/09/dog.jpg": { "alt": "A dog asleep on a rug" },
  "2026/09/rule.png": { "decorative": true }
}
```

The Markdown the library offers embeds a picture with its alt text, and a
decorative one with an empty alt, which renders `alt=""`. A file name is never
used as alt text: the editor's upload control embeds a fresh upload as
`![](…)`, for the author to describe. Once an image is in a post, the post's
own `![…](…)` is its alt text there, since the same picture can need
describing differently in two posts. Deleting an upload forgets its entry.

Publishing a post or page checks every image it shows. An image is described
when its `![…](…)` or `alt` says something, or when it is an upload the library
marks decorative. Anything else, including an `<img>` with no `alt` at all,
publishes with a warning that names each image. A site that sets
`requireAltText` gets a refusal instead, and nothing is written. A draft is
never checked.

A federated post carries each picture from `content/uploads` as an `Image`
attachment whose `name` is its alt text, which is where Mastodon reads the
description from. Decorative pictures are left out.

## Image optimization

An uploaded photograph goes out at whatever size the camera made it unless
something narrows it, so the CMS derives smaller and more modern copies with
[sharp](https://sharp.pixelplumbing.com/) and offers them in the site's pages
(decision-10). The original under `content/uploads/` is never touched, never
re-encoded and never moved: it stays the only source of truth, and it is what
every representation but the HTML page keeps pointing at.

Uploading a PNG, JPEG, WebP or AVIF writes, into
`data/images/{yyyy}/{mm}/{name}{ext}/`, one file per width per format —
`320.webp`, `320.png`, `640.webp` and so on — plus an `image.json` recording
the original's intrinsic width and height and everything derived from it. The
widths are [`imageWidths`](#configuration), 11ty/image's own set by default;
nothing is ever upscaled, and the original's own width is always added so a
wide display has a full-size copy to pick that is not the unprocessed upload.
The formats are [`imageFormats`](#configuration) plus the original's own, which
is what the `<img>` falls back to. EXIF orientation is applied and the metadata
— the camera, the timestamp, the location — is dropped. A GIF gets no variants
and is served as it was stored: an animation cannot survive being resized into
a still.

A post page then renders the picture as

```html
<picture>
  <source
    type="image/webp"
    srcset="/uploads/_/2026/09/photo.jpg/320.webp?v=3f9a1c0e7b2d 320w, …"
    sizes="100vw"
  />
  <img
    src="/uploads/2026/09/photo.jpg"
    alt="A photo"
    srcset="/uploads/_/2026/09/photo.jpg/320.jpg?v=3f9a1c0e7b2d 320w, …"
    sizes="100vw"
    width="2400"
    height="1600"
    loading="lazy"
    decoding="async"
  />
</picture>
```

The first image a page shows is the exception to `loading="lazy"`. It is
usually the page's Largest Contentful Paint, and waiting to lazy-load it slows
that paint down, so it carries `fetchpriority="high"` and no `loading` instead.
On a single post or page that is the first image in the body. On a listing, and
on a front page with its recent posts under it, it is the first image in the
page's own body when that has one, and otherwise the first image of the first
entry. Every other image stays lazy.

`sizes` is `100vw`, which is 11ty/image's default and the only honest one a CMS
can give: how wide a picture is drawn is a fact about the theme's stylesheet.
Attributes the author wrote win — a hand-written `width`, `loading`,
`fetchpriority` or `srcset` is left alone — and an image pointing at another origin is untouched.

Only the theme's HTML gets that markup. The RSS and Atom `content:encoded`, the
JSON and Markdown representations of a document and the ActivityStreams
`content` a fediverse instance fetches all keep the plain `<img>` of the
original, because none of those readers can resolve this site's derived files
sensibly.

`data/images/` is derived state and may be deleted at any moment, exactly as
the SQLite index may (decision-9). A request for a file that is not there
rebuilds the whole set for that source and serves it; a request for a width or
a format the site does not offer is a 404 and encodes nothing. The directory is
inside `data/`, so git ignores it, the content sync never sees it and an
Eleventy build never reads it.

Turning `imageOptimization` off changes nothing on disk and nothing in the
feeds: the pages go back to the plain `<img>`, and uploading stops encoding.

### The same pictures from an Eleventy build

A site that builds the same `content/` with Eleventy gets equivalent markup
from [`@11ty/eleventy-img`](https://github.com/11ty/image) over the same
originals — which is why the CMS's width set and output shape are that
plugin's. The CMS's own `data/images/` is not involved; the plugin keeps its
own cache under `_site/img/`, and the two never meet.

```js
// eleventy.config.js, on top of the copied example config
import { eleventyImageTransformPlugin } from '@11ty/eleventy-img';

export default function (eleventyConfig) {
  eleventyConfig.addPlugin(eleventyImageTransformPlugin, {
    widths: [320, 640, 960, 1280, 1920],
    formats: ['webp', 'auto'],
    defaultAttributes: { loading: 'lazy', sizes: '100vw' },
  });
}
```

The transform rewrites every `<img>` in the built HTML, so it finds the same
uploads the CMS's renderer does. Keep the two width lists in step — a build and
a serve of the same directory should not disagree about what a reader is
offered.

## Site settings

`/admin/settings` holds the values that are a site's own rather than a post's,
on seven pages under the Settings menu: **General** (title, tagline, author, base
URL, time zone, language, the locale dates and counts are written in when
it is not the language, and the site icon), **Reading** (what the homepage displays, posts per
page, the notify server the feeds advertise), **Permalinks** (the tag and category
archive bases), **Discussion** (comments and when they close, webmentions sent
and received, and how long commenter emails, address hashes and contact
messages are kept), **Email** (how the site sends mail and where a message written to
it goes), **Privacy** (what the site shares of where a post was written, and
every later privacy choice) and **Federation** (the relays the site subscribes to). They live in
`content/_data/site.json`, which is published with the site and in git.

### Location on posts

A Micropub app such as Quill can send where a post was written, and the
editor has a Location box for it: coordinates, their accuracy, and the place's
name, locality, region and country. The site keeps it in `data/locations.json`,
keyed by the post's permalink, at mode 0600. It is never written into the
post's file, so `content/` and its git history never carry it, whatever the
setting says (decision-29). An Eleventy build of the same `content/` prints no
location for the same reason.

Where the browser can share its position, the Location box has a **Use my
location** button. It fills Coordinates and Accuracy, and says in the box when
the browser refused, timed out or could not find a position. It does not fill
in the place's name: turning coordinates into a name means sending them to a
geocoding service somebody else runs, so those boxes stay typed by hand.

A Micropub `checkin`, which Swarm-style apps send, is kept the same way, with
the editor's A check-in box ticked. Only its venue's name, locality, region,
country and coordinates are kept, never its street address, postcode or URL.
Readers see it as any other location, under the same setting.

**Location on posts** on Settings > Privacy decides what readers see, and
takes effect on the next request for every post without rewriting one:

| Choice                   | `locationSharing` | What a reader sees                                                                                       |
| ------------------------ | ----------------- | -------------------------------------------------------------------------------------------------------- |
| Keep it, publish nothing | `none`            | Nothing. The default.                                                                                    |
| Publish the place only   | `place`           | The name, locality, region and country, never a coordinate. A post with coordinates alone shows nothing. |
| Publish the coordinates  | `exact`           | The words and the coordinates.                                                                           |

What is shared is printed inside the post's h-entry as `p-location`, an h-card
when the place is named, an h-adr for its words, an h-geo for coordinates
alone, and federates as an ActivityStreams `Place` on the post's object,
with `latitude`, `longitude` and `accuracy` only under `exact`. The feeds, the
JSON and Markdown representations, the JSON-LD, oEmbed, search and `llms.txt`
carry no location at any level. The post's author gets the whole location back
from `q=source` whatever the setting.

The same page says that location and camera metadata is always removed from
uploads, and names `geekity strip-metadata` for files uploaded before that was
so.

**Site author** on the General page says who the site is. It lists every
user by display name, and Several authors. A new site has several authors.
Choosing a user makes the site that person's, and the homepage speaks for them,
whether it lists posts or shows a static front page. It shows their bio card,
carries their `rel="me"` profile links, and links their author archive with
`rel="me"`. The archive links back to the homepage with `rel="me"`, so the two
URLs are provably the same person. A Mastodon profile that links the homepage
then verifies, the homepage is their IndieAuth identity, and the structured
data names them as the site's publisher and what it is about. The footer and
the feeds credit them by display name. With Several authors, the homepage
speaks for nobody: it shows no bio and makes no `rel="me"` claims, the site
title stands in for a name in the footer and the feeds, and the structured
data has the site published by an Organization named for it. The bio always
links `/author/{username}/`, which stays the author's canonical page.

A link preview on Mastodon can credit the author, with a button to follow
them. Every post and page by a user carries
`<meta name="fediverse:creator" content="@username@host">`, which names that
user's own account on this site: the handle WebFinger answers for. The
homepage of a site with one author names that author. A page by nobody in
particular, such as a tag archive or the homepage of a site with several
authors, names nobody.

Mastodon shows the credit only when the account the tag names lists the
site's domain as one it may be credited from. A Mastodon account sets that
list under **Preferences > Public profile > Verification > Author
attribution**, by adding a domain such as `example.com`. Mastodon reads the
same list from a remote account's `attributionDomains`. The account this tag
names is the user's actor on this site, not a Mastodon account, so there is no
Mastodon setting to change. Every user's actor publishes `attributionDomains`
with the host of `baseUrl`, such as `example.com`, and so does the Update a
profile change sends. The port is left out, because Mastodon compares the list
with the shared link's host, which has none. A Mastodon server that fetched
the actor before this list existed reads it when it next refreshes the
account, or at once when the user saves their profile and the Update reaches
it.

`site.json` stores the chosen username as `author`, and has no `author` on a
site with several authors. **Breaking:** the free-text Author field and the
Solo author blog checkbox are gone, and `soloAuthor` is no longer read. An
`author` that names a user by username or display name keeps naming that user,
and the General page writes the username at its next save. An `author` that
names nobody, such as a free-text name, now makes a site with several authors:
its footer and feeds print the site title instead of the old name. decision-25
records the shape.

**Site icon** on the General page is the picture a browser tab, a home screen
and a search box show for the site. It takes the path of an image in the media
library, such as `/uploads/2026/10/icon.png`, the same form the Avatar field on
a user's screen takes. Use a square image at least 512 pixels wide: every icon
is cropped to the middle of it, and the largest one the web app manifest lists
is 512 pixels. From that one upload the site derives the 32 and 16 pixel
favicons and the 180 pixel `apple-touch-icon` the head links, `/favicon.ico`,
the 192, 512 and maskable 512 pixel icons in `/manifest.webmanifest`, and the
`Image` in `/opensearch.xml`. The page shows the current icon beside the field.
A full URL, a path outside `/uploads/`, a file that is not an image (PNG, JPEG,
GIF, WebP, AVIF, TIFF or SVG) and a path with no upload behind it are refused
with a message that says which, and nothing is saved. Clearing the field takes
the icon away.

`site.json` stores the path as `icon`, and has no `icon` when the field is
empty. A `site.json` written by hand with an `avatar` and no `icon` keeps using
the avatar as its icon. The field shows that avatar, and the next save of the
General page writes it as `icon`. With image optimization turned off, no icons
are derived and the site links none.

**License** on the General page says what readers may do with the site's
posts. The choices are no license, which is the default and means all rights
reserved, one of the seven Creative Commons licenses (CC BY, BY-SA, BY-NC,
BY-NC-SA, BY-ND and BY-NC-ND at version 4.0, and CC0 1.0), or a custom license
with the URL of its terms and a name. A custom license without an `http://` or
`https://` URL, or without a name, is refused. With a license chosen, the
default theme's footer links it with `rel="license"`, the JSON-LD `WebSite`
and each `BlogPosting` or `Article` carry it as `license`, the Atom feed and
each entry carry a `link rel="license"`, and the RSS channel and each item
carry a `creativeCommons:license`. JSON Feed has no field for a license and
says nothing. With no license, none of these is printed.

`site.json` stores a Creative Commons choice as its key under `license`, such
as `"license": "cc-by-sa"`, and a custom license as its URL under `license`
with its name under `licenseName`. Neither key is written when there is no
license.

A post or page can name its own license in its front matter, and it then
applies to that post's footer, its JSON-LD and its feed items instead of the
site's. The value takes the same forms as `site.json`:

- `license: cc-by` names a Creative Commons license by its key, in any case.
- `license: https://example.com/terms` names a custom license, with
  `licenseName: House terms` beside it. Without a name, a Creative Commons URL
  is named by its deed and any other URL by itself.
- `license: none` is all rights reserved on that post, whatever the site says.

A value that is neither a key, an `http` or `https` URL, nor `none` is
ignored, and the post keeps the site's license.

Nothing on those pages is an ActivityPub profile. Every user is an actor with a
name, a summary, a picture and links of their own, edited on that user's own
screen under `/admin/users`; saving one sends an `Update` of that actor to
their followers.

Each page is its own form saving its own fields. A page writes the settings it
carries onto the file as it reads at that moment and validates only what it
shows, so two pages saved at once both land, and a refused save comes back on
the page it came from having written nothing.

The time zone is the one setting that changes what a page says rather than what
it holds. Every date the CMS writes into a file is a UTC instant ending in `Z`;
the setting is the lens it is read through — the editor shows and accepts
wall-clock time in that zone, the theme's `date` filter renders `readable`,
`html` and `year` in it, and a new post's filename day and `/{yyyy}/{mm}/`
permalink come from the calendar day that zone was on when it was saved.
Changing it moves what every page shows on the next request and moves nothing
on disk, and it cannot move a URL that already exists. The package README has
[the whole rule](packages/cms/README.md#dates-and-the-timezone-setting).

**`content/_data/site.json` is the source.** Every settings page reads that
file, validates what was typed, and writes it back — to a temporary file in the
same directory, renamed over the old one, with the read and the write as one
step nothing else writing that file can get between. Nothing else remembers a
setting, so a save is on the public site and in the feeds on the very next
request, an Eleventy build of the same content directory
renders with the same values, and a hand edit of the file while the server runs
is picked up on the next request exactly as a save is. A site whose database
was written by an older version has its settings rows written into the file
once, on the first boot of this one, and the table is dropped.

The file always carries `title`, `tagline`, `url`, `postsPerPage`,
`timezone`, `language`, `tagBase`, `categoryBase`, `notifyServer`, `mailProvider`, `mailFromName`,
`mailFromAddress`, `mailReplyTo`, `contactEmail`, `relays`, `menus` and
`taxonomyRedirects`,
and `author` when the site names one, and every other key it already had is
kept — a site may put anything in there, `feedSize` included, and reach it from
its templates. A key it does not carry
is the default: an absent `notifyServer` is `https://rpc.rsscloud.io`, an empty
one is real-time notification turned off.

Nothing is written until every field is valid, and a form with a problem comes
back with a 400 and one message under each field that has one:

| Field          | Has to be                                                                         |
| -------------- | --------------------------------------------------------------------------------- |
| Title          | Not empty.                                                                        |
| Base URL       | An absolute `http://` or `https://` URL. See [Configuration](#configuration).     |
| Time zone      | An IANA zone name `Intl` knows, such as `Europe/London`.                          |
| Language       | A BCP 47 tag, such as `en` or `en-GB`. It is the page's `lang` and the feeds'.    |
| Posts per page | A whole number of one or more. It is what the home page and tag archives page by. |
| Tag base       | One URL-safe path segment. See below.                                             |
| Category base  | The same, and not the same word as the tag base.                                  |
| Relays         | One relay inbox per line, each an absolute `http://` or `https://` URL.           |
| Notify server  | An absolute `http://` or `https://` URL, or empty for none. See below.            |
| Mail provider  | `none`, `brevo` or `smtp`. See below.                                             |
| From address   | An email address, or empty for `no-reply@` at the site's host.                    |
| Reply-to       | An email address, or empty to reply to the From address.                          |

The notify server is an [rssCloud][rsscloud] and [WebSub][websub] server, and
it defaults to `https://rpc.rsscloud.io`, which speaks both. Every feed
advertises it, and the site tells it whenever a feed changes, so a subscriber
hears about a post at once instead of on its next poll. Emptying the field
takes the advertisement out of every feed and stops the pings; a different URL
moves both. See [Real-time notification][notify] in the package README.

A relay is a Mastodon-style hashtag or instance relay ([FEP-ae0c][fepae0c]) that
boosts every public post it is sent on to instances nobody here follows —
`https://tags.pub/user/_____relay_____/inbox` is one. Adding a line sends that
inbox a follow of the ActivityStreams Public collection; the relay answers, and
`/admin/federation` says where each subscription stands and offers a Retry for
one still waiting. Removing a line unfollows it. See
[Relays][relays] in the package README.

[fepae0c]: https://w3id.org/fep/ae0c
[relays]: packages/cms/README.md#relays
[rsscloud]: https://rpc.rsscloud.io/docs
[websub]: https://www.w3.org/TR/websub/
[notify]: packages/cms/README.md#real-time-notification

The two archive bases decide where the taxonomy archives live: `/{tagBase}/{tag}/`
and `/{categoryBase}/{name}/`. They default to WordPress's `tag` and `category`,
so a site imported from WordPress keeps every archive URL it published. Each is
one path segment — up to 64 letters, digits, dashes or underscores, starting
with a letter or a digit — the two may not be the same word, and neither may
take a path the site already answers on: `page`, `feed`, `admin`, `ap`,
`theme`, `uploads` or `nodeinfo`. Saving one moves the archive, its paging, its
feeds, every link the theme renders and the `Hashtag` hrefs on the
ActivityStreams `Article` on the next request; the old base 404s.

How the site sends email is a setting; the key or password that makes it work
is not. `mailProvider` picks `none`, Brevo's transactional API or any SMTP
server, and the From name, From address and reply-to go in `site.json` with
everything else — but the Brevo API key and the SMTP host, port, user and
password live in `data/mail.json` at mode `0600`, which is private and out of
git, and they have a pair of forms of their own on the Email page. Neither
secret is ever printed back into the page: the panel shows the last four
characters of the key and the host and user of the SMTP connection, and leaving
a secret blank keeps the one already stored. A **Send test email** button sends
a message through the whole chain and reports what the provider said, and with
no configuration at all nothing is sent and every feature that emails carries on
working. See [Email][email] in the package README.

[email]: packages/cms/README.md#email

## Navigation

A menu is a named thing the site stores and the theme asks for, and
`/admin/navigation` is where somebody manages them. It is a section of its own
after Pages rather than a settings page: a menu is content a site arranges, the
way its pages are, rather than a switch that changes how the site behaves — and
the shape of the screen comes from the active theme, which is not something a
page of fields can be.

**A theme declares where a menu can go.** Its `theme.json` carries an `areas`
list, each entry a `name` and a `label`:

```json
{ "areas": [{ "name": "primary", "label": "Site menu" }] }
```

That declaration is the whole of what puts an area on the screen. The packaged
theme declares `primary` ("Site menu") and `footer` ("Footer links"); a theme
that wants a third declares it, and a theme that declares none — or whose
`areas` cannot be read — inherits the packaged theme's, exactly as it inherits
every template it has not overridden.

**The screen is two lists.** First the areas the active theme declares, in the
theme's own order and under the theme's own labels, each a box of links. An
area the site has never filled in is an empty box rather than a missing one.
Then every other menu the site stores, under a heading saying this theme
renders them nowhere: those are kept, still editable — which is how the menu a
theme will use gets written before the site switches to it — and each has a
Delete, which is the only way a menu is removed. An area the theme declares is
emptied rather than deleted.

**A menu's items** are typed one `Label | URL` per line — `About | /about/`,
`Mastodon | https://example.social/@me | me` — rendered in that order, with the
item whose path is the one being read marked `aria-current`. A line may end in
the `rel` values the link carries, a word each: `| me`, which is how Mastodon
verifies that the site and the profile it links are yours, or anything else
HTML has, as in `A source | https://example.com/thing | nofollow noopener`.
They are taken off the end only while the last part reads as a list of values,
so `Odd | /odd/?a=1|2` keeps its query string. The menu is the whole of itself: a page cannot put
itself in one, so there is one screen to edit it on, one order, and no way for
a link to appear twice. A page the site serves as its front page is typed
`Home | /`, the URL a reader lands on, rather than at the permalink that
redirects there.

**A menu name** is lower-case letters, digits and underscores, starting with a
letter, up to 32 characters. It is the word a theme writes after the dot in
`{% for item in menus.footer %}`, which is why a dash is
refused: after a dot it is a minus sign, and a menu named `top-bar` would render
nothing and say nothing about why. Lower case is the other half of the rule, and
it is what stops two menus nobody can tell apart: `Footer` is refused rather
than quietly lowered, and a name the site already holds is refused too.

A site stores its menus as `menus` in `content/_data/site.json`, keyed by name.
Templates get them all as `menus`; an Eleventy build reads the same object —
`docs/eleventy.config.example.js` assembles it as `collections.menus`. See
[Navigation][navigation] in the theme README.

[navigation]: packages/cms/themes/default/README.md#navigation

## Tags and categories

`/admin/tags` and `/admin/categories` list every term in use with two counts —
what the public site lists under it, and every file carrying it including
drafts, scheduled posts and the trash — and a link to its archive. A term can be
renamed, merged into another, or deleted, and all three are the same rewrite:
the front matter of every file carrying it is re-read from disk (the files are
the truth, decision-1), rewritten through the document writer, and announced,
so the index, the feeds and one `Update(Article)` per affected published post
all follow. Each action says how many files it wrote.

Renaming onto a term that already exists is offered as a merge rather than done
quietly, with both counts on the screen; a file that carried both keeps the
target once, where it already stood. A rename is recorded as a
`taxonomyRedirects` entry in `content/_data/site.json`, so
the old archive URL and its feed answer `301` at the new one for as long as the
site keeps the record. Chains are collapsed as they are written, a term that
comes back into use is served rather than redirected, and deleting a term drops
every record pointing at it.
[The package README](packages/cms/README.md#managing-tags-and-categories) has
the detail.

## Users

`/admin/users` is who may sign in. There is one role — doc-5 puts anything
beyond admin out of scope for phase one — so the listing is a username, an
email address, when the account was made, and Edit. Everything about one person
is on their own screen at `/admin/users/<id>`: the account and its email
address, the public profile, what they are emailed about, your own password on
your own page, and the delete.

**`data/users.json` is the source.** One entry per user — id, username, an
optional email address, argon2 hash, created time — written the way every file this CMS owns is written: to a
temporary file beside it, renamed over the old one, with the read and the write
as one step nothing else writing that file can get between, and with `0600`
permissions, so nobody but the account the site runs as can read it. It is in
`data/` rather than `content/` because `content/` is published and in git, and
back it up: `data/geekity.db` may be deleted at any moment and rebuilt, but
this file cannot be rebuilt from anything.

Sessions stay in the database, which is what makes them cheap to throw away.
They name a user by id, and a session naming somebody `users.json` no longer
holds is not a login — so deleting the database signs everybody out and costs a
site nothing else, and restoring an old one cannot bring a deleted account back
or resurrect a password that has been changed.

Adding a user enforces exactly the rules `/admin/setup` and
`geekity user add` do: a username of 1 to 64 letters, digits, dots, dashes or
underscores, and a password of at least 8 characters. Tick **Generate one
instead** and the server makes the password itself, from `randomInt` over an
alphabet with no `0`/`O` or `1`/`l`, and shows it once in the flash on the next
page. The flash lives on the session row, so a generated password is never in a
URL, a cookie or a browser's history, and it is never stored in the clear —
leave that page without copying it and the only way back is to delete the user
and add them again.

Changing your own password asks for the current one first, then ends **every
other session that login has** and spares the one you are using. That is the
point of the screen: the reason to change a password is usually that somebody
else may have it, and a change that left the other browsers signed in would not
have fixed anything. The flash says how many were signed out. Changing somebody
else's password is deliberately not offered — a fresh account is the honest way
to hand a colleague a login, and it keeps the current-password check meaningful.

Deleting a user takes their sessions with them, and any that outlive the
deletion — in a database restored from a backup, say — are refused on sight,
because the file no longer holds the person they name. Two deletions are
refused, and the table only renders a button for rows that are neither:

- **The last remaining user.** A site with no users falls back into first-run
  setup, and the next person to reach `/admin` becomes its admin.
- **Your own account.** It would end the session doing the deleting, and there
  is no undo. Another admin can do it for you.

**A profile's links** are typed one per line, either `Label | URL` or a bare
URL that labels itself, and the URL is a path or an absolute `http(s)` one with
no spaces in it — the rule a menu item's URL is held to. It is the same line in
both boxes, down to the `rel` values it may end in, so
`Mastodon | https://example.social/@me | me` means here what it means on the
Navigation screen. Every one of these links is published `rel="me"` whether or
not it is typed, which is how Mastodon verifies a profile field pointing back
at this site and how IndieAuth knows the link is yours; nothing else in Geekity
asks for it. Typing `| me` is therefore a no-op rather than a second value, and
`| me nofollow author` puts all three on the rendered `rel`. A link stored
before the box was checked still renders and still comes back in the box; a
line that is still not a link is refused when the panel is saved, with the line
to fix named.

A form with a problem comes back with a 400, one message under each field, and
nothing written. The add form keeps the username that was typed; the password
forms keep nothing, because a password does not belong in rendered HTML.

**An email address is optional**, on the add form and inline on any row —
including somebody else's, since with one role every user already has every
power there is, and an admin who has just added a colleague should be able to
put their address in without waiting for them. Clearing the box removes it. It
never appears on the public site. `geekity user add ada --email ada@example.com`
sets one from a shell.

What the address buys is **getting back in without a shell**. `/admin/login`
carries a Forgotten your password? link to `/admin/forgot`, which takes a
username or an address and always answers with the same sentence — whether the
name matched, did not match, or matched somebody with no address. An answer
that varied would be a list of which accounts the site has. A match with an
address gets a message carrying a link to `/admin/reset`, good for an hour and
for one use; only the link's SHA-256 is stored, beside the sessions, so a copy
of the database is not a stack of working keys. Using it sets the password
under the same rules every other door enforces, cancels every other reset that
user had outstanding, signs out every session they had, and sends a
confirmation with no link back in. Requests are rate limited exactly as
sign-ins are, on a counter of its own so a flood of resets cannot lock somebody
out of logging in. With no mail configured the page says so and points at
`geekity user add`, which is how a site nobody can reach gets a fresh admin.
[The package README](packages/cms/README.md#forgotten-passwords) has the
detail.

## Signing in with your own site

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

### Connected apps

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

### Apps allowed without PKCE

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

### App activity

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

## Micropub

The site has a [Micropub](https://www.w3.org/TR/micropub/) endpoint, so you
can write, edit and delete posts from any Micropub app instead of the admin
editor. A post made this way is written exactly as the editor writes it, by the
user who connected the app. Publishing it sends webmentions, federates and
updates the feeds as an editor publish does.

The endpoint is `/_geekity/micropub` and its media endpoint is
`/_geekity/micropub/media`. The site root and every author archive advertise
the endpoint with a `Link: <…>; rel="micropub"` header and a
`<link rel="micropub">` in the head, beside the IndieAuth metadata. The CMS adds
both to the response, so every theme carries them and an app finds the
endpoint from the URL you sign in with. The endpoint and the media endpoint
answer 503 in maintenance mode.

### Connecting an app

1. In the app, sign in with your author URL, `https://example.com/author/{username}/`,
   or with the site URL. [Signing in with your own site](#signing-in-with-your-own-site)
   says which URL works for whom.
2. The app sends you to the site. Sign in to the admin if you are not signed in.
3. The consent screen names the app and lists what it asks for. A Micropub app
   asks for some of these scopes:

   | Scope     | The consent screen says   | What it allows                                       |
   | --------- | ------------------------- | ---------------------------------------------------- |
   | `create`  | Create posts as you       | A `POST` that creates a post, and an upload.         |
   | `update`  | Edit your posts           | `action=update`.                                     |
   | `delete`  | Delete your posts         | `action=delete` and `action=undelete`.               |
   | `media`   | Upload media to your site | An upload to the media endpoint, but no post.        |
   | `profile` | Your name, URL and photo  | Nothing on the endpoint. The app learns who you are. |

   Untick any scope you do not want the app to have. A scope the site does not
   offer, such as `draft`, is left off the screen and is not granted. The
   legacy `post` scope, which Quill still offers at sign-in, is shown and
   granted as `create` and `update`.

4. Choose Approve. The app gets an access token for the scopes you left
   ticked. The token works for seven days, and the app renews it with its
   refresh token, so it stays connected while you use it.

A query works with a token of any scope. A request without the scope its
action needs gets 401 `insufficient_scope`, as the
[Micropub spec's error table](https://www.w3.org/TR/micropub/#error-response)
says, with a `WWW-Authenticate: Bearer` header naming the scope.

When an app cannot sign in or its post is refused, open Users > App activity.
It lists the request, the properties it sent and the reason the site gave.
[App activity](#app-activity) describes the screen.

### Disconnecting an app

Open Users > Connected apps, at `/admin/users/apps`, and choose Revoke on the
app's row. Its access token and its refresh token stop working at once, and its
next request gets 401 `invalid_token`. To connect it again, sign in from the app
again. [Connected apps](#connected-apps) describes the screen.

Deleting a user also disconnects every app that user connected.

### Sending the token

An app sends its token in an `Authorization: Bearer` header, or in an
`access_token` field of a form-encoded or multipart body. Quill sends the same
token both ways, which the site accepts. A request that sends two different
tokens gets 400 `invalid_request`. A request with no
token gets 401 `unauthorized`. An unknown, expired or revoked token, or one
issued for another resource such as an MCP endpoint, gets 401 `invalid_token`.

### Creating a post

A `POST` without an `action` creates a post and needs the create scope. The
body is form-encoded (`h=entry&content=…`), multipart (the same fields, with
files as parts), or JSON (`{"type": ["h-entry"], "properties": {…}}`). In a
form, a property with several values is sent once per value, as `category` or
`category[]`. In JSON, each property is a list of values, and a bare value is
read as a list of one, as Quill's event editor sends some. The site answers 201 with a `Location` header naming the new
post's URL, draft or not.

The endpoint maps these properties onto the editor's fields, and decision-27
records the mapping. Each property takes one value unless the table says
otherwise.

| Property               | Becomes                                                                                                                                                                                                                                                                                                                                                         |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `h=entry`              | A post. In JSON, `"type": ["h-entry"]`.                                                                                                                                                                                                                                                                                                                         |
| `h=event`              | An event (decision-32). In JSON, `"type": ["h-event"]`. Needs `start` and `name`. Its `location` is the event's place, not where the post was written.                                                                                                                                                                                                          |
| `content`              | The body. Text is kept as the Markdown it is written in, and `{"html": "…"}` is converted to Markdown. Either way the HTML in it is cleaned first; see below.                                                                                                                                                                                                   |
| `name`                 | The title. A post without one is a note.                                                                                                                                                                                                                                                                                                                        |
| `summary`              | The description.                                                                                                                                                                                                                                                                                                                                                |
| `category`             | The tags, one tag per value. Several values.                                                                                                                                                                                                                                                                                                                    |
| `published`            | The date. A date without an offset is in the site's time zone. Without it, the post is dated now.                                                                                                                                                                                                                                                               |
| `post-status`          | `published` or `draft`. A draft is not published, federated or sent webmentions.                                                                                                                                                                                                                                                                                |
| `mp-slug`              | The slug in the file name and the URL. Without it the slug comes from `name`, then the content's first five words. A like, repost, bookmark or reply with neither is named after the cited page's title, as `liked-scripting-news`, else its address, as `liked-scripting-com`. A photo post with neither is named by its first photo's alt text, else `photo`. |
| `in-reply-to`          | Makes the post a reply to that URL.                                                                                                                                                                                                                                                                                                                             |
| `rsvp`                 | `yes`, `no`, `maybe` or `interested`. With `in-reply-to` naming an event, makes the post an RSVP to it, and refused without it. Needs no content. It federates as a Note replying to the event (decision-31).                                                                                                                                                   |
| `like-of`              | Makes the post a like of that URL. Needs no content. A like of a fediverse status federates as a `Like` of it (decision-28).                                                                                                                                                                                                                                    |
| `repost-of`            | Makes the post a repost of that URL. Needs no content. A repost of a fediverse status federates as an `Announce` of it (decision-28).                                                                                                                                                                                                                           |
| `bookmark-of`          | Makes the post a bookmark of that URL. Needs no content.                                                                                                                                                                                                                                                                                                        |
| `read-of`              | What was read: an h-cite, `{"type": ["h-cite"], "properties": {"name": ["…"]}}` with `author`, `uid` (`isbn:…` or `doi:…`) and `url` when known. With `read-status`, makes the post a read. Needs no content.                                                                                                                                                   |
| `read-status`          | `to-read`, `reading` or `finished`. Sent with `read-of`, and refused without it.                                                                                                                                                                                                                                                                                |
| `photo`                | A photo on the post. Several values. A value is a URL, `{"value": "…", "alt": "…"}` in JSON, or a file part in a multipart request. A post with a photo and no reply target is a photo post.                                                                                                                                                                    |
| `start`                | When an event starts. A time without an offset is in the site's time zone. Sent only with `h=event`, and refused on an `h=entry`.                                                                                                                                                                                                                               |
| `end`                  | When an event ends, with `h=event` only. An end before the start is refused.                                                                                                                                                                                                                                                                                    |
| `location`             | Where the post was written: a `geo:` URI such as `geo:48.85837,2.29448;u=50`, which Quill sends, or an h-geo, h-adr or h-card object. Kept in `data/locations.json`, never in the post's file; [Settings > Privacy](#location-on-posts) decides what readers see.                                                                                               |
| `location` (event)     | With `h=event`, where the event is, written into the post as its place: words, a web address for an online event, or an h-card or h-adr, which is written as its name and address joined by commas, or as its `url` when it names none. Its coordinates are dropped. A `geo:` URI is refused.                                                                   |
| `checkin`              | The venue of a checkin, an h-card, as Swarm and micropub.rocks send it. It becomes the post's location, marked as a checkin: the name, coordinates, locality, region and country are kept, and the URL, street address and postcode are dropped. Needs no content. A `location` sent with it fills in what it leaves out. Readers see it as any other location. |
| `mp-syndicate-to`      | Selects a syndication target by its `uid`, as the editor's Syndicate to checkboxes do. Several values. The post is sent to the targets when it is published.                                                                                                                                                                                                    |
| `slug`, `syndicate-to` | The same as `mp-slug` and `mp-syndicate-to`. Quill accounts created before Quill renamed them still send these names.                                                                                                                                                                                                                                           |
| `p3k-content-type`     | `text/plain` or `text/markdown`, which Quill sends from its content type selector. Either way the content is kept as Markdown, and nothing else is stored. Any other type is refused.                                                                                                                                                                           |
| `visibility`           | `public` or `unlisted`. Unlisted writes `visibility: unlisted`: the post keeps its page and federates, but is left off every listing, feed, the sitemap and search. `private` is refused, since the site has no private posts.                                                                                                                                  |
| `access_token`         | The token, when it is not in the header. It is never stored on the post.                                                                                                                                                                                                                                                                                        |

Content is cleaned at the endpoint, because a post's Markdown is rendered with
its raw HTML, as Eleventy renders it, and an app granted only the `create`
scope should not be able to put script on the site. HTML content is put through
an allow-list (headings, paragraphs, emphasis, links, lists, images, code,
quotations, tables, figures and details) and converted to Markdown. Script,
style, iframe, object, SVG and form elements, event-handler and `style`
attributes, link addresses with a scheme other than `http`, `https` or
`mailto`, and image addresses with one other than `http` or `https` are
removed. A table, figure, details or definition list
stays as an HTML block with no indentation and no blank line inside it, so
pretty-printed HTML never turns into a code block. Text and Markdown content
keeps its text as sent, and each piece of raw HTML in it, as the renderer reads
it, goes through the same allow-list. `q=source` answers the Markdown that was
stored. Posts written in the editor or as files are the owner's and are not
cleaned.

A like, repost or bookmark cites its URL on the post's page and sends that URL
a webmention when the post is published, as a reply does.

A read prints what was read, such as "Want to read: The Left Hand of Darkness
by Ursula K. Le Guin, ISBN: 9780441478125", on its page, opens its feed items
with the same line and federates as a note that says the same. A `read-of`
with a `url` is sent a webmention, as a citation is. A read keeps no `summary`:
its summary is that line, so changing `read-status` changes it everywhere.
[indiebookclub](https://indiebookclub.biz/) posts reads this way, and a test
replays the request its documentation shows.

A photo file part is stored in the media library the way the media endpoint
stores a file, and must be an image. A photo URL that points at this site's own
uploads is written as the upload's path, so the theme serves its resized
versions. A photo URL on another site is shown from that site. A photo without
alt text of its own takes the alt text from the media library.

A request whose `Content-Length` is over the larger of `uploadMaxBytes` and
`uploadMediaMaxBytes`, plus 8 KiB for the multipart envelope, gets 400
`invalid_request` before its body is read. The limit covers the whole request,
so several photo files in one create share it, and it applies to JSON and
form-encoded bodies too. The media endpoint has the same check.

A property not in the table, such as `itinerary`, is kept as it was
sent and the rest of the post is published. The site keeps it in
`data/kept-properties.json`, keyed by the post's URL and mode 0600, never in
the post's file, and shows it nowhere: not on the page, its Markdown or JSON,
the feeds, the fediverse, search or `llms.txt`. `q=source` gives it back, an
update changes it, and it moves with the post. A post keeps up to 16 KiB of
them. decision-27 records the rule.

Anything else gets 400 `invalid_request` with a description that names it, and
nothing is written. That covers another type such as `h=card`, an `mp-`
command the site does not carry out such as `mp-channel`, a create whose only
properties are ones the site does not understand (Quill's weight post, which
would publish an empty post), a file sent as a property other than `photo`, a
`location` that is not a `geo:` URI or an h-geo, h-adr or h-card, a `checkin`
that is not an h-card naming a place, a second
value for a property that takes one, a `uid` the site does not declare, and
anything the editor itself refuses, such as an `in-reply-to` that is not a URL.

### Changing and deleting a post

A `POST` with an `action` changes a post that already exists. Its `url` is the
post's URL on this site. A URL that is not a post here gets 400
`invalid_request`, and a post another user wrote gets 403 `forbidden`.

- `action=update` needs the update scope and a JSON body, such as
  `{"action": "update", "url": "…", "replace": {"content": ["…"]}}`.
  - `replace` sets a property's values.
  - `add` adds values to a property, which need not exist yet.
  - `delete` takes away the values it lists, or, given a list of property
    names, the whole properties.

  Only the properties it names change. It accepts the properties a create
  accepts, except `mp-slug` and `slug`, and changes a kept property the site
  does not understand as it changes the others. A `p3k-content-type` or `visibility` is
  checked as a create checks it and changes nothing. Adding or deleting an `mp-syndicate-to` value
  selects or deselects that target, and a deselected target is told the post no
  longer links to it. An update is saved exactly as an editor save. The post
  is stamped updated, federates an `Update` and sends webmentions. If the post
  is open in the editor, the editor reports a conflict on its next save instead
  of overwriting the update. The site answers 204, or 201 with a `Location` header
  when the post's URL changed, which only a re-dated draft can do.

  On an event, `start`, `end` and `location` change the event. Changing one
  keeps the other two, an end before the start is refused, and deleting
  `start` is refused, since it would leave a post that is no event; the
  editor can do that. A `start` or `end` sent to a post that is no event is
  refused.

- `action=delete` needs the delete scope. It moves the post to the trash, as
  the editor's Move to trash does. The post leaves the site, its feeds and
  search, and federates a `Delete`. The body is form-encoded or JSON. The site
  answers 204.
- `action=undelete` needs the delete scope. It restores the post from the
  trash and answers 204.

### Queries

A `GET` with `q` asks the endpoint a question and answers JSON. A query with
no `q`, or one the endpoint does not answer, gets 400 `invalid_request`.

- `?q=config` lists the media endpoint, the syndication targets under
  `syndicate-to`, the post types the site accepts (note, article, reply, RSVP,
  photo, like, repost, bookmark, read and event), the queries it answers, and the visibility
  values a post may take, `"visibility": ["public", "unlisted"]`. Each post
  type lists the `properties` a client should offer for it and the
  `required-properties` that make a post that type, so a client that reads
  the list, such as Micropublish, offers no field the site refuses. The event
  type offers `start`, `end`, `name` and the common properties, and requires
  `start` and `name`.
- `?q=syndicate-to` lists the syndication targets on their own. Each is the
  `uid` and `name` of a target in `content/_data/syndicationTargets.json`, with
  its `id` as the `uid`. A site that declares none lists `[]`. The file is read
  on each query, so a target added by hand is offered at once.
- `?q=category` lists every tag and category on a published post, once each,
  in alphabetical order. Add `&filter=…` to keep only the terms that contain
  that text, ignoring case.
- `?q=source&url=…` answers a post's properties in the same mapping a create
  takes, so an app can edit them and send them back. The selected syndication
  targets are under `mp-syndicate-to`; an id in the post's `syndicate-to` that
  names no declared target is left out and kept in the file. A photo in the
  media library is given as its absolute URL. The post's `location` is
  answered whatever Settings > Privacy shares, because the token's user is the
  author who sent it: a `geo:` URI for coordinates alone, an h-adr for a
  place's words, an h-card for a named place, each with the coordinates and
  their accuracy nested as `geo`. A checkin is answered as `checkin`, an
  h-card, instead of `location`. An event is answered as an `h-event` with its
  `start` and `end` as UTC instants and its place as `location`; the author's
  own location on an event is answered only when it is a checkin. A property
  the site does not understand is answered as it was sent. Add `&properties[]=content`, once
  per property, to get only those properties, without the type. The same
  ownership rules as an update apply.
- `?q=source` on the media endpoint answers
  `{"items": [{"url": "…", "published": "…"}]}`, the most recent file the
  token's user uploaded through it and when, or `{"items": []}` when there is
  none or the file has since been deleted. `&limit=…` caps the list; the site
  keeps only the last upload, so the list never holds more than one. Quill asks
  this to offer a photo uploaded in the last 15 minutes for the next note.
- `?q=last` on the media endpoint answers the same upload as `{"url": "…"}`, or
  `{}`. Each user's last upload and its time are kept in `micropub-media.json`
  in the data directory.

### Uploading media

The media endpoint takes a file before an app names it in a post. It takes a
token with the create scope or the media scope, because a create can already
carry a photo file part. A token with neither gets 401 `insufficient_scope`,
whose `WWW-Authenticate` header names `scope="create media"`. A token with media
and without create can upload but cannot create a post. The body is
`multipart/form-data` with the file in a part named
`file`. The file goes into the media library exactly as an admin upload does.
It is stored under `content/uploads/{yyyy}/{mm}/`, its image variants are
derived, and it is listed on the media screen. The site answers 201 with a `Location` header
naming the file's URL. A file over the upload limit, of a type the library does
not accept, or whose bytes do not match its extension gets 400
`invalid_request` with the library's reason, and nothing is stored.

### Clients and conformance

Each [micropub.rocks](https://micropub.rocks/) server test request has been
replayed with curl against a local site, and the full suite was run against
shll.me on 0.19.0 (2026-10-03). Every test passes except this one:

- 805 sends the same token in the header and the body and expects it refused,
  as RFC 6750 says. The site accepts it, because Quill sends its token that way
  and refusing it would refuse every Quill post.

Test 204 sends a `checkin` h-card. The site publishes the post and keeps the
checkin as the post's location, published only as far as Settings > Privacy
allows. A test replays the request.

Test 700 uploads a jpg with the token micropub.rocks signs in for, which has
create, update, delete and undelete and no media. It passes because the media
endpoint takes a create token.

[Quill](https://quill.p3k.io/) is supported: its note, article, bookmark, like,
repost and event editors, the location its note editor attaches, its photo uploads
through the media endpoint, and its last photo offer. Tests replay the
requests its source builds. On a site with `requireAltText` on, a photo needs
alt text: type it in Quill's photo dialog, which then sends
`{"value": "…", "alt": "…"}`, or the post is refused. An event whose place
was looked up keeps the place's name and address and drops its coordinates,
and one given a date and no time starts at midnight in the site's time zone.
Quill's code, review, itinerary, exercise and weight posts are not supported
yet.

## The theme

Templates are Nunjucks (decision-4). The default theme lives in
`packages/cms/themes/default` and ships inside the package: `layouts/` for the
base layout, home, post, page, tag archive and 404; `partials/` for the post
list, the pager, the bio and the tag macros; `static/style.css`, served at
`/theme/style.css`. That stylesheet is compiled from `src/style.css` with
Tailwind v4 by `pnpm build` (decision-22): a build product, gitignored and
shipped in the package, and one plain CSS file to a reader, with no script,
web font or CDN behind it. `pnpm --filter @geekity/cms build:theme` recompiles
it alone, and the package's `pretest` does so before its suites read it.

It is the Paper design (doc-9) on the andrewshell.org shell (decision-16): one
warm column at 42rem, serif throughout with sans for small labels, and a
kicker above every entry naming its kind, so an article is the only thing with
a headline and a note or a reply is its words. `layouts/base.njk` is the shell — the skip
link, a `.global-wrapper` that says when it is at `/`, a header that is the
site title and tagline on the front page and a small link home everywhere else,
and a footer with the copyright, the colophon and `menus.footer`. The header
carries `menus.primary` on every page — a line of its own under the tagline at
the root, beside the small link home everywhere else — so a reader looks in one
place whatever they are reading. The bio under an entry carries the person it
is by and nothing else, and the footer links what a site typed into its footer
menu rather than anything read off an account.
Webrings, badges and anything else particular to one site are not in the
package: they go in a site theme's `footer` block. Dark mode follows the
system under `prefers-color-scheme: dark`, and
`packages/cms/src/web/theme-colors.test.ts` reads the `--color-*` custom
properties out of the compiled stylesheet and proves every run of text in both
schemes meets 7:1 and every border a reader relies on meets 3:1, so a colour
change that breaks one fails the build.

A site keeps its own themes under `themes/` — `themesDir` in the config,
`GEEKITY_THEMES_DIR` at boot — one directory per theme with a `theme.json` in
it giving a display `name`, a `kind` of `site` and an optional `description`.
The directory's name is the theme's id, and the one setting that picks a theme,
`theme` in `content/_data/site.json`, holds that id. A template is looked up in
the chosen theme first and in the packaged theme second, one file at a time, so
a theme that ships only `layouts/post.njk` replaces the post layout and keeps
receiving updates to every other template. Assets under `/theme/` resolve in
the same order, and so do the mail templates under `mail/`. A layout links a
theme file with `{{ "style.css" | asset }}`, which writes a URL with a hash of
the file's bytes in it; that URL is cached for a year as `immutable`, and the
plain `/theme/style.css` for an hour. Image variants and icons under
`/uploads/_/` work the same way: the page links them with a hash of the
original upload's bytes as `v`, so a picture deleted and replaced under the
same name gets new URLs. A matching `v` is cached for a year as `immutable`;
no `v`, or a stale one, still gets the file, for a day.

**Appearance > Themes** in the admin is where the choice is made: the packaged
theme and everything under `themes/` with its name and description, the active
one marked, and one Activate button. Activating the packaged theme takes the
`theme` key out of `site.json` rather than writing an empty one, which is why a
site running the default has no such key. A change takes effect on the next
request with no restart, a folder whose manifest will not read is listed under
"Not themes" with the reason, and a `theme` naming a theme that is not there
falls back to the packaged one with a warning in the log rather than a broken
site. Nothing scaffolds `themes/`: a site has one once it writes a theme.

The admin is not themed (decision-4, decision-15). Its templates are a tree of
their own with their own loader, off the theme search path, so no theme can
shadow the login form or the CSRF field inside it.

The context mirrors what an Eleventy layout receives — `title`, `date`, `tags`,
`categories`, `content`, `page.url`, and every front matter key the file carried — so a
layout can move between an Eleventy build and the CMS with few edits. The
context, the blocks and the filter set (`date`, `url`, `absoluteUrl`, `asset`) are part
of the semver contract; they are documented in
[`packages/cms/themes/default/README.md`](packages/cms/themes/default/README.md).

`apps/demo/themes/demo/` is the worked example. The demo ships wearing the
packaged theme, so `pnpm dev` shows what a new site gets, and the demo theme is
one Appearance screen away. Beside its `theme.json` it holds two files:
`layouts/post.njk`, which extends the packaged base layout and adds a byline of
its own and a reading time, and `static/style.css`, which replaces the packaged
stylesheet at `/theme/style.css`. Everything else the demo serves still comes
from the package. `apps/demo/test/site.test.ts` asserts both halves over HTTP:
the packaged post layout and the packaged stylesheet as the demo ships, and,
against a copy of the content with `"theme": "demo"` written in, the byline,
the reading time and the demo stylesheet. A stylesheet is the one
all-or-nothing override: assets resolve file by file the way templates do, so a
site's `style.css` is served instead of the packaged one, not after it.

`apps/demo/content/pages/contact.md` is the worked example of the other kind of
opt-in: `contact: true` puts the contact form under the page, and the demo's
`menus.primary` names it so the page is in the menu. Send it a message with the demo
running and the message is written to `data/contact/` before anything is
emailed, and is waiting on **Messages** in the admin. Where it is emailed is the
`contactEmail` setting in `content/_data/site.json`, which is read when the
submission arrives and reaches no template — `apps/demo/test/site.test.ts`
asserts that address is in none of the HTML the demo serves.

The demo's content directory also builds with Eleventy.
`apps/demo/eleventy.config.js` re-exports
[`packages/cms/docs/eleventy.config.example.js`](packages/cms/docs/eleventy.config.example.js) —
a site of your own copies that file and owns the copy, but the demo re-exports
it so the two cannot drift — and `content/_includes/post.njk` and `page.njk`
are the layouts the directory data files name. `pnpm --filter demo build:11ty`
writes `_site/`, which is gitignored.

Rendering does not need a request:

```ts
import { createRenderer, resolveConfig } from '@geekity/cms';

const renderer = createRenderer({ config: resolveConfig() });
renderer.renderDocument(document);
```

Handlers reach the same renderer as `c.var.renderer`, alongside `c.var.store`
and `c.var.config`.

## Deploying with Docker

The image `ghcr.io/geekitycom/cms` runs `geekity serve` over four directories
under `/site`: `content/`, `data/`, `plugins/` and, optionally, `themes/`. It runs as uid
1000, listens on port 3000 and fills an empty `content/` with the starter site
on its first start. [`deploy/compose.yaml`](deploy/compose.yaml) runs it as a
compose stack. It is written for [dockge](https://github.com/louislam/dockge),
but plain `docker compose` reads it the same way. Nothing else from this
repository goes on the server.

The steps below assume a Linux server with Docker, a stack directory of
`/opt/stacks/geekity` (dockge's default layout), and a reverse proxy on the same
machine that terminates TLS.

### 1. Create the stack and its directories

In dockge, create a stack called `geekity` and paste in `deploy/compose.yaml`.
With plain compose, copy the file to `/opt/stacks/geekity/compose.yaml`.

Then, in the stack directory, create `content/`, `data/` and `plugins/` and
give them to uid 1000 before the first start:

```sh
cd /opt/stacks/geekity
mkdir -p content data plugins
sudo chown 1000:1000 content data plugins
```

The container runs as uid 1000 and writes to all three directories. If they
are missing, Docker creates them owned by root and the site fails to start with
`EACCES`. `content/` must be empty, or already hold a site: an empty one is
filled with the starter site, and one with anything in it, even a dotfile, is
left alone. `plugins/` holds the plugins `geekity plugin add` installs; see
[Installing a plugin on Docker](#installing-a-plugin-on-docker).

To move an existing site in, copy its `content/` and `data/` here instead and
`chown -R 1000:1000` them.

### 2. Write the `.env`

The `.env` sits beside `compose.yaml` (dockge edits it on the stack page).
Compose reads it for the image tag and passes every line in it to the container.

```sh
# The image tag to run, which is the @geekity/cms version in it. Required: it
# has no default, so the stack never picks a version by itself. `latest` is
# published too, and works here.
GEEKITY_TAG=0.3.0

# The public address of the site. Required. Canonical URLs, feeds, ActivityPub
# ids and the Secure flag on the session cookie all come from it, and the
# starter site's site.json is written with it.
GEEKITY_BASE_URL=https://blog.example.com

# The port on 127.0.0.1 the reverse proxy connects to. Defaults to 3000.
# GEEKITY_HOST_PORT=3000
```

Compose refuses to start the stack when `GEEKITY_TAG` or `GEEKITY_BASE_URL` is
missing, and says which one.

The compose file names three variables itself, and its values win over the
`.env`:

| Variable              | Value  | Why                                                                       |
| --------------------- | ------ | ------------------------------------------------------------------------- |
| `GEEKITY_BASE_URL`    | `.env` | Passed through, so compose can refuse to start without it.                |
| `GEEKITY_TRUST_PROXY` | `true` | The client address comes from the proxy's `X-Forwarded-For`.              |
| `GEEKITY_PORT`        | `3000` | The port mapping and the health check assume it. Use `GEEKITY_HOST_PORT`. |

The image sets `GEEKITY_CONTENT_DIR`, `GEEKITY_DATA_DIR`, `GEEKITY_THEMES_DIR`
and `GEEKITY_SEED_CONTENT`; leave them alone. Any other setting in
[Configuration](#configuration) can go in the `.env`, for example
`GEEKITY_UPLOAD_MAX_BYTES` or `GEEKITY_IMAGE_FORMATS=webp,avif`. Mail, comments
and the rest of the site settings are set in the admin, not here.

### 3. Start it and point the proxy at it

Deploy the stack in dockge, or:

```sh
docker compose up -d
docker compose ps       # (healthy) once /healthz answers 200
```

The port is published on `127.0.0.1` only. Docker writes its own firewall
rules ahead of ufw and firewalld, so a port published on every interface would
be reachable from the internet even with the firewall closed, and anyone
connecting to it directly could put any address in `X-Forwarded-For`. Do not
change the mapping to `3000:3000`.

The proxy forwards to `http://127.0.0.1:3000`. Geekity reads the **first**
address in `X-Forwarded-For`, so the proxy must replace that header with the
address it saw rather than append to one the client sent. For nginx:

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $remote_addr;
    client_max_body_size 200m;  # at least GEEKITY_UPLOAD_MEDIA_MAX_BYTES
}
```

The proxy's body limit has to be at least the larger of
`GEEKITY_UPLOAD_MAX_BYTES` and `GEEKITY_UPLOAD_MEDIA_MAX_BYTES`, 200 MiB by
default, or an episode is refused by the proxy with a 413 before Geekity sees
it. nginx's own default is 1 MiB. Caddy sets no limit unless the site block has
a `request_body { max_size 200MB }`, and Cloudflare's free plan stops at 100 MB
whatever the origin allows, so a larger episode has to be uploaded to the
server directly.

Geekity compresses its own text responses, brotli or gzip, so the proxy does
not need to. If the proxy compresses anyway (nginx with `gzip on`, Caddy with
`encode`, or a CDN such as Cloudflare), add `GEEKITY_COMPRESSION=false` to the
`.env` so each response is compressed once, by the proxy. Leave it on when the
proxy only forwards, as the nginx block above does.

`GET /healthz` is also what an uptime monitor should poll; see
[Health check](#health-check).

### 4. Sign in for the first time

A site with no users sends `/admin` to `/admin/setup`, where the first person
to arrive creates the admin account. Do this as soon as the site is reachable.

To create the account from the server instead, and close the setup screen
before anyone else reaches it:

```sh
docker compose exec geekity geekity user add ada --email ada@example.com
```

It prompts for the password without echoing it. Run from the stack directory,
`docker compose exec` finds the container by its service name, `geekity`; plain
`docker exec -it <container> geekity user add ada` works as well. The command
writes `data/users.json` through the same mount as the server, and the new
account can sign in straight away.

### 5. Bring a WordPress author across

[Moving a site off the WordPress ActivityPub plugin](packages/cms/README.md#moving-a-site-off-the-wordpress-activitypub-plugin)
describes the cutover. In a container, the WordPress plugin and the user have
to exist first, and the exported key pair is read from standard input so no
copy of the private key is left inside the container:

```sh
docker compose exec geekity geekity plugin add @geekity/plugin-wordpress
docker compose exec geekity geekity user add ada
docker compose exec -T geekity geekity import wordpress-actor ada \
  --actor-id 'https://blog.example.com/?author=2' \
  --wordpress-id 2 \
  --keypair /dev/stdin < ada.keypair.json
shred -u ada.keypair.json
```

`-T` stops compose allocating a terminal, which would swallow the redirected
file. Left to itself, the import fetches the followers from the plugin on the
actor id's origin. A saved followers file has to be copied in first:

```sh
docker compose cp followers.json geekity:/tmp/followers.json
```

and then passed as `--followers /tmp/followers.json`.

### Reading the logs

The container writes to stdout and nothing else — no log file inside the
image, nothing to rotate — so Docker collects it and dockge shows it. From the
stack directory:

```sh
docker compose logs -f              # follow everything, boot lines included
docker compose logs -t --since 1h   # the last hour, with Docker's timestamps
docker compose logs | grep webfinger
```

The image runs `geekity serve`, so [the access log](#the-access-log) is on:
one line per request, `GET /path?query 200 4.2ms`. That is what answers "did
that Mastodon instance ever ask about me?" — `docker compose logs | grep webfinger`
shows each lookup and what it was answered with. The health check polls
`/healthz` every 60 seconds, so those lines are the background hum; `grep -v healthz`
drops them.

The client address is not logged unless the stack asks for it. To turn it on,
add `GEEKITY_ACCESS_LOG_ADDRESS=true` to the `.env` and redeploy; behind the
proxy `GEEKITY_TRUST_PROXY` is already `true`, so the address logged is the
visitor's rather than the proxy's. `GEEKITY_ACCESS_LOG=false` turns the log
off altogether.

### Backups

Everything the site cannot rebuild is under the stack directory
([Two directories](packages/cms/README.md#two-directories-content-and-data) in
the package README has the full list):

- **All of `content/`**: posts, pages, uploads, `site.json`, followers, the
  inbox log and comments.
- **`data/`, apart from what is derived.** `data/users.json` and `data/keys/`
  matter most: the accounts, and the key pairs every follower has cached.
  Losing the keys breaks federation. The rest (`mail.json`, `akismet.json`,
  `contact/`, `comment-salt`, `notification-secret` and the other small files)
  is credentials and records that are also not rebuilt.
- **`compose.yaml` and `.env`**, so the stack can be recreated.

`data/geekity.db` (with `-wal` and `-shm`), `data/images/` and `data/avatars/`
are derived and need not be copied: the database is rebuilt on the next start, and an image
variant the next time it is asked for. The site writes its files by renaming a
finished copy over the old one, so a copy taken while it runs gets whole files;
stop the stack first if the copy has to be of one moment. For example:

```sh
tar -C /opt/stacks -czf geekity-$(date +%F).tar.gz \
  --exclude='geekity/data/geekity.db*' --exclude='geekity/data/images' \
  --exclude='geekity/data/avatars' geekity
```

Restore by unpacking it into `/opt/stacks`, checking `content/` and `data/` are
still owned by uid 1000, and starting the stack.

### Upgrading and rolling back

Every published version is a tag (see
[Publishing the Docker image](#publishing-the-docker-image)). To upgrade, set
`GEEKITY_TAG` in the `.env` to the new version and redeploy, which in dockge is
Save then Deploy, and with plain compose is:

```sh
docker compose pull
docker compose up -d
```

Database migrations run on start, so there is no other step. Read the
[changelog](packages/cms/CHANGELOG.md) for the versions in between first; a
breaking change carries a note there.

An upgrade never deletes a reader's data. Commenter emails, address hashes and
contact messages are kept until the owner sets a retention period on
**Settings > Discussion** ([Personal data](#personal-data)).

`GEEKITY_TAG=latest` is the other way to run this. Every push moves that tag,
so an upgrade is `pull` and `up -d` with nothing to edit — at the cost of the
site not saying which version it is on, and of the rollback below starting with
finding that out. `docker compose exec geekity geekity --version` answers it.
Pin the version if the site matters; the tags stay published either way.

To roll back, set `GEEKITY_TAG` to the version you came from and redeploy the
same way. If the newer version migrated the database, the older one refuses to
start and says the database was written by a newer `@geekity/cms` (the logs in
dockge, or `docker compose logs`, show it). The database is a cache, so rebuild
it with the old version — the one rebuild the admin cannot do, because there is
no site running to press a button in:

```sh
docker compose stop
docker compose run --rm geekity geekity rebuild
docker compose start
```

`geekity rebuild` refuses to run while the server has the database open, so
`docker compose exec` will not do; the one-off container from `run` uses the
same image, `.env` and mounts with the server stopped. A rebuild signs everyone
out; [what else it costs](#what-is-in-the-database-and-what-a-rebuild-loses) is
listed above. The same three commands fix a damaged database.

**Every other rebuild belongs in the admin.** When the index and the content
files have come apart — content edited over ssh, a `git pull` while the stack
was down, one of the two restored from a backup — **Tools > Content index**
[reads every file again on the running site](#rebuilding-the-index-from-the-admin):
no stopping the stack, no one-off container, nobody signed out, and none of the
cost listed above. In a container the server is PID 1, so
`docker exec <container> geekity rebuild` can never work; the admin is the door
that is always open.

### A custom theme

With no `theme` in `content/_data/site.json`, the site wears the default theme
that ships in the image. To use one of your own:

1. Create `themes/` in the stack directory and put the theme in it, one
   directory per theme with a `theme.json` in it (see [The theme](#the-theme)):

   ```sh
   mkdir -p themes
   cp -r ~/my-theme themes/my-theme
   sudo chown -R 1000:1000 themes
   ```

2. Uncomment the `./themes:/site/themes:ro` line under `volumes` in
   `compose.yaml` and redeploy. The site only reads this directory, so it is
   mounted read-only.
3. In the admin, choose the theme on **Appearance > Themes**. That writes
   `theme` into `site.json`, and it takes effect on the next request.

A theme can replace a single template or `style.css` and take everything else
from the default theme.

## Continuous integration

`.github/workflows/ci.yml` runs on every pull request and every push to `main`.
Each gate is its own job so it can be named as a required status check:

| Job            | What it runs                                        |
| -------------- | --------------------------------------------------- |
| `lint`         | `pnpm lint`, then `pnpm format:check`.              |
| `typecheck`    | `pnpm typecheck`.                                   |
| `test`         | `pnpm test` on Node 24.                             |
| `test-node-26` | The same suite on Node 26, the current line.        |
| `build`        | `pnpm build`.                                       |
| `test-11ty`    | `pnpm test:11ty`, the Eleventy compatibility suite. |
| `pack-install` | `scripts/pack-install-smoke.sh`.                    |
| `docker-smoke` | Builds the image, then `scripts/docker-smoke.sh`.   |

The four steps every job shares — install pnpm from the pinned
`packageManager`, install Node with the pnpm store cached, run
`pnpm install --frozen-lockfile` — live in the local composite action
`.github/actions/setup-workspace`. A new job is a `uses:` line, not another copy
of the setup.

Two things about that install are worth knowing. `pnpm install` runs the root
`prepare` script, which is `husky && pnpm build`, so `dist/` exists in every job
before its own command runs; the `build` job is still there on its own because a
required check needs something to point at. And `HUSKY=0` is set, because CI has
no git hooks to install.

`pack-install` is the one job that does not test the workspace. Every other job
reaches `@geekity/cms` through a symlink, which shows the whole source tree
whether or not `files` in `package.json` would have shipped it; this one runs
`pnpm pack`, scaffolds a site with `geekity init`, rewrites its dependency to
the tarball, installs, boots the site and asks it for `/`, the sample post and
the custom route in `server.ts`, then type checks the site with `tsc --noEmit`.
Its steps live in `scripts/pack-install-smoke.sh` rather than in the workflow,
so the same sequence can be run on a laptop:

```sh
scripts/pack-install-smoke.sh          # or: … /some/scratch/directory
```

The script builds the package first, makes its scratch directory, and removes
it and the tarball on the way out however it exits. `GEEKITY_SMOKE_PORT`
changes the port it boots on, which defaults to 3456.

`docker-smoke` builds the Docker image for `linux/amd64` on an amd64 runner,
loads it into the runner's Docker and pushes it nowhere, with the buildx GitHub
Actions cache keeping the rebuild quick. `scripts/docker-smoke.sh` then starts
it on two fresh, empty named volumes for `/site/content` and `/site/data`,
waits for `GET /healthz` to answer 200, and checks that `/` is the seeded
starter site in the default theme and that `/theme/style.css` is byte for byte
`packages/cms/themes/default/static/style.css`. A Dockerfile that does not
build, a container that exits, or a site that does not answer fails the job,
and the container's log is printed. On a laptop, with Docker running:

```sh
pnpm docker:smoke                  # builds linux/amd64 from the Dockerfile
GEEKITY_SMOKE_PLATFORM=linux/arm64 pnpm docker:smoke   # native on Apple silicon
pnpm docker:smoke some-image:tag   # tests an image that is already built
```

The script removes its container, its volumes and any image it built however it
exits.

`.github/dependabot.yml` opens weekly grouped update pull requests for the
GitHub Actions and npm ecosystems, whose commits are `ci(deps): …` and
`chore(deps): …`, so release-please reads them like any other commit.

### Branch protection

On GitHub, under Settings → Rules → Rulesets (or Settings → Branches), protect
`main` with:

- **Require a pull request before merging.** Direct pushes to `main` are what
  the release flow assumes never happen.
- **Require status checks to pass**, and select exactly these, spelled as the
  job names above: `lint`, `typecheck`, `test`, `test-node-26`, `build`,
  `test-11ty`, `pack-install`. Tick "Require branches to be up to date
  before merging".
- Allow only **merge commits** in Settings → General → Pull Requests. A merge
  keeps every commit of the branch, and release-please reads each one, so every
  change gets its own changelog line. GitHub puts the pull request title in the
  merge commit's body, and release-please reads any Conventional Commit line
  there too, so pull request titles are plain prose: a `feat(cms): …` title
  would list the branch's work a second time.
- Leave "Allow specified actors to bypass" empty except for administrators, and
  do **not** require signed commits: release-please commits with the Actions
  token, which does not sign.

Also enable Settings → Actions → General → "Allow GitHub Actions to create and
approve pull requests", which release-please needs to open its release pull
request.

## Releasing

`packages/cms` publishes only `dist`, `themes`, `templates`, `README.md` and
`LICENSE`. Verify with:

```sh
pnpm build
pnpm --filter @geekity/cms pack
```

Versions, tags and the changelog are automated by release-please (decision-7).
Releasing to npm and ghcr.io is one command a maintainer runs from main once the
release commit is in; CI never publishes. `apps/demo` is private and unversioned, so it is not
tracked.

### How a release flows

1. A pull request whose branch holds the commit
   `feat(cms): serve Atom and JSON feeds for posts` is merged into `main` with a
   merge commit, which keeps that commit as it is.
2. `.github/workflows/release-please.yml` runs on the push. release-please
   reads every Conventional Commit since the last release, works out the next
   version, and opens or updates a **release pull request** that bumps
   `packages/cms/package.json`, writes `packages/cms/CHANGELOG.md` and updates
   `.release-please-manifest.json`. Nothing is published while it is open.
3. Merging that release pull request pushes the version bump to `main`.
   release-please runs again, sees its own release commit, and creates the git
   tag and the GitHub release.
4. Nothing is published. When the maintainer wants the release out they
   follow [Releasing](#releasing) below, which publishes to npm and pushes the
   Docker image in one run.

The bumps are the pre-1.0 rules of decision-7, configured in
`release-please-config.json`: `fix` takes a patch, `feat` takes a minor, and
`bump-minor-pre-major` keeps a breaking change on a minor until the package
reaches 1.0. `bump-patch-for-minor-pre-major` is off, so a feature really is a
minor. `initial-version` is `0.1.0`, because release-please otherwise starts a
package with no prior tag at 1.0.0 whatever the pre-major rules say.
`include-component-in-tag` is off too, because there is only one package to
tag, so tags read `v0.2.0` rather than `@geekity/cms-v0.2.0`.

`separate-pull-requests` is on and the release pull request title is pinned to
`chore(release): release ${version}`. Both matter: with a package under
`packages/` rather than at the repository root, release-please derives a
component name (`cms`) from the package name and only recognises a merged
release pull request whose branch carries that component. Grouped release pull
requests use a branch without one, so the merge is silently ignored and no
tag is cut (release-please issue 2214). Separate pull requests put the
component in the branch.

`.release-please-manifest.json` is the current released version of each tracked
package and must agree with `packages/cms/package.json`. release-please writes
both; do not edit either by hand.

### Releasing

A release goes to npm and to ghcr.io together. `scripts/release.sh` does both
in one run, after the release pull request is merged:

```sh
git checkout main
git pull --tags
pnpm release:dry-run   # print every step first
pnpm release           # npm, then <version> and latest on ghcr.io
pnpm release beta      # the same, plus a custom image tag
```

It runs the two scripts described below, in four steps, and stops at the first
failure:

1. The preflight checks of both, npm first: `npm-publish.sh --check-only`, then
   `docker-build-push.sh --check-only`. A dirty tree, a missing login or an
   untagged `HEAD` turns up here, before minutes of gates, and so does an
   interactive `docker login` if ghcr.io needs one.
2. The quality gates, once: `pnpm lint`, `pnpm format:check`,
   `pnpm typecheck`, `pnpm test` and `pnpm test:11ty`. The list is the union of
   the gates of both scripts, which all three read from
   `scripts/lib/quality-gates.sh`, so a gate added to either script is run
   here too.
3. `npm-publish.sh --skip-gates`, which re-runs its own checks and publishes.
4. `docker-build-push.sh --skip-gates`, which re-runs its own checks, builds
   and pushes.

If the Docker step fails after npm published, the script says so and prints the
command that finishes the release, for example
`pnpm docker:build-push -- --skip-gates beta`. Run that once the problem is
fixed. Running `pnpm release` again would stop at the npm preflight, because
the version is already on the registry.

Each script also runs on its own, for publishing only one half or for
re-running the half that failed. Both take `--check-only`, which runs the
preflight checks and nothing else, and `--skip-gates`, which does everything
except the quality gates. `--skip-gates` assumes the gates just passed on this
commit, so use it only after a run whose gates passed. The two flags cannot be
used together.

### Publishing to npm

CI does not publish. `pnpm release` publishes to npm as its third step. To
publish only to npm, or to re-run that half of a release, use
`scripts/npm-publish.sh`, the same shape as the Docker script below:

```sh
git checkout main
git pull --tags
pnpm npm:dry-run    # check the package, the version and the tag first
pnpm npm:publish
pnpm npm:publish -- --skip-gates   # after a release whose gates passed
```

The version is read from `packages/cms/package.json`, which is why the pull
comes first: release-please bumps it in the release pull request and tags the
release commit, so main right after that merge already is `v<version>`.

The script refuses to run from anywhere but the repository root. It then
refuses, before running anything slow, when the working tree is dirty, when
`HEAD` does not carry the version's tag, when nobody is logged in to npm (run
`npm login` yourself; the script will not), or when that version is already on
the registry. Checking the tag at `HEAD` is what replaced the old
`git checkout v0.1.0` recipe: it proves the commit being published is the
released one instead of assuming it, with no detached HEAD to strand commits on
and nothing to undo afterwards. It is also why `--no-git-checks` is gone — pnpm
is on the publish branch with a clean tree, so its own checks pass.

It then runs the quality gates `pnpm lint`, `pnpm format:check`,
`pnpm typecheck`, `pnpm test` and `pnpm test:11ty`. A failing gate stops it
before anything is published. The publish itself is
`pnpm publish --filter @geekity/cms --access public`; `--access public` matters
for a scoped package, and the npm scope `@geekity` must be owned by the project
(decision-6). `--dry-run` prints the package, the version, the tag it needs and
the gates it would run, and publishes, checks and runs nothing. `--check-only`
stops after the checks, and `--skip-gates` publishes without running the gates.

The `pack-install` CI job has already proven the tarball installs and boots, so
the publish itself is the only untested step.

### Publishing the Docker image

The image is `ghcr.io/geekitycom/cms`, built from the `Dockerfile` at the
repository root for `linux/amd64` and `linux/arm64`. CI never pushes it:
GitHub's runners are amd64 only and the machine a site runs on may be arm64, so
a CI publish could ship only half of what is needed. A maintainer publishes it
from a workstation, normally as the last step of `pnpm release`. To push only
an image, or to re-run that half of a release, use
`scripts/docker-build-push.sh`. What CI does do is
build the amd64 image on every pull request and boot it (the `docker-smoke`
job), so a broken Dockerfile fails on its pull request rather than at release.

Run it after a release, once the release pull request is merged:

```sh
git checkout main
git pull
pnpm docker:dry-run          # check the version and tags first
pnpm docker:build-push       # pushes <version> and latest
pnpm docker:build-push beta  # the same, plus a custom tag
pnpm docker:build-push -- --skip-gates beta  # after a release whose gates passed
```

The version tag is read from `packages/cms/package.json`, which is why the
pull comes first: release-please bumps it in the release pull request, so main
right after the merge is the tagged commit and carries the new version.

The script refuses to run from anywhere but the repository root. It checks that
Docker is running and that you are logged in to ghcr.io (it runs
`docker login ghcr.io` if the Docker config has no entry for it; the password is
a GitHub personal access token with `write:packages`), then runs the quality
gates `pnpm lint`, `pnpm format:check`, `pnpm typecheck` and `pnpm test`. A
failing gate stops it before anything is built. It then builds both platforms
with `--pull --no-cache` on a buildx builder called `multiplatform`, which it
creates with the `docker-container` driver the first time, and pushes every tag
as one manifest list. `--dry-run` prints the image, the version and the tags,
and builds, pushes, logs in and runs nothing. `--check-only` stops after the
Docker and login checks, and `--skip-gates` builds and pushes without running
the gates.

Confirm the push carried both platforms:

```sh
docker buildx imagetools inspect ghcr.io/geekitycom/cms:<version>
```

The output lists a manifest for `linux/amd64` and one for `linux/arm64`.

### Repository secrets

| Secret                 | Required? | What it is for                                              |
| ---------------------- | --------- | ----------------------------------------------------------- |
| `RELEASE_PLEASE_TOKEN` | optional  | A fine-grained PAT, so CI runs on the release pull request. |

No npm credential lives in the repository, because CI never publishes.

**`RELEASE_PLEASE_TOKEN` is optional.** GitHub deliberately does not trigger
workflows from events raised with the default `GITHUB_TOKEN`, so a release pull
request opened by release-please gets no CI checks. Adding a fine-grained
personal access token with **Contents: read and write** and **Pull requests:
read and write** on this repository, stored as `RELEASE_PLEASE_TOKEN`, restores
them. Without it the release still works; the release pull request just shows no
checks, so merging it needs an administrator override if the checks are
required.

## License

MIT
