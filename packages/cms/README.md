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

That is a running site on <http://localhost:3000> with a post, an About page, a
starter privacy page and the packaged theme. `geekity init` refuses a directory that already has anything in
it, so it can never write over a site you already have.

What it writes:

```
package.json          depends on @geekity/cms; scripts dev, start and sync
geekity.config.ts     port, directories, base URL
server.ts             the entry file; where your own routes go
tsconfig.json         so the site type checks against the package
content/
  posts/              Markdown posts, plus posts.json for Eleventy
  pages/              about.md, privacy.md, plus pages.json
  _data/site.json     the settings: title, tagline, author, page and feed sizes
  _data/federation/   once the site federates: followers.json and the inbox log
  _data/comments/     once somebody comments: one JSON file per post
.gitignore            node_modules, data and .env
```

`data/` and `themes/` are not written. The index under `data/` is created on
first boot and is safe to delete; `themes/` is optional and only exists once
you write a theme of your own — one folder, `themes/<name>/`, with a
`theme.json` in it, chosen on **Appearance > Themes** in the admin. Until then
every page comes from the theme inside the package. [Theme
overrides](#theme-overrides) has the whole of it, and the comment beside
`themesDir` in the generated `geekity.config.ts` says it where you will see
it.

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

Upgrading to the release that renamed the session cookie signs everybody out
of an https site once. See [Session hardening](#session-hardening).

Upgrading never deletes a reader's data. The release that added
[retention](#retention) keeps every commenter email, address hash and contact
message on a site whose `site.json` has not set a period.

## The `geekity` command

`geekity` is installed as a bin, so `pnpm geekity <command>` runs it inside a
site (or `npx geekity`, or a `package.json` script, which is how the generated
`sync` script calls it).

| Command                                   | What it does                                                                                                                                                          |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `geekity serve`                           | Boot from the config file and listen. The default when no command is given.                                                                                           |
| `geekity init <dir>`                      | Create a new site in `<dir>`. Refuses a directory that is not empty.                                                                                                  |
| `geekity sync`                            | Rebuild the content index once and exit. Exits non-zero if any file could not be parsed.                                                                              |
| `geekity rebuild`                         | Delete `data/geekity.db` and build it again from the files.                                                                                                           |
| `geekity resend --all`, `<slug>...`       | Send announced posts to every follower and relay again, as they now read. See [Quote posts](#quote-posts).                                                            |
| `geekity maintenance on`, `off`, `status` | Take the public site down on purpose with a 503 and `Retry-After`, or bring it back, without a restart. `on --until <time>` names when it should be back.             |
| `geekity strip-metadata`                  | Remove location and camera metadata from files already in `content/uploads`. See [The media library](#the-media-library).                                             |
| `geekity user add <name>`                 | Create an admin account, so a site can get its first login without the setup screen.                                                                                  |
| `geekity import wordpress-actor <name>`   | Bring one person across from the WordPress ActivityPub plugin: their key pair, the actor id their followers hold, the plugin's numeric actor id, and their followers. |
| `geekity --help`, `-h`                    | The same table, on the terminal.                                                                                                                                      |
| `geekity --version`                       | The installed version.                                                                                                                                                |

`serve`, `sync`, `rebuild`, `resend`, `maintenance`, `strip-metadata`, `user add` and `import wordpress-actor` take
`--config <file>`; without it they look for `geekity.config.ts`, then
`geekity.config.js`, then `geekity.config.mjs` in the working directory, and run
on defaults if there is none.

`sync` prints what the scan did and forces watching off whatever the config
says, because a one-shot scan that then sat in a watcher would never exit:

```sh
$ geekity sync
Scanned 12: 2 created, 1 updated, 0 removed, 9 unchanged, 0 failed
```

A file that will not parse is logged, left out of the index and counted in
`failed`; the command then exits `1` so a deploy step notices. Everything else
in the directory is still indexed.

### Starting the database again

`geekity rebuild` deletes `data/geekity.db` (with its `-wal` and `-shm`) and
builds a new one exactly as a boot does — the same migrations, the same scan of
`content/`, the same read of `content/_data/federation/` — then says what it
indexed:

```sh
$ geekity rebuild
Rebuilt /srv/blog/data/geekity.db from the files.
Scanned 214: 214 created, 0 updated, 0 removed, 0 unchanged, 0 failed
Indexed 37 followers and 1,204 inbox activities.
```

Nothing in the database is anything but a reading of `content/` and `data/`, so
this is a command with no undo and nothing to lose; [what a rebuild does cost
is listed below](#two-directories-content-and-data). It is also the way past a
database this version refuses to open — a damaged one, or one written by a newer
`@geekity/cms`.

It refuses while the site is running, because deleting the file under a live
server would leave it writing to a database nothing can find. Stop the site
first. A file that will not parse is reported and exits `1`, as with `sync`.

That is why it is not the usual repair. **Tools > Content index** in the admin
empties the index and reads every file again in place, on the live connections:
no downtime, nobody signed out, and the delivery log, the relay handshakes and
the scheduler's watermark all kept. It is behind a confirm step, because the
site answers 404 for its documents between the emptying and the end of the
scan, and it federates nothing — a change a scan makes carries `origin: 'scan'`,
which delivery, the webmentions and the feed pings ignore. Use the command for
the one case the screen cannot be the door for: a database this version refuses
to open, where there is no site running to press a button in.

### Creating an admin from the command line

`geekity user add <username>` writes a user straight into `data/users.json`,
which is how a site that cannot reach `/admin/setup` from a browser — a
headless deploy, a server behind a bastion — gets its first login. It is also
the way back into a site that has locked everybody out and cannot send email.
It enforces exactly the rules the setup form does: a username of 1 to 64
letters, digits, dots, dashes or underscores, and a password of at least 8
characters.

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

`--email <address>` puts an address on the new user, which is optional and is
what [password recovery](#forgotten-passwords) works through:

```sh
$ geekity user add ada --email ada@example.com
Password for ada:
Created admin user ada (ada@example.com). Sign in at /admin/login.
```

A name that is already taken is refused and nothing is written; so are an
illegal username, a short password and an address that is not one. Every
refusal prints why and exits `1`.

Once somebody can sign in, the [`/admin/users` screen](#the-admin) is the
easier door: it adds users, generates passwords and deletes them, and each
user's own screen under it is where the rest of an account is edited.

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

| Field              | Default                               | Environment override         | Meaning                                                                                                                                                                                                                                                         |
| ------------------ | ------------------------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `port`             | `3000`                                | `GEEKITY_PORT`, then `PORT`  | Port the HTTP server listens on. `0` picks a free one.                                                                                                                                                                                                          |
| `contentDir`       | `<cwd>/content`                       | `GEEKITY_CONTENT_DIR`        | Markdown content.                                                                                                                                                                                                                                               |
| `dataDir`          | `<cwd>/data`                          | `GEEKITY_DATA_DIR`           | Derived state — the SQLite index, the image variants — and the files that are not derived and must be backed up, such as `users.json`, the actor key pairs under `keys/` and `locations.json`. [Two directories](#two-directories-content-and-data) lists them. |
| `themesDir`        | `<cwd>/themes`                        | `GEEKITY_THEMES_DIR`         | The site's themes, one directory per theme, each with a `theme.json`. Which one is in use is the `theme` setting in `site.json`, not a path. Need not exist.                                                                                                    |
| `baseUrl`          | `http://localhost:<port>`             | `GEEKITY_BASE_URL`           | Public origin for canonical URLs, feeds and ActivityPub ids. A trailing slash is stripped.                                                                                                                                                                      |
| `watch`            | `true`                                | `GEEKITY_WATCH`              | Watch `contentDir` while serving and keep the index in step.                                                                                                                                                                                                    |
| `sessionLifetime`  | `1209600` (14 days)                   | `GEEKITY_SESSION_LIFETIME`   | How long an admin login lasts, in seconds.                                                                                                                                                                                                                      |
| `loginAttempts`    | `5`                                   | `GEEKITY_LOGIN_ATTEMPTS`     | Failed sign-ins a username or an address may make before it is locked out.                                                                                                                                                                                      |
| `loginLockout`     | `900` (15 minutes)                    | `GEEKITY_LOGIN_LOCKOUT`      | How long the first lockout lasts, in seconds. See [Login hardening](#login-hardening).                                                                                                                                                                          |
| `trustProxy`       | `false`                               | `GEEKITY_TRUST_PROXY`        | Believe `X-Forwarded-For` when deciding which address a sign-in came from.                                                                                                                                                                                      |
| `accessLog`        | `false`; `true` under `geekity serve` | `GEEKITY_ACCESS_LOG`         | One line per request on stdout: method, path with query, status, duration. See [The access log](#the-access-log).                                                                                                                                               |
| `accessLogAddress` | `false`                               | `GEEKITY_ACCESS_LOG_ADDRESS` | Put the client address on the end of each access-log line. `trustProxy` decides which address that is.                                                                                                                                                          |
| `accessLogWriter`  | stdout                                | —                            | Where the lines go instead. See [The access log](#the-access-log).                                                                                                                                                                                              |
| `maintenance`      | `false`                               | `GEEKITY_MAINTENANCE`        | Keep the site in maintenance mode, answering 503, until a restart without it.                                                                                                                                                                                   |
| `compression`      | `true`                                | `GEEKITY_COMPRESSION`        | Compress text responses with brotli or gzip. Turn it off behind a proxy that compresses. See [Compression](#compression).                                                                                                                                       |
| `securityHeaders`  | [see below](#security-headers)        | —                            | Headers every response carries. A string replaces a default or adds a header, `false` removes one.                                                                                                                                                              |
| `onDocumentChange` | none                                  | —                            | Hook run for every change to the index. See [Hooks](#hooks).                                                                                                                                                                                                    |
| `onPublish`        | none                                  | —                            | Hook run when a document becomes visible. See [Hooks](#hooks).                                                                                                                                                                                                  |
| `federation`       | `{}`                                  | —                            | Federation stores and guards. See [Federation](#federation).                                                                                                                                                                                                    |
| `commentChecker`   | Akismet                               | —                            | A spam checker of the site's own, which wins over the key in `data/akismet.json`. See [Akismet](#akismet).                                                                                                                                                      |
| `mail`             | `{}`                                  | —                            | Mail provider, retries, backoff and logger. See [Email](#email).                                                                                                                                                                                                |

Precedence is environment variable, then config file, then default, so a host
can override anything without editing the site. A boolean environment variable
takes `true`, `1`, `yes` and `on`, or their opposites; anything else is an error
rather than a silent `false`.

## The access log

`geekity serve` writes one line per request to stdout. `createCms` does not:
a CMS mounted inside somebody else's server has no business writing to its
stdout uninvited, so an embedder asks for it with `accessLog: true` — in the
config, no environment variable needed:

```ts
const cms = createCms({ accessLog: true });
```

The line is the method, the path with its query string, the status and how
long the request took, in that order, separated by single spaces:

```
GET / 200 4.2ms
GET /.well-known/webfinger?resource=acct:ada@blog.example 200 1.9ms
GET /nothing-here 404 2.1ms
POST /admin/login 303 41.3ms
```

Every route is on it — `/healthz`, the federation endpoints, the admin and the
public site — and a request whose handler threw gets its `500` line. Nothing
but the request line is ever read: no body is touched, so a password posted to
the login form cannot reach the log, and no cookie or `Authorization` header
is looked at either.

With `accessLogAddress: true` the client address goes on the end, after the
duration. It is off by default because an address is personal data. Which
address is right is `trustProxy`'s answer — the leftmost `X-Forwarded-For`
entry behind a proxy that sets it, the socket's own address otherwise — the
same one the login throttle counts a failed sign-in against.

`accessLogWriter` takes the lines somewhere else, one call per line, without
the newline:

```ts
const lines: string[] = [];
const cms = createCms({
  accessLog: true,
  accessLogWriter: (line) => lines.push(line),
});
```

## Two directories: `content/` and `data/`

Everything a site cannot afford to lose is a file, and every one of those files
is in one of two directories. Nothing else needs backing up, and nothing else
needs carrying across a deploy.

`content/` is what the site publishes. It belongs in git, an Eleventy build of
the same directory reads all of it, and everything in it is meant to be public:

| Path                                               | What it holds                                                            |
| -------------------------------------------------- | ------------------------------------------------------------------------ |
| `content/posts/`, `content/pages/`                 | The Markdown documents, `_trash/` included.                              |
| `content/uploads/`                                 | Uploaded files, with their location and camera metadata removed.         |
| `content/_data/site.json`                          | Every site setting.                                                      |
| `content/_data/federation/followers.json`          | Who follows the site.                                                    |
| `content/_data/federation/inbox/{yyyy}-{mm}.jsonl` | Every activity the inbox was handed, one per line.                       |
| `content/_data/comments/{slug}.json`               | The comments left on that post, whatever a moderator has done with them. |

`data/` is private. It is gitignored, and it is the half to copy somewhere safe:

| Path                              | What it holds                                                                                                                   |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `data/users.json`                 | Usernames and argon2id password hashes. Mode `0600`.                                                                            |
| `data/keys/`                      | Each user's actor key pairs as JWK files. Mode `0600`. **Losing these breaks federation.**                                      |
| `data/locations.json`             | Where each post was written, keyed by permalink (decision-29). Mode `0600`.                                                     |
| `data/comment-salt`               | What hides commenters' addresses in the published comment files. Mode `0600`.                                                   |
| `data/comments/{slug}.json`       | The emails of that post's commenters, and whether each asked to hear about replies, keyed by comment id. Mode `0600`.           |
| `data/akismet.json`               | The Akismet key, and what `verify-key` last said about it. Mode `0600`.                                                         |
| `data/mail.json`                  | The mail credential: a Brevo API key, an SMTP connection, or both. Mode `0600`.                                                 |
| `data/notification-secret`        | What signs the one-click links in a notification. Mode `0600`. Losing it kills every link already in an inbox and nothing else. |
| `data/comment-optouts.json`       | The addresses that have unsubscribed from reply notices. Mode `0600`.                                                           |
| `data/indieauth-tokens.json`      | A SHA-256 hash of each IndieAuth access and refresh token, with its user, app, scopes and expiry (decision-24). Mode `0600`.    |
| `data/notification-digests.json`  | When each user was last sent a digest. Mode `0600`. Losing it sends one digest early and nothing worse.                         |
| `data/wordpress-activitypub.json` | When each WordPress compatibility path was last asked for. Losing it resets the answer the switch is watched by.                |

Three things under `data/` may be deleted whenever the site is stopped, and
nothing else in either directory may:

| Path              | What it is                                                                                      |
| ----------------- | ----------------------------------------------------------------------------------------------- |
| `data/geekity.db` | The SQLite cache, with its `-wal` and `-shm`. `geekity rebuild` deletes and rebuilds it.        |
| `data/images/`    | Variants derived from `content/uploads/`, with their `image.json` sidecars. `rm -r` it.         |
| `data/avatars/`   | Remote avatars served from `/_geekity/avatars/` (TASK-134). `rm -r` it; they are fetched again. |

The next boot builds the database out of the files with no manual step, and a
request for a variant that is not there derives it and serves it.

### What is in the database, and what a rebuild costs

No table holds anything that is not either read back from the files or
something a site is told it may lose:

| Table                                               | Where it comes back from                                                     |
| --------------------------------------------------- | ---------------------------------------------------------------------------- |
| `documents`, `document_tags`, `document_categories` | The boot scan of `content/`.                                                 |
| `followers`, `ap_inbox`                             | `content/_data/federation/`, emptied and read back on every boot.            |
| `comments`                                          | `content/_data/comments/`, emptied and read back on every boot.              |
| `sessions`                                          | Nothing. Everybody signed in is signed out.                                  |
| `ap_deliveries`                                     | Nothing. The federation screen shows its posts with "Nothing recorded."      |
| `ap_relays`                                         | The relay list in `site.json`: boot sends each of them a fresh `Follow`.     |
| `password_resets`, `spent_tokens`                   | Nothing. Every reset link and every one-click moderation link stops working. |
| `cms_state`                                         | Nothing. One key, the scheduler's watermark.                                 |
| `migrations`, `admin_migrations`                    | The package. They record which schema versions have run.                     |

So four things are actually lost:

- **Logins.** Everybody signed in has to sign in again. The accounts themselves
  are in `data/users.json` and are untouched.
- **Whether a one-click link had been used.** The links themselves are signed
  rather than stored, so they go on working; a rebuild only forgets which of
  them had already been spent. Every action they perform is idempotent, so the
  worst that costs is a moderation link that works a second time. A password
  reset link, which _is_ stored, stops working altogether.
- **Relay handshakes.** A relay named in the settings that the database has
  never heard of is followed on boot, so a rebuild sends every listed relay a
  new `Follow` and the reason one gave for rejecting the last is gone.
- **A scheduled post that came due while the site was down.** The scheduler
  treats an absent watermark as "start from here", so that a rebuilt database
  cannot re-announce the archive to every follower. Such a post is public on the
  next boot but no `Create` is delivered for it; resend it from
  `/admin/federation` if it should have gone out.

The one thing the file-first design gives up is narrower than any of those: a
post whose **file is gone entirely** can no longer be withdrawn from followers'
timelines, because the permalink a `Delete` names was in the file. Trashing a
post in the admin keeps the file under `_trash/`, so the ordinary way of
unpublishing still sends the `Delete`.

### A database this version will not open

Two cases refuse the boot rather than being cleaned up behind your back, and
both name the file and say what to do about it:

- **Written by a newer `@geekity/cms`**, meaning its migration ledger records a
  schema version this package does not ship. Upgrading the package back is
  usually what was meant; `geekity rebuild` throws it away if it was not.
- **Damaged**, meaning SQLite will not open it. `geekity rebuild` is the fix.

A database _older_ than the oldest migration the package still ships is the one
case thrown away and rebuilt without asking: there is by definition no path
forward from it, and nothing in it is anything but a reading of the files.

## Federation

**Every user is an ActivityPub actor**, served by [Fedify] at their author URL:
`{baseUrl}/author/{username}/` is the archive in a browser and the `Person` to
a peer asking for `application/activity+json`, exactly as a post's permalink is
its page and its object. The collections are that URL's children —
`inbox/`, `outbox/`, `followers/` and `following/` — and the instance-wide
shared inbox is `/inbox/`. `author` and `inbox` are reserved top-level paths
for that reason: an actor id a settings field could move would be a different
account to everybody holding it.

There is no site actor. A post is announced by the actor of the user its
`author` names, its `outbox` is that user's archive as activities, and its
followers are that user's own.

Fedify's stores have defaults that suit a single process, and `federation` is
where a site that has outgrown them says so:

| Field                 | Default                 | Meaning                                                                                                                                        |
| --------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `kv`                  | `MemoryKvStore`         | Fedify's cache and idempotence store. Nothing that has to survive a restart lives in it.                                                       |
| `queue`               | `InProcessMessageQueue` | The delivery and inbox queue. `null` means no queue: activities are handled and delivered inside the request that carried them, with no retry. |
| `allowPrivateAddress` | `false`                 | Whether Fedify may fetch private and loopback addresses. Leave it off: turning it on removes an SSRF guard. It exists for tests.               |

Followers and the log of what the inbox was told are the CMS's own, and they
are files the site publishes (decision-9):
`content/_data/federation/{username}/followers.json` holds one object per
follower of that user — actor id, inbox, shared inbox, handle, name, icon,
profile URL and follow time, oldest follow first — and
`content/_data/federation/inbox/{yyyy}-{mm}.jsonl` holds one compact JSON-LD
activity per line, with the `receivedAt` the log stamped it with and the
`recipient` it was addressed to in front of it. The log stays one chronological
record because it is a record of what this server was told; each line says
whose it was. Both are in git beside the posts, and an Eleventy build of the
same content directory sees them as `federation.{username}.followers` and
`federation.inbox`. A `Follow` appends to the first, an `Undo(Follow)` or an
actor's own `Delete` takes the entry out, and a like, a boost or a reply
appends a line to the second; each write updates the SQLite index in the same
step, behind a lock on the file, so the two can never disagree. The `followers` and `ap_inbox` tables are that
index and nothing more: every boot empties them and reads them back from the
files, which is what makes editing `followers.json` by hand and restarting a
supported thing to do, and what makes deleting the database cost a site
nothing. `cms.admin.replaceFollowers` and `replaceInboxActivities` are what the
rebuild calls; `rebuildFederationIndexes({ admin, contentDir })` is the rebuild
itself. The delivery outcomes stay in SQLite as a cache of what happened; the
activities themselves are not stored at all, because they are rebuilt from the
posts' files whenever they are wanted again.

Each user's key pairs are the CMS's own too, but they are the one
thing a site can never regenerate, so they live in files: one JWK per algorithm
per user under `dataDir/keys` (`ada.rsassa-pkcs1-v1_5.jwk` and
`ada.ed25519.jwk`), written `0600` in a `0700` directory, each holding the
private key alone because the public half is derived from it. They are
generated on the first request that needs them and read back on every one after
that. The actor publishes the RSA key as `publicKey` at `{actor}#main-key`,
which is what a peer verifies an HTTP Signature with, and both as
`assertionMethod` multikeys at `{actor}#multikey-0` and `#multikey-1`.

A key file that is there and will not import stops the boot, with a message
naming it. That is deliberate: replacing it would give the site a new identity
and every follower's cached public key would stop verifying, and Fedify's own
answer — an actor document with no `publicKey` at all — is worse still, because
peers cache it. Restore the file from a backup, or delete it to ask for a new
key on purpose.

### Delivery

Publishing federates. The delivery service listens to the index, so a post
edited on disk reaches the followers exactly as one saved through the editor
does:

| What happened to the post                                                 | What the followers get    |
| ------------------------------------------------------------------------- | ------------------------- |
| became published — written live, or undrafted, or restored from the trash | `Create` of its object    |
| edited while published                                                    | `Update` of its object    |
| drafted, trashed, or its file deleted                                     | `Delete` of a `Tombstone` |

Nothing is delivered for a full scan, the boot scan included: a rebuilt index
reports the whole archive as new, and announcing it again is not what deleting
`data/geekity.db` should mean.

A post's ActivityStreams object id is its permalink, absolute on the site's
base URL. One URL answers both audiences — a browser gets the page, a peer
asking for `application/activity+json` gets the post's object — so a shared
link, a feed item, an object id and a reply's `inReplyTo` all name the same
thing. Nothing else has to be minted or kept in step.

That object is a `Note` or an `Article`, whichever the post's discovered type
is: a post with no title, or whose text opens with its title, is a `Note`, and
any other is an `Article`. Mastodon shows the two differently. An `Article`
arrives as its title, its excerpt and a link, so it sends `name` and a
`summary`. A `Note` arrives as its `content` and nothing else, and Mastodon
would show a `summary` as a content warning, so a note sends neither and puts a
title its text does not open with at the top of its content.

Both carry their text twice: `content` as it always was, and `contentMap` keyed
by the post's language, with `summaryMap` beside an `Article`'s `summary`. The
language is the post's `lang` front matter when it names one, and the site's
`language` otherwise, so a client can filter and translate by it. Mastodon
reads a status's language from that key.

An author can choose the type for one post in its front matter:

```yaml
activitypub:
  type: Note
```

`Note` and `Article` are the two values. Anything else is logged as a warning
and the derived type is sent instead. The CMS never rewrites the key. Changing
it on a post already announced sends an `Update`, but a remote server may keep
showing the post the way it first arrived.

The first activity about a post writes one key, `activitypub.published`, into
its front matter: the record that the post has been announced and when, which
is what decides `Create` against `Update` and what a resend reads. Restoring a
trashed post reuses it too.

A post whose file already names an `activitypub.id` keeps it as its object id
for the life of the post — that is how a post migrated from WordPress keeps the
`https://example.com/?p=813` its followers, its replies and its RSS subscribers
already hold. The CMS serves the post's object at that URL on an ActivityStreams
request, redirects a browser from it to the permalink, and names it in every
`Update` and `Delete`.

The CMS writes one itself in one case: when a published post's slug or
permalink is changed in the editor. A fediverse server cannot rename an object
it holds, so the URL the post is leaving becomes its stored `activitypub.id`.
Followers get an `Update` of the object they already have, a peer at the old
URL still gets the object, and a browser there is redirected to the new
permalink. The object's `url` is the new permalink. See
[Moved URLs](#moved-urls).

One POST serves a whole instance — the shared inbox is preferred — but the
outcome is recorded per recipient, so an admin can see which one did not get it
and send the post again:

```ts
const report = await cms.delivery.resend(slug);
report?.deliveries; // one row per follower and relay: inbox, status, error, time
```

`resend` is "send this post as it now reads", not "send that activity again":
the activity is built from the file at the moment it is called, so a follower
whose server was down ends up with the post as it stands. Which activity that
is follows the same table as a save — a published post nobody has been told
about is a `Create` and is stamped, a published post they hold is an `Update`
under a fresh id, a draft or a trashed one is a `Delete` of a `Tombstone` — and
`undefined` comes back when there is no post by that name and nothing to
withdraw.

Nothing else is stored. What SQLite keeps about anything the site has sent is
one outcome row per recipient — the activity's id, type, object id and slug,
the inbox used, how it went, why not, and when — and that is a cache which may
be empty. `cms.admin.lastDeliveryToObject(objectId)` is the newest outcome
about one post, and `listDeliveries(activityId)` and
`countDeliveriesByStatus(activityId)` say how one activity landed with each
recipient. A status is `sent` (the inbox took it), `queued` (handed to Fedify's
queue, which retries out of band) or `failed`.

The one capability given up is tombstoning a post whose file is gone entirely
rather than in the trash: there is no file left to build the `Tombstone` from.

### Quote posts

Mastodon 4.5 lets people quote a post only when the post says who may, and
shows a quote only once the quoted author's server has approved it
([FEP-044f]). Every post this site federates is public, so every `Note` and
`Article` carries `interactionPolicy.canQuote` with `automaticApproval` set to
the public collection: anybody may quote it, and nobody has to approve it by
hand. Pages, drafts, scheduled and trashed posts do not federate, so nobody
can quote them.

A quoting server sends a `QuoteRequest` to the post's author. The inbox, and
the WordPress-compatible inbox when that switch is on, answers it:

- For a post the site federates, whose quote lives on the requester's own
  server, it stores an approval and replies `Accept` with a
  `QuoteAuthorization` as its `result`. The authorization names the quote
  (`interactingObject`), the post (`interactionTarget`) and the author
  (`attributedTo`).
- For anything else it replies `Reject` and stores nothing.

Approvals are files, like followers:
`content/_data/federation/{username}/quotes.json` holds one object per quote of
that user's posts. Each is served unsigned, as ActivityStreams JSON, at
`{baseUrl}/author/{username}/quotes/{id}/`, for as long as the post is still
published. An `Undo` of the `QuoteRequest`, or a `Delete` of the quoting post,
removes the approval, and its URL answers 404 after that. A quote does not
notify the author.

Mastodon keeps the copy of a post it fetched first, so a post federated before
the quote policy existed is not quotable until its followers receive an
`Update`. Editing the post sends one. To update every announced post at once,
run `geekity resend --all` in the site directory:

```sh
$ geekity resend --all
hello-world: Update to 3 of 3 inboxes
another-post: Update to 3 of 3 inboxes
```

`geekity resend <slug>...` does the same for named posts. Each is what the
Resend button on the federation screen does: an `Update` for a post still
published, a `Delete` for one that has been withdrawn, and a `Create` for a
published post that was never announced. `--all` only reaches posts that were
announced. The command delivers with no queue, so every activity has been
posted before it exits, and it exits non-zero when a named slug has nothing to
resend. It works while the server runs, because both read the same files and
database.

[FEP-044f]: https://codeberg.org/fediverse/fep/src/branch/main/fep/044f/fep-044f.md

### Relays

A [Mastodon-style relay][fepae0c] boosts every public activity it is sent on to
the instances subscribed to it, which is how a site nobody follows yet reaches
people. `relays` is the setting: one relay inbox per line on
`/admin/federation/settings`, kept in `site.json` like every other setting, and
`https://tags.pub/user/_____relay_____/inbox` is one worth knowing about — it
boosts any public post carrying a hashtag it tracks, which every `Article` this
CMS builds already carries one of per tag and per category.

Adding a line sends that inbox a `Follow` whose object is the ActivityStreams
Public collection, signed by the site's first account — a relay subscription is
an instance-wide agreement rather than one person's, and the first account is
the one actor that can be chosen without asking — and carrying the Linked Data
signature a Mastodon-style relay verifies. The relay answers `Accept` or
`Reject` — possibly days later, because a subscription may need a human to
approve it — and that answer arrives in the site's inbox and moves the
subscription. Removing the line sends `Undo` of the same `Follow`.

Only an accepted relay is delivered to. From there it is one more inbox in the
fan-out: every `Create`, `Update` and `Delete` for a post, whoever wrote it,
and the actor `Update` a profile change sends, goes to it as well as to the
author's followers, its
outcome recorded in the delivery log against its actor id and its inbox exactly
as a follower's is — which is why Resend reaches relays too.

```ts
cms.admin.listRelays(); // inbox, actor, state, reason, follow id, times
cms.relays.sync(); // reconcile the records with the setting
await cms.relays.retry(inboxId); // send the follow again
```

The records live in `ap_relays`, keyed by inbox, and are operational state
rather than a source: the setting is. A relay the settings name that has no
record — a rebuilt database, a restored content directory — is followed again
on the next boot.

[fepae0c]: https://w3id.org/fep/ae0c

### A user's profile

An actor's `name`, `summary`, `icon` and `attachment` are the display name, the
bio, the avatar and the links on their user record, edited on
`/admin/users/<id>` and stored in `data/users.json` — the same profile the
author archive is headed with, so a page and an actor cannot say different
things about somebody. Their `preferredUsername` is their login, and
`alsoKnownAs` lists every URL they answer to: the actor id, the archive and
`/@{username}`. The profile holds two more fields the actor does not carry — a
job title and a location — which are there for a theme to print beside the
name.

The avatar is a path like `/uploads/2026/09/me.png`, stored with the site's
other uploads. The actor carries it as an absolute URL resolved against the
base URL in effect, because a peer has no site to resolve a path against; one
that is already an absolute URL is left alone, which is how a profile picture
goes on a CDN.

Saving a profile delivers an `Update` of that user's actor to their followers,
so the profile a peer cached is refreshed rather than left showing last year's
picture. Nothing on the settings screen does: the site is not an actor.
`cms.delivery.updateActor(user)` sends one from code. Its outcome is recorded
like every other activity's, with the actor's id as its object and no slug, so
it is not a row in the federation screen's per-post delivery table, which is
built from the posts the content index holds.

### WebFinger

`/.well-known/webfinger` is the CMS's own route rather than Fedify's, because
Fedify computes its `self` link and its `aliases` from the dispatcher path and
neither can be added to. It answers for every spelling of the same person — the
`acct:{username}@{host}` handle, the bare `{username}@{host}`, the author URL,
`/@{username}` and the stored actor id of somebody who has one — with the actor
id as `self`, the archive as `profile-page`, and all of the person's URLs as
`aliases`. A username nobody has is a 404. `/@{username}` itself is a 301 to
the archive of the user of exactly that name, and a 404 for a handle nobody
answers to: it is an alias of somebody, so a handle that is not anybody's is
nowhere rather than a redirect to an archive that does not exist either.

### A user's stored actor id

A user record in `data/users.json` may carry an `actorId`: the ActivityStreams
id that person was published under somewhere else, such as the
`https://example.com/?author=2` the WordPress ActivityPub plugin publishes.
That is identity, not cache — a follower's server keys the account by the URL
it first saw — so the CMS serves the person under it for the life of the
account, the way a post keeps its `activitypub.id`:

```json
{ "id": 2, "username": "ada", "actorId": "https://example.com/?author=2" }
```

The actor document's `id` is then that URL and its keys hang off it
(`…?author=2#main-key`), every activity the user sends names it as `actor` and
is signed with a key id under it, and the URL itself — query string and all —
answers with the `Person` for a peer and a 301 to the author archive for a
browser. WebFinger publishes it as `self` and resolves a lookup by it, and the
actor lists it in `alsoKnownAs` beside the archive and `/@{username}`. Nothing
else moves: `url` is still the archive and the collections are still the
archive's children, because a peer refetches those.

The CMS never mints one and no screen writes one. It arrives with the WordPress
import, or is typed into the file by hand; `/admin/users/<id>` shows it
read-only beside the account, and a value that is not an absolute URL is
ignored.

### WordPress ActivityPub compatibility

A site that moved here from the WordPress ActivityPub plugin has followers
whose servers still hold the plugin's endpoints — `/wp-json/activitypub/1.0/actors/2/inbox`,
the shared `/wp-json/activitypub/1.0/inbox`, and the collections beside them.
Those are cache rather than identity: a follower's server replaces them the
next time it refetches the actor. So the CMS can carry them for a while, behind
a switch, and is meant to stop.

Turn **WordPress ActivityPub compatibility** on under
`/admin/federation/settings`. It is off by default and `site.json` says nothing
about it until it is on. It needs one thing on the user record in
`data/users.json` besides the stored actor id above: the number WordPress gave
that person, which is what its paths are built from.

```json
{
  "id": 2,
  "username": "ada",
  "actorId": "https://example.com/?author=2",
  "wordpressActorId": 2
}
```

`geekity import wordpress-actor` writes both; no screen does. With the switch
on, those paths are real inbox routes, signature-verified exactly as the
canonical ones are — an unsigned or badly signed delivery is refused — plus GET
routes for the actor, its outbox, its followers and its following. What a peer
reads back is always the canonical document: the same `id`, the same key, and
the _canonical_ inbox and collections, so a follower refetching the actor at
the old URL is the follower that learns the new endpoints. A user with no
`wordpressActorId` is not reachable through any of it.

Every one of those paths records the instant it was last asked for, per user,
in `data/wordpress-activitypub.json` — a file, so a deleted database does not
forget it — and the settings page lists each path beside the switch with that
instant, or _Never_. That is what the switch is watched by: once every
follower's server has refetched the actor, nothing asks any more, and the
switch can go off. Clearing it takes the paths away on the very next request,
with no restart.

### Moving a site off the WordPress ActivityPub plugin

`geekity import wordpress-actor` brings one person across. It writes the three
things the CMS cannot mint for itself — the RSA key pair the followers have
cached, the actor id they key the account by, and the followers — and it is a
command rather than a screen because a stored actor id is identity for the life
of the account.

```sh
geekity import wordpress-actor ada \
  --actor-id 'https://example.com/?author=2' \
  --wordpress-id 2 \
  --keypair ada.keypair.json
```

It writes `data/keys/ada.rsassa-pkcs1-v1_5.jwk` (and mints the Ed25519 pair
beside it, which WordPress never had), puts `actorId` and `wordpressActorId` on
the user in `data/users.json`, and fetches the plugin's public followers
collection into `content/_data/federation/ada/followers.json`, dereferencing
each follower for its inbox, shared inbox, handle, name, avatar and profile URL.

| Option                                        | What it is                                                                                                                                            |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--actor-id <url>`                            | The id WordPress published, query string and all. The one thing the import cannot work out for itself.                                                |
| `--wordpress-id <n>`                          | The WordPress user id, which is the number in the plugin's paths.                                                                                     |
| `--keypair <file>`                            | The JSON the plugin's option holds: `{"private_key": …, "public_key": …}`.                                                                            |
| `--private-key <file>`, `--public-key <file>` | The two PEMs instead, for a site still on the legacy user meta. The public key is only checked against the private half; it is derived, never stored. |
| `--followers <url\|file\|none>`               | Where the followers come from. Left off, the plugin's own collection on the actor id's origin.                                                        |
| `--force`                                     | Import over a key pair the user already has.                                                                                                          |

**Exporting the key pair with wp-cli.** The plugin keeps a user's pair in a
WordPress option named after their login:

```sh
# On the WordPress server. The login, not the user id, is what names the option.
wp option get activitypub_keypair_for_ada --format=json > ada.keypair.json
```

A site old enough to still be on the plugin's legacy storage has the pair in
user meta instead, one PEM per key:

```sh
wp user meta get 2 magic_sig_private_key > ada.private.pem
wp user meta get 2 magic_sig_public_key  > ada.public.pem
```

Either export is accepted, and either PEM encoding — `-----BEGIN PRIVATE
KEY-----` (PKCS#8) or `-----BEGIN RSA PRIVATE KEY-----` (PKCS#1). Treat the
files the way you would treat a password: the private key is the account.

**Running it twice changes nothing**, and says so, which is what makes it safe
to run again after an instance that was down comes back — a follower already in
the file keeps its place and its follow time. A follower whose server will not
answer is listed and skipped rather than failing the import. A user who already
has a _different_ key pair is refused: importing over one would change that
person's identity, and every follower has cached the public half of the key
that is there. `--force` is the way past that, and is only right when you are
certain the pair being imported is the one the followers hold.

#### The cutover, end to end

1. **Export, while the WordPress site is still up.** The key pair, as above.
   The followers can be saved too — `curl -H 'Accept: application/activity+json'
'https://example.com/wp-json/activitypub/1.0/actors/2/followers?page=1' >
followers.json` — which is worth doing if the old site is going away before
   the import runs. Note the actor id and the numeric actor id off
   `https://example.com/?author=2`, and bring the content across.
2. **Import.** `geekity import wordpress-actor ada --actor-id … --wordpress-id
… --keypair ada.keypair.json`, pointing `--followers` at the saved file if
   you took one. Check the report: every follower should be added, and any that
   were skipped should be re-run once their servers answer.
3. **Switch on.** Turn **WordPress ActivityPub compatibility** on under
   `/admin/federation/settings`, then move the DNS. Followers' servers go on
   delivering to the plugin's old inbox paths until they next refetch the
   actor, and the switch is what catches those deliveries.
4. **Watch.** `/admin/federation` lists the users with their actor ids and
   followers; `/admin/federation/settings` lists each compatibility path with
   the instant it was last asked for. Deliveries should thin out as each
   follower's server refetches the actor and learns the new endpoints.
5. **Switch off.** Once every path says _Never_ again for long enough — weeks
   rather than days, since a quiet instance refetches rarely — clear the switch.
   The paths go away on the very next request, with nothing restarted, and if
   something was still using them you can turn it back on just as quickly.

Retiring the stored actor id itself is a separate, optional step by the Move
protocol, and is not part of the cutover: not every follower's software honours
a `Move`, and the ones that do not would simply stop following.

### The federation screen

`/admin/federation` is all of that with a page in front of it. It shows one
panel per user — their avatar, their `@username@host` handle, the summary their
profile carries, their actor id, and the followers each of them has with
avatars and follow dates — the recent likes, boosts and replies out of the
inbox log, each linked to the remote object and to the post it was about, and
one row per post that has been federated: who announced it, its last activity,
when it went, and how many recipients it reached, is queued for, or failed
for. Each of those rows has a
Resend button, which is `cms.delivery.resend` behind a form: it builds the post
again from its file, sends it to every follower and every accepted relay the
site has now, and says what came of it.

Which posts are listed is a question for the files — the posts carrying an
`activitypub.published`, the trash included, which is the same thing as the
posts some follower holds a copy of — and how each landed is a question for the outcome
cache. So a site that has just deleted `data/geekity.db` sees every federated
post listed with nothing recorded against it, and can press Resend on any of
them.

A Relays panel sits between the followers and the inbox log: one row per
subscription with its inbox, whether it is waiting, accepted or rejected, when
it last moved, why it was refused if it was, and the last activity delivered
there with how that went. A subscription still waiting has a Retry, which sends
the `Follow` again under a fresh id.

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
site booted on `http://localhost:3000` serves actors whose ids are
`http://localhost:3000/author/{username}/`, and no remote instance can
dereference those:

```sh
GEEKITY_BASE_URL=https://quiet-sun-42.serveo.net geekity serve
```

Then, from a Mastodon account:

1. Search for `@ada@quiet-sun-42.serveo.net` — the handle is a username at the
   tunnel's host. The profile should come back with that user's display name,
   bio and avatar.
2. Follow it. The `Follow` lands on `/author/ada/inbox/` (or on `/inbox/`), the
   CMS answers `Accept`, and the account appears on `/admin/federation` within
   a second or two.
3. Publish a post, from the editor or by writing a file into `content/posts/`.
   A `Create` is delivered, and the post shows up in the follower's
   home timeline; `/admin/federation` records the outcome, with a Resend
   button if it did not land.
4. Edit the post, then set `draft: true` on it, to see the `Update` and the
   `Delete` arrive.

Two things to know before relying on what a tunnel run shows you.

The tunnel address changes every time the command starts, and the followers
gathered under one are throwaway: their instances hold an actor id on a host
that no longer exists, so they cannot be migrated to the real domain. The
admin has no button for removing a follower yet, so run tunnel rehearsals
against a scratch `dataDir` rather than the one the real site will keep.

The key pairs live in `dataDir/keys`, not in the base URL, so they
survive across tunnel sessions. That is usually what you want; it also means a
`data` directory copied from one deployment to another brings the other's
identity with it.

`pnpm fed:smoke`, in this repository, is the automated half of the same idea:
it boots the CMS on a free port, runs `fedify lookup` against a user's actor
and a post object, reads WebFinger, and delivers a `Create(Article)` to two real inboxes over
loopback. It needs no tunnel and no network, and it is a job in CI. See
`packages/cms/scripts/fed-smoke.ts`, whose header explains why the `Follow`
half is sent by a peer built in the script rather than by `fedify inbox`.

[Fedify]: https://fedify.dev/
[`fedify tunnel`]: https://fedify.dev/cli

## Comments

A reader can answer a post on the page, and what they leave joins the same
thread as the fediverse replies rather than sitting in a section of its own.

A comment is a file. `content/_data/comments/{slug}.json` holds one post's
comments — id, source, kind, status, author, the Markdown and the HTML it
rendered to, when it was submitted, a salted hash of the address, and what it
answers — so they are in git beside the posts, an Eleventy build of the same
directory shows them, and the `comments` table is an index emptied and read
back on every boot. The commenter's email is not in that file: it is in
`data/comments/{slug}.json` (mode `0600`), keyed by comment id, because
everything under `content/` is published and goes into git. A site upgrading
from a version that kept the email in the comment file has it moved there on
the next boot, and so does an email somebody types into a comment file by
hand.

Three settings and one front-matter key decide whether a post is still taking
them, and they are read in one place so the form and the endpoint can never
disagree:

| Where                                      | What it says                                                                       |
| ------------------------------------------ | ---------------------------------------------------------------------------------- |
| `comments` in `site.json`                  | Whether the site takes comments at all. On by default; off is off everywhere.      |
| `commentsCloseAfterDays` in `site.json`    | Days after a post's `date` that it closes. `14` by default; `0` never closes.      |
| `comments: true` / `false` in front matter | The post's own answer, which beats both, in both directions. The editor offers it. |
| The document's type                        | A page is closed unless it says otherwise.                                         |

None of it touches the fediverse: a reply, a like or a boost arrives because a
remote server sent it, and a closed post shows every one of them.

A comment is held for a moderator unless the same **name and email** have had
one approved before — WordPress's rule. In front of that are a honeypot field,
a minimum time between the form being rendered and submitted, and a per-address
rate limit. Comments are rendered from Markdown with raw HTML off, images
unembedded and every link marked `rel="nofollow ugc"`.

A site can hand the whole thing to a service:

```ts
export default defineConfig({
  commentChecker: {
    async check(submission) {
      // submission carries the comment, the post's URL, and the commenter's
      // address, user agent and referrer — everything Akismet asks for.
      return 'spam' | 'discard' | 'ham' | 'unknown';
    },
    async reportSpam(report) {}, // a moderator filed something as spam
    async reportHam(report) {}, // …or let something out of the spam list
  },
});
```

A checker that throws is treated as having no opinion and logged, so a service
that is down never stops a site taking comments. `/admin/comments` is the
moderation queue and the dashboard carries the number waiting.

### Being told about one

With mail configured, a comment or a webmention entering the queue emails every
user who has an address and has not switched the notice off on their
`/admin/users/<id>` screen. The message carries the comment, the post it is on,
and three links — approve, spam, delete — that work without a login. Nothing is
sent about a comment Akismet filed as spam or told the site to discard: only
what is actually waiting for a person.

Each link lands on a small page with a button on it, and only the button acts.
That is not politeness. Mail readers, spam filters and corporate link scanners
fetch the URLs in a message as a matter of course, and a link that moderated on
being opened would mean a mail gateway silently deleting this site's comments.
A link is signed rather than stored — the secret is `data/notification-secret`,
so a link goes on working across a `geekity rebuild` — is bound to one action
on one comment, lasts a week, and is spent the first time it is used.

Commenters get the other half. The form offers "email me when somebody replies
to this", but only on a site that can actually send mail; ticking it stores
`notify: true` beside the commenter's address in `data/comments/{slug}.json`, and
nothing about either is ever rendered — not on the page, not in the JSON or
Markdown representations, and not in the comments feeds. When a reply to that
comment is **approved**, one message goes out with the reply in it and an
unsubscribe link at the bottom. Unsubscribing is site-wide by address: the
address goes into `data/comment-optouts.json` and this site writes to it about
replies again. The comments themselves are untouched.

### One message an hour instead of one a comment

Beside each switch on a user's `/admin/users/<id>` screen is how often that
notice should arrive: as they arrive, an hourly digest, or a daily one. It is
per user, and it starts as "as they arrive", so nothing changes for anybody who
does not touch it.

On a digest, a comment entering the queue sends nothing at all. Instead, once a
window has passed, one message goes out listing everything **still waiting**,
each item with its own approve, spam and delete links. A digest is built from
the queue as it stands rather than from a list of things that happened, so an
item somebody moderated in the meantime is simply not in it, and there is no
queue to keep true across a restart. A user with nothing waiting is not written
to at all, and their window does not start until something is: the promise a
mode makes is at most one message per window, and a quiet site sends none.

A very long queue — a spam wave Akismet let through — is listed up to a hundred
items, with the rest counted in a line pointing at `/admin/comments`.

The only thing written down is when each user last had one, in
`data/notification-digests.json`. It is a file rather than a row because
decision-9 lets a site delete the database whenever it is stopped, and a
forgotten timestamp would mean either a window silently skipped or a digest
sent twice. It is its own file rather than a field in `data/users.json` because
that file answers "who may sign in", and a timestamp rewritten every hour is
bookkeeping rather than anything about the person.

Reply notices to commenters are not affected: those are one message about one
reply, and they go when the reply is approved.

With no mail configured, none of this happens and nothing breaks: the box is
not offered, no notice is sent, no digest runs, and the moderation screen is
the notification it was before.

Notices are per user and keyed by event name, so a later one — a new follower,
a digest of failed deliveries — is one entry in the registry in
`src/notifications/preferences.ts` and a checkbox that appears by itself; an
entry that says `batched: true` gets the how-often select beside it too. An
event a user has said nothing about is at its default, which is why turning one
on for a site does not need anybody to visit the users screen.

### Akismet

The one checker the package ships. It is off until a site has a key, and the
key is a credential rather than a setting: it lives in `data/akismet.json` at
mode `0600` beside the password hashes and the users' private keys, never in
`content/_data/site.json`, which is public, in git and published with the site.

Paste it into **Spam checking** on `/admin/settings/discussion`. It is checked with
Akismet's `verify-key` before it is stored, and the panel then reads Connected,
"Akismet does not recognise this key", "Akismet could not be reached", or Not
connected. The key is never printed back — the last four characters are, so it
is possible to tell which key is in there. A **Remove key** button turns Akismet
off again.

The file is read on every call, so a key saved on that screen filters the next
comment and a removed one stops filtering at once. Neither needs a restart.

A `commentChecker` in the config wins outright: the Akismet checker is built
only when the site named none.

Every comment and every incoming webmention that gets past the honeypot, the
form's age and the rate limit goes to `comment-check` with `blog`, `user_ip`,
`user_agent`, `referrer`, `permalink`, `comment_type` (`comment` or
`webmention`), `comment_author`, `comment_author_email`, `comment_author_url`,
`comment_content`, `comment_date_gmt`, `blog_lang`, `blog_charset` and, for a
form submission, `honeypot_field_name`. Fediverse replies are never sent: they
do not reach the checker seam at all.

| Akismet says                              | What happens                                                                                   |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `true`                                    | Filed as spam, where a moderator can still see it and change its mind.                         |
| `true` with `X-akismet-pro-tip: discard`  | Dropped without a queue entry.                                                                 |
| `false`                                   | The site's own rules decide: approved for a name and email approved before, pending otherwise. |
| `invalid`, a non-200, a timeout, no route | The same as `false`, and the failure is logged with whatever Akismet said was wrong.           |

`false` is deliberately not a positive opinion. Nothing Akismet does can lose a
comment: every failure is no opinion, no opinion is the queue, and a call is
abandoned after ten seconds.

Marking something spam or not spam on `/admin/comments` posts `submit-spam` or
`submit-ham` with the same fields, minus `user_ip`, `user_agent` and `referrer`
— a stored comment keeps a salted hash of the address and nothing else.

## Webmentions

The open web's version of what ActivityPub does: one page telling another that
it linked to it. Both directions are on by default and each has a switch on the
Discussion settings page.

| Setting in `site.json` | What it does                                                               |
| ---------------------- | -------------------------------------------------------------------------- |
| `webmentionsSend`      | Tell the external pages a post links to, when it is published or edited.   |
| `webmentionsReceive`   | Advertise the endpoints and accept webmentions and pingbacks sent to them. |

**Sending** runs off the same index changes federation does, so a post saved in
the editor and one edited on disk are one thing, and a full scan sends nothing.
Every external link in the rendered body is asked whether it advertises a
Webmention endpoint — the `Link` header first, then the first `<link>` or `<a>`
with `rel="webmention"` — and told if it does. Both versions of an edited post
are read, so a page that has just been _unlinked_ is told too and can drop what
it was showing. One outcome is recorded per link (`sent`, `none` for a page that
takes none, or `failed`), shown per post on `/admin/federation`, and the Resend
button there sends them again from the file as it now reads.

**Receiving** advertises `/_geekity/webmention` two ways — a `Link` header on
every representation of a document, and a `<link rel="webmention">` in the head
— and takes a form `POST` of `source` and `target`. It answers `202` for
anything worth checking and `400` for anything that is not, and does the looking
afterwards: it fetches the source, checks it really links to the target, reads
its microformats (`h-entry`, `h-card`, and whether it is a reply, a like, a
repost or a plain mention), and files the result as a **pending comment** with
`source: "webmention"` in the same file, the same thread and the same moderation
queue as everything else — through the same `commentChecker` seam, so a checker
can tell one from a form submission by its `source`. Akismet is told it is a
`webmention` rather than a `comment`.

The source URL is its identity. A page that sends its webmention again updates
what it left rather than adding a second, and one whose link has gone — or which
answers 404 or 410 — takes it away. Closing rules do not apply: a post that
stopped taking comments still hears about a page that links to it, exactly as it
still hears a fediverse reply.

**Pingbacks** are how most WordPress sites say they linked here. The same
switch takes them at `/_geekity/pingback`, advertised as an absolute URL in an
`X-Pingback` header and a `<link rel="pingback">` on every post and on every
page that takes comments. A `pingback.ping(source, target)` XML-RPC call goes
through the same check, verification, spam checker and moderation queue as a
webmention and is filed as the same comment, so a link pinged and a link
mentioned are one entry. Because XML-RPC wants an answer, the source is read
before the endpoint replies, and a failure is one of the spec's fault codes:
`0x0010` for a source that does not exist, `0x0011` for one that does not link
here, `0x0020` for a target that does not exist, `0x0021` for a target that
takes no pingbacks, and `0x0030` for a ping sent again, which still rewrites
the entry from the source as it now reads. A body over 16 KB, XML that is not
well formed, and any document type declaration are refused with `-32700`
before anything is resolved. The CMS does not send pingbacks.

### Syndication targets

Some services copy a post when it links to them and sends them a webmention,
and answer with the address of the copy. IndieNews lists posts about the
IndieWeb; Bridgy Publish posts to Mastodon, Bluesky, GitHub and Flickr. The
CMS knows none of them by name. A site lists the ones it uses on the admin's
**Posts > Syndication** screen (`/admin/syndication`), which reads
and writes `content/_data/syndicationTargets.json`. The file stays the source of
truth, so it can still be edited by hand, and it looks like this:

```json
[
  {
    "id": "indienews",
    "name": "IndieNews",
    "url": "https://news.indieweb.org/en",
    "tag": "indienews"
  },
  {
    "id": "mastodon",
    "name": "Mastodon",
    "url": "https://brid.gy/publish/mastodon"
  }
]
```

| Key         | What it is                                                                                    |
| ----------- | --------------------------------------------------------------------------------------------- |
| `id`        | What a post's `syndicate-to` lists. Letters, digits, `.`, `-` and `_`.                        |
| `name`      | What the editor's checkbox and the post's link say.                                           |
| `url`       | The page the post links to and sends its webmention to. May hold `{lang}`.                    |
| `tag`       | Optional. A post carrying this tag is sent to the target without listing it.                  |
| `languages` | Optional. The language tags the target takes posts in. A post in any other language skips it. |

An entry missing any of the first three, repeating an id, or with a `languages`
value that is not a list of language tags, is ignored. It is reported in the log
when the site starts, and the Syndication screen shows it with its problem so it
can be fixed or removed there. No file means no targets.

The screen has a panel for each entry, in file order, and an **Add a target**
form. A save is checked by the same rules the file is read by: a field that
breaks one is marked on the form and the file is left as it was. A save that
passes is written atomically, and the editor's **Syndicate to** checkboxes and
Micropub's `q=syndicate-to` offer the change on the next request. A save or
remove is refused when the entry changed in the file since the page was drawn.
A file that is not a JSON list is shown with its problem and never saved over.
To keep the default theme's old IndieNews link, add a target with the id
`indienews`, the url `https://news.indieweb.org/{lang}` and the tag `indienews`.

Some targets have a page per language. IndieNews has `news.indieweb.org/en`,
`/de`, `/fr` and more. Declare one target and put `{lang}` where the language
goes:

```json
{
  "id": "indienews",
  "name": "IndieNews",
  "url": "https://news.indieweb.org/{lang}",
  "tag": "indienews",
  "languages": ["en", "de", "fr"]
}
```

The CMS fills `{lang}` with the post's language: its `lang` front matter, or the
site's language when the post names none. With `languages`, a post in a
language the list does not name neither links to the target nor notifies it. A
regional tag counts as its language, so a `de-AT` post goes to
`news.indieweb.org/de`, and `{lang}` takes the tag from the list. Without
`languages`, `{lang}` takes the post's own tag as written, region and all.

A post selects targets in one of two ways:

- **By listing them.** The post editor has a **Syndicate to** checkbox for each
  target, and saving writes the ticked ids into the front matter as
  `syndicate-to: [indienews, mastodon]`. An id no target declares is kept as
  written.
- **By its tags.** A post tagged `indienews` is sent to the target whose `tag`
  is `indienews`, as the WordPress IndieNews plugin did.

The default theme links to each selected target at the start of the Published
line, inside the post's `h-entry`, as `<a class="u-syndication"
href="https://news.indieweb.org/en">IndieNews</a>`. That link is what IndieNews
and Bridgy Publish check for when they fetch the post. When the post is
published or updated, the sender adds each selected target to the pages it
notifies, the same way it adds the post a reply answers. Nothing is sent while a
page is served.

A target that answers `201` or `202` with a `Location` header has made a copy.
The address is kept in `content/_data/syndication.json`, keyed by the post's
permalink (decision-26), and the theme prints it after the dates as **Also on**
with a `u-syndication` link. A copy made by hand goes in the post's own front
matter, and is printed the same way:

```yaml
syndication:
  - https://mastodon.social/@me/113000000000000000
```

Removing a target from `syndicate-to`, or removing its tag, removes the link.
The sender then tells the target, as it tells any page a post stops linking to,
and the copy is dropped from `syndication.json`. IndieNews takes the post down
when it finds the link gone. Drafting or trashing the post does the same.

The posts table on `/admin/federation` lists each selected target with how its
last webmention went and a link to its copy, and **Resend** sends to the targets
again.

## Email

The CMS sends its mail through one service and one seam. Everything that will
ever email — the Send test email button, and the password resets, moderation
notices and contact messages built on it — calls `cms.mail.send()`, and what
carries the message is decided in one place.

**A site with no mail configuration still works.** `send` writes a line in the
log saying the message was not sent and resolves successfully, so nothing that
emails is a feature that breaks without a mail account.

### Configuring it

Two halves, kept apart for the reason the Akismet key is kept out of
`site.json`:

| Where                     | What                                                                              |
| ------------------------- | --------------------------------------------------------------------------------- |
| `content/_data/site.json` | `mailProvider`, `mailFromName`, `mailFromAddress`, `mailReplyTo`, `contactEmail`. |
| `data/mail.json`          | The Brevo API key, and the SMTP host, port, TLS flag, user and password.          |

`site.json` is public, in git and published with the site; `data/mail.json` is
private, mode `0600`, and sits beside the password hashes and the users'
private keys. No key or password is ever written to `site.json` and none is
ever printed back into the settings screen — the panel shows the last four
characters of an API key and the host and user of an SMTP connection, which is
enough to tell what is stored and not enough to use it. Leaving a secret field
blank keeps the one already stored, so the SMTP port can be corrected without
retyping the password. **Remove credentials** forgets both.

The panel draws the boxes of the provider that is saved and no others: an API
key on a Brevo site, a host, port, TLS flag, user and password on an SMTP one,
and nothing at all on a site sending through neither. It follows what is in
`site.json` rather than what the Provider select above it is showing, so
choosing a different provider there takes a **Save settings** before its boxes
appear — the panel says as much. A credential stored for the provider that is
not the chosen one still gets a line of its own, because it is still on disk
and **Remove credentials** is still what forgets it.

Both files are read on every send, so a credential pasted into the settings
screen sends the next message and one removed stops the message after it.
Neither needs a restart.

`mailFromAddress` should be an address the provider has verified; empty falls
back to `no-reply@` at the site's host, which most providers will refuse.

### The two providers

| `mailProvider` | What it is                                                                            |
| -------------- | ------------------------------------------------------------------------------------- |
| `none`         | Nothing is sent. The default.                                                         |
| `brevo`        | `POST https://api.brevo.com/v3/smtp/email` with an `api-key` header. No open sockets. |
| `smtp`         | Any SMTP server, through nodemailer — including Brevo's own relay.                    |

### Send test email

The Email settings page has an address field and a button that sends the `test`
message through the whole chain — the template, the From line, the provider and
the retry — and reports what came back, the provider's own words and its
message id included. It is the one thing that proves mail works before somebody
needs it to.

It is on the page only where the site can actually send — a provider chosen and
its credential stored. Without one the only thing the button could report is
that it did nothing.

### Queue, retries and the log

Messages go on one queue and are sent one at a time, so a provider that hangs
delays the next message and nothing else. A refused message is tried three
times, waiting two seconds, then eight; every attempt is logged with its
outcome and, when it went, the provider's message id, so a message somebody
never received can be traced to the attempt that carried it. `send` never
throws — a failure is a result with `ok: false` and the provider's own words in
`error`.

### Messages

Messages are Nunjucks templates under `mail/` in the theme, resolved the way
every other template is: the theme the site has chosen first, the packaged theme
second, file by file. Each is up to three files — `mail/<name>.subject.njk`,
`mail/<name>.txt.njk` (required) and `mail/<name>.html.njk` — so a site can
replace the text of a message and keep the subject the package ships, or add a
message the package never had. The full table is in
[`themes/default/README.md`](./themes/default/README.md).

### From an entry file, and from a test

```ts
const result = await cms.mail.send({
  to: 'ada@example.com',
  template: 'test',
  data: { name: 'Ada' },
});
result.ok; // true, whether it went or the site sends no mail
result.skipped; // true when the site sends no mail
```

`sendRaw({ to, subject, text, html })` is the same thing for a message the
caller built itself. Both resolve when the message has been sent, given up on
or skipped; a caller that does not care drops the promise with `void`.

A test names a provider in the config and reads back what would have gone out.
It wins outright over the settings and `data/mail.json`, the way a
`commentChecker` wins over the Akismet key:

```ts
import { createCms, createMemoryMailProvider } from '@geekity/cms';

const provider = createMemoryMailProvider();
const cms = createCms({
  mail: { provider, backoffMs: () => 0 },
});

// …
provider.sent[0].subject;
provider.failNext(2); // watch the retry without waiting for it
```

`mail` also takes `attempts`, `backoffMs` and `logger`, which is how a test
proves the retry without spending ten seconds on it.

## The archive page

A page carrying `archive: true` in its front matter lists every published post
under its own words, grouped by the month it was published in, newest month
first and newest post first inside a month. Nothing paginates it: an archive
page is a way of finding one piece of writing rather than a listing to read
through. Drafts and posts whose date has not arrived are absent, as they are
everywhere else.

The default theme draws it from `partials/archive.njk`, and the CMS hands the
layout `archiveMonths` — `{ month, posts }` per month, the month already read
through the site's `timezone` so the heading and the dates agree. Eleventy
ignores the key, and a static build of the same directory publishes the page as
an ordinary page.

## The contact form

A page carrying `contact: true` in its front matter renders a contact form
under its content — name, email, subject, message. The editor offers it as a
**Contact form** checkbox on the pages editor, and the key is honoured wherever
it is written, so a theme that includes `partials/contact-form.njk` in its post
layout gets one there too.

It works with JavaScript switched off, and there is no script on it. The form
posts to `/_geekity/contact`, and a message that is stored redirects back to
the page with `?contact=sent`, which draws a thank-you where the form was — so
a refresh sends nothing twice.

**Where the message goes never appears in the HTML.** The contact address is
read when a submission arrives; it is not on any render context, so no theme
can print it and no form carries it.

### Where a message goes

| Where                               | What                                                                        |
| ----------------------------------- | --------------------------------------------------------------------------- |
| `data/contact/<id>.json`, mode 0600 | Every message, written **before** anything is emailed.                      |
| The `contactEmail` setting          | Where the `contact-message` email is sent, reply-to the sender.             |
| `/admin/messages`                   | The inbox: read, mark read, delete. The dashboard carries the unread count. |

`contactEmail` is on the Settings screen under Email. Empty falls back to the
first admin with an email address, by username, so a fresh site with a mail
credential takes messages without anybody visiting the field.

The file is written first and the mail goes out behind the redirect, which is
the whole point of the design: a provider that is down, a key that has expired
or an address that bounces costs a notification rather than the message. **With
no mail configured at all, submissions are still stored and still shown on the
Messages screen** — it is the notification, exactly as `/admin/comments` was
before there was any email.

Messages live under `data/` rather than `content/` because they carry the
sender's address and were never meant to be published, and there is no SQLite
index over them: the screen reads the directory to sort it anyway, and a second
copy of the truth would only be a second thing to keep true. One JSON file per
message, named by an id that begins with the instant it arrived, so `ls` is the
inbox in order. Deleting a message on the screen deletes its file.

### What is in a message file

```json
{
  "id": "20260920T120000000Z-1a2b3c4d",
  "received": "2026-09-20T12:00:00.000Z",
  "status": "received",
  "read": false,
  "page": { "slug": "contact", "permalink": "/contact/", "title": "Say hello" },
  "from": { "name": "Ada Lovelace", "email": "ada@example.com" },
  "subject": "About the analytical engine",
  "message": "It is a lovely machine. Please write back.",
  "addressHash": "9f2c…"
}
```

`addressHash` is the same salted hash a comment keeps — the salt is
`data/comment-salt` — so a run of submissions from one machine is visible
across both without a reader's address being written down.

### The defences in front of it

The same four a comment goes through, out of the same modules, so the two
public forms cannot drift into different rules:

| Defence             | What it refuses                                                                                                   |
| ------------------- | ----------------------------------------------------------------------------------------------------------------- |
| The honeypot        | A hidden field a person never fills in. A submission that filled it gets the thank-you and is dropped in silence. |
| The form's age      | Submitted under three seconds after the page loaded, or from a form rendered more than a day ago.                 |
| The rate limit      | Five messages per address per ten minutes, on the same limiter the login form uses. The sixth is a 429.           |
| The comment checker | The `commentChecker` seam, told `comment_type: contact-form`. With an Akismet key stored, that is Akismet.        |

A checker's `discard` stores nothing at all. Its `spam` **stores the message**,
on the Spam list of the Messages screen, and does not email it: a false
positive on a contact form is somebody's message vanishing, which is a worse
failure than a spam list to glance at. A checker that is down or throwing is no
opinion, and the message is stored as it would have been before anybody had
one.

## Personal data

This is every piece of personal data the CMS stores, where it is, and how long
it stays. "Kept" means until somebody deletes it, unless a retention period
says otherwise.

| What                                                                                                                   | Where                                                         | How long                                                                                                             |
| ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| A commenter's name, website and words                                                                                  | `content/_data/comments/{slug}.json`, public and in git       | Kept. Erasing on request replaces the name and drops the website.                                                    |
| A commenter's email, and whether they asked to be told about replies                                                   | `data/comments/{slug}.json`, mode `0600`, keyed by comment id | `commentEmailRetentionDays`: forever unless set, 180 on a new site.                                                  |
| A salted hash of the address a comment, webmention or contact message came from (the address itself is never stored)   | The comment file, or the contact message file                 | `addressHashRetentionDays`: forever unless set, 30 on a new site.                                                    |
| A webmention's author name, website, avatar URL and the source page's words                                            | `content/_data/comments/{slug}.json`                          | Kept, as a copy of a page that is public already.                                                                    |
| A contact message: the sender's name, email, subject and message                                                       | `data/contact/{id}.json`, mode `0600`                         | `contactMessageRetentionDays`: forever unless set, 365 on a new site.                                                |
| The addresses that unsubscribed from reply notices                                                                     | `data/comment-optouts.json`, mode `0600`                      | Kept, so the site goes on not writing to them. Erasing on request removes one.                                       |
| Followers: actor id, handle, display name, avatar URL, profile URL                                                     | `content/_data/federation/{username}/followers.json`, in git  | Until they unfollow.                                                                                                 |
| Inbound likes, boosts, replies and quotes, with the actor who sent them                                                | `content/_data/federation/inbox/{yyyy}-{mm}.jsonl`, in git    | Kept.                                                                                                                |
| What a reply shows of the post it answers: its title, words and author                                                 | `content/_data/replyContexts.json`, in git                    | Kept.                                                                                                                |
| Other actors who liked, boosted, answered or quoted: handle, display name, avatar URL, profile URL                     | `data/geekity.db`, fetched from their actor document          | A cache. Refetched weekly while the inbox log names them.                                                            |
| Remote avatars, shrunk                                                                                                 | `data/avatars/`                                               | Deleted by the avatar sweep once nothing shown names them.                                                           |
| Users: username, email, argon2id password hash, profile                                                                | `data/users.json`, mode `0600`                                | Until the user is deleted.                                                                                           |
| The apps a user signed in to with IndieAuth: app, scopes, hashes of its tokens, when they expire                       | `data/indieauth-tokens.json`, mode `0600`                     | Until the user is deleted, or 60 days after the app last refreshed.                                                  |
| Recent IndieAuth and Micropub requests: app, username, what it sent (no secrets, values cut short), the answer         | `data/indieauth-activity.json`, mode `0600`                   | The last 100 requests, none older than 14 days.                                                                      |
| An index of all of the above, and sessions, reset tokens and spent link tokens                                         | `data/geekity.db`                                             | A cache of the files. Sessions and tokens are pruned when they expire.                                               |
| Client addresses in the rate limits                                                                                    | Memory                                                        | Until the window passes or the site restarts.                                                                        |
| Where and when a photo or video was taken, and the camera or phone (EXIF, XMP, IPTC, a video's `©xyz`)                 | Removed from `content/uploads/` on upload                     | Never stored. Older uploads keep it until `geekity strip-metadata`; git history keeps the old bytes until rewritten. |
| Where the author wrote a post or checked in: coordinates, accuracy, and the place's name, locality, region and country | `data/locations.json`, mode `0600`, keyed by permalink        | Kept until the author clears it. Published only as far as **Settings > Privacy** allows, nothing by default.         |
| Micropub properties a post was sent that the site does not understand, such as an RSVP                                 | `data/kept-properties.json`, mode `0600`, keyed by permalink  | Kept until an update deletes them. Never published.                                                                  |
| Client addresses in the access log                                                                                     | stdout, and whatever collects it                              | Only with `accessLogAddress` on. The collector keeps them.                                                           |

Two services outside the site see personal data when a site turns them on.
Akismet is sent a commenter's or sender's address, user agent, referrer, name,
email, website and words. The mail provider is sent every address a message
goes to.

### The starter privacy page

`geekity init` writes `content/pages/privacy.md`, served at `/privacy/` and
linked from the footer by a `Privacy | /privacy/` line in `menus.footer`. It
says in plain language what the table above says, marks the contact form,
reply emails and Akismet as optional, and quotes the retention periods a new
site starts with. It is a starting point written from what the software does,
not legal advice, and a note at its top says so to the owner: review it, add
whatever the site does beyond the CMS (analytics, a host's logs, a theme that
loads fonts from elsewhere), change the numbers when a retention period
changes, and remove the menu line if the page is deleted.

The link is a menu line rather than something the theme prints, because the
footer prints `menus.footer` and nothing of its own (TASK-105). A site that
upgrades gets no page and no link; it can copy the file from
`templates/site/content/pages/privacy.md` in the package.

### Retention

Three settings in `content/_data/site.json`, on **Settings > Discussion**,
decide how long the site keeps what readers hand it. Each counts whole days from
when the data arrived, and `0` keeps it forever:

| Setting                       | Recommended | What goes when it runs out                                        |
| ----------------------------- | ----------- | ----------------------------------------------------------------- |
| `commentEmailRetentionDays`   | `180`       | The email on a comment, and with it the reply subscription.       |
| `addressHashRetentionDays`    | `30`        | The address hash on a comment, a webmention or a contact message. |
| `contactMessageRetentionDays` | `365`       | The whole contact message.                                        |

**A site keeps everything until its owner sets a period.** A `site.json`
without these keys reads as `0` for all three, so an existing site that
upgrades loses nothing, and the Discussion screen says "Kept forever" beside
each one. A new site from `geekity init` starts with the recommended periods
written into its `site.json`. An existing site opts in by typing them on
Settings > Discussion and saving once.

They are settings rather than config because how long a site keeps people's
data is the owner's decision, and a privacy notice quotes it; `site.json` is
public, which suits a policy. The recommended periods are long enough for a
reply notice to arrive, a run of spam to be spotted and a year of
correspondence to be answered, and no longer. The first sweep after a site
sets a period removes whatever is already past it.

A sweep runs when the site starts serving and every six hours after that, and
`cms.retention.sweep()` runs one now. It reads the files rather than the index,
rewrites each comment file and message inside the same lock every other writer
takes, and puts each changed comment back into the index in the same step. A
second sweep finds nothing left to remove and writes nothing.

A comment that loses its email keeps its id, its place in the thread, its
status, its words and its name. It gains `"redacted": ["email"]`, which is how
the index tells an email removed from one never given: a name whose email was
removed does not count toward auto-approval, so nobody can type that name and
skip the queue. Its author is no longer told about replies, and their next
comment waits for a moderator. A moderation link in an inbox names the comment
by id, so it goes on working.

The sweep changes the files as they are now. The emails are in `data/`, which
is not in git, so removing one removes it. Emails from before they moved out of
the comment files (TASK-182) were committed with those files, and they stay in
the repository's history until that history is rewritten, whatever the sweep or
an erasure does to the files today.

### Erasing one person's data

**Tools > Personal data** erases what the site holds for one email address.
It shows what it found first: how many comments carry the address, how many
contact messages came from it, and whether it is on the opt-out list. Erasing
then signs each of those comments `Anonymous`, removes its email, website,
avatar and address hash, and marks it `"redacted": ["email", "addressHash",
"author"]`; the comment keeps its place in the thread, its status and its words.
The contact messages are deleted and the address comes off the opt-out list.

A comment is found by its email, so one whose email the sweep has already
removed, a webmention and a fediverse reply are not found there. The Comments
screen deletes those one at a time.

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

## Dates and the timezone setting

Every date the CMS writes into a file — `date`, `updated` and
`activitypub.published` — is a UTC instant ending in `Z`. The `timezone`
setting is not stored with the date; it is the lens the instant is read
through.

That means one rule in three places:

- **The editor** shows a stored instant as the clock reads in the site's zone,
  with the zone named under the field (`Wall-clock time in America/Chicago
(CDT). Stored as UTC.`), and reads what you type back in the same zone. Type
  `2026-09-04 09:00` in a site set to `America/Chicago` and the file gets
  `date: '2026-09-04T14:00:00Z'`. A value you write with an offset of its own —
  `2026-09-04T09:00:00+02:00` — already names an instant, so it is kept as one.
- **The theme's `date` filter** renders `readable`, `html` and `year` in the
  site's zone; `iso` stays the instant, because that is what a `<time
datetime>` and a feed want. Changing the setting changes what every page
  shows on the very next request, with no file touched and no rebuild.
- **A new post's filename day and its `/{yyyy}/{mm}/` permalink** come from the
  calendar day the site's zone was on at that instant, so a post published at
  half past midnight on 1 October in Berlin is filed under October and not
  under the 30 September that UTC was still on.

Changing the setting later never moves a URL. The permalink is written
explicitly into every file the CMS saves, and the day a post is filed under is
the one in its filename — decided once, when it was written, where no setting
can reach it.

Files written by hand keep working. A `date` with an offset, or one YAML parses
into a timestamp by itself, is read for the instant it names, sorts and
schedules by that instant, and is rewritten as UTC the next time the CMS saves
that file — never by a mere scan. A hand-written file with no `permalink` still
resolves to the URL Eleventy gives it, which is cut from the date as the file
spells it.

Feeds, the sitemap and the ActivityStreams objects emit instants and are
unaffected by the setting, and a scheduled post fires at its instant whatever
the zone is set to.

## Scheduling

A post whose `date` is in the future is written now and published then, the way
WordPress schedules one. Save it with Publish; the editor answers `Scheduled:
{title}` and says when it goes out, in the site's `timezone` setting.

Until that moment the post is not public in any sense: it is off the home page,
off every archive, out of all three feeds and out of the ActivityPub outbox,
its permalink 404s in every representation, and no follower has been told about
it. When the moment comes the running server publishes it — no restart, no
build — and the same delivery that a live publish runs sends the
`Create` and pings the notify server.

There is no `scheduled` key and no state to keep: a scheduled post is an
ordinary published one whose date has not arrived, which is a question asked of
the clock on every query. So moving the date moves the publication, ticking
Draft cancels it, and a date pushed into the future withdraws a post that was
already out — with a `Delete` to the followers, exactly as drafting it would.

A post whose date passed while the server was down is public the moment the
next boot has scanned, and is federated once on that boot. The CMS remembers
how far through the calendar it has got, so a restart never announces the same
post twice and a deleted database never announces the archive.

The admin lists scheduled posts under their own Scheduled filter, with a
Scheduled status beside them. The public permalink 404s for a signed-in admin
too: the public site has no session, deliberately — every response it gives is
cacheable, and a URL that answered differently for one viewer would be cached
and served to the rest. Use the editor's Preview button, which renders the post
through the theme's own layout at an admin URL.

## Unlisted posts

An unlisted post is published at its URL and left off every list. Choose
Unlisted in the editor's Visibility field, send `visibility=unlisted` from a
Micropub app, or write it into the front matter:

```yaml
visibility: unlisted
```

Public is the key's absence, and the editor removes the key when you choose
Public again. The site has no private posts. A value other than `public` or
`unlisted`, such as a hand-typed `visibility: private`, hides the post the way
`draft: true` does: its URL answers 404 to anybody not signed in, it is on no
list, and a post the followers already hold is withdrawn with a `Delete`. The
editor shows the value as it is stored, marks the post Hidden in the list, and
keeps the value through a save until you choose Public or Unlisted.

The rule works for pages too.

| Where                                                                      | An unlisted post                                                                                                                             |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Its permalink, in every representation                                     | 200, with `X-Robots-Tag: noindex`. The default theme also prints `<meta name="robots" content="noindex">`.                                   |
| The home page, tag, category and author archives, the `archive: true` page | Absent, and not counted in a pager or a tag count.                                                                                           |
| Previous and next links under other posts, the front page's recent posts   | Absent.                                                                                                                                      |
| Every RSS, Atom and JSON feed, and the site-wide comments feed             | Absent. Saving one pings no notify server.                                                                                                   |
| The sitemap, search (HTML and JSON) and `llms.txt`                         | Absent.                                                                                                                                      |
| IndexNow                                                                   | Not submitted. A public post that becomes unlisted is submitted once, so a search engine reads the `noindex`.                                |
| The ActivityPub outbox and featured collection                             | Absent.                                                                                                                                      |
| Followers                                                                  | Get the `Create` and every `Update`, addressed `to` the followers with Public in `cc`, which Mastodon shows as unlisted. Relays get nothing. |
| Webmentions                                                                | Sent as for any post: the page is public.                                                                                                    |

Changing a published post between public and unlisted sends its followers an
`Update` with the new addressing.

In code, `isServed(document)` says whether the site serves a document at its
URL and `isListed(document)` whether it also lists it. The index answers the
same two rules in SQL. An Eleventy build with the example config reads the key
too: an unlisted post gets its page, `noindex`, and no place in any collection,
and an unrecognized value builds no page. See
[Building the same content with Eleventy](#building-the-same-content-with-eleventy).

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
site's theme may override any public template, and must not be able to
shadow the login form.

| Route                                            | What it does                                                                                  |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| `/admin`                                         | The dashboard: counts, the five most recent posts, the follower count.                        |
| `/admin/posts`, `/admin/pages`                   | The listings and the editors.                                                                 |
| `/admin/tags`, `/admin/categories`               | Every term in use, with rename, merge and delete.                                             |
| `/admin/tags/rename`, `/admin/categories/rename` | `POST` only. Renames a term, or merges it into one that exists.                               |
| `/admin/tags/delete`, `/admin/categories/delete` | `POST` only. Takes a term out of every file.                                                  |
| `/admin/navigation`                              | Navigation > Menus: every menu the site holds. `POST` saves one menu's items.                 |
| `/admin/navigation/add`                          | `POST` only. Adds an empty menu under the name the form gives.                                |
| `/admin/navigation/delete`                       | `POST` only. Deletes one menu the active theme renders nowhere.                               |
| `/admin/media`                                   | Everything under `content/uploads`, with the URL, the Markdown and what uses it.              |
| `/admin/media/upload`                            | `POST` only. Stores one file by the rules the editor's upload enforces.                       |
| `/admin/media/delete`                            | `POST` only. Deletes one upload, asking first when a document points at it.                   |
| `/admin/media/alt`                               | `POST` only. Sets a picture's alt text, or marks it decorative, in `media.json`.              |
| `/admin/comments`                                | Pending, approved and spam, with approve, spam, delete and reply.                             |
| `/admin/comments/moderate`                       | `POST` only. Approves one comment, files it as spam, or deletes it.                           |
| `/admin/comments/reply`                          | `POST` only. Posts an approved reply under the comment it answers.                            |
| `/admin/messages`                                | The contact form's inbox, with a Spam list beside it.                                         |
| `/admin/messages/read`                           | `POST` only. Marks one message read, or unread again.                                         |
| `/admin/messages/delete`                         | `POST` only. Deletes one message, and its file with it.                                       |
| `/admin/appearance/themes`                       | Appearance > Themes: the themes on disk. `POST` activates the one named.                      |
| `/admin/tools`                                   | Tools > Content index: what the index holds, and the button that rebuilds it.                 |
| `/admin/tools/rebuild-index`                     | `POST` only. Offers the rebuild, then reads every file again on the live site.                |
| `/admin/settings`                                | Settings > General: title, tagline, author, base URL, time zone, language, locale, site icon. |
| `/admin/settings/reading`                        | What the homepage displays, posts per page, the notify server.                                |
| `/admin/settings/permalinks`                     | The tag and category bases, and the archive redirects already recorded.                       |
| `/admin/settings/discussion`                     | Comments and the closing window, webmentions, and the Akismet key.                            |
| `/admin/settings/akismet`                        | `POST` only. Saves the Akismet key, or forgets it.                                            |
| `/admin/settings/email`                          | The mail provider, the From line, the reply-to and the contact address.                       |
| `/admin/settings/mail`                           | `POST` only. Saves a mail credential, or forgets every one of them.                           |
| `/admin/settings/mail/test`                      | `POST` only. Sends the theme's test message through the whole chain.                          |
| `/admin/users`                                   | Who may sign in: a row each, with Edit and Delete. Nothing on it edits anybody.               |
| `/admin/users/new`                               | Users > Add new: the add form. `POST` adds one.                                               |
| `/admin/users/<id>`                              | One user: the account, the profile, the notices, your password, and the delete.               |
| `/admin/users/password`                          | `POST` only. Changes the signed-in admin's own password.                                      |
| `/admin/users/email`                             | `POST` only. Sets or clears the email address on the user the form names.                     |
| `/admin/users/profile`                           | `POST` only. Saves the whole public profile of the user the form names.                       |
| `/admin/users/notifications`                     | `POST` only. Turns one notice on or off for the user the form names.                          |
| `/admin/users/notifications/mode`                | `POST` only. Sets how often that notice arrives: as they arrive, hourly or daily.             |
| `/admin/users/delete`                            | `POST` only. Deletes the user the form names.                                                 |
| `/admin/federation`                              | The actors, their followers, the inbox log, and per-post delivery.                            |
| `/admin/federation/settings`                     | Federation > Settings: the relays the site subscribes to, and the WordPress switch.           |
| `/admin/federation/resend`                       | `POST` only. Sends one post to the followers again, as its file now reads.                    |
| `/admin/setup`                                   | First run: creates the first admin. Closed once a user exists.                                |
| `/admin/login`                                   | Username and password.                                                                        |
| `/admin/logout`                                  | `POST` only. Deletes the session row and sends `Clear-Site-Data`.                             |
| `/admin/_static/*`                               | The admin's own stylesheet and scripts, cached for an hour.                                   |

The screens behind the login share one layout: a bar across the top with the
site name and a link to the public site, the menu down the left, and a place for
flash messages. A message queued with `flash(c, 'notice', '…')` is kept on the
session row, shown on the next page the browser asks for, and cleared as it is
read, so it survives exactly one redirect.

### The admin's look

The admin is drawn in DaisyUI 5 on Tailwind v4 (decision-30). Its stylesheet,
`admin/static/admin.css`, is compiled at build time from `admin/src/admin.css`
and ships in the package like the default theme's. It carries every built-in
DaisyUI theme, with `light` as the default and `dark` when the system prefers
dark. A site cannot override it or add a theme of its own.

The admin bar is the same component on the admin and across the top of every
public page a signed-in user reads: a `<geekity-admin-bar>` element holding a
declarative shadow root, so neither the site theme nor the admin's theme
reaches inside it. It draws in a light or a dark palette of its own, following
the user's admin theme. On a public page it pushes the page down by
`--geekity-admin-bar-height` and adds the `geekity-admin-bar` class to
`<html>` for a theme that needs to make room of its own.

Each user picks the theme the admin is drawn in for themselves, on their own
screen under Users: any built-in DaisyUI theme, or Follow the system. The
choice is stored as `adminTheme` on the user in `data/users.json`, and every
admin page drawn for that user carries it as `data-theme` on `<html>`. Following
the system stores nothing and puts no `data-theme` on the page. The login,
setup, forgot-password and reset screens never carry one.

### The menu

The menu is WordPress classic: twelve sections — Dashboard, Posts, Pages,
Navigation, Media, Comments, Messages, Appearance, Users, Tools, Settings,
Federation — each a heading over one or more children. Clicking a heading opens the section and lands on its first
child; the open section shows its children and the one you are on carries
`aria-current="page"`, so Users tells you that you are on Users > All users.
Tags and categories are children of Posts, because a tag with no post on it is
nothing. Every section has at least one child even when it has one screen, so
the rule never needs an exception and a second child can appear later without
the menu changing shape. There is no JavaScript in it: the server knows which
section is open, so expanding one is a page rather than a script.

The whole menu is `ADMIN_SECTIONS` in `src/admin/menu.ts`. A site's own screen
joins it in two steps:

```ts
// 1. One entry in the section's children, naming the screen and its URL.
{ child: 'imports', label: 'Imports', url: '/admin/imports' }

// 2. The same pair on whatever that screen renders.
render(c, 'layouts/imports.njk', { section: 'posts', child: 'imports' });
```

Nothing else changes: the heading, the landing URL and the marking all follow.
A screen naming a section or a child the registry does not hold throws
`UnknownAdminScreenError` rather than rendering a menu expanded around nothing,
so the mistake is a failed test instead of a menu that quietly marks nothing.

Who may sign in is `data/users.json`: one entry per user with an id, a
username, an argon2 hash and a created time — and, for a user who has them, an
email address, notification preferences, a public profile and the
[stored actor id](#a-users-stored-actor-id) they were published under
elsewhere. Written atomically with `0600` permissions and serialised against
itself, so two admins adding the same name at once cannot both succeed. It is in `data/` rather than `content/` because
`content/` is published with the site, and it is one of the files under
`dataDir` that must be backed up.

Sessions stay in SQLite, where the rest of the cache lives. They name a user by
id and are joined against the file on every admin request, so a session whose
user is no longer there is not a login: deleting `data/geekity.db` signs
everybody out and loses nothing else, and restoring an old one cannot bring
back an account that was deleted or a password that was changed.

Passwords are hashed with argon2id through `node:crypto`, so there is no native
module to build. The cost parameters travel with each hash, which means raising
them later leaves every password already stored verifiable.

A session id is 256 random bits in a `HttpOnly; SameSite=Lax; Path=/` cookie.
When `baseUrl` is an `https` URL the cookie is `Secure` and named
`__Host-geekity_session`; over plain http it is `geekity_session`, as
[Session hardening](#session-hardening) explains. It lasts `sessionLifetime`;
an expired session is deleted rather than merely ignored. Every mutating admin
form carries a per-session CSRF token, and a `POST` without a valid one is
refused with 403 — including the login and setup forms,
which get the token from a short anonymous session created when the form is
first rendered. Logging in throws that session away and starts a new one, so a
planted session id cannot become a logged-in one.

The first admin comes from `/admin/setup` or from
[`geekity user add`](#creating-an-admin-from-the-command-line). Every one after
that comes from `/admin/users`, which lists who may sign in and adds a user
with a password you supply or one it generates and shows once. The list is a
listing and nothing more: a username with the archive URL under it, the email
address, when the account was made, and Edit and Delete. Every field lives on
that person's own screen at `/admin/users/<id>`, where each box has a label
beside it — the account and its email address, the public profile, what this
person is emailed about, your own password on your own page, and the delete or
the sentence saying why this account cannot go. Each Save lands back on that
screen, so it shows its own result. The last remaining user cannot be deleted,
and nobody may delete their own account.

An email address is optional on a user and can be set on anybody's screen,
since with one role every user already has every power there is. It buys
[password recovery](#forgotten-passwords) and the notices
[a comment sets off](#being-told-about-one), and it never appears on the public
site. Beside it is which of those notices go to it: one switch per event, on by
default, stored in `data/users.json` only when somebody turns one off.

A site whose database was written by a version that kept the accounts in a
`users` table has those rows written into `data/users.json` on the first boot
of this one — ids and hashes as they stand, so nobody has to log in again — and
the table is dropped. A `users.json` that is already there wins and is left
alone.

Creating one from your own code, which is what the CLI does:

```ts
import { createUser } from '@geekity/cms';

await createUser({
  dataDir: 'data',
  username: 'ada',
  password: process.env.PASSWORD ?? '',
});
```

### Settings

`content/_data/site.json` is the source of truth for a site's settings. The
pages under `/admin/settings` — General, Reading, Permalinks, Discussion and
Email — each read that file, validate what was typed and write it back; nothing
else remembers a setting, and `data/geekity.db` holds none of them. Federation's
page is a sixth one of exactly the same kind, filed under its own section at
`/admin/federation/settings` rather than under Settings, because the relays and
the compatibility switch are about the section that holds the followers.

Each page saves its own fields and no others, onto the file as re-read inside
the write, so two people saving two different pages at the same moment both
land, and each page validates only what it shows: a refused save comes back on
the page it was sent from and writes nothing at all.

The write is atomic and serialised: the bytes go to a temporary file beside the
real one and are renamed over it, and the read of what the file already held
and the write of what it says next are one step nothing else writing that file
can get between. So a reader — an Eleventy build, the CMS's own site data
source, another process entirely — always sees one whole version, and two saves
at once cannot each keep half of what the other kept.

The file carries `title`, `tagline`, `url`, `author` (a username, when the
site has one author), `postsPerPage`, `homepage`, `postsPage`,
`timezone`, `language`, `locale` (when it is set), `icon` (when it is set),
`license` and `licenseName` (when a license is chosen; see below), `tagBase`,
`categoryBase`, `notifyServer`, `feedUpdatePeriod`, `feedUpdateFrequency`,
`webmentionsSend`, `webmentionsReceive`,
`mailProvider`, `mailFromName`, `mailFromAddress`, `mailReplyTo`,
`contactEmail`, `securityContacts`, `securityPolicy`, `securityLanguages`,
`relays`, `menus` and `taxonomyRedirects`,
and every other key it already had is kept, `feedSize` and anything a site put
there included. A key it does not carry is the default, and a key of the wrong
type is the default too: a hand-edited `site.json` cannot take the site down.

`homepage`, `postsPage` and `wordpressActivityPub` are the only three written
just when they have a value. The first two are WordPress's Reading choice, the
slug of the page served at `/` and the slug of the page whose own URL carries
the post listing, absent altogether on a site that shows its latest posts at
`/`; the third is the
[WordPress ActivityPub compatibility](#wordpress-activitypub-compatibility)
switch, absent until somebody turns it on and absent again when they turn it
off. A `postsPage` without a `homepage` is
ignored, the listing being at `/` already, and a slug naming no published page
is a site back on its latest posts. See [The front page](#the-front-page).

Because it is the source rather than a copy, editing it by hand while the
server runs is picked up on the next request — on the public site, in the
feeds and on the settings screen alike — with nothing
to restart and nothing to tell. Put the file in git and a checkout of it is the
site's settings.

The one exception is `url`. A base URL decides the absolute URLs in the feeds,
the ActivityStreams ids and whether the session cookie is `Secure`, so
`GEEKITY_BASE_URL` and a `baseUrl` in the config file both win over the file's,
and the General settings page renders the field read-only and says which value
is in effect and why. When neither names one, the file's `url` becomes the base URL
at boot — at boot rather than on save, so an `https` base URL cannot log out
the admin who submitted it over `http`.

Two things on that screen are not settings and are not in that file: the
Akismet key and the mail credential. Both are credentials, both live under
`data/` at mode `0600`, and each is its own pair of forms — save and remove —
so a key typed wrong cannot lose an edit to the title. See
[Akismet](#akismet) and [Email](#email).

A site whose database was written by a version that kept the settings in SQLite
has those rows written into `site.json` on the first boot of this one, and the
table is dropped. If the file was written after the rows were — a hand edit, or
a content directory restored from git — the file wins outright.

### The front page

`/` is the site's latest posts until the Reading settings say otherwise. The
choice is WordPress's own, and so are its two answers:

- **Your latest posts.** The archive at `/`, paginated at `/page/N/`. This is
  the default, and it is what an empty `homepage` means.
- **A static page.** The page is served at `/`, its own permalink answers `301`
  to `/` so the front page has one URL, and the menu links it at `/`. The
  default theme draws it with `layouts/front-page.njk` — the page's own words,
  then `Recent Posts`, then the line of links and the bio — and a theme lays it
  out differently by overriding that one file.

With a homepage set, a second pick gives the listing a page of its own: the
**posts page**. Its permalink carries the listing, with the page's own title
and words above the posts, paginated beneath it at `{permalink}page/N/`;
`/page/N/` at the root redirects there, and the theme's `layouts/posts-page.njk` is
the theme's override, falling back to the listing layout. A posts page with no
homepage is refused, as WordPress refuses it, and so is one page picked as
both. With a homepage and no posts page the listing has no page of its own,
which is WordPress's answer too.

The feeds do not move: `/feed/`, `/feed/atom/` and `/feed/json/` syndicate the
site's posts wherever the listing is read, and every page advertises them. The
sitemap follows the site — `/` once, and the listing's pages under the posts
page — and the pages list marks the two rows **Front Page** and **Posts Page**.

Both settings are page slugs in `content/_data/site.json`, so an Eleventy build
of the same directory shows the same front page:
`docs/eleventy.config.example.js` puts the homepage at `/` and flags the posts
page on the context as `isPostsPage`. A slug whose page is drafted, trashed or
deleted names nothing published, and the site is back to its latest posts with
the pick kept: publishing the page again puts the front page back.

### The media library

`/admin/media` lists every file under `content/uploads`, newest first by
modification time, with a thumbnail for a picture and its extension at the same
size for anything else, the size in bytes, the date, and — for a library that
has grown — a pager, twenty-four files to a page.

The list is a walk of the directory on every request rather than a query.
Nothing records that an upload exists: the filesystem is the truth
(decision-1, decision-9), so a file copied in over ssh, pulled in by git, or
written by an Eleventy build is on the screen without a restart, and one
removed the same way is off it. The only question the index is asked is which
documents mention a URL, which is the one thing a directory cannot answer.

Each row carries the public URL and the ready-made Markdown — `![alt](url)`
for a picture, with its alt text from the library or empty when it has none or
is decorative, and `[name](url)` for anything else, from the same function the
editor's upload control pastes from — as readonly text fields, which select and
copy on their own. `admin/static/copy.js` reveals a Copy button beside each and
does nothing else, so the screen is complete before it loads and a browser
without the clipboard API is not shown a button that would fail.

The upload form is `storeUpload`, the same function behind `POST /admin/uploads`
alike: one allowlist, one signature check, one
`{yyyy}/{mm}/{slug}{ext}` naming rule, and one set of refusals, shown as a flash
on the next page rather than as the editor's JSON.

Delete asks when it should. A file nothing points at is deleted on the first
click. A file a document still mentions — anywhere in its body, as Markdown, as
HTML or in prose — brings back a confirmation naming every document that does,
linked to its editor and marked when it is in the trash, and only a form
carrying `confirm` goes through. The trash counts because a trashed post can be
restored, and restoring one whose picture went in the meantime is a broken post
nobody was warned about. The submitted path is resolved against
`content/uploads` and refused when it lands outside, so a form field cannot
name a file elsewhere in the content directory.

`deleteUpload` takes a `removeDerived` hook, called with the same
content-relative path once the original is gone. The original under
`content/uploads` is the only source of truth (decision-10) and anything
generated from it is derived state that must not outlive it; the hook defaults
to `removeImageVariants`, which takes the file's derived images with it. The
file's entry in `content/_data/media.json` goes too.

A picture's row also carries its alt text: a text field, a Decorative checkbox
that wins over the text, and a line saying which of the two the library holds
or that it holds neither. The form posts to `/admin/media/alt`, which writes
`content/_data/media.json` atomically, keeping every other entry. The file is
the truth (decision-9) and is read on each request, so an entry written by hand
shows up without a restart. `readAltTexts(contentDir)` and
`undescribedImages(html, library)` in `src/images/alt-text.ts` are what the
editor's publish check and the federated `Image` attachments read.

#### Location and camera metadata

A phone photo carries where it was taken, when, and on what camera, and the
original under `content/uploads` is what the site serves at `/uploads/…`, puts
in every `<picture>` as the fallback, and federates as a photo post's
attachment. So `storeUpload` removes that metadata before the file is written,
for every upload: the editor's control, the media library, the Micropub media
endpoint and Micropub photos. It is not a setting.

| Format   | What goes                                                                                                                                       | What stays                                                    |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| JPEG     | EXIF (GPS, camera, lens, serial, time), XMP, IPTC, comments, other APPn segments, data after the image                                          | JFIF, the ICC profile, Adobe's colour flag, the orientation   |
| PNG      | `eXIf`, `tEXt`, `zTXt`, `iTXt` (XMP), `tIME` and private chunks                                                                                 | Image and colour chunks, APNG animation, the orientation      |
| WebP     | `EXIF`, `XMP ` and unknown chunks                                                                                                               | The bitstream, alpha, animation, ICC profile, the orientation |
| AVIF     | The contents of the Exif and XMP items, overwritten with an empty EXIF block and an empty XMP packet                                            | The picture, and its `irot`/`imir` orientation                |
| GIF      | Comment extensions and application extensions other than looping and ICC (XMP lives in one)                                                     | Frames, timing, looping                                       |
| MP4, M4V | `udta` (the `©xyz` location, camera), `meta` (the QuickTime location key) and `uuid` (XMP) boxes, in the movie, its tracks and at the top level | Every other box                                               |

Nothing is re-encoded. Segments, chunks and blocks are cut out and the pixel
data is copied byte for byte, so a stored JPEG or PNG decodes to the same
pixels as the upload. A picture taken sideways keeps a minimal EXIF block
holding its orientation and nothing else, so it still shows the right way up.
AVIF and MP4 keep their layout exactly: the metadata is overwritten in place
and a removed box becomes a zero-filled `free` box of the same size, so no
offset inside the file moves. A file whose structure cannot be followed far
enough to find its metadata is refused with a 415 rather than stored as it is.

Audio (MP3, M4A, Ogg), WebM, PDF and the text formats are stored as they
arrive. An episode's tags are its title and artwork, not where it was
recorded.

Files uploaded before this version still carry their metadata. Strip them
with

```sh
geekity strip-metadata
```

which rewrites each file under `content/uploads` that has something to remove,
prints what it removed, keeps the file's modification time (the library sorts
by it), and leaves alone, and names, a file it cannot read, exiting `1`. It is
safe to run again: a clean file is left as it is, and a second run reports
every file already clean. The derived variants under `data/images` never
carried metadata.

A site that keeps `content/` in git still has the old bytes in its history,
and so does every clone and fork of it. Removing them means rewriting that
history. One way: run `geekity strip-metadata`, copy `content/uploads`
somewhere outside the repository, remove it from every commit with
[`git filter-repo`](https://github.com/newren/git-filter-repo)
`--path content/uploads --invert-paths`, copy the stripped files back, commit
them, and force-push. That changes every commit hash, so anybody else with a
clone has to clone again.

### Image variants

`generateImageVariants(config, uploadPath)` derives one upload's copies with
sharp and writes them, plus an `image.json` sidecar, into
`<dataDir>/images/<the upload's path>/`. It runs inside `storeUpload`, so the
editor's control and the media library both produce the same
variants for the same file and the encoding is paid for by whoever uploaded it.
It answers `undefined`, having written nothing, for a GIF, an animation, a PDF,
a text file, an upload that is not there, and a site with `imageOptimization`
off — every one of which means "serve the original", which is what the site
would have done anyway.

| Function                           | What it is for                                                                       |
| ---------------------------------- | ------------------------------------------------------------------------------------ |
| `generateImageVariants`            | Derive the whole set and write the sidecar. Two callers at once share one encode.    |
| `describeImage`                    | The record, synchronously and cached, for a renderer that must not open a file.      |
| `findImageVariant`                 | One derived file by request path, generating it when it is missing.                  |
| `removeImageVariants`              | Take a source's derived directory away.                                              |
| `responsiveImages(html, describe)` | Rewrite `<img src="/uploads/…">` as `<picture>`. Pure: hand it any lookup.           |
| `siteImageMarkup(config, html)`    | The same, over one site's own records, deriving in the background for a record miss. |
| `siteIcons(config, setting)`       | The head's icon links for a site's icon setting: `{ rel, sizes, href }`, or none.    |

`describeImage` is synchronous and cached because it is called once per image
while a page renders, and decision-10 forbids probing an image file at render
time. Its cache entry outlives the sidecar on purpose: `data/images/` is
disposable, so a page whose variants have been swept away keeps rendering the
markup that asks for them back, and the first request for each one rebuilds it.

The site's icons are derived copies of the same kind, and `siteIcons` is how a
head gets at them: three square PNGs, `icon` at 32 and 16 pixels and
`apple-touch-icon` at 180, cropped from the middle of the site's icon (the
`icon` that Settings > General writes, else a hand-set `avatar`) and
encoded the first time a browser asks for one. It answers an empty list — and
the packaged theme then links no icon at all — when the site has no icon, when
its icon is a file no icon can be made of, or when `imageOptimization` is off,
so a head never advertises a URL this server would answer 404 for.

`documentContext(document, images)` is where the rewrite is applied. Passing the
config is what turns the page's `content` into `<picture>` markup; the feeds,
`documentJson`, the Markdown representation and `postObject` all read
`document.html` directly and so keep the plain `<img>` by construction.

### Managing tags and categories

`/admin/tags` and `/admin/categories` list every term in use with two counts and
a link to its archive: **Posts**, what the public site lists under it, and
**Files**, every file carrying it — drafts, scheduled posts and the trash
included. The second is the one to look at before acting, because it is what an
action is about to rewrite.

Three things can be done to a term, and all three are the same operation. Typing
a new name into a row's field and pressing Rename rewrites the front matter of
every file carrying it. Renaming onto a term that already exists is a **merge**:
the screen comes back with a question naming both counts, and only a confirmed
form goes through, because a merge cannot be undone by renaming back. A file
that carried both terms keeps the target once, in the place it already had.
Delete takes the term out of every file and leaves everything else alone.

Each of them says how many files it wrote. The files are the truth (doc-1), so
each file is re-read and re-parsed from disk before it is rewritten rather than
being taken from the index: the index can be a moment behind a hand edit, and a
bulk rewrite that trusted it would put that edit back. A file that has gone or
will not parse is skipped, counted, and named in the message.

Every rewrite is announced the way an editor save is, so the index, the feeds,
the notify server and the fediverse all follow — one `Update` per
affected published post, because the hashtags on those posts have just changed.
A term on many published posts is therefore many deliveries; that is the point,
but it is worth knowing before renaming a tag that half the archive carries.

A rename moves an archive, and an archive is a URL somebody may have linked to,
so the site records the move in a `taxonomyRedirects` list — `{ taxonomy, from,
to }` — in `content/_data/site.json` with the rest of the settings. The
old archive URL and its feed then answer `301` to the new ones. Chains are
collapsed as they are recorded, so `a → b` followed by `b → c` is stored as
`a → c` and answered in one hop; a term that comes back into use is served
rather than redirected; and deleting a term drops every record pointing at it,
because a redirect to a 404 is worse than the 404.

### Login hardening

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

### Session hardening

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

### Forgotten passwords

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
[`geekity user add`](#creating-an-admin-from-the-command-line), which is how a
site nobody can sign in to gets a fresh admin from a shell. Saving a credential
under [Settings → Email](#email) turns the form on for the next visitor, with
no restart.

### Security headers

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

### Compression

Text responses are compressed on the way out: HTML, CSS, JavaScript, feeds,
JSON, Markdown, SVG, sitemaps and anything else whose media type is `text/*`,
`+json` or `+xml`. A client that accepts brotli (`br`) gets brotli, at quality
5 because every page is built per request; one that accepts only gzip gets
gzip; one that accepts neither gets the plain bytes.

Some responses go out as they are:

- Images, video, WOFF and WOFF2 fonts and other formats that carry their own
  compression. Encoding them again costs CPU and can make them bigger.
- Bodies under 1024 bytes, where the saving is smaller than the cost.
- A response that already has a `Content-Encoding`, or whose `Cache-Control`
  says `no-transform`.
- A response that may hold a secret: anything whose `Cache-Control` says
  `private` or `no-store`, which every page drawn for somebody signed in does,
  and every admin screen under `/admin`, the setup and login forms included.
  These carry CSRF tokens next to text a visitor can influence, and compressing
  them would let an attacker who watches response sizes recover the token a
  byte at a time (the BREACH attack). Their `Vary` is left as it was. The
  admin's static files under `/admin/_static/` hold no secret and are
  compressed. Error pages say `no-store`, so they go out plain too.

Every other text response carries `Vary: Accept-Encoding`, whether it was
compressed or not, and so does every `304`. A cache in front of the site
therefore keeps a copy per encoding and never hands brotli to a client that
cannot decode it.

A compressed response's `ETag` is the plain response's with `W/` in front: the
bytes differ, but the representation is the same. `If-None-Match` compares
weakly, so a browser holding the brotli copy and a feed reader holding the gzip
copy both revalidate to `304`, and each gets back the validator it sent.

`compression: false`, or `GEEKITY_COMPRESSION=false`, turns all of this off.
Turn it off when a reverse proxy or CDN in front of the site compresses
responses itself (Caddy's `encode`, nginx's `gzip on`, Cloudflare), so the work
is done once and the proxy's settings apply. Leave it on when nothing in front
compresses, as in the Docker deployment the repository documents.

### security.txt and change-password

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

## The public site

Booting mounts the public site on the app. The routes are:

| Route                                   | What it serves                                                                                                         |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `/`                                     | Published posts, newest first.                                                                                         |
| `/page/2/` and up                       | Later pages of the same archive.                                                                                       |
| a document's permalink                  | The post or the page, through the theme.                                                                               |
| `/tag/{tag}/`                           | Everything published carrying that tag, paginated at `/tag/{tag}/page/2/`.                                             |
| `/category/{name}/`                     | The second taxonomy, paginated the same way.                                                                           |
| `/author/{username}/`                   | One user's published posts, headed by their profile, paginated the same way.                                           |
| `/feed/`, `/feed/atom/`, `/feed/json/`  | The recent posts as RSS 2.0, Atom and JSON Feed.                                                                       |
| `/tag/{tag}/feed/` and its two siblings | The same, for one tag; `/category/{name}/feed/` likewise.                                                              |
| `/author/{username}/feed/` and siblings | The same, for one person.                                                                                              |
| `/comments/feed/`                       | Every reply the inbox has been sent, as RSS 2.0.                                                                       |
| `{permalink}feed/`                      | One post's replies, the same way.                                                                                      |
| `/sitemap.xml`                          | Every public URL, for a search engine.                                                                                 |
| `/sitemap-{n}.xml`                      | One file of a sitemap too big to be a single one.                                                                      |
| `/robots.txt`                           | What a crawler may have, and where the sitemap is.                                                                     |
| `/opensearch.xml`                       | The OpenSearch description, so a browser can offer the site's search from its address bar.                             |
| `/_geekity/oembed?url=…`                | The oEmbed card of the post or page at `url`, as JSON or with `format=xml`; a 404 for anything else.                   |
| `/_geekity/embed?url=…`                 | The same card as a page any site may frame, which the oEmbed `html` puts in an iframe; a 404 for anything else.        |
| `/llms.txt`                             | The site's pages and recent posts for a language model, each linked to its Markdown. See [below](#llmstxt).            |
| `/{key}.txt`                            | The IndexNow key, while the site has IndexNow on. See [below](#indexnow).                                              |
| `/.well-known/security.txt`             | Where to report a vulnerability; a 404 until a security contact is set. See [above](#securitytxt-and-change-password). |
| `/.well-known/change-password`          | A redirect to the signed-in user's change-password form, or to the login form.                                         |
| `/_geekity/comments`                    | `POST` only. Where the comment form under a post submits.                                                              |
| `/_geekity/contact`                     | `POST` only. Where the contact form on a page submits.                                                                 |
| `/_geekity/webmention`                  | `POST` only. Where a webmention is sent; advertised on every document.                                                 |
| `/_geekity/moderate`                    | Where an approve, spam or delete link from a notification lands. `GET` shows a button; `POST` acts.                    |
| `/_geekity/unsubscribe`                 | Where the unsubscribe link in a reply notice lands. Same two steps.                                                    |
| `/theme/…`                              | The theme's own files, from its `static/` directory.                                                                   |
| `/uploads/…`                            | A file from `content/uploads/`, byte for byte as it was stored.                                                        |
| `/uploads/_/…`                          | One derived copy of an uploaded image, generated on the spot if missing.                                               |
| anything else                           | The theme's 404.                                                                                                       |

The federation routes go on before it, and answer only their own paths:

| Route                           | What it serves                                                                        |
| ------------------------------- | ------------------------------------------------------------------------------------- |
| `/author/{username}/`           | The `Person` on an ActivityStreams request; the archive above to anything else.       |
| `/author/{username}/inbox/`     | `POST` only. That user's inbox, signature-verified by Fedify.                         |
| `/author/{username}/outbox/`    | Their published posts as `Create` activities, paged 20 at a time.                     |
| `/author/{username}/followers/` | Who follows them, paged 20 at a time.                                                 |
| `/author/{username}/following/` | Always empty: a relay is a subscription rather than a relationship.                   |
| `/inbox/`                       | `POST` only. The instance-wide shared inbox; the addressee is read out of the body.   |
| `/@{username}`                  | A 301 to their archive; a 404 for a handle nobody answers to.                         |
| `/.well-known/webfinger`        | The handle, the author URL or `/@{username}`, all resolving to the same actor.        |
| `/.well-known/nodeinfo`         | A link to the NodeInfo document.                                                      |
| `/nodeinfo/2.1`                 | What software this is, how many users and how many posts.                             |
| a post's permalink              | The `Article` on an ActivityStreams request (decision-13); the page to anything else. |

Drafts, documents in the trash and posts whose date has not arrived are not on
the public site: their URLs 404, and they are in no listing.

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
published. `tagBase` and `categoryBase` on the Permalinks settings page move
them, and
the routes, the paging, the canonical redirects, the tag feeds, the theme's
links and the ActivityStreams hashtags all follow on the next request. A base
is one URL-safe path segment: no slashes, and not a path the site already
answers on (`page`, `feed`, `comments`, `admin`, `theme`, `uploads`,
`nodeinfo`, `author`, `inbox`), and
the two may not be the same word. Both are `tagBase` and `categoryBase` in
`content/_data/site.json`, so an Eleventy build of the same content directory
can put its archives at the same URLs.

### Navigation

A menu is a named thing the site stores and the theme asks for.

**The site stores menus by name.** `content/_data/site.json` holds a `menus`
object keyed by the name of each menu, each an ordered list of items:

```json
{
  "menus": {
    "primary": [{ "label": "About", "url": "/about/" }],
    "footer": [
      { "label": "Colophon", "url": "/colophon/" },
      { "label": "Mastodon", "url": "https://example.social/@me", "rel": "me" }
    ]
  }
}
```

An item is a label, a URL and the `rel` values it carries. The URL is a
site-root path or an absolute `http(s)` URL; anything else is refused. `rel` is
one string holding every value — `"me"`, `"nofollow noopener"` — present only
when there is one, lower case and each value said once, and a theme prints it
as the whole of the link's `rel` attribute. The values are whatever HTML link
types the site wants; `me` is the one most menus have, because it is how
Mastodon and the rest of the IndieWeb verify that the site and the profile it
links are the same person. An item written `"me": true`, the spelling before
`rel` held a list, is still read as `"rel": "me"`.

**The theme declares the areas it renders.** `theme.json` carries an `areas`
list, each entry a `name` — the key under `menus` — and a `label` a person
reads:

```json
{ "areas": [{ "name": "primary", "label": "Site menu" }] }
```

The packaged theme declares `primary` ("Site menu") and `footer` ("Footer
links"). A theme that wants a third declares it; an `areas` that is missing or
unreadable leaves that theme declaring none rather than failing to load it, and
the Navigation screen then offers the packaged theme's — a site theme is laid
over the packaged one a file at a time, so a theme that has declared nothing has
not overridden the declaration, and its inherited `layouts/base.njk` really is
still rendering `menus.primary` and `menus.footer`.

**A theme renders a menu by name.** Every template gets `menus`, keyed by the
same names, each item already marked `current` for the path being rendered.
`{% for item in menus.footer %}` is the whole interface, so a site theme can
render a menu the packaged theme has never heard of. Every stored menu is on
the context, not only the declared ones: the declaration is what the screen
that edits menus reads, and a menu nothing loops over is rendered nowhere and
kept — which is how somebody writes the menu a theme will use before switching
to that theme.

**The menus are managed on `/admin/navigation`.** It is a top-level section
after Pages rather than a settings page: a menu is content a site arranges, the
way its pages are, and the shape of the screen comes from the active theme.
The screen is two lists. First the areas that theme declares, in the theme's
order and under its labels — an area the site has never filled in is an empty
box, not a missing one. Then every other stored menu, under a heading saying
this theme renders them nowhere; those are still editable, which is how the
menu a theme will use is written before the site switches to it, and each has
the Delete that is the only way a menu is removed. An area the theme declares
is emptied rather than deleted: the theme goes on asking for the name, and the
box has to stay for the next thing typed into it.

Each menu is one box of `Label | URL` lines, in the order they are typed, and a
line may end in the `rel` values the link carries, a word each — `Mastodon |
https://example.social/@me | me`, `A source | https://example.com/thing |
nofollow noopener`. The values come off the end of the line only while the last
bar-separated part reads as a list of them, so a URL holding a bar survives:
`Odd | /odd/?a=1|2` keeps its query string, because `2` is not a word. A line
that is not an item is refused by name, with the box still holding every line of
what was typed, and nothing written. It is the same line the Links box on a
profile takes.

**A menu name** is lower-case ASCII letters, digits and underscores, starting
with a letter, at most 32 characters. It is the word a theme writes after the
dot — `{% for item in menus.footer %}` — so a dash is refused: after a dot it
is a minus sign, and `menus.top-bar` renders nothing and raises nothing. Lower
case is the rest of the rule and it is what refuses the confusable spellings:
`Footer` is refused rather than quietly lowered, because `footer` and `Footer`
would be two menus on one screen that nothing could tell apart. A name the site
already holds is refused too, and the message says its box is already on the
page. The rule governs a name somebody types; a name a `theme.json` declares is
a menu name by declaration and is shown as the theme spells it, because a
screen that hid a declared area over a spelling would leave somebody unable to
fill in a menu their site renders.

There is no second source. A page cannot put itself in a menu, so there is one
screen to edit it on, one order, and no way for the same link to appear twice.
A page that should be linked is linked by typing a line for it — including the
page a site serves as its front page, which is typed `Home | /`, the URL a
reader lands on, rather than at the permalink that redirects there.

Because the menus live in `site.json`, an Eleventy build renders the same ones;
the example config assembles them as `collections.menus`. A `menus` in a
hand-edited `site.json` that is not an object of lists of items yields no menu
rather than an error, exactly as a bad archive base falls back rather than
taking the site down.

### Moved URLs

Changing the slug or the permalink of a published post or page in the editor
moves it, and the URL it leaves is written into its file:

```yaml
permalink: /2026/01/new-name/
redirect_from:
  - /2026/01/first-name/
  - /2026/01/second-name/
```

Every URL in `redirect_from` answers `301 Moved Permanently` with the current
permalink, and so do its `.md` and `.json` spellings. Each entry points at the
document itself, not at the next rename, so no chain of redirects builds up.
The list is in the file, so deleting `data/geekity.db` keeps it working.

A URL in the list only redirects while nothing else lives there: a new document
given that URL takes it over. Moving a document back to a URL in its list takes
that URL off the list. A draft that was never published moves without leaving
anything behind. Correcting a published post's date files it under the new
day but keeps its URL.

### Declared redirects

A site that moves to this CMS, or reorganises, lists the old URLs that no
document owns in `content/_data/redirects.json`. The file is a JSON list:

```json
[
  { "from": "/?p=123", "to": "/2026/01/hello/" },
  { "from": "/old-section/", "to": "/new-section/", "status": 301 },
  { "from": "/sale/", "to": "/shop/", "status": 302 },
  { "from": "/forum/", "to": "https://forum.example.com/", "status": 308 }
]
```

- `from` is a path on this site. It starts with `/` and can carry a query
  string.
- `to` is a path on this site, or an absolute `http` or `https` URL.
- `status` is `301` or `308` for a permanent redirect, and `302` or `307` for a
  temporary one. It defaults to `301`.

A `from` without a query string matches that path with any query, or none. The
request's query goes on to a `to` that has no query of its own, so
`/old-section/?page=2` lands on `/new-section/?page=2`. The path must match
exactly, except that a `from` ending in `/` also answers the same path without
the slash, in one hop.

A `from` with a query string matches only that query. The order of the
parameters does not matter, so `/archives/?cat=4&paged=2` also matches
`/archives/?paged=2&cat=4`. Nothing else in the request's query may differ:
`/?p=123` does not match `/?p=123&replytocom=9`. This is how old WordPress
`?p=` links reach their posts.

A declared redirect never hides something real. A path-only `from` is answered
only after every document, archive, feed and moved URL has had its turn, and
just before the 404 page, so a document given that URL later takes it over. A
`from` with a query string is answered first, because no document is addressed
by its query. The admin, the federation endpoints and the health check answer
before any declared redirect.

The file is read on the next request after it changes, with no restart. An
entry that cannot be served is logged as a warning at boot, and again on the
first request after the file changes, and it is skipped. The following entries are skipped:

- An entry with a missing or malformed `from`, `to` or `status`.
- A second entry with the same `from`. The first entry wins.
- Every entry that leads into a loop, such as `/a/` to `/b/` and `/b/` back to
  `/a/`.

A file that is not a JSON list serves no redirects and is reported the same
way.

Every redirect the CMS sends carries `X-Redirect-By: Geekity CMS`. This
includes the declared redirects, moved URLs, trailing slashes, feed spellings
and the admin's redirects. Someone who traces a chain of redirects through a
proxy can see which layer sent each one.

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

Every representation but the HTML carries `X-Robots-Tag: noindex`, whether it
was asked for by extension or by `Accept`. They say what the page says, and a
search engine that indexed them would list one page two or three times.

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
{ "title": "My Site", "tagline": "Notes", "author": "me", "feedSize": 20 }
```

Every RSS feed, the comments feeds included, tells a reader how often to poll
it with the Syndication module's `sy:updatePeriod` and `sy:updateFrequency`.
Settings → Reading sets both, as `feedUpdatePeriod` (`hourly`, `daily`,
`weekly`, `monthly` or `yearly`) and `feedUpdateFrequency` (a whole number, 1 or
more) in `site.json`. The default is `hourly` and `1`, which is what WordPress
declares, so the subscribers of a migrated site keep polling as they did. A
reader may back off from a feed that stays quiet much longer than it says, so
a site that posts weekly does better to say `weekly`. Atom and JSON Feed have no
element for it.

### What every format says about a post

The three formats render one **feed item**, derived once per post, rather than
each reading the file for itself. So they agree about the three things a reader
actually keys on.

**Identity.** A post is named by its ActivityStreams object id, which is its
permalink (see [Federation](#federation)) or the `activitypub.id` the front
matter stores for a post migrated from elsewhere. That id is RSS's `guid`,
Atom's `id` and JSON Feed's `id`. The permalink is always the link: RSS's
`link`, Atom's `link rel="alternate"` and JSON Feed's `url`. The two are the
same URL for every post born on this CMS, and differ only for one carrying a
stored id — which is what lets a migrated post keep the name its WordPress
subscribers already hold. RSS's `isPermaLink` says which of the two a `guid`
is: `true` when it is the permalink, `false` for a stored id like `?p=813`.

**Terms.** Every format lists the post's categories and then its tags, in file
order, as one flat list: RSS's `category` elements, Atom's `category term`
attributes, JSON Feed's `tags`. None of the three can say which vocabulary a
term came from, which is how WordPress publishes both too.

**Summary.** Every format summarises a post the same way: the `description`
front matter when the post has one — it is what the author wrote for exactly
this — and otherwise the first paragraph of the rendered body, stripped to
plain text and cut at 55 words, WordPress's own excerpt length. It is RSS's
`description`, Atom's `summary` and JSON Feed's `summary`, and it is left out
only when there is nothing to summarise at all. The whole post goes in the
content element beside it, so a reader that shows both has something to choose
between.

**Replies.** A post whose `in-reply-to` front matter is an absolute `http` or
`https` URL is a reply, and Atom and JSON Feed name the URL it answers. An Atom
entry carries RFC 4685's `<thr:in-reply-to ref="…" href="…"/>`, with the target
URL as both its identity and its location, and every Atom feed declares
`xmlns:thr="http://purl.org/syndication/thread/1.0"`. JSON Feed 1.1 has no reply
field, so a JSON Feed item carries the target in an extension object, which the
spec allows under any key that starts with an underscore and tells readers that
do not know it to ignore:

```json
{
  "id": "…",
  "url": "…",
  "content_html": "…",
  "_geekity": { "in_reply_to": "https://example.net/notes/1" }
}
```

The key is `_geekity` because an extension is named after its publisher, and
`in_reply_to` spells the microformats `in-reply-to` property the JSON way. A
post that is not a reply, or whose `in-reply-to` is not such a URL, carries
neither. RSS 2.0 has no equivalent element, so an RSS item for a reply is
written the same as any other.

**Languages.** Every feed declares the site's `language` once: RSS as the
channel's `language`, Atom as the feed's `xml:lang` and JSON Feed as its
`language`. A post whose `lang` front matter names another language says so on
its own item: RSS as `dc:language`, Atom as `xml:lang` on the `entry` and JSON
Feed as the item's `language`. A post in the site's language, or whose `lang`
is not a language tag, adds nothing.

**Photos.** A post's `photo` front matter prints in every format's content,
before the body, which is where the page prints it too. Each photo is a plain
`<figure><img src alt></figure>` of the original upload, never the responsive
variants, which a reader cannot resolve (decision-10). Its `src` is absolute on
the site's base URL. Its `alt` is the post's own text, else the media library's,
else empty. So a photo-only post reads in a feed reader as its photos. JSON Feed
also names the item's main image as `image`: the post's `image` front matter,
else its first photo. A photo is never an RSS `enclosure`, an Atom
`rel="enclosure"` link or a JSON Feed attachment. Those carry a recording only.

### RSS 2.0

The channel carries `title`, `link`, `description` (the tagline), `language`
(the `language` setting, `en` by default), `lastBuildDate`, `generator`, an
`atom:link rel="self"`, the three notify-server elements described under
[Real-time notification](#real-time-notification), and an `image` built from the
avatar when the site has one.

An item carries `title`, `link`, `guid`, `pubDate` in RFC 822, `dc:creator` from
the post's author or the site's, one `category` per term, `description` holding
the summary, `content:encoded` holding the whole rendered post, and
`source:markdown` holding the Markdown the post was written from. The `guid`,
the terms and the summary are the ones described above.

`source:markdown` is Dave Winer's [source namespace][source-ns]: a reader that
understands Markdown should render from it rather than from `content:encoded`.
It is the same text the ActivityStreams `Article` carries as its `source`.

Every item also says where its comments are, three ways: `comments` is the page
to read them on, `wfw:commentRss` (the [Well-Formed Web][wfw-ns] comment API) is
the feed to poll, and `source:comments` is that same feed with a `count`
attribute, so a reader can say "3 comments" without fetching anything.

When the site has a license (Settings > General, or `license` in `site.json`),
the channel carries a `creativeCommons:license` holding its URL, and every item
carries one for its own license: the post's `license` front matter, else the
site's. A post whose front matter says `license: none` carries none. The
element is the [Creative Commons RSS module][cc-rss], declared as
`xmlns:creativeCommons` only when some license is printed. It names a license
by URL, Creative Commons or not, which a reader can act on; `dc:rights` would be
free text. Nothing about a license is printed on a site and posts without one.
RSS has no element that says "no license", so a post saying `license: none`
on a licensed site carries no item license while the channel still names the
site's; a reader that applies the channel's license to every item reads that
post as under it.

[source-ns]: https://source.scripting.com/
[wfw-ns]: http://wellformedweb.org/CommentAPI/
[cc-rss]: https://cyber.harvard.edu/rss/creativeCommonsRssModule.html

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

An Atom entry carries `id` (the post's object id), `title`, `updated`,
`published`, `link rel="alternate"` (the permalink), an `author` when the front
matter names one, a `category` per term, a `summary`, and the whole rendered
post as `content type="html"`. The feed itself carries `id`, `title`,
`subtitle` from the site's tagline, `updated`, `link rel="self"`,
`link rel="alternate"` to the HTML page, a `generator`, an
`xml:lang` from the `language` setting, and — when the site names a notify
server — a `source:cloud` and a `link rel="hub"`.

With a license, the feed carries an [RFC 4946][rfc4946] `link rel="license"`
to the site's license, its name as the `title`, and every entry carries one for
its own license, the post's `license` front matter else the site's. An entry
states its own because RFC 4946 does not let an entry inherit the feed's. JSON
Feed has no field for a license and says nothing about one.

[rfc4946]: https://www.rfc-editor.org/rfc/rfc4946

A JSON Feed item carries `id` (the object id), `url` (the permalink), `title`,
`content_html`, `image` (see Photos above), `summary`, `date_published`, `date_modified`, `tags` (the
terms) and `authors`; the feed carries `version`, `title`, `home_page_url`,
`feed_url`, `description`, `authors` and `hubs`. Keys with nothing behind them
are left out rather than sent empty.

The XML is written by this package rather than by a library. Text is escaped;
`content:encoded` and `source:markdown` are CDATA sections, with any `]]>` in
the text split across two sections so it cannot end one early.

### A recording on a post

A post can carry one recording: a spoken version of an article, or an episode
now and then. The site is a blog that sometimes has audio, not a podcast host,
so the feeds carry what a podcast app needs to play, describe and caption an
item, and leave the podcast directory tags out. The front matter spells it the
way RSS does:

```yaml
enclosure:
  url: /uploads/2026/10/episode-12.mp3 # an upload; written by the editor
  type: audio/mpeg # from the upload table; written by the editor
  length: 23456789 # bytes, from the file on disk; written by the editor
  duration: 1834 # seconds, optional
  transcript: # optional
    url: /uploads/2026/10/episode-12.vtt # an upload or an http(s) URL
    type: text/vtt # text/vtt, application/x-subrip, text/html or text/plain
  alternates: # optional, any number
    - url: /uploads/2026/10/episode-12.mp4
      type: video/mp4
      length: 98765432
      title: Video # optional, at most 32 characters
      height: 720 # optional, for video
      lang: en # optional
    - url: https://cdn.example.com/episode-12-low.mp3
      type: audio/mpeg # required for a link
      title: Low bandwidth # a link's length is optional
```

**The main file is always an upload** under `/uploads/`, because RSS requires
its `url`, `length` and `type`, and an upload is the only file whose length the
site knows. A main file without all three is no recording at all. A bad
alternate version or transcript is dropped on its own, so one wrong line in a
hand-edited file costs that line and not the episode. `enclosureOf(extra)` is
the one reading of the key, and the feeds, the theme and the federation read
only what it returns.

**The post editor** has a Recording section on posts. The main file is a select
of the audio and video in the media library, and None removes the whole key,
transcript and alternate versions included. The duration takes seconds, `30:34`
or `1:02:03`. The transcript is an upload (`.vtt`, `.srt` or `.txt`) or an
`https` address with its type. Alternate versions are numbered rows with one
blank row at the end, so a plain form can add, edit and remove them; emptying a
row's address removes it. On save, the type and length of every upload are read
from the upload table and from the file on disk, never from the form. A main
file that is not an audio or video upload, a linked version without an `http`
or `https` address or a media type, or a title over 32 characters is refused
with a message, and nothing is written.

**What the feeds print, and when.** A post with no recording prints none of
this, and a feed with no recording in it declares neither namespace, so its
bytes and its ETag are what they were before recordings existed.

| Element                                                     | Format      | Printed when                                                                                                                                                                            |
| ----------------------------------------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `<enclosure url length type/>`                              | RSS item    | The post has a main file. `url` is absolute.                                                                                                                                            |
| `<podcast:alternateEnclosure>` with `<podcast:source uri/>` | RSS item    | Once per alternate version, with `type`, and `length`, `title`, `height` and `lang` when known.                                                                                         |
| `<podcast:transcript url type/>`                            | RSS item    | The post has a transcript, with `rel="captions"` for WebVTT or SubRip.                                                                                                                  |
| `<itunes:duration>`                                         | RSS item    | The duration is known, in whole seconds.                                                                                                                                                |
| `<podcast:medium>blog</podcast:medium>`                     | RSS channel | Any item in the feed has a recording. Without it an app assumes `podcast`; `blog` is the spec's word for articles that sometimes have audio.                                            |
| `<link rel="enclosure" type length href/>`                  | Atom entry  | The post has a main file. Atom has no way to say the others are versions of it.                                                                                                         |
| `attachments`                                               | JSON Feed   | The main file and then each alternate version, with `url`, `mime_type`, `size_in_bytes` and `title` when known, and `duration_in_seconds` on audio or video when the duration is known. |

`xmlns:podcast="https://podcastindex.org/namespace/1.0"` is declared only on a
feed that prints a podcast element, and
`xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"` only on one that
prints `itunes:duration`.

**Left out on purpose:** the Apple directory tags (`itunes:image`,
`itunes:category`, `itunes:explicit`, `itunes:owner`), and `podcast:guid`,
`podcast:locked`, `podcast:person`, `podcast:season`, `podcast:episode`,
`podcast:value` and `podcast:chapters`. Each one matters only to a podcast
directory or a dedicated show. Adding them is a follow-up for a site that wants
to be listed in Apple Podcasts, and so is `podcast:license`, which could reuse
the [content license](#rss-20).

**The fediverse** gets the main file as an `Audio` or `Video` attachment with
its absolute `url`, its `mediaType`, and the post's title, or a note's first
words, as its `name`. It goes before the post's `Image` attachments, because
Mastodon shows a player or a gallery by the type of the first attachment and
keeps only four. Alternate versions and linked files stay out: a remote server
fetches and re-encodes what it is given, and a link to another host is a type
this site cannot check. `playsAsVideo(type)` decides `Video` against `Audio`,
and the default theme's `<video>` against `<audio>`, so the two never disagree.

The default theme plays the main file on the post page; see its README.

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

The validator also covers the revision of the item format itself, so a release
that changes what a feed says about a post moves every post feed's `ETag` once
rather than leaving a polling reader with a `304` that hides the new bytes.

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

`commentsRssFeed` is the same for comments, and what goes in it comes from the
conversation reader — the one thing that reads the inbox log and the comment
index to show somebody what has been said, so a feed and the page under the
post carry the same entries:

```ts
import {
  commentsRssFeed,
  createConversation,
  feedComments,
} from '@geekity/cms';

const conversation = createConversation({
  admin: cms.admin,
  store: cms.store,
  baseUrl: cms.config.baseUrl,
});

commentsRssFeed({
  site,
  comments: feedComments(conversation.latest(20), {
    baseUrl: cms.config.baseUrl,
    limit: 20,
  }),
  title: `${site.title}: comments`,
  href: '/',
  feedHref: '/comments/feed/',
  baseUrl: cms.config.baseUrl,
});
```

`conversation.thread(document)` is the same reading for one post — the shape the
theme's `conversation.njk` is handed — `spokenIn` flattens it into the entries a
feed carries, and `conversation.counts(documents)` is the number `source:comments`
puts beside each item of a post feed.

## Sitemap and robots.txt

Two more fixed routes, at the two paths a crawler goes looking for on its own.

`/sitemap.xml` is every URL the public site publishes, in the
[sitemap protocol's](https://www.sitemaps.org/protocol.html) `<urlset>`:

- the home archive and each of its pages, `/`, `/page/2/` and so on;
- every published post and every page, at its permalink;
- every tag archive and every category archive, with each of their pages,
  under whatever bases the site is configured with.

Each `<loc>` is absolute, built on `baseUrl`. `<lastmod>` is a document's
`updated` when it has one and its `date` otherwise, and for a listing page it
is the newest of those among the documents on that page. Something nothing
dates — a page with no date in its front matter — carries no `<lastmod>`
rather than an invented one.

Nothing hidden reaches it. The sitemap is drawn from the same queries the
listings are and checked against the same `isListed`, so drafts, the trash and
posts whose date has not arrived are absent for the same reason their
permalinks 404, and an [unlisted post](#unlisted-posts) is absent for the same
reason it is off the home page.

The protocol caps one file at 50,000 URLs. Past that, `/sitemap.xml` becomes a
`<sitemapindex>` naming `/sitemap-1.xml`, `/sitemap-2.xml` and so on, each
holding its own slice and dated by the newest URL in it. The address a search
engine holds does not change, which is the point of the index living there.
While the whole sitemap fits in one file the children name nothing and 404.

`/robots.txt` starts short:

```
User-agent: *
Disallow: /admin/

Sitemap: https://example.com/sitemap.xml
```

Everything public is crawlable; only the admin is not. The actors and their
collections are deliberately left open — an actor and an object exist to be
fetched, they carry the same
content as the pages that link to them, and a crawler that follows one gets
JSON it will ignore.

The Crawlers section of Settings → Reading adds to it, and writes what it sets
to `site.json`:

| Setting               | `site.json` key                                                       | What the file gains                                                                                                                                                                                                                                                                                                                                                                                             |
| --------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AI crawlers           | `aiCrawlers`                                                          | `allow` (the default) adds nothing. `block-training` adds a `Disallow: /` group for each training crawler: GPTBot, ClaudeBot, anthropic-ai, Google-Extended, Applebot-Extended, Bytespider, CCBot and meta-externalagent. `block-all` also blocks the retrieval crawlers: OAI-SearchBot, ChatGPT-User, PerplexityBot, Perplexity-User, Claude-SearchBot, Claude-User, meta-webindexer and meta-externalfetcher. |
| Content signals       | `contentSignalSearch`, `contentSignalAiInput`, `contentSignalAiTrain` | Each `yes`, `no` or empty. The ones set become one line, such as `Content-Signal: search=yes, ai-input=yes, ai-train=no`.                                                                                                                                                                                                                                                                                       |
| More robots.txt rules | `robotsRules`                                                         | Groups of the site's own, one line per array entry: `User-agent`, then `Allow`, `Disallow`, `Crawl-delay`, `Content-Signal` or `Sitemap` lines.                                                                                                                                                                                                                                                                 |

A crawler obeys only the one group that names it (RFC 9309), so the CMS puts
`Disallow: /admin/` and the content signal into every group, its own and the
site's, unless the group already disallows everything or carries a signal of
its own. The form refuses a line that is not a robots.txt field, a rule with no
`User-agent` above it, and an `Allow` under `/admin/`; a hand edit of
`site.json` that does any of these loses that line. The site's own `Sitemap:`
line is always there.

For example, `block-training`, `ai-train` set to `no` and a rule of
`User-agent: SlowBot` / `Crawl-delay: 10` serve:

```
User-agent: *
Disallow: /admin/
Content-Signal: ai-train=no

User-agent: GPTBot
Disallow: /

…one group per training crawler…

User-agent: SlowBot
Disallow: /admin/
Crawl-delay: 10
Content-Signal: ai-train=no

Sitemap: https://example.com/sitemap.xml
```

Both are registered routes rather than anything resolved from the content
index, so a document permalinked at `/sitemap.xml` cannot take the URL a
search engine polls, and both carry an `ETag` and answer a conditional request
with 304 the way the feeds do — the sitemap with a `Last-Modified` as well,
robots without one, because nothing dates it.

Nothing links the sitemap from a page: `robots.txt` names it, which is where a
crawler looks.

## llms.txt

`/llms.txt` describes the site for a language model, in the
[llms.txt](https://llmstxt.org/) format. It holds the site's title as a heading
and its tagline as a quote. Then it lists every public page by title and the
posts the feeds carry, newest first. Each entry links to the document's
Markdown, which is what a model reads best:

```markdown
# Field Notes

> Notes from the field.

## Pages

- [About](https://example.com/about/index.md): Who writes this.

## Recent posts

- [Third post](https://example.com/third/index.md)
```

A document's `description` follows its link. A static homepage is listed at
`/index.md`, because `/` is where it is published. The file is served as
`text/markdown` and carries an `ETag` and a `Last-Modified`, the newest date
among its entries. It answers a conditional request with 304, as the sitemap
does.

The home page advertises the file twice. The response carries
`Link: </llms.txt>; rel="describedby"; type="text/markdown"`, for a tool that
reads no HTML. The default theme's head carries
`<link rel="describedby" type="text/markdown" href="/llms.txt">`. A theme
gets the path as `llmsTxt` while the site serves the file.

To write the file yourself, put it at `content/llms.txt`. The CMS serves it
exactly as written in place of the generated one, dated by the file. To serve
no file at all, clear **Serve /llms.txt** under Settings → Reading. This
writes `"llmsTxt": false` to `site.json`. `/llms.txt` then answers 404, even
when `content/llms.txt` exists, and the home page stops advertising it.

## IndexNow

[IndexNow](https://www.indexnow.org/) gets a changed URL recrawled by Bing,
Yandex, Naver, Seznam and the other engines that share it within minutes,
instead of on their next visit. It is off by default, because it sends the
site's URLs to a third party. To turn it on, select **Submit changes to
IndexNow** under Settings → Reading.

The first time you turn it on, the CMS generates a key of 32 hex digits and
writes it to `site.json` as `indexNowKey`, beside `"indexNow": true`. The site
then serves the key at `/{key}.txt` as plain text, which is how an engine
checks that the submissions are yours. Turning IndexNow off takes the file away
and keeps the key, so turning it back on reuses the key the engines already
checked. To change the key, write a new one of 8 to 128 letters, digits or
dashes to `indexNowKey`. A key that does not fit that pattern counts as none,
and the site sends nothing.

When a post or a page is published, changed, moved or deleted, the CMS submits
its URL. A move submits the old URL and the new one. Unpublishing, trashing and
deleting submit the URL that went away. The changes of the next ten seconds go
out together as one `POST` to `https://api.indexnow.org/indexnow`:

```json
{
  "host": "example.com",
  "key": "0123456789abcdef0123456789abcdef",
  "keyLocation": "https://example.com/0123456789abcdef0123456789abcdef.txt",
  "urlList": ["https://example.com/hello/"]
}
```

A network failure, a 429 or a 5xx answer is tried again after ten seconds, then
after forty. Any other refusal, such as a 403 for a key the engine could not
fetch, is not. A batch that still fails is logged as a warning, and the post
stays published.

Nothing is sent for a draft or a scheduled post, for the boot scan, or while
the base URL's host is local: `localhost`, a `.local` name, or a private IP
address.

A site can change how the CMS sends with `indexNow` in its config. Every field
is optional:

```ts
export default defineConfig({
  indexNow: {
    fetch, // what submits the URLs; a test names one
    endpoint: 'https://www.bing.com/indexnow',
    batchMs: 10_000,
    attempts: 3,
    backoffMs: (attempt) => attempt * attempt * 10_000,
    logger: console,
  },
});
```

## Theme overrides

A site's themes live one directory per theme under `themesDir` (`themes/` by
default), each with a `theme.json` naming it:

```json
{
  "name": "Midnight",
  "kind": "site",
  "description": "Dark, quiet, mostly type."
}
```

`name` is what a person reads, `kind` is `site` — the only kind there is, and
the field is in the file so another can be added later without the format
changing — and `description` is optional. The directory name is the theme's id.

One setting in `content/_data/site.json`, `theme`, says which one the site is
wearing, and that id is what it holds:

```json
{ "theme": "midnight" }
```

**Appearance > Themes** in the admin is where the choice is made. It lists the
theme inside this package and every folder under `themesDir` with its name and
description, marks the one in use, and Activate on another writes the setting —
or, on the packaged theme, takes the key out of `site.json` again, which is why
a site wearing it has no `theme` key rather than an empty one. A folder whose
`theme.json` is missing, unparseable or names another kind is listed under
"Not themes" with the reason, so a typo is something you can see on the screen
that would otherwise have shown the theme. Activating takes effect on the next
request, with no restart. Editing the setting by hand does exactly the same
thing.

A template is then looked up in that theme first and in the theme that ships
inside this package second, file by file. Sites override one template at a time
and keep receiving updates to the rest. Files under `/theme/` resolve the same
way, so `themes/midnight/static/style.css` replaces the packaged stylesheet,
and the [email messages](#messages) under `mail/` resolve the same way too.

Neither the setting nor `themesDir` need exist. A site that names no theme
serves every page, the 404 and the stylesheet out of the packaged theme, and an
unchosen theme sitting in `themes/` changes nothing. A `theme` naming a
directory that is not there, or one whose manifest will not read, falls back to
the packaged theme with a warning in the log rather than a broken site.

A theme that ships only

```
themes/midnight/layouts/post.njk
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

The admin is not themed. Its templates and its static files live in a tree of
their own with a loader of their own, deliberately off this search path, so no
theme can shadow the login form or the CSRF field inside it.

The packaged theme is the Paper design (doc-9) on the andrewshell.org shell
(decision-16). Its stylesheet is written in Tailwind v4 in
`themes/default/src/style.css` and compiled to `themes/default/static/style.css`
when the package is built (decision-22), so what ships is one plain CSS file; a
site theme's own `static/style.css` replaces it wholesale and needs no
Tailwind. Every colour is a `--color-*` custom property a site can override.
`base.njk` is its shell: a skip link, a `.global-wrapper` carrying `data-is-root-path="true"`
at `/` only, a header that is the site title and tagline on the front page and a
small link home on every other — with `menus.primary` inside it on every page
— `<main id="main">`, and a footer with the copyright year, the site author's
display name (the site title on a site with several authors), the colophon and
`menus.footer`. The footer reads nothing off an account: it
used to print an RSS link and one `rel="me"` link per link on the site author's
profile, and a site that wants either types it into its footer menu. Nothing
particular to one site is in it — webrings and badges belong in a site theme's
`footer` block. Its head
carries a description, Open Graph and Twitter card tags, icons derived from the
site's avatar, and one JSON-LD `@graph` from `partials/jsonld.njk`: that partial
is all the structured data the theme emits, there is no Microdata anywhere, and
a site that wants a different graph replaces the one file. The stylesheet
is a serif body and sans headings at an 18px root, one column at 42rem, warm
paper with a rust primary and a blue secondary, and a second scheme under
`prefers-color-scheme: dark` that redefines the same `--color-*` tokens on dark
paper. Both meet WCAG 2.2 AA, checked by a test that reads the custom properties
out of the stylesheet and computes the ratios.

The context mirrors what an Eleventy layout receives — `title`, `date`, `tags`,
`content`, `page.url`, and every front matter key the file carried — plus
`site`, which is `content/_data/site.json`. It is part of the semver contract.
The one key that is not the front matter's own string is `author`: it is the
person the file names, resolved against the site's users, with `author.name` to
print and `author.url` — their archive at `/author/{username}/` — to link to
when the name is one of them. `siteAuthor` is the same object answering a
different question — who the page in front of the reader is by, which is the
entry's author on a document, the archive's person on an author archive and the
profile behind the site's `author` setting everywhere else — so the bio, the
`rel="me"` links and any structured data a theme emits all read one profile.
The full table of context keys, blocks and
filters is in [`themes/default/README.md`](./themes/default/README.md).

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

### Moving a `theme/` directory

Before named themes a site had one `theme/` directory, always on the search
path, pointed at by `themeDir` and `GEEKITY_THEME_DIR`. Both are gone and
neither is aliased, so a site carrying one moves it:

```sh
mkdir -p themes/mine
git mv theme/* themes/mine/
rmdir theme
```

Then write `themes/mine/theme.json` with a `name` and `"kind": "site"`, choose
it on **Appearance > Themes** (or put `"theme": "mine"` in
`content/_data/site.json`), and drop `themeDir` from `geekity.config.ts` and
`GEEKITY_THEME_DIR` from the environment — a config naming `themeDir` is now a
type error and the variable is ignored. Nothing inside the theme changes: the
layouts, partials, `mail/` and `static/` keep their names and their meaning.
Until it is chosen the site serves the packaged theme, so the move and the
choice belong in the same deploy.

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
the rules the CMS follows that Eleventy does not know about on its own:

| Rule                                            | How the config does it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `draft: true` hides a document                  | An `addPreprocessor` that returns `false` for it. `BUILD_DRAFTS=1` builds drafts anyway, for a local preview.                                                                                                                                                                                                                                                                                                                                                                                                       |
| `visibility: unlisted` is listed nowhere        | An `addPreprocessor` that sets `eleventyExcludeFromCollections` on the document, so a feed, sitemap or archive drawn from collections leaves it out, and sets `noindex` for the layout to print as `<meta name="robots" content="noindex">`. Any value other than `public` or `unlisted` returns `false`, as a draft does.                                                                                                                                                                                          |
| A file with no `permalink` gets the CMS default | An `addPreprocessor` that fills in `/{yyyy}/{mm}/{slug}/` for a post and `/{slug}/` for a page, slugifying the title exactly as the CMS does. Front matter always wins; the CMS writes `permalink` into every file it saves, so this only matters for hand-authored files.                                                                                                                                                                                                                                          |
| `content/uploads/` is served at `/uploads/`     | `addPassthroughCopy({ 'content/uploads': 'uploads' })`, plus an `ignores` entry for the same path. Without the ignore, an upload that happens to be Markdown would be copied _and_ rendered as a page; the CMS only ever indexes `posts/` and `pages/`.                                                                                                                                                                                                                                                             |
| `content/_data/federation/` is data             | `followers.json` is an ordinary data file in a namespaced `_data` subdirectory, so Eleventy hands it over as `federation.followers` without being told. The monthly inbox logs are JSON Lines, which Eleventy has no reader for, so the config registers one with `addDataExtension('jsonl', …)`: each month becomes an entry of `federation.inbox`, keyed by its `{yyyy}-{mm}` name.                                                                                                                               |
| `content/_data/comments/` is the same thread    | The conversation under a post is not only the inbox log: the approved comments in `content/_data/comments/{slug}.json` thread with it. The `conversation` filter takes the post's slug as a second argument and reads that file directly, rather than through the data cascade — a namespaced `_data/comments/` directory would arrive as a global called `comments`, and `comments: true` in a post's front matter would shadow it on exactly the pages that need it. The slug is on the context as `geekitySlug`. |
| `content/_trash/` is not published              | `ignores.add('content/_trash/**')`. Eleventy skips `_includes` and `_data` because they are configured directories, not because of the underscore, so the trash has to be named.                                                                                                                                                                                                                                                                                                                                    |
| Dates are shown in the site's `timezone`        | A `date` filter with the CMS's four formats: `readable`, `html` and `year` are the calendar the site's zone was on at the instant, `iso` is the instant in UTC. The zone is read from `content/_data/site.json`, which the settings screen writes, so a zone changed in the CMS changes the built pages too.                                                                                                                                                                                                        |
| A future `date` holds a post back               | An `addPreprocessor` that returns `false` for it. This is the one rule that cannot be exactly the same in both places: a build has no clock, only a moment. A scheduled post is left out of the build that runs before its date and is in the next build after it, so a scheduled site needs a build on a schedule; the CMS publishes it on the date by itself. `BUILD_SCHEDULED=1` builds them anyway.                                                                                                             |

It also builds two collections Eleventy has no notion of. `collections.categories`
is the second taxonomy, one entry of `{ name, posts }` per category in use, for
paginating into archives at `/{{ site.categoryBase }}/{name}/`.
`collections.menus` is the site's named menus — the `menus` object of
`site.json`, and nothing else — each an ordered list of `{ label, url }`
entries, plus `rel` on a link that carries `rel` values; a layout
marks the current one itself by comparing `item.url` with `page.url`, because a
collection is built once for the whole site.

The `date` filter is the one that needs a word. The files hold UTC instants and
the `timezone` setting decides how they read, so the config's filter takes the
zone from `content/_data/site.json` — the file the settings screen writes —
and renders with `Intl`, which keeps the file free of dependencies. If your site
already uses [Luxon](https://moment.github.io/luxon/), which Eleventy ships
anyway, the same filter is shorter:

```js
import { DateTime } from 'luxon';

const zone =
  JSON.parse(readFileSync('content/_data/site.json', 'utf8')).timezone ?? 'utc';

eleventyConfig.addFilter('date', (value, format = 'readable') => {
  const at = DateTime.fromJSDate(
    value instanceof Date ? value : new Date(value),
  ).setZone(zone);
  if (!at.isValid) return '';

  // `iso` is the instant, never the zone: a <time datetime> and a feed want
  // UTC and must not move when a setting does.
  if (format === 'iso') return at.toUTC().toISO();
  if (format === 'html') return at.toFormat('yyyy-MM-dd');
  if (format === 'year') return at.toFormat('yyyy');
  return at.toFormat('d LLLL yyyy');
});
```

Either way it is the CMS's own filter, format for format, so a layout moved
across prints the same dates.

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
build needs its own. `/sitemap.xml` and `/robots.txt` are the same story, and
for the same reason. Everything else is the same directory.

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
