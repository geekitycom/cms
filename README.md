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
    components/        what a page imports or includes: field macros, the flash
  themes/default/      default theme, shipped inside the package
  templates/site/      files `geekity init` copies into a new site
  dist/                tsc output (JS + .d.ts), gitignored
apps/demo/             private site that consumes the package via workspace:*
  geekity.config.ts
  server.ts
  content/           six posts, three pages and _data/site.json
    _includes/       the two layouts an Eleventy build of the same files needs
  themes/demo/       the theme this site wears: post.njk, style.css, theme.json
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

| Command                  | What it does                                                              |
| ------------------------ | ------------------------------------------------------------------------- |
| `pnpm install`           | Installs both workspace packages and links `apps/demo` to `packages/cms`. |
| `pnpm dev`               | Starts the demo site with `tsx watch` (`pnpm --filter demo dev`).         |
| `pnpm start`             | Starts the demo site once, without watching.                              |
| `pnpm build`             | Compiles `packages/cms` to `dist/` and bundles the admin editor.          |
| `pnpm test`              | Runs the `node:test` suites in every package through `tsx`.               |
| `pnpm test:coverage`     | The same suites with `--experimental-test-coverage`.                      |
| `pnpm test:11ty`         | Builds the fixtures and the demo content with Eleventy, comparing URLs.   |
| `pnpm typecheck`         | `tsc --noEmit` across the workspace, tests included.                      |
| `pnpm lint`              | Fans out to each package's lint script.                                   |
| `pnpm lint:fix`          | The same, with eslint's fixes applied.                                    |
| `pnpm format`            | Rewrites every file prettier owns.                                        |
| `pnpm format:check`      | Fails if any of them is not already formatted.                            |
| `pnpm clean`             | Removes build output.                                                     |
| `pnpm docker:dry-run`    | Prints the image tags a Docker publish would push, and builds nothing.    |
| `pnpm docker:build-push` | Builds the image for amd64 and arm64 and pushes it to ghcr.io.            |
| `pnpm docker:smoke`      | Builds the image locally, boots it on empty volumes and checks it serves. |

Package-scoped variants work too, for example
`pnpm --filter @geekity/cms test` or `pnpm --filter demo dev`.

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
| `pre-push`   | `pnpm typecheck` and `pnpm test`.                            |

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
| `dataDir`          | `<cwd>/data`                              | `GEEKITY_DATA_DIR`           | Derived state — the SQLite index, the image variants — and the two things in it that are not derived and must be backed up: `users.json` and, under `keys/`, each user's actor key pairs.                                                                                                                                                                                                  |
| `themesDir`        | `<cwd>/themes`                            | `GEEKITY_THEMES_DIR`         | The site's themes, one directory per theme. Which one is in use is the `theme` setting, not a path. Need not exist.                                                                                                                                                                                                                                                                        |
| `baseUrl`          | `http://localhost:<port>`                 | `GEEKITY_BASE_URL`           | Public origin for canonical URLs, feeds and ActivityPub ids. A trailing slash is stripped.                                                                                                                                                                                                                                                                                                 |
| `watch`            | `true`                                    | `GEEKITY_WATCH`              | Watch `contentDir` while serving and keep the index in step.                                                                                                                                                                                                                                                                                                                               |
| `accessLog`        | `false`, but `true` under `geekity serve` | `GEEKITY_ACCESS_LOG`         | Write one line per request to stdout: the method, the path with its query string, the status and how long it took. `geekity serve` and the Docker image turn it on, because a server answering the internet should be able to say what it answered; `createCms` leaves it off, so a CMS embedded in another app never writes to its stdout unasked. See [The access log](#the-access-log). |
| `accessLogAddress` | `false`                                   | `GEEKITY_ACCESS_LOG_ADDRESS` | Put the client address at the end of each access-log line. Off unless asked for: an address is personal data and needs a reason and a retention policy. Which address is right is `trustProxy`'s answer.                                                                                                                                                                                   |
| `seedContent`      | `false`                                   | `GEEKITY_SEED_CONTENT`       | When `geekity serve` starts and `contentDir` is missing or has no entries at all, fill it with the starter site `geekity init` writes, its `site.json` `url` set to the base URL. A directory with anything in it, even a dotfile, is never touched. Off so a site run from npm is never written to unasked.                                                                               |

The admin adds eight more:

| Field               | Default                     | Environment override         | Meaning                                                                    |
| ------------------- | --------------------------- | ---------------------------- | -------------------------------------------------------------------------- |
| `uploadMaxBytes`    | `10485760` (10 MiB)         | `GEEKITY_UPLOAD_MAX_BYTES`   | Largest file the editor's upload endpoint accepts.                         |
| `uploadTypes`       | every type below            | `GEEKITY_UPLOAD_TYPES`       | Extensions it accepts, as a list (comma-separated in the env).             |
| `imageOptimization` | `true`                      | `GEEKITY_IMAGE_OPTIMIZATION` | Derive smaller copies of uploaded images and offer them in the pages.      |
| `imageWidths`       | `320, 640, 960, 1280, 1920` | `GEEKITY_IMAGE_WIDTHS`       | The widths those copies are made at, in pixels.                            |
| `imageFormats`      | `['webp']`                  | `GEEKITY_IMAGE_FORMATS`      | The formats besides the original's own. `avif` is opt-in.                  |
| `loginAttempts`     | `5`                         | `GEEKITY_LOGIN_ATTEMPTS`     | Failed sign-ins a username or an address may make before it is locked out. |
| `loginLockout`      | `900` (15 minutes)          | `GEEKITY_LOGIN_LOCKOUT`      | How long the first lockout lasts, in seconds.                              |
| `trustProxy`        | `false`                     | `GEEKITY_TRUST_PROXY`        | Believe `X-Forwarded-For` when deciding which address a sign-in came from. |

`uploadTypes` defaults to `.avif`, `.gif`, `.jpeg`, `.jpg`, `.md`, `.pdf`,
`.png`, `.txt` and `.webp` — every type the CMS knows a media type for. The
dot and the case are optional: `PNG` and `.png` are the same entry. A name the
CMS has no media type for is refused at boot rather than ignored, so a typo in
an allowlist is heard about immediately.

SVG is not in that list and cannot be added: an SVG is markup that may carry
script, and an upload is served from the site's own origin, so accepting one
would be a stored cross-site scripting hole in the site's own pages.

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
| `content/uploads/`                                   | Uploaded files exactly as they arrived.            |
| `content/_data/site.json`                            | Every site setting.                                |
| `content/_data/federation/{username}/followers.json` | Who follows that user.                             |
| `content/_data/federation/inbox/{yyyy}-{mm}.jsonl`   | Every activity the inbox was handed, one per line. |

`data/` is private. It is never in git, and it is the half that has to be
copied somewhere safe:

| Path              | What it holds                                                                      |
| ----------------- | ---------------------------------------------------------------------------------- |
| `data/users.json` | Usernames and argon2id password hashes, mode 0600.                                 |
| `data/keys/`      | Each user's key pairs as JWK files, mode 0600. **Losing these breaks federation.** |

And two things under `data/` may be deleted at any time the site is stopped:

| Path              | What it is                                                                                      |
| ----------------- | ----------------------------------------------------------------------------------------------- |
| `data/geekity.db` | The SQLite cache, `-wal` and `-shm` with it. See below.                                         |
| `data/images/`    | Image variants derived from `content/uploads/` (decision-10), with their `image.json` sidecars. |

Deleting either is safe with the site stopped: the next boot builds the
database back out of the files with no manual step, and a request for a variant
that is not there derives it and serves it. `geekity rebuild` does the database
half on demand, and **Tools > Content index** in the admin does it [without
stopping the site](#rebuilding-the-index-from-the-admin). There is no command
for the images, because there is nothing to do: `rm -r data/images`.

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
| `/robots.txt`          | Everything but `/admin/`, and the sitemap's absolute URL.                      |
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
{ "status": "ok", "checks": { "database": "ok", "content": "ok" } }
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
would put on the site, theme overrides included. It writes nothing. It is also
the only way to look at a scheduled post: the public permalink 404s until the
date arrives, for a signed-in admin too, because the public site deliberately
has no session and every response it gives is cacheable.

`POST /admin/uploads` stores one file at
`content/uploads/{yyyy}/{mm}/{slug}{ext}` and answers with `{ url, markdown }`.
A name is never overwritten: a second `photo.png` becomes `photo-2.png`. Three
things have to agree before anything is written — the extension is on the
site's allowlist, the media type the browser declared is one that extension may
have, and the file's first bytes are that format's — and a file that is too
big gets a 413 and one of the wrong type a 415, both as JSON. See
[`uploadMaxBytes` and `uploadTypes`](#configuration). The same rules run behind
[the media library](#the-media-library), which is a form rather than a `fetch`,
so a body over the limit posted from a browser gets that 413 as plain text
instead.

Both endpoints are behind the admin's guard and need the session's CSRF token,
like every other POST in the admin.

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
is a bare `'self'`. The public site gets none of that, so a theme is free to
reference whatever it likes. The package README has
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
— the camera, the timestamp, the location — is dropped. A GIF is stored and
served exactly as it arrived: an animation cannot survive being resized into a
still.

A post page then renders the picture as

```html
<picture>
  <source
    type="image/webp"
    srcset="/uploads/_/2026/09/photo.jpg/320.webp 320w, …"
    sizes="100vw"
  />
  <img
    src="/uploads/2026/09/photo.jpg"
    alt="A photo"
    srcset="/uploads/_/2026/09/photo.jpg/320.jpg 320w, …"
    sizes="100vw"
    width="2400"
    height="1600"
    loading="lazy"
  />
</picture>
```

`sizes` is `100vw`, which is 11ty/image's default and the only honest one a CMS
can give: how wide a picture is drawn is a fact about the theme's stylesheet.
Attributes the author wrote win — a hand-written `width`, `loading` or
`srcset` is left alone — and an image pointing at another origin is untouched.

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
on six pages under the Settings menu: **General** (title, tagline, author, base
URL, time zone and language), **Reading** (what the homepage displays, posts per
page, the notify server the feeds advertise), **Permalinks** (the tag and category
archive bases), **Discussion** (comments and when they close, webmentions sent
and received), **Email** (how the site sends mail and where a message written to
it goes) and **Federation** (the relays the site subscribes to). They live in
`content/_data/site.json`, which is published with the site and in git.

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

The file always carries `title`, `tagline`, `url`, `author`, `postsPerPage`,
`timezone`, `language`, `tagBase`, `categoryBase`, `notifyServer`, `mailProvider`, `mailFromName`,
`mailFromAddress`, `mailReplyTo`, `contactEmail`, `relays`, `menus` and
`taxonomyRedirects`,
and every other key it already had is kept — a site may put anything in there,
`feedSize` included, and reach it from its templates. A key it does not carry
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
item whose path is the one being read marked `aria-current` and a line ending
`| me` given `rel="me"`, which is how Mastodon verifies that the site and the
profile it links are yours. The menu is the whole of itself: a page cannot put
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
no spaces in it — the rule a menu item's URL is held to. Every one of them is
rendered `rel="me"`, which is how Mastodon verifies a profile field pointing
back at this site and how IndieAuth knows the link is yours; nothing else in
Geekity asks for it. That is the one way the box differs from a menu:
`Mastodon | https://example.social/@me | me` is a menu line, and here it is
refused, because the `| me` is already there. A link stored before the box was
checked still renders and still comes back in the box; it is refused when the
panel is saved, with the line to fix named.

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

## The theme

Templates are Nunjucks (decision-4). The default theme lives in
`packages/cms/themes/default` and ships inside the package: `layouts/` for the
base layout, home, post, page, tag archive and 404; `partials/` for the post
list, the pager, the bio and the tag macros; `static/style.css`, served at
`/theme/style.css`. It is plain CSS with no build step.

It is the andrewshell.org design (decision-16): a serif body and sans headings
at an 18px root, warm paper, a rust primary and a blue secondary, one column at
42rem, links that invert on hover. `layouts/base.njk` is the shell — the skip
link, a `.global-wrapper` that says when it is at `/`, a header that is the
site title and tagline on the front page and a small link home everywhere else,
and a footer with the copyright, the colophon and `menus.footer`. The header
carries `menus.primary` on every page — a line of its own under the tagline at
the root, beside the small link home everywhere else — so a reader looks in one
place whatever they are reading. The bio under an entry carries the person it
is by and nothing else, and the footer links what a site typed into its footer
menu rather than anything read off an account.
Webrings, badges and anything else particular to one site are not in the
package: they go in a site theme's `footer` block. The source design is light only; the theme adds a dark
scheme under `prefers-color-scheme: dark`, and
`packages/cms/src/web/theme-colors.test.ts` reads the custom properties out of
the stylesheet and proves every text and background pair in both schemes meets
WCAG 2.2 AA, so a colour change that breaks one fails the build.

A site keeps its own themes under `themes/` — `themesDir` in the config,
`GEEKITY_THEMES_DIR` at boot — one directory per theme with a `theme.json` in
it giving a display `name`, a `kind` of `site` and an optional `description`.
The directory's name is the theme's id, and the one setting that picks a theme,
`theme` in `content/_data/site.json`, holds that id. A template is looked up in
the chosen theme first and in the packaged theme second, one file at a time, so
a theme that ships only `layouts/post.njk` replaces the post layout and keeps
receiving updates to every other template. Assets under `/theme/` resolve in
the same order, and so do the mail templates under `mail/`.

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
context, the blocks and the filter set (`date`, `url`, `absoluteUrl`) are part
of the semver contract; they are documented in
[`packages/cms/themes/default/README.md`](packages/cms/themes/default/README.md).

`apps/demo/themes/demo/` is the worked example, and the demo's
`content/_data/site.json` says `"theme": "demo"`, so the demo proves the choice
rather than the default. Beside its `theme.json` it holds two files:
`layouts/post.njk`, which extends the packaged base layout and adds a byline of
its own and a reading time, and `static/style.css`, which replaces the packaged
stylesheet at `/theme/style.css`. Everything else the demo serves still comes
from the package. `apps/demo/test/site.test.ts` asserts both halves over HTTP:
the byline, the reading time and the demo stylesheet while the theme is chosen,
and — against a copy of the content with the setting taken out — the packaged
post layout and the packaged stylesheet when it is not. A stylesheet is the one
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

The image `ghcr.io/geekitycom/cms` runs `geekity serve` over three directories
under `/site`: `content/`, `data/` and, optionally, `themes/`. It runs as uid
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

Then, in the stack directory, create `content/` and `data/` and give them to
uid 1000 before the first start:

```sh
cd /opt/stacks/geekity
mkdir -p content data
sudo chown 1000:1000 content data
```

The container runs as uid 1000 and writes to both directories. If they are
missing, Docker creates them owned by root and the site fails to start with
`EACCES`. `content/` must be empty, or already hold a site: an empty one is
filled with the starter site, and one with anything in it, even a dotfile, is
left alone.

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
    client_max_body_size 10m;  # at least GEEKITY_UPLOAD_MAX_BYTES
}
```

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
describes the cutover. In a container, the user has to exist first, and the
exported key pair is read from standard input so no copy of the private key is
left inside the container:

```sh
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

`data/geekity.db` (with `-wal` and `-shm`) and `data/images/` are derived and
need not be copied: the database is rebuilt on the next start, and an image
variant the next time it is asked for. The site writes its files by renaming a
finished copy over the old one, so a copy taken while it runs gets whole files;
stop the stack first if the copy has to be of one moment. For example:

```sh
tar -C /opt/stacks -czf geekity-$(date +%F).tar.gz \
  --exclude='geekity/data/geekity.db*' --exclude='geekity/data/images' geekity
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

| Job            | What it runs                                           |
| -------------- | ------------------------------------------------------ |
| `lint`         | `pnpm lint`, then `pnpm format:check`.                 |
| `typecheck`    | `pnpm typecheck`.                                      |
| `test`         | `pnpm test` on Node 24.                                |
| `test-node-26` | The same suite on Node 26, the current line.           |
| `build`        | `pnpm build`.                                          |
| `test-11ty`    | `pnpm test:11ty`, the Eleventy compatibility suite.    |
| `pack-install` | `scripts/pack-install-smoke.sh`.                       |
| `docker-smoke` | Builds the image, then `scripts/docker-smoke.sh`.      |
| `coverage`     | `pnpm test:coverage`, summary uploaded as an artifact. |
| `pr-title`     | The pull request title, as a Conventional Commit.      |

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

`pr-title` exists because a squash merge takes the pull request title as the
commit message, and release-please reads that message. It accepts the types and
scopes of `commitlint.config.js`; a scope is optional, but a title that names
one has to name an allowed one. The workflow listens for `edited` as well as
`opened` and `synchronize`, so correcting a title re-runs the check.

Coverage is Node's own `--experimental-test-coverage`. The summary is uploaded
as a build artifact called `coverage-summary`; no third-party coverage service
is involved.

`.github/dependabot.yml` opens weekly grouped update pull requests for the
GitHub Actions and npm ecosystems, titled `ci(deps): …` and `chore(deps): …` so
they pass `pr-title` and commitlint.

### Branch protection

On GitHub, under Settings → Rules → Rulesets (or Settings → Branches), protect
`main` with:

- **Require a pull request before merging.** Direct pushes to `main` are what
  the release flow assumes never happen.
- **Require status checks to pass**, and select exactly these, spelled as the
  job names above: `lint`, `typecheck`, `test`, `test-node-26`, `build`,
  `test-11ty`, `pack-install`, `coverage`, `pr-title`. Tick "Require branches to be up to date
  before merging".
- **Require linear history**, and allow only **Squash and merge** in Settings →
  General → Pull Requests. Squashing is what makes `pr-title` sufficient: the
  title becomes the commit message release-please parses. Turn off "Default to
  PR title and description" only if you are prepared to police merge commit
  messages by hand.
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
Publishing to npm is a manual step a maintainer runs from the tagged checkout;
CI never publishes. `apps/demo` is private and unversioned, so it is not
tracked.

### How a release flows

1. A pull request titled `feat(cms): serve Atom and JSON feeds for posts` is
   squash-merged into `main`. The squashed commit carries that title.
2. `.github/workflows/release-please.yml` runs on the push. release-please
   reads every Conventional Commit since the last release, works out the next
   version, and opens or updates a **release pull request** that bumps
   `packages/cms/package.json`, writes `packages/cms/CHANGELOG.md` and updates
   `.release-please-manifest.json`. Nothing is published while it is open.
3. Merging that release pull request pushes the version bump to `main`.
   release-please runs again, sees its own release commit, and creates the git
   tag and the GitHub release.
4. Nothing is published. When the maintainer wants the release on npm they
   follow [Publishing to npm](#publishing-to-npm) below, and for the Docker
   image [Publishing the Docker image](#publishing-the-docker-image).

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
component in the branch. The pinned title keeps the `pr-title` check happy,
since the default would use the target branch as the scope.

`.release-please-manifest.json` is the current released version of each tracked
package and must agree with `packages/cms/package.json`. release-please writes
both; do not edit either by hand.

### Publishing to npm

CI does not publish. Publish from the tagged commit so what reaches npm is
exactly what was released:

```sh
git fetch --tags
git checkout v0.1.0
pnpm install --frozen-lockfile
pnpm build && pnpm test && pnpm test:11ty
pnpm publish --filter @geekity/cms --access public --no-git-checks
git checkout main
```

`--no-git-checks` is needed because a tag checkout is a detached HEAD and pnpm
otherwise insists on being on the publish branch. `--access public` matters for
a scoped package. Log in first with `npm login`; the npm scope `@geekity` must
be owned by the project (decision-6). The `pack-install` CI job has already
proven the tarball installs and boots, so the publish itself is the only
untested step.

### Publishing the Docker image

The image is `ghcr.io/geekitycom/cms`, built from the `Dockerfile` at the
repository root for `linux/amd64` and `linux/arm64`. CI never pushes it:
GitHub's runners are amd64 only and the machine a site runs on may be arm64, so
a CI publish could ship only half of what is needed. A maintainer publishes it
from a workstation with `scripts/docker-build-push.sh`. What CI does do is
build the amd64 image on every pull request and boot it (the `docker-smoke`
job), so a broken Dockerfile fails on its pull request rather than at release.

Run it after a release, once the release pull request is merged:

```sh
git checkout main
git pull
pnpm docker:dry-run          # check the version and tags first
pnpm docker:build-push       # pushes <version> and latest
pnpm docker:build-push beta  # the same, plus a custom tag
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
and builds, pushes, logs in and runs nothing.

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
