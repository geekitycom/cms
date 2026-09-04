# @geekity/cms

A file-first CMS. Content is Markdown on disk, laid out so Eleventy can build
the same directory unchanged. One Node process is both the editor and the public
website. SQLite holds a derived index plus the data that has no natural file
form.

This is the guide for someone building a site on the package. The repository's
own [README](https://github.com/geekitycom/cms#readme) is the contributor guide.

Requires Node 24 or newer, the active LTS line.

## A new site

```sh
pnpm dlx @geekity/cms init my-site
cd my-site
pnpm install
pnpm dev
```

That is a running site on <http://localhost:3000> with a post, a page and the
packaged theme. `geekity init` refuses a directory that already has anything in
it, so it can never write over a site you already have.

What it writes:

```
package.json          depends on @geekity/cms; scripts dev, start and sync
geekity.config.ts     port, directories, base URL
server.ts             the entry file; where your own routes go
tsconfig.json         so the site type checks against the package
content/
  posts/              Markdown posts, plus posts.json for Eleventy
  pages/              Markdown pages, plus pages.json
  _data/site.json     title, tagline, author, page and feed sizes
.gitignore            node_modules, data and .env
```

`data/` and `theme/` are not written. The index under `data/` is created on
first boot and is safe to delete; `theme/` is optional and only exists once you
override a template.

The generated `package.json` pins `@geekity/cms` to the version of the CLI that
wrote it, so a site is never scaffolded against a version it has not been tested
with.

## An existing project

```sh
pnpm add @geekity/cms
```

Then write a `geekity.config.ts` and a `content/` directory, and either add an
entry file or run the bin. Nothing else is required.

## Upgrading

```sh
pnpm up @geekity/cms
```

Database migrations ship inside the package and run on boot, so a version bump
is the whole upgrade. The config schema, `createCms`, the template context, the
JSON representation and the content format are all covered by semver: a
breaking change to any of them is a major with a migration note in the
changelog.

## The `geekity` command

`geekity` is installed as a bin, so `pnpm geekity <command>` runs it inside a
site (or `npx geekity`, or a `package.json` script, which is how the generated
`sync` script calls it).

| Command                   | What it does                                                                             |
| ------------------------- | ---------------------------------------------------------------------------------------- |
| `geekity serve`           | Boot from the config file and listen. The default when no command is given.              |
| `geekity init <dir>`      | Create a new site in `<dir>`. Refuses a directory that is not empty.                     |
| `geekity sync`            | Rebuild the content index once and exit. Exits non-zero if any file could not be parsed. |
| `geekity user add <name>` | Create an admin account, so a site can get its first login without the setup screen.     |
| `geekity --help`, `-h`    | The same table, on the terminal.                                                         |
| `geekity --version`       | The installed version.                                                                   |

`serve`, `sync` and `user add` take `--config <file>`; without it they look for
`geekity.config.ts`, then `geekity.config.js`, then `geekity.config.mjs` in the
working directory, and run on defaults if there is none.

`sync` prints what the scan did and forces watching off whatever the config
says, because a one-shot scan that then sat in a watcher would never exit:

```sh
$ geekity sync
Scanned 12: 2 created, 1 updated, 0 removed, 9 unchanged, 0 failed
```

A file that will not parse is logged, left out of the index and counted in
`failed`; the command then exits `1` so a deploy step notices. Everything else
in the directory is still indexed.

### Creating an admin from the command line

`geekity user add <username>` writes a user straight into the site's database,
which is how a site that cannot reach `/admin/setup` from a browser — a
headless deploy, a server behind a bastion — gets its first login. It enforces
exactly the rules the setup form does: a username of 1 to 64 letters, digits,
dots, dashes or underscores, and a password of at least 8 characters.

```sh
$ geekity user add ada
Password for ada:
Created admin user ada. Sign in at /admin/login.
```

The prompt does not echo. When standard input is not a terminal the command
prints no prompt and reads the password as a single line, so a script can pipe
one in:

```sh
printf '%s\n' "$ADMIN_PASSWORD" | geekity user add ada
```

`--password <pw>` passes it inline instead. That is the least private of the
three: a password on the command line is visible in the process list and lands
in shell history.

A name that is already taken is refused and nothing is written; so are an
illegal username and a short password. Every refusal prints why and exits `1`.

Once somebody can sign in, the [`/admin/users` screen](#the-admin) is the
easier door: it adds users, generates passwords, deletes them, and is where an
admin changes their own password.

### How a TypeScript config is loaded

`geekity serve` and `geekity sync` import `geekity.config.ts` directly. That is
all it takes on Node 24, which strips types without a flag. For a config using
syntax stripping cannot erase, such as `enum`, the
CLI falls back to registering the **tsx installed in your own site**, which is
what `geekity init` puts in `devDependencies` (it is what runs `server.ts` too).
A site that wants neither can write `geekity.config.js` instead; it is in the
lookup list for exactly that reason. Nothing else is searched: the tsx has to be
the site's, so a copy that happens to be elsewhere on the machine is never used.

## Using the package from an entry file

An entry file exists so a site can add routes and middleware of its own. A site
that adds nothing can delete `server.ts` and run `geekity serve`.

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
| `store`                  | The content index.                                                                                                         |
| `events`                 | Index changes as they happen.                                                                                              |
| `onDocumentChange(hook)` | Subscribe to every change; returns the unsubscribe.                                                                        |
| `onPublish(hook)`        | Subscribe to documents becoming visible; returns the unsubscribe.                                                          |
| `sync()`                 | One full scan of the content directory.                                                                                    |
| `serve()`                | Scan, start watching, listen. Resolves with the port actually bound, which matters when the configured port is `0`.        |
| `close()`                | Stop the watcher, the server and the index. Safe to call twice, and required, because the index holds an open database.    |

Routes a site registers always win over the content index. Documents are
resolved in the not-found handler, after every registered route has failed to
match, so a post whose permalink is `/hello/` cannot shadow the `/hello/` route
above — and neither can it shadow the admin and federation routes of later
milestones.

## Configuration

Declare config in `geekity.config.ts`; `defineConfig` gives it type checking.

```ts
import { defineConfig } from '@geekity/cms';

export default defineConfig({
  port: 3000,
  contentDir: 'content',
  dataDir: 'data',
  themeDir: 'theme',
  baseUrl: 'http://localhost:3000',
  watch: true,
  sessionLifetime: 60 * 60 * 24 * 14,
});
```

Every field is optional. Relative directories resolve against the working
directory; absolute ones are used as given.

| Field              | Default                   | Environment override        | Meaning                                                                                    |
| ------------------ | ------------------------- | --------------------------- | ------------------------------------------------------------------------------------------ |
| `port`             | `3000`                    | `GEEKITY_PORT`, then `PORT` | Port the HTTP server listens on. `0` picks a free one.                                     |
| `contentDir`       | `<cwd>/content`           | `GEEKITY_CONTENT_DIR`       | Markdown content.                                                                          |
| `dataDir`          | `<cwd>/data`              | `GEEKITY_DATA_DIR`          | Derived state, including the SQLite index.                                                 |
| `themeDir`         | `<cwd>/theme`             | `GEEKITY_THEME_DIR`         | Site template overrides, resolved before the packaged default theme. Need not exist.       |
| `baseUrl`          | `http://localhost:<port>` | `GEEKITY_BASE_URL`          | Public origin for canonical URLs, feeds and ActivityPub ids. A trailing slash is stripped. |
| `watch`            | `true`                    | `GEEKITY_WATCH`             | Watch `contentDir` while serving and keep the index in step.                               |
| `sessionLifetime`  | `1209600` (14 days)       | `GEEKITY_SESSION_LIFETIME`  | How long an admin login lasts, in seconds.                                                 |
| `onDocumentChange` | none                      | —                           | Hook run for every change to the index. See [Hooks](#hooks).                               |
| `onPublish`        | none                      | —                           | Hook run when a document becomes visible. See [Hooks](#hooks).                             |
| `federation`       | `{}`                      | —                           | Federation stores and guards. See [Federation](#federation).                               |

Precedence is environment variable, then config file, then default, so a host
can override anything without editing the site. A boolean environment variable
takes `true`, `1`, `yes` and `on`, or their opposites; anything else is an error
rather than a silent `false`.

## Federation

The site is one ActivityPub actor, served by [Fedify]. Its stores have
defaults that suit a single process, and `federation` is where a site that has
outgrown them says so:

| Field                 | Default                 | Meaning                                                                                                                                        |
| --------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `kv`                  | `MemoryKvStore`         | Fedify's cache and idempotence store. Nothing that has to survive a restart lives in it.                                                       |
| `queue`               | `InProcessMessageQueue` | The delivery and inbox queue. `null` means no queue: activities are handled and delivered inside the request that carried them, with no retry. |
| `allowPrivateAddress` | `false`                 | Whether Fedify may fetch private and loopback addresses. Leave it off: turning it on removes an SSRF guard. It exists for tests.               |

Followers, the actor's key pairs, the inbound activity log and the delivery
log are the CMS's own and live in SQLite whatever those are set to, so a
restart never costs a site a follower.

### Delivery

Publishing federates. The delivery service listens to the index, so a post
edited on disk reaches the followers exactly as one saved through the editor
does:

| What happened to the post                                                 | What the followers get    |
| ------------------------------------------------------------------------- | ------------------------- |
| became published — written live, or undrafted, or restored from the trash | `Create(Article)`         |
| edited while published                                                    | `Update(Article)`         |
| drafted, trashed, or its file deleted                                     | `Delete` of a `Tombstone` |

Nothing is delivered for a full scan, the boot scan included: a rebuilt index
reports the whole archive as new, and announcing it again is not what deleting
`data/geekity.db` should mean.

The first activity about a post writes `activitypub.id` and
`activitypub.published` into its front matter. That id is what every follower
now holds, so it is the id the post keeps: renaming the slug afterwards sends
an `Update` rather than a second post, and `/ap/posts/{old-slug}` goes on
answering. Restoring a trashed post reuses it too.

One POST serves a whole instance — the shared inbox is preferred — but the
outcome is recorded per follower, so an admin can see which one did not get it
and send the activity again:

```ts
const report = await cms.delivery.redeliver(activityId);
report?.deliveries; // one row per follower: inbox, status, error, time
```

`cms.admin.listOutboundActivities()` lists what has been sent, newest first,
and `listDeliveries(activityId)` and `countDeliveriesByStatus(activityId)`
say how each one landed. A status is `sent` (the inbox took it), `queued`
(handed to Fedify's queue, which retries out of band) or `failed`.

### The site's avatar

The actor's `icon` is an image uploaded on `/admin/settings`. It is stored with
the site's other uploads, under `content/uploads/{yyyy}/{mm}/`, and the public
path it is served at — `/uploads/2026/09/me.png` — is the `avatar` setting,
mirrored into `content/_data/site.json` like the rest of them. The actor
carries it as an absolute URL, resolved against the base URL in effect, because
a peer has no site to resolve a path against; an `avatar` that is already an
absolute URL is left alone, which is how a site puts its avatar on a CDN.

Saving or removing it delivers an `Update` of the actor to every follower, so
the profile a peer cached is refreshed rather than left showing last year's
picture. The same goes for the title, the tagline, the base URL and the actor's
handle and type: those are the fields the profile is built from, and a save
that moves one of them tells the followers. A save that only moves the time
zone or the page size tells nobody, and neither does anything at all on a site
that has no followers yet.

The `Update` is recorded in the delivery log like every other activity, with
the actor's id as its object and no slug, and `cms.delivery.updateActor()`
sends one from code. Because it is about no post, it is not a row in the
federation screen's per-post delivery table.

### The federation screen

`/admin/federation` is all of that with a page in front of it. It shows the
site's own actor — its avatar, handle and type, the name and summary the
profile carries, and how many actors follow it — the follower list with avatars and
follow dates, the recent likes, boosts and replies out of the inbox log, each
linked to the remote object and to the post it was about, and one row per post
that has been federated: its latest activity, when it went, and how many
followers it reached, is queued for, or failed for. Each of those rows has a
Redeliver button, which is `cms.delivery.redeliver` behind a form: it sends
that activity to every follower the site has now and says what came of it.

### Testing federation against a real Mastodon account

Federation is the one part of the CMS that cannot be finished on localhost.
Mastodon has to be able to reach the site to fetch the actor, verify a
signature and deliver a `Follow`, and `http://localhost:3000` is not an
address it can reach. [`fedify tunnel`] gives the local server a public HTTPS
address for as long as the command runs, which is enough to do the whole round
trip by hand:

```sh
pnpm dlx @fedify/cli tunnel 3000
# The ephemeral public address is up and running:
# https://quiet-sun-42.serveo.net
```

Leave that running and boot the site with `baseUrl` set to the address it
printed, because `baseUrl` is what every ActivityStreams id is minted from — a
site booted on `http://localhost:3000` serves an actor whose id is
`http://localhost:3000/ap/actor`, and no remote instance can dereference that:

```sh
GEEKITY_BASE_URL=https://quiet-sun-42.serveo.net geekity serve
```

Then, from a Mastodon account:

1. Search for `@blog@quiet-sun-42.serveo.net` — the handle is the
   `actorHandle` setting (`blog` unless it has been changed) at the tunnel's
   host. The profile should come back with the site title, tagline and avatar.
2. Follow it. The `Follow` lands on `/ap/actor/inbox`, the CMS answers
   `Accept`, and the account appears on `/admin/federation` within a second or
   two.
3. Publish a post, from the editor or by writing a file into `content/posts/`.
   A `Create(Article)` is delivered, and the post shows up in the follower's
   home timeline; `/admin/federation` records the outcome, with a Redeliver
   button if it did not land.
4. Edit the post, then set `draft: true` on it, to see the `Update` and the
   `Delete` arrive.

Two things to know before relying on what a tunnel run shows you.

The tunnel address changes every time the command starts, and the followers
gathered under one are throwaway: their instances hold an actor id on a host
that no longer exists, so they cannot be migrated to the real domain. The
admin has no button for removing a follower yet, so run tunnel rehearsals
against a scratch `dataDir` rather than the one the real site will keep.

The actor's key pairs live in the SQLite database under `dataDir`, not in the
base URL, so they survive across tunnel sessions. That is usually what you
want; it also means a database copied from one deployment to another brings
the other's identity with it.

`pnpm fed:smoke`, in this repository, is the automated half of the same idea:
it boots the CMS on a free port, runs `fedify lookup` against the actor and a
post object, and delivers a `Create(Article)` to two real inboxes over
loopback. It needs no tunnel and no network, and it is a job in CI. See
`packages/cms/scripts/fed-smoke.ts`, whose header explains why the `Follow`
half is sent by a peer built in the script rather than by `fedify inbox`.

[Fedify]: https://fedify.dev/
[`fedify tunnel`]: https://fedify.dev/cli

## Keeping the index in step

Booting scans `contentDir`, indexes every Markdown file under `posts/` and
`pages/`, and drops index rows whose file has gone. After that a watcher keeps
the two in step, so an edit on disk reaches the live site in about a second
without a restart.

```ts
await cms.sync(); // one full scan; what `serve()` runs on boot
```

Set `watch: false` (or `GEEKITY_WATCH=false`) for a host whose content cannot
change under the process. `geekity sync` sets it for you.

## Hooks

Two hooks let a site do something of its own when content changes. Both are
config options, and both are also methods, for a site that would rather
subscribe from its entry file:

```ts
export default defineConfig({
  onPublish: (change) => {
    console.log(`${change.next?.title ?? ''} went live`);
  },
});
```

```ts
const stop = cms.onDocumentChange((change) => {
  console.log(change.type, change.path, change.origin);
});
stop(); // the method returns the unsubscribe
```

`onDocumentChange` runs for every `created`, `updated` and `deleted`.
`onPublish` runs when a document becomes visible on the public site: created
already published, a draft published, or a document restored from the trash. A
hook may be `async`; the CMS never waits for it, and a hook that throws or
rejects is reported and does not stop the scan or wedge the watcher.

**Mind the origin.** Every change carries `origin`: `watch` for a live edit,
`admin` for a write the editor made, and `scan` for a full scan — _including
the one on boot_. A cold index reports its whole first scan as `created`, and
every published document as `published`, so a hook that must not re-fire when
the index is rebuilt has to say so:

```ts
cms.onPublish((change) => {
  if (change.origin === 'scan') return; // not a rebuilt index
  void announce(change.next);
});
```

Deleting `data/geekity.db` is a supported thing to do, so this is not a corner
case: it is what happens on the next boot.

For anything the two hooks do not cover, subscribe to the events directly. An
`async` listener registered this way _is_ waited for, unlike the two hooks, so
it can finish writing before the change is called done — and can also hold up
the watcher if it is slow.

```ts
cms.events.on('unpublished', (change) => {
  console.log(`${change.previous?.title ?? ''} came down`);
});
```

| Event         | When                                                                                               |
| ------------- | -------------------------------------------------------------------------------------------------- |
| `created`     | A file was indexed for the first time.                                                             |
| `updated`     | An indexed file's content changed.                                                                 |
| `deleted`     | An indexed file is gone.                                                                           |
| `published`   | A document became visible: created live, a draft published, or a document restored from the trash. |
| `unpublished` | The reverse: published to draft, trashed, or deleted while live.                                   |
| `change`      | Every `created`, `updated` and `deleted`.                                                          |

Each one carries the document before and after the change (`previous` and
`next`, either of which may be `undefined`), the content-relative `path`, and
`origin`. `on()` returns the function that unsubscribes; there is also `once()`
and `off()`.

## The admin

Booting also mounts the admin at `/admin`. It is server-rendered from templates
that ship inside the package, deliberately outside the theme search path: a
site's `theme/` may override any public template, and must not be able to
shadow the login form.

| Route                          | What it does                                                            |
| ------------------------------ | ----------------------------------------------------------------------- |
| `/admin`                       | The dashboard: counts, the five most recent posts, the follower count.  |
| `/admin/posts`, `/admin/pages` | The listings and the editors.                                           |
| `/admin/settings`              | Site title, tagline, base URL, time zone, paging, archive bases, actor. |
| `/admin/settings/avatar`       | `POST` only. Uploads the site's avatar, or removes it.                  |
| `/admin/users`                 | Who may sign in. `POST` adds one.                                       |
| `/admin/users/password`        | `POST` only. Changes the signed-in admin's own password.                |
| `/admin/users/delete`          | `POST` only. Deletes the user the form names.                           |
| `/admin/federation`            | The actor, the followers, the inbox log, and per-post delivery.         |
| `/admin/federation/redeliver`  | `POST` only. Sends one post's latest activity to the followers again.   |
| `/admin/setup`                 | First run: creates the first admin. Closed once a user exists.          |
| `/admin/login`                 | Username and password.                                                  |
| `/admin/logout`                | `POST` only. Deletes the session row.                                   |
| `/admin/_static/*`             | The admin's own stylesheet, cached for an hour.                         |

The screens behind the login share one layout: a bar across the top with the
site name and a link to the public site, the sections down the left with the
current one marked, and a place for flash messages. A message queued with
`flash(c, 'notice', '…')` is kept on the session row, shown on the next page the
browser asks for, and cleared as it is read, so it survives exactly one
redirect.

Users and sessions live in the same SQLite file as the content index, in tables
of their own. That is the half of the database that is _not_ derived from the
content directory: deleting the file loses every login, while everything else
in it is rebuilt on the next boot.

Passwords are hashed with argon2id through `node:crypto`, so there is no native
module to build. The cost parameters travel with each hash, which means raising
them later leaves every password already stored verifiable.

A session id is 256 random bits in a `HttpOnly; SameSite=Lax; Path=/admin`
cookie, with `Secure` added when `baseUrl` is an `https` URL. It lasts
`sessionLifetime`; an expired session is deleted rather than merely ignored.
Every mutating admin form carries a per-session CSRF token, and a `POST`
without a valid one is refused with 403 — including the login and setup forms,
which get the token from a short anonymous session created when the form is
first rendered. Logging in throws that session away and starts a new one, so a
planted session id cannot become a logged-in one.

The first admin comes from `/admin/setup` or from
[`geekity user add`](#creating-an-admin-from-the-command-line). Every one after
that comes from `/admin/users`, which lists who may sign in, adds a user with a
password you supply or one it generates and shows once, deletes another user,
and changes your own password — which signs out every other browser holding
that login and leaves the one you are using alone. There is a single role, so a
row has nothing else to edit. The last remaining user cannot be deleted, and
nobody may delete their own account.

Creating one from your own code, which is what the CLI does:

```ts
import { openAdminStore } from '@geekity/cms';

const admin = openAdminStore({ dataDir: 'data' });
admin.createUser({ username: 'ada', password: process.env.PASSWORD ?? '' });
admin.close();
```

## The public site

Booting mounts the public site on the app. The routes are:

| Route                                   | What it serves                                                             |
| --------------------------------------- | -------------------------------------------------------------------------- |
| `/`                                     | Published posts, newest first.                                             |
| `/page/2/` and up                       | Later pages of the same archive.                                           |
| a document's permalink                  | The post or the page, through the theme.                                   |
| `/tag/{tag}/`                           | Everything published carrying that tag, paginated at `/tag/{tag}/page/2/`. |
| `/category/{name}/`                     | The second taxonomy, paginated the same way.                               |
| `/feed/`, `/feed/atom/`, `/feed/json/`  | The recent posts as RSS 2.0, Atom and JSON Feed.                           |
| `/tag/{tag}/feed/` and its two siblings | The same, for one tag; `/category/{name}/feed/` likewise.                  |
| `/comments/feed/`                       | Every reply the inbox has been sent, as RSS 2.0.                           |
| `{permalink}feed/`                      | One post's replies, the same way.                                          |
| `/theme/…`                              | The theme's own files, from its `static/` directory.                       |
| anything else                           | The theme's 404.                                                           |

Drafts and documents in the trash are not on the public site: their URLs 404,
and they are in no listing.

Trailing slashes are canonical. A request that arrives without one redirects
301 to the URL with it, but only when that URL resolves — a genuinely missing
address 404s straight away rather than bouncing first. `/page/1/` redirects to
`/`, because the first page of a listing lives at the listing's own URL.

A document is resolved after every registered route has failed to match, so
routes a site adds always win over a permalink that happens to collide with
them. The taxonomy archives are resolved there too, ahead of the documents: a
route table is fixed when the app is built and the archive bases are a setting,
so `/{tagBase}/{tag}/` is matched against whatever the site holds at the moment
of the request.

`tag` and `category` are the bases a site has until it says otherwise —
WordPress's own, so a site imported from it keeps every archive URL it
published. `tagBase` and `categoryBase` on the settings screen move them, and
the routes, the paging, the canonical redirects, the tag feeds, the theme's
links and the ActivityStreams hashtags all follow on the next request. A base
is one URL-safe path segment: no slashes, and not a path the site already
answers on (`page`, `feed`, `comments`, `admin`, `ap`, `theme`, `uploads`,
`nodeinfo`), and
the two may not be the same word. Both are mirrored into
`content/_data/site.json` as `tagBase` and `categoryBase`, so an Eleventy build
of the same content directory can put its archives at the same URLs.

## Content negotiation

Every public URL is one resource with more than one body. A post or a page has
three; a listing has two.

| Media type         | Extension | Body                                                     |
| ------------------ | --------- | -------------------------------------------------------- |
| `text/html`        | —         | The document through the theme. The default.             |
| `text/markdown`    | `.md`     | The file exactly as it is stored, front matter included. |
| `application/json` | `.json`   | The document as data, see below.                         |

Listings — `/`, `/page/N/`, `/tag/{tag}/` and `/tag/{tag}/page/N/` — offer
HTML and JSON only. There is no Markdown file behind a listing to serve.

The representation is chosen like this:

1. A `.md` or `.json` suffix on the path wins outright and `Accept` is ignored.
   Both spellings work: `/2026/09/hello/index.md` (what the `Link` header
   advertises) and the shorter `/2026/09/hello.md`.
2. Otherwise `Accept` is matched with q-values. The highest q wins; a tie goes
   to the more specific range; what is still tied goes to HTML.
3. No `Accept` header, an empty one, or `*/*` means HTML, so a browser and a
   `curl` with no arguments both get a page.
4. A request that accepts none of the representations gets `406` with a JSON
   body listing what it could have asked for.

The feeds are fixed routes and are not negotiated: feed readers do not send
useful `Accept` headers. See [Feeds](#feeds).

```sh
curl -H 'Accept: text/markdown' https://example.com/2026/09/hello/
curl https://example.com/2026/09/hello/index.json
curl 'https://example.com/index.json?full=1'
```

### The JSON shape

```json
{
  "schema": 1,
  "url": "https://example.com/2026/09/hello/",
  "frontMatter": {
    "title": "Hello, World!",
    "date": "2026-09-02T09:00:00Z",
    "permalink": "/2026/09/hello/",
    "tags": ["introductions"]
  },
  "markdown": "A *file-first* CMS.",
  "html": "<p>A <em>file-first</em> CMS.</p>\n"
}
```

`schema` is the version of this shape; keys are only added within a version.
`url` is absolute, built on the configured `baseUrl`. `frontMatter` is the
document's front matter exactly as the `.md` representation carries it — the
same block the writer emits, unknown keys included — so the two cannot drift.
`markdown` is the body without the front matter, and `html` is that body
rendered.

A listing's JSON is a plain array of the same objects with `markdown` and
`html` left out, because an archive page should not carry every post in full.
`?full=1` puts them back.

```json
[
  {
    "schema": 1,
    "url": "https://example.com/one/",
    "frontMatter": { "title": "One", "…": "…" }
  },
  {
    "schema": 1,
    "url": "https://example.com/two/",
    "frontMatter": { "title": "Two", "…": "…" }
  }
]
```

A 406 body names the alternates:

```json
{
  "error": "not_acceptable",
  "message": "This URL is not available in any of the media types you accept.",
  "alternates": [
    { "type": "text/html", "url": "/2026/09/hello/" },
    { "type": "text/markdown", "url": "/2026/09/hello/index.md" },
    { "type": "application/json", "url": "/2026/09/hello/index.json" }
  ]
}
```

### Headers

Every negotiated response carries `Vary: Accept` and a `Link` header pointing
at the representations it is not:

```
Link: </2026/09/hello/index.md>; rel="alternate"; type="text/markdown",
      </2026/09/hello/index.json>; rel="alternate"; type="application/json"
```

It also carries `ETag` — derived from the document's content hash and the
representation, so a client holding the JSON is never told its Markdown is
unchanged — plus `Last-Modified` from the document's `updated`, falling back to
its `date`, and `Cache-Control: no-cache` so a client revalidates rather than
guessing how long the page stays fresh. `If-None-Match` and `If-Modified-Since`
are honoured and answered with `304`.

One exception: while `watch` is on, the HTML representation is served without
validators. Only the document is hashed, and a template edit changes the page
without changing the document, so a development server would otherwise answer
`304` with a page that had already moved on. The `.md` and `.json`
representations are validated either way.

Adding a representation — an ActivityStreams object, say — means adding it to
`Representation` in `src/web/negotiate.ts` with its media type and, if it wants
one, its extension. The selection, the `Link` alternates, the `ETag` and the
406 body all follow from those two tables. ActivityPub types are claimed by the
federation middleware before the negotiator sees them.

## Feeds

The recent posts are syndicated in three formats, at the URLs WordPress uses,
so a site moving off it keeps every subscriber it had:

| URL                      | Format                                           |
| ------------------------ | ------------------------------------------------ |
| `/feed/`                 | RSS 2.0 (`application/rss+xml`)                  |
| `/feed/atom/`            | Atom 1.0 (`application/atom+xml`)                |
| `/feed/json/`            | JSON Feed 1.1 (`application/feed+json`)          |
| `/tag/{tag}/feed/`       | One tag archive, in RSS; `atom/` and `json/` too |
| `/category/{name}/feed/` | One category archive, the same three             |
| `/comments/feed/`        | Every reply the site has been sent, in RSS       |
| `{permalink}feed/`       | One post's replies, in RSS                       |

`/feed/` is RSS because that is the format nearly every existing subscriber
holds. The two archive bases are settings (`tagBase`, `categoryBase`), so the
per-archive feeds follow wherever the archives live.

WordPress's older spellings redirect `301` rather than 404: `/feed/rss/` to
`/feed/`, and the query forms `?feed=rss2`, `?feed=rss`, `?feed=atom` and
`?feed=json` on any listing to that listing's feed, and `?feed=rss2` or
`?feed=rss` on a post's permalink to that post's comments feed. A feed URL that
arrives without its trailing slash redirects to the canonical one in a single
hop.

A feed holds the newest published posts, newest first. Drafts, documents in the
trash and pages are never in one, and a term nothing published carries 404s
rather than serving an empty feed. `feedSize` in `content/_data/site.json` sets
how many entries a feed holds; without it a feed holds 20, which is deliberately
more than an archive page, so a reader that polls once a day does not miss a
post on a site that publishes several.

```json
{ "title": "My Site", "tagline": "Notes", "author": "Me", "feedSize": 20 }
```

### RSS 2.0

The channel carries `title`, `link`, `description` (the tagline), `language`
(the `language` setting, `en` by default), `lastBuildDate`, `generator`, an
`atom:link rel="self"`, the three notify-server elements described under
[Real-time notification](#real-time-notification), and an `image` built from the
avatar when the site has one.

An item carries `title`, `link`, `guid isPermaLink="false"`, `pubDate` in
RFC 822, `dc:creator` from the post's author or the site's, one `category` per
category and per tag, `description` holding an excerpt, `content:encoded`
holding the whole rendered post, and `source:markdown` holding the Markdown the
post was written from.

The `guid` is the post's ActivityStreams object id rather than its permalink.
That id is minted from the slug and written into the front matter on the first
delivery, so it survives the post being moved and a reader that has already
shown the item will not show it again.

The excerpt is the `description` front matter when the post has one, and
otherwise the first paragraph of the rendered body, stripped to plain text and
cut at 55 words — WordPress's own excerpt length.

`source:markdown` is Dave Winer's [source namespace][source-ns]: a reader that
understands Markdown should render from it rather than from `content:encoded`.
It is the same text the ActivityStreams `Article` carries as its `source`.

Every item also says where its comments are, three ways: `comments` is the page
to read them on, `wfw:commentRss` (the [Well-Formed Web][wfw-ns] comment API) is
the feed to poll, and `source:comments` is that same feed with a `count`
attribute, so a reader can say "3 comments" without fetching anything.

[source-ns]: https://source.scripting.com/
[wfw-ns]: http://wellformedweb.org/CommentAPI/

### Comments

This CMS stores no comments of its own. What it has instead is the fediverse
replies its inbox has been sent: a `Create` of a `Note` whose `inReplyTo` names
a post's ActivityStreams object id (see [Federation](#federation)). Those are
what the comments feeds publish, at the URLs WordPress publishes its own at —
`{permalink}feed/` for one post, `/comments/feed/` for the whole site.

Both are RSS 2.0 and nothing else: a comments feed has no Atom or JSON spelling
here, so `{permalink}feed/atom/` 404s. A post with no replies answers an empty
feed rather than a 404 — it exists, and a reader that subscribed before anybody
answered should keep polling — while a permalink that is no published post 404s
like any other. A page has no comments feed at all: only posts federate, so
nothing can ever have replied to one.

A channel carries the usual `title` (`Comments on: {post}`), `link`,
`description`, `language`, `lastBuildDate`, `generator`, `atom:link rel="self"`
and the same notify-server elements every other feed carries. An item carries the author's name as its `title` and `dc:creator`,
the reply's `url` as its `link` and its id as `guid isPermaLink="false"`, the
`published` time the note gave (or when it arrived, if it gave none),
`description` holding a plain-text excerpt and `content:encoded` holding the
note. On the site-wide feed the title names the post as well: `{author} on
{post}`.

The author's name is the profile the site stored when that actor followed it,
and otherwise the `@user@host` the actor's own URL implies. Naming them
properly would mean dereferencing the actor, which is a network round trip per
comment shown.

**The note's HTML is sanitised before it is published.** It is markup a
stranger wrote, so it is tokenised and rebuilt from an allowlist rather than
passed through: `p`, `br`, `a`, `em`, `strong`, `del`, `code`, `pre`,
`blockquote` and the list elements survive; `script` and `style` are dropped
along with their contents; every other element is unwrapped, keeping its text;
every attribute goes except an `a`'s `href`, which must be `http`, `https` or
`mailto` and is marked `rel="nofollow noopener noreferrer"`. `sanitizeCommentHtml`
is exported for a site that shows comments in its own templates.

A reply to a post that has since been unpublished or moved to the trash
disappears from `/comments/feed/`, and that post's own feed 404s with the post.
`feedSize` caps both feeds.

### Atom and JSON Feed

An Atom entry carries `id` (the post's absolute URL), `title`, `updated`,
`published`, `link rel="alternate"`, an `author` when the front matter names
one, a `category` per tag, a `summary` when the front matter has a
`description`, and the whole rendered post as `content type="html"`. The feed
itself carries `id`, `title`, `subtitle` from the site's tagline, `updated`,
`link rel="self"`, `link rel="alternate"` to the HTML page, a `generator`, an
`xml:lang` from the `language` setting, and — when the site names a notify
server — a `source:cloud` and a `link rel="hub"`.

A JSON Feed item carries `id`, `url`, `title`, `content_html`, `summary`,
`date_published`, `date_modified`, `tags` and `authors`; the feed carries
`version`, `title`, `home_page_url`, `feed_url`, `description`, `authors` and
`hubs`. Keys with nothing behind them are left out rather than sent empty.

The XML is written by this package rather than by a library. Text is escaped;
`content:encoded` and `source:markdown` are CDATA sections, with any `]]>` in
the text split across two sections so it cannot end one early.

### Real-time notification

A feed reader that polls hears about a post when it next polls. An [rssCloud][]
or [WebSub][] server turns that around: the reader registers with the server,
the site tells the server when a feed changes, and the server tells every
subscriber at once.

One setting, `notifyServer`, is the whole of it. It defaults to
`https://rpc.rsscloud.io`, which speaks both protocols, and everything else is
derived from it: `{notifyServer}/pleaseNotify` is where a subscriber registers,
`{notifyServer}/websub` is the hub, and `{notifyServer}/ping` is where this site
says a feed changed. Emptying the setting removes every element, every header
and every ping; a different URL moves all of them.

**Advertising.** An RSS channel carries all three spellings, so a reader of any
age finds one it understands:

```xml
<cloud domain="rpc.rsscloud.io" port="80" path="/pleaseNotify"
       registerProcedure="" protocol="http-post"/>
<source:cloud>https://rpc.rsscloud.io/pleaseNotify</source:cloud>
<atom:link rel="hub" href="https://rpc.rsscloud.io/websub"/>
```

The port and protocol of the legacy `<cloud>` are `80` and `http-post` whatever
scheme the server is actually reached over, because that is what
[rpc.rsscloud.io's quick start][quick-start] prescribes and what a 2001
aggregator expects to read. An Atom feed carries the `source:cloud` and the
`rel="hub"` link but no `<cloud>`, which is an RSS 2.0 element with no namespace.
A JSON Feed carries JSON Feed 1.1's `hubs`:

```json
{ "hubs": [{ "type": "WebSub", "url": "https://rpc.rsscloud.io/websub" }] }
```

And every feed response in every format — the site's, each archive's and both
comments feeds — carries WebSub's discovery header, on the `304` as well as on
the body, because a poller mostly gets the `304`:

```
Link: <https://rpc.rsscloud.io/websub>; rel="hub", <https://example.com/feed/>; rel="self"
```

**Pinging.** The server notifies nobody until it hears the feed changed. So when
a post is published, edited or withdrawn — the same index changes that drive
ActivityPub delivery, and never a full scan — the site posts
`url={feed}` to `{notifyServer}/ping`, once for each feed whose contents moved:
the three site feeds, and the three feeds of every tag and category the post
carried before _and_ after the change, because a post that left a tag changed
that tag's feed as much as the one it joined.

Pings are best effort. They run one after another on a queue of their own, a
repeated URL is sent once, each is given ten seconds, and a refusal is logged
rather than thrown: a notify server that is down costs a line in the log, never
a save. A site can ping a feed of its own:

```js
await cms.notifyFeeds(['https://example.com/podcast/feed/']);
```

`cms.notifier` is the service behind it — `notify(urls)`, `feedsFor(change)`,
`handle(change)` and `settled()` — already subscribed to the index.

[rsscloud]: https://rpc.rsscloud.io/docs
[websub]: https://www.w3.org/TR/websub/
[quick-start]: https://rpc.rsscloud.io/docs/quick-start

### Caching and discovery

Every feed carries `ETag`, `Last-Modified` and `Cache-Control: no-cache`, and
answers `If-None-Match` and `If-Modified-Since` with `304`. The validator covers
the feed's metadata as well as its entries, and each format and each scope gets
its own, so a reader holding the RSS feed is never told the Atom one is
unchanged. Feeds are validated even while `watch` is on, because a feed is not
rendered through the theme.

```sh
curl -i https://example.com/feed/
curl -i https://example.com/tag/releases/feed/json/
```

Every page of the default theme advertises all three feeds in its `<head>`, RSS
first, then the site's comments feed; an archive advertises that archive's three
as well, and a post its own comments feed (the renderer puts that URL in
`commentsFeed`, so a layout that overrides `post.njk` keeps it). A theme that
does not extend `layouts/base.njk` should emit them itself:

```html
<link
  rel="alternate"
  type="application/rss+xml"
  title="My Site"
  href="/feed/"
/>
<link
  rel="alternate"
  type="application/atom+xml"
  title="My Site"
  href="/feed/atom/"
/>
<link
  rel="alternate"
  type="application/feed+json"
  title="My Site"
  href="/feed/json/"
/>
<link
  rel="alternate"
  type="application/rss+xml"
  title="My Site comments"
  href="/comments/feed/"
/>
```

The builders are exported, so a site can write a feed of its own — one
category, one author — without reimplementing any of the three formats:

```ts
import { atomFeed, createRenderer, jsonFeed, rssFeed } from '@geekity/cms';

const site = createRenderer({ config: cms.config }).site();

const source = {
  site,
  documents: cms.store.listByTag('releases', { limit: 20 }),
  title: `${site.title}: releases`,
  href: '/tag/releases/',
  feedHref: '/tag/releases/feed/',
  baseUrl: cms.config.baseUrl,
};

rssFeed(source); // a string
atomFeed(source); // a string
jsonFeed(source); // a JSON Feed object
```

`commentsRssFeed` is the same for comments, and `postComments`, `siteComments`
and `commentCounts` read the replies out of the inbox log:

```ts
import { commentsRssFeed, siteComments } from '@geekity/cms';

const context = {
  admin: cms.admin,
  store: cms.store,
  baseUrl: cms.config.baseUrl,
};

commentsRssFeed({
  site,
  comments: siteComments(context, 20),
  title: `${site.title}: comments`,
  href: '/',
  feedHref: '/comments/feed/',
  baseUrl: cms.config.baseUrl,
});
```

## Theme overrides

A template is looked up in the site's `themeDir` first, then in the theme that
ships inside this package, file by file. Sites override one template at a time
and keep receiving updates to the rest. Files under `/theme/` resolve the same
way, so `theme/static/style.css` replaces the packaged stylesheet.

`themeDir` need not exist. A site of nothing but `geekity.config.ts` and
`content/` serves every page, the 404 and the stylesheet out of the packaged
theme; creating `theme/` is how you start replacing pieces of it, not a
condition of running.

A site that ships only

```
theme/layouts/post.njk
```

replaces the post layout; the base layout, the archive, the tag pages and the
404 all still come from the package. Templates are Nunjucks, and an override
can extend a packaged one by name:

```njk
{% extends "layouts/base.njk" %}

{% block content %}
<h1>{{ title }}</h1>
{{ content | safe }}
{% endblock %}
```

The context mirrors what an Eleventy layout receives — `title`, `date`, `tags`,
`content`, `page.url`, and every front matter key the file carried — plus
`site`, which is `content/_data/site.json`. It is part of the semver contract.
The full table of context keys, blocks and filters is in
[`themes/default/README.md`](./themes/default/README.md).

Rendering is also callable without a request:

```ts
import { createRenderer, resolveConfig } from '@geekity/cms';

const renderer = createRenderer({
  config: resolveConfig({ baseUrl: 'https://example.com' }),
});
renderer.renderDocument(document); // the HTML the site would serve
renderer.site(); // content/_data/site.json, defaults filled in
```

Handlers reach the same renderer as `c.var.renderer`.

## Building the same content with Eleventy

The content directory is an [Eleventy](https://www.11ty.dev) 3 input directory.
The same files this CMS serves build into a static site at the same URLs, so
leaving is a build step rather than a migration. That is a promise, and it is
kept by a test rather than by good intentions.

Copy
[`docs/eleventy.config.example.js`](https://github.com/geekitycom/cms/blob/main/packages/cms/docs/eleventy.config.example.js)
into your site as `eleventy.config.js` and run Eleventy:

```sh
npm install --save-dev @11ty/eleventy
npx @11ty/eleventy
```

It is a plain ESM config with no dependency on this package, and it writes out
the four rules the CMS follows that Eleventy does not know about on its own:

| Rule                                            | How the config does it                                                                                                                                                                                                                                                     |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `draft: true` hides a document                  | An `addPreprocessor` that returns `false` for it. `BUILD_DRAFTS=1` builds drafts anyway, for a local preview.                                                                                                                                                              |
| A file with no `permalink` gets the CMS default | An `addPreprocessor` that fills in `/{yyyy}/{mm}/{slug}/` for a post and `/{slug}/` for a page, slugifying the title exactly as the CMS does. Front matter always wins; the CMS writes `permalink` into every file it saves, so this only matters for hand-authored files. |
| `content/uploads/` is served at `/uploads/`     | `addPassthroughCopy({ 'content/uploads': 'uploads' })`, plus an `ignores` entry for the same path. Without the ignore, an upload that happens to be Markdown would be copied _and_ rendered as a page; the CMS only ever indexes `posts/` and `pages/`.                    |
| `content/_trash/` is not published              | `ignores.add('content/_trash/**')`. Eleventy skips `_includes` and `_data` because they are configured directories, not because of the underscore, so the trash has to be named.                                                                                           |

It also turns the template engine off for Markdown
(`markdownTemplateEngine: false`), because the CMS renders Markdown with
markdown-it and nothing else. Leaving Liquid or Nunjucks on would make `{{ … }}`
in a post mean one thing on the live site and another in the build.

Layouts are yours. The directory data files name them — `posts.json` says
`"layout": "post"` and `pages.json` says `"layout": "page"` — so Eleventy wants
`content/_includes/post.njk` and `content/_includes/page.njk`. The context an
Eleventy layout receives is the one this package's theme mirrors, so a layout
can often be moved across with only its `{% extends %}` removed.

The feeds are the one thing that does not carry over: `/feed/`, `/feed/atom/`
and `/feed/json/` are generated in code here, not by a template, so an Eleventy
build needs its own. Everything else is the same directory.

### The compatibility test

```sh
pnpm --filter @geekity/cms test:11ty   # or, from the repository root, pnpm test:11ty
```

`test:11ty` builds `test/fixtures/` with Eleventy 3 and the example config, then
checks every document against what the CMS computed for the same file: the
output path equals the permalink plus `index.html`, drafts and the trash are
absent, and uploads are copied through byte for byte. The fixtures deliberately
cover a post whose permalink is not the default, a hand-authored post and page
with no permalink at all, an accented title, a draft and a trashed file.

It is a separate script from `pnpm test` on purpose. The unit suite stays fast
and free of a build tool; `test:11ty` pulls in Eleventy, writes a temporary
directory and is the slow one. CI runs both. Neither `docs/` nor `test/` is in
the published tarball — the example config lives in the repository, which is
where you copy it from.

The repository's demo site makes the same comparison over content that reads
like a real site rather than like fixtures, with the two layouts above in
`apps/demo/content/_includes/`, so `pnpm test:11ty` from the root runs both.

## License
