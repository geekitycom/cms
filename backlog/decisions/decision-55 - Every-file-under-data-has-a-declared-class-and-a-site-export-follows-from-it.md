---
id: decision-55
title: 'Every file under data/ has a declared class, and a site export follows from it'
date: '2026-10-14 14:21'
status: proposed
---
## Context

decision-52 item 3 says every file in `data/` has a declared class, and a site export follows those classes. TASK-384 is the spike that lists the files and designs the export. This record is its result. Nothing here is built.

### How the files were found

The code was read on 2026-10-14 at commit 9053eef1 (`m39-site-export-spike`), in `packages/cms/src` and in the `src/` of the four published plugins. Three methods were used, and they agree.

1. **Path constants and joins.** A grep for `*_FILE`, `*_DIRECTORY` and `*_DIR` constants, and for every `path.join` whose first argument names `dataDir` or `contentDir`. A throwaway script that matches `join(… dataDir …)` on one line found 26 sites in source, plus one in a smoke script. It missed the file-storage join in `settings/registry.ts` (around line 161), which spans several lines. The build task therefore uses the TypeScript AST, not a regex.
2. **Write calls.** A grep for `writeFileAtomically`, `updateFileAtomically`, `writeFile`, `appendFile`, `mkdir`, `rename`, `copyFile`, `new DatabaseSync` and the plugin `host.data` calls. It matched 52 non-test source files in core and the plugins, and each write site was read.
3. **A recorded test run.** A throwaway `--require` hook wrapped the `node:fs` write functions and called `syncBuiltinESMExports()`. When a written path had an ancestor holding `geekity.db` (a data directory) or `_data/site.json` (a content directory), the hook logged the path relative to that ancestor, with the first `packages/` stack frame. It ran under `NODE_OPTIONS` for `pnpm test` in `packages/cms` (6010 tests pass) and in the four plugins (207 tests pass), and it logged 19,831 writes. Collapsed to patterns, these writes name every file in the table below and nothing else, apart from test fixtures (`late.json` from `drain.test.ts`, and `@test/plugin-*` folders). SQLite writes go through native code, so the hook does not see `geekity.db`; the code establishes it. The hook and the summariser were kept in the session scratchpad and are not in the repository.

### What is under `data/` today

The class is the one this record proposes (section 1 of the Decision). "Private" means the writer uses mode 0600, or the file holds personal data or secrets that belong to the site. A private file is still exported. Only a credential is left out unless the person exporting asks for it.

| Path under `data/` | Written by | Class | What is lost if it is lost |
| --- | --- | --- | --- |
| `keys/<user>.<alg>.jwk` (RSA and Ed25519) | `federation/keys.ts` (`actorKeyFile`, `loadActorKeyPairs`), `admin/legacy-migrations.ts` | kept, private | The actor's signing keys. New keys are minted, remote servers that cached the old key reject signatures until they fetch the actor again, and FEP-8b32 proofs on objects already sent stop verifying. This is the fediverse identity. |
| `users.json` | `site/users.ts`, `admin/legacy-migrations.ts` | kept, private | Every account: usernames (which are the actor ids), emails, argon2id hashes and profiles |
| `notification-secret` | `notifications/tokens.ts` | kept, private | Every moderation and unsubscribe link in mail already sent stops working |
| `comment-salt` | `forms/protection.ts` | kept, private | Address hashes written before the loss can no longer be compared with new ones |
| `comments/<slug>.json` | `comments/records.ts`, `comments/migrations.ts` | kept, private | Commenters' emails, and their reply subscriptions |
| `contact/<id>.json` | `contact/records.ts` | kept, private | Contact messages |
| `comment-optouts.json` | `notifications/optouts.ts` | kept, private | The list of people who unsubscribed. The site would write to them again. |
| `indieauth-tokens.json` | `indieauth/tokens.ts` | kept, private | Every connected IndieAuth or Micropub app has to sign in again |
| `locations.json` | `content/locations.ts` through `content/permalink-file.ts` | kept, private | Where each post was written |
| `kept-properties.json` | `content/kept-properties.ts` through `content/permalink-file.ts` | kept, private | Micropub properties the site does not understand, such as an RSVP |
| `plugin-changes.json` | `plugins/changes.ts` | kept | Who added, updated and removed which plugin. Nothing else holds it. |
| `jobs.json` | `jobs/file-records.ts` | kept (decision-54) | Queued jobs and the last five results for each job name |
| `dev-mode.json` | `settings/registry.ts` (namespace `dev_mode`) | kept (decision-53 said rebuildable; see Decision 7) | Dev mode. A lost file takes the site live. |
| `dev-mode.jsonl` | `settings/dev-mode.ts` | kept | The record that proves a migration was silent (decision-35) |
| `mail.json` | `settings/registry.ts` (namespace `mail`) | credential | The Brevo key or SMTP login. Typed in again on Settings > Email. |
| `akismet.json` | `settings/registry.ts` (namespace `akismet`) | credential | The Akismet key. Typed in again on Settings > Discussion. |
| `plugins/<name>/settings.json` | `settings/registry.ts` (folder storage), `plugins/migrate-settings.ts` | kept | The plugin's public settings |
| `plugins/<name>/secrets.json` | `settings/registry.ts` (folder storage) | credential | The plugin's API keys |
| `plugins/@geekity/plugin-wordpress/actors.json` | `plugin-wordpress/src/records.ts` through `host.data` | kept | Each user's WordPress actor number. The old `/wp-json/activitypub/1.0/actors/<n>` URLs, which followers who came from WordPress still follow, stop answering. This is identity too. |
| `plugins/@geekity/plugin-wordpress/import.json` | `plugin-wordpress/src/content-import.ts` through `host.data` | kept | Hashes of what the import wrote. A second import then reports every file as edited on this site and keeps the site's copy. |
| `plugins/@geekity/plugin-wordpress/requests.json` | `plugin-wordpress/src/records.ts` through `host.data` | kept | When each old WordPress path was last asked for. This is the evidence that the compatibility routes can be retired, and nothing else can rebuild it. |
| `plugins/@geekity/plugin-llm/last-call.json` | `plugin-llm/src/index.ts` through `host.data` | rebuildable | The figures of the last call. The next call writes them again. |
| `plugins/@geekity/plugin-tag-suggest/followers.json` | `plugin-tag-suggest/src/followers.ts` through `host.data` | rebuildable | A one-day cache of tags.pub follower counts |
| `indieauth-activity.json` | `web/indieauth-activity-log.ts` | rebuildable | The last 100 IndieAuth and Micropub requests (14 days at most), which exist for debugging. Leaving them out keeps personal data out of exports. |
| `notification-digests.json` | `notifications/digest.ts` | rebuildable | When each user last had a digest. One digest may come a window early. |
| `micropub-media.json` | `micropub/media.ts` | rebuildable | Each user's last upload for Micropub's `q=last`. Empty until the next upload. |
| `maintenance.json` | `settings/registry.ts` (namespace `maintenance`) | rebuildable (decision-53) | Maintenance mode. It falls back to off. |
| `geekity.db`, `-wal`, `-shm` | `cache.ts`, `store/`, `content/sqlite/` | rebuildable (decision-9) | The index and the followers, inbox and comment indexes, all rebuilt from files. Also sessions, password resets, spent link tokens, delivery outcomes (`ap_outbound`, `ap_deliveries`), sent webmentions, relay handshakes, cached actor profiles and the scheduler watermark (`cms_state`), which start empty. |
| `images/<upload path>/…` (variants, `image.json`, derived icons) | `images/variants.ts`, `images/icons.ts` | rebuildable (decision-10) | Derived again from `content/uploads/` when a page asks for them |
| `avatars/<hash>` | `avatars/avatars.ts` | rebuildable | Fetched again by the avatar sweep |
| `*.<pid>-<n>.tmp` | `files/atomic.ts` (`temporaryName`) | scratch | Nothing. A crash can leave one behind. |
| `jobs.json.lock`, `jobs.json.lock.takeover` | `jobs/lock-file.ts` | scratch | Nothing. A stale lock is taken over. |
| `queue.sqlite` (TASK-379, not built yet; the name is decision-54's suggestion) | Fedify `SqliteMessageQueue` | pending | Queued deliveries and Fedify's scheduled retries |

`@geekity/plugin-post-summary` writes nothing of its own under `data/`. Its settings live in its `settings.json`.

### What is under `content/` today

Everything in `content/` is the site, and it is kept. Writers found:

- `_data/site.json`: settings registry namespace `site`, `init.ts`, `admin/legacy-migrations.ts`, `plugins/migrate-settings.ts`.
- `_data/comments/<slug>.json`: `comments/records.ts`, `comments/migrations.ts`, and the WordPress import.
- `_data/federation/<user>/followers.json` and `inbox/<yyyy>-<mm>.jsonl`: `federation/records.ts`. `_data/federation/<user>/quotes.json`: `federation/quotes.ts`.
- `_data/replyContexts.json`: `webmention/reply-contexts.ts`. `_data/syndication.json` and `_data/syndicationTargets.json`: `webmention/syndication.ts`, `admin/syndication-targets.ts`.
- `_data/handles.json`: `content/handles.ts`. `_data/media.json`: `content/alt-text.ts` and the WordPress media import.
- `_data/redirects.json` and `_data/redirects/*.json`: `content/redirects.ts`, and `wordpress.json` from the WordPress import.
- Documents (`posts/`, `pages/` and the other collections): `content/write.ts`, `content/save.ts`, and the WordPress import. `_trash/`: `content/trash.ts`.
- `uploads/`: `media/uploads.ts`, `content/metadata/sweep.ts` (it rewrites files in place). `uploads/cited/`: `webmention/cited-picture.ts`. These are copies of remote pictures that may not be fetchable again, so they are kept.

Scratch under `content/`: the `.tmp` files of atomic writes, and the `.geekity-watch-<uuid>` directory that `content/sync.ts` makes and removes to check that the watcher works.

No credential is stored under `content/`. `site.json`'s `indexNowKey` is public by design, because it is served at `/<key>.txt`.

### Outside `data/` and `content/`

- `pluginsDir` (`/site/plugins` in the image) holds plugin bundles that `plugins/install.ts` writes. They can be installed again from npm.
- `themesDir` holds the owner's own themes. The site only reads it.
- The config file and the environment are the deployer's.
- The supervisor's control socket is in `tmpdir()` (`supervisor/control.ts`).
- Fedify's KV store is `MemoryKvStore`. IndieAuth codes and rate limits are in memory.

None of these is in an export. The export records what is needed to set them up again (section 4).

### Findings that shape the design

- **`secret` means two things today.** `DataClass` is `{ kept: true; secret: boolean } | { kept: false }`. The only reader of `secret` is `settings/registry.ts`, which writes a secret file at mode 0600. decision-52 uses "secret" to mean "exported only when asked". Actor keys, `notification-secret`, `comment-salt` and `users.json` are secrets by any reading, but leaving any of them out of an export would lose the site's identity or break its links. A file therefore needs a class that says "credential: typed in again from elsewhere", separate from "private". The file mode stays the writer's concern.
- **The plugin data folder takes any file name.** `pluginDataFolder` (plugins/registry.ts) checks that a name is one segment, and it hands out `path`, the absolute folder. No published plugin uses `path`. Two of the plugin files are identity or irreplaceable (`actors.json`, `requests.json`), and two are caches, so a plugin has to say which is which.
- **A rebuilt database announces nothing from before.** `content/schedule.ts` records a first-run instant and never announces anything dated earlier. An imported site therefore does not re-announce its archive. A post that came due between the export and the import is published, but it is not announced; `geekity resend` covers it.
- **Relays come back by themselves.** `relays.sync()` follows every relay in `site.relays` that has no row in `ap_relays`, so an imported site follows its relays again at boot.
- **The repository already reads tarballs.** `plugins/install.ts` unpacks npm tarballs with `node:zlib`. There is no zip dependency. Zip does not reliably carry Unix modes, and the private files here depend on mode 0600.

## Decision

### 1. The class model

`DataClass` in `settings/types.ts` is replaced by a union with one tag:

```ts
export type DataClass =
  /** The site cannot be rebuilt without it. Always exported. */
  | { readonly kind: 'kept' }
  /** Typed in again from another service: an API key, a login. Exported only when asked. */
  | { readonly kind: 'credential' }
  /** The site makes it again, fetches it again, or falls back to a default. Never exported. */
  | { readonly kind: 'rebuildable' }
  /** Work not done yet, tied to this host. Never exported; drained before a move. */
  | { readonly kind: 'pending' }
  /** Left by a write or a lock in flight. Never exported. */
  | { readonly kind: 'scratch' };
```

A farm would later add `{ kind: 'supplied' }` for values its control plane provides. The site neither stores nor exports such a value. Nothing is built for it. Callers use an exhaustive `switch` on `kind`, so adding the member breaks at compile time every place that has to decide about it.

`SettingDeclaration.secret` does not change. It still means "print `(set)` and never the value". The settings registry writes a namespace file at mode 0600 when its class is `credential`, or when any of its settings is secret, which is what it does today.

### 2. Every data file is declared in one table

A new module, `packages/cms/src/files/data-files.ts`, sits beside `atomic.ts` and holds the core declarations:

```ts
export interface DataFileDeclaration {
  /** Under `dataDir`, `/`-separated. `*` is one segment and `**` any depth: `keys/*.jwk`, `images/**`. */
  readonly pattern: string;
  readonly dataClass: DataClass;
  /** One sentence for the docs and `geekity export --list`: what is lost if it is lost. */
  readonly lost: string;
}

export const USERS = declareDataFile({ pattern: 'users.json', dataClass: { kind: 'kept' }, lost: '…' });
export const ACTOR_KEYS = declareDataFile({ pattern: 'keys/*.jwk', dataClass: { kind: 'kept' }, lost: '…' });
// … one per row of the table in Context

/** The one way to build a path under `dataDir`. */
export function dataPath(dataDir: string, file: DataFileDeclaration, ...parts: string[]): string;

/** Every declaration in effect for a site: core, the settings registry's files, and each loaded plugin's. */
export function siteDataFiles(options: { settings: SettingsRegistry; plugins: PluginRegistry }): readonly DataFileDeclaration[];
```

Settings namespaces are not declared twice. The registry already knows each namespace's file and class, so `siteDataFiles` asks it for them. The two scratch patterns (`**/*.tmp`, `**/*.lock*`) are declared once in this table. Their names come from `files/atomic.ts` and `jobs/lock-file.ts`, and a test pins them to the code that makes them.

Under `content/` there is no per-file table. Everything there is kept, apart from the same scratch patterns and `.geekity-watch-*`, which are declared as content scratch in the same module.

### 3. How a missing declaration fails

Three checks:

1. **Boundary test** (`data-files-boundary.test.ts`). It parses every non-test `.ts` file in `packages/cms/src` and `packages/plugin-*/src` with the TypeScript compiler API. It fails on any call to `path.join`, `join`, `path.resolve` or `resolve` whose first argument is an identifier or property access named `dataDir`, unless the call is in `files/data-files.ts`, `settings/registry.ts` or `plugins/registry.ts` (`pluginFolderPath`). The failure names the file, the line and the fix: "build the path with `dataPath` and a declaration in files/data-files.ts". Before the offending call is removed, the test is shown to fail on one added on purpose, as TASK-381 required of the settings boundary test. The sites the one-line scan found, plus the multi-line join, move to `dataPath` in the same task.
2. **Plugin data declarations.** A plugin names its files on its definition: `data: { 'actors.json': 'kept', 'followers.json': 'rebuildable' }`. The only classes a plugin may use are `kept`, `rebuildable` and `credential`. `PluginDataFolder.read` and `update` throw on an undeclared name, as they already throw on a name with a `/`. `PluginDataFolder.path` is removed. This is a plugin API break. It is released in the same major as decision-53's two breaks. A folder whose plugin is not loaded, such as a removed plugin, is exported whole as `kept`, because a site may add the plugin again.
3. **Census test** (`data-census.test.ts`). It boots one site with the four published plugins in the shape of `dev-mode-site.test.ts`. It then drives every writer in the table: a comment with an email, a contact message, an opt-out, a digest tick, a Micropub post with a location and an unknown property, an IndieAuth token and request, a job, an upload, an avatar, mail and Akismet credentials, plugin settings and a secret, an LLM call, a tag lookup, and a WordPress import with an actor number. Then it walks `data/` and `content/` and fails on any file that matches no declaration, naming the file. This catches writes the boundary test cannot see: Fedify's SQLite file, and a file written through a helper that takes a ready-made path. The recorded run in Context shows that today's tests already reach every row, so the fixture can be built from existing test helpers.

### 4. The export

**Format.** A gzipped tar, not a zip. The file is named `geekity-<host>-<yyyymmdd>T<hhmmss>Z.tar.gz` and written at mode 0600. The reasons are in Context: Unix modes survive, `node:zlib` streams it with no new dependency, and the repository already reads tarballs. This departs from decision-52's word "zip".

**Contents.**

```
manifest.json
content/…          everything under content/ except scratch; left out with --without-content
data/…             every file whose class is kept; credentials too with --with-credentials
```

`manifest.json` is the first entry:

```json
{
  "format": 1,
  "cms": "<the @geekity/cms version>",
  "exportedAt": "2026-10-14T15:00:00Z",
  "baseUrl": "https://shll.me",
  "content": true,
  "credentials": false,
  "devMode": false,
  "files": [{ "path": "data/users.json", "class": "kept", "size": 1234, "sha256": "…" }],
  "credentialsLeftOut": ["mail", "@geekity/plugin-llm"],
  "plugins": [{ "name": "@geekity/plugin-llm", "version": "1.2.0", "enabled": true }],
  "overrides": [{ "setting": "site.base_url", "source": "env GEEKITY_BASE_URL" }],
  "pending": { "deliveries": null, "jobs": { "queued": 0, "running": 0 } }
}
```

`overrides` lists setting names and sources from `settings.resolve`, never values. `credentialsLeftOut` names the namespaces whose credential files held a value. `plugins` comes from the enabled set and the plugin folder. `pending.deliveries` is `null` until TASK-379 gives the queue a count (task 8).

**Credentials.** These are left out unless the person asks: `--with-credentials` on the CLI, or a checkbox in the admin. Credentials set through the environment are never in a file, so they are never exported.

Every export holds actor keys, password hashes and personal data, whether or not credentials are included. The admin therefore asks for the user's password again before it starts an export, and the CLI prints a line saying the file is as sensitive as `data/`.

**Consistency.** Every writer replaces its file by rename, so each file read once is a whole file. The export takes no lock across files. A comment's email (`data/comments/`) and the comment (`content/_data/comments/`) can come from either side of one retention sweep. That case reads as a comment with no email, which the code already handles. SQLite files are never exported, so no SQLite backup API is needed.

**Pending work.**

- Fedify's queue (`queue.sqlite`, TASK-379) is never exported. A backup restored days later would otherwise replay stale deliveries. A restore on a second host while the first still runs would send everything twice. The rows also carry retry timing for this host. Once TASK-379 lands, the manifest records how many messages were waiting, and the admin and the CLI print the count. For a move, the documented order is: wait until the count is 0, export, stop the old site. Maintenance mode does not hold outbound deliveries (decision-35), so turning it on during the wait stops new inbound work while the queue drains.
- `jobs.json` is exported as `kept`, as decision-54 says. On the imported site, start-up recovery treats its queued and running jobs as cut off by a crash and runs them. Both jobs that exist today, strip-metadata and resend, are safe to run again.

**Surface.**

- `geekity export [--out <file>] [--with-credentials] [--without-content] [--list] [--config <file>]` reads only, so it runs while the site is serving. `--list` prints each declared pattern, its class and what is lost, and writes nothing.
- **Tools > Export** in the admin queues a `site.export` job on the decision-54 job queue, because a site with gigabytes of uploads would time out a request. The page asks for the password again and has the credentials checkbox. While the job runs, the page shows its progress (files and bytes). When the job finishes, the page offers a signed-in download of the archive. The job writes to `data/exports/`, which is declared `scratch`. Only the newest archive is kept, and it is deleted after 24 hours.

### 5. The import

`geekity import <file> [--replace] [--dev-mode] [--new-base-url] [--config <file>]` runs from the CLI only, with the site stopped.

1. Refuse while the site runs. The checks are the ones `geekity rebuild` and `geekity reload` use: `databaseInUse` (cli.ts) and `isServing` (supervisor/control.ts).
2. Read the manifest. Refuse a `format` newer than this version knows. Treat the archive as untrusted. Reject any entry outside `content/` and `data/`, any absolute path, any `..`, any link and any device. Check every file's sha256 against the manifest. Skip a `data/` entry whose declared class here is not `kept` or `credential`, such as a `geekity.db` someone added by hand, and say so.
3. Refuse when `content/` or `data/` already holds any file that is not scratch. With `--replace`, rename each one to `<dir>.before-import-<stamp>` first. Nothing is deleted.
4. Unpack into `<dir>.importing` beside each target, then rename into place. A crashed import leaves only the staging directories, and a second run removes them and starts again.
5. Compare the base URL in effect (config or environment, else the imported `site.json`) with `manifest.baseUrl`. If they differ, refuse unless `--new-base-url` is given. The refusal explains that actor ids are built from the URL, so followers would not follow the site to a new address. A `Move` is not part of this work.
6. If `--dev-mode` is given, set `dev_mode.on` to true through the registry. This is for a staging copy of a live site. Without the flag, dev mode stays as it was exported. This is why `dev-mode.json` is `kept`.
7. Run the rebuild. Its body is pulled out of `rebuildCommand` as `rebuildDatabase(config)`, and both commands call it, so an imported site's database is the one `geekity rebuild` makes.
8. Print what the owner still has to do:
   - Add each plugin from `manifest.plugins` with `geekity plugin add <name>@<version>`.
   - Set each override in `manifest.overrides` again.
   - Type in again each credential in `credentialsLeftOut`.
   - Every user signs in again.

**What a restored site keeps, rebuilds and loses.**

- **Kept:** the fediverse identity. The actor keys, `users.json` usernames and the base URL in `site.json` give the same actor ids and key ids. `content/_data/federation/` holds the followers, and the WordPress actor numbers are in `actors.json`. Connected IndieAuth apps keep working, because their token hashes are in `indieauth-tokens.json`. Links in mail already sent keep working (`notification-secret`). Address hashes stay comparable (`comment-salt`). Comment emails, opt-outs, contact messages, locations and kept properties are all restored.
- **Rebuilt at first boot or soon after:** the content, followers, inbox and comment indexes (the rebuild); relay follows (`relays.sync`); image variants and icons (derived again when a page asks for them); avatars (the sweep); the caches of the LLM and tag-suggest plugins.
- **Lost:** sessions, so everyone signs in again. Password-reset links in flight. Delivery outcomes, so the Federation screen starts with no history. The sent-webmention record, so a link removed later does not notify its old target. The scheduler watermark, so a post that came due between the export and the import is not announced; `geekity resend <slug>` sends it. Pending deliveries, which the move procedure drains first. Credentials, unless they were exported.

### 6. `geekity rebuild` does not change

It still deletes only `geekity.db` and its WAL files, and builds it again. Classes do not decide what it deletes. Image variants and avatars are rebuildable, but they are refreshed lazily, and deleting them would make the next page loads slow for nothing. One test pins the relation: every file `discardDatabase` removes matches a declaration of class `rebuildable`. The export therefore never contains a file that `rebuild` would delete.

### 7. Changes to earlier decisions

- **decision-53:** `dev_mode`'s file moves from rebuildable to `kept`. decision-35 says a lost variable must not take a site live, and the same holds for a lost file in a restore. `maintenance` stays rebuildable. `mail`, `akismet` and plugin `secrets.json` become `credential`, and plugin `settings.json` and `site` become `kept`.
- **decision-52:** the export is a `.tar.gz`, not a zip.
- **decision-54:** `data/exports/` is new scratch that a job writes. `jobs.json` stays kept.

## Consequences

- `DataClass` changes shape. The settings registry, five namespace declarations and the plugin folder storage change in the first task. Nothing outside `settings/` reads `dataClass` today.
- Every path under `data/` is built by `dataPath` with a declaration. About 27 call sites change. A new data file without a declaration fails the boundary test or the census test, and the failure names the fix.
- The plugin API loses `PluginDataFolder.path` and gains a required `data` declaration for any file a plugin keeps. This is a breaking change, released with decision-53's `siteInfo()` and `current()` breaks in one major. Plugins outside this repository that keep files must add the declaration.
- An export contains private data whatever the options. The admin asks for the password again, and the docs say to store the file as carefully as `data/`.
- Moving a site becomes: drain the queue, export, stop, import on the new host, point DNS. docs/deploying.md gains that procedure, and docs/personal-data.md gains a column for the class of each file and says that exports contain personal data.
- Pending deliveries are never in an export. Someone who skips the drain loses them. After TASK-379, the manifest's count shows that before it happens.
- TASK-379 must declare `queue.sqlite` as `pending` when it adds the file. If task 3 lands first, its census test fails on the undeclared file.

## Proposed tasks

1. **Data classes: declare every core data file and build its path through the declaration.**
   Replace `DataClass` with the tagged union of section 1. Add `files/data-files.ts` with one declaration per core row of the Context table, and `dataPath`. Move every `dataDir` join site onto it. Update the five settings namespaces and the folder storage. Change `dev_mode` to `kept`.
   - AC: `DataClass` is the union of section 1, and every `switch` on it is exhaustive.
   - AC: Every core file and folder in the table has a declaration with its class and a `lost` sentence.
   - AC: `data-files-boundary.test.ts` uses the TypeScript AST, fails on a `dataDir` join outside the allowed modules, and names the file, the line and the fix. It is shown to fail on a call added on purpose before that call is removed.
   - AC: A test pins the scratch patterns to `files/atomic.ts` `temporaryName` and `jobs/lock-file.ts`.
   - AC: A test asserts that every file `discardDatabase` removes is declared `rebuildable`.
   - AC: The settings registry writes mode 0600 exactly where it does today.

2. **Plugins declare their data files.**
   Add a `data` map to the plugin definition. `PluginDataFolder.read` and `update` refuse an undeclared name, and `path` is removed. The three published plugins that keep files declare them as in the table. The change is released with decision-53's plugin breaks.
   - AC: A plugin that writes an undeclared file gets an error that names the file and the `data` field.
   - AC: `@geekity/plugin-wordpress` declares `actors.json`, `import.json` and `requests.json` as kept. `@geekity/plugin-llm` declares `last-call.json` as rebuildable, and `@geekity/plugin-tag-suggest` declares `followers.json` as rebuildable.
   - AC: `siteDataFiles` returns core, settings and loaded plugin declarations. A folder whose plugin is not loaded reads as kept.
   - AC: docs/plugins.md documents `data` and the classes a plugin may use.

3. **A census test that every file a site writes is declared.**
   Boot one site with the four published plugins, drive every writer in the Context table, and walk `data/` and `content/`.
   - AC: The test fails on an undeclared file and names it. This is shown by a writer added on purpose and then removed.
   - AC: The fixture reaches every row of the table that exists in the code (all but `queue.sqlite` until TASK-379).

4. **`geekity export`.**
   A streaming tar.gz writer on `node:zlib`, the manifest of section 4, and the flags `--out`, `--with-credentials`, `--without-content`, `--list` and `--config`.
   - AC: The archive holds `manifest.json` first, every `kept` file, and `content/` without scratch. It holds no `rebuildable`, `pending` or `scratch` file.
   - AC: Credential files are present only with `--with-credentials`. `credentialsLeftOut` names the namespaces that were left out.
   - AC: File modes are kept: a 0600 file in `data/` is 0600 in the archive. The archive itself is written at 0600.
   - AC: The command runs while the site serves and changes no file under `data/` or `content/`.
   - AC: `overrides` lists sources without values, and `plugins` lists name, version and enabled.
   - AC: `--list` prints each declaration, its class and what is lost.

5. **`geekity import`.**
   The steps of section 5, with `rebuildDatabase` pulled out of `rebuildCommand` and shared by both commands.
   - AC: An export imported into empty directories boots with the same actor ids and key ids, and a test signs an activity before and after to show it. The users, followers, comment emails and opt-outs are the same. An IndieAuth token issued before the export is still accepted. A moderation link minted before the export still verifies.
   - AC: Import refuses while the site runs, refuses a newer `format`, refuses entries with `..`, absolute paths or links, and refuses a file whose sha256 does not match.
   - AC: Without `--replace`, import refuses non-empty directories. With it, the old directories are renamed and nothing is deleted.
   - AC: A different base URL in effect is refused unless `--new-base-url` is given.
   - AC: `--dev-mode` turns dev mode on. Otherwise dev mode is as exported.
   - AC: A second run after an import killed mid-unpack finishes with the same result.
   - AC: The command prints the plugins to add, the overrides to set, the credentials to type in again, and that everyone signs in again.

6. **Tools > Export in the admin.**
   A `site.export` job on the decision-54 queue, with password re-entry, the credentials checkbox, progress, and a download.
   - AC: Starting an export needs the current user's password. A wrong password queues nothing.
   - AC: The page shows the job's progress and, when it finishes, a download that only a signed-in user can fetch.
   - AC: `data/exports/` keeps only the newest archive, deletes it after 24 hours, and is declared scratch.

7. **Docs: classes, export and moving a site.**
   - AC: docs/personal-data.md gives each file's class and says that an export contains personal data.
   - AC: docs/deploying.md gains "Back up and move a site": drain, export, stop, import, DNS. It says what users must do again and what is lost.
   - AC: docs/cli.md documents `export` and `import`. docs/admin.md documents Tools > Export.

8. **After TASK-379: the queue file is pending, and the export counts it.**
   - AC: `queue.sqlite` is declared `pending`, and the census test covers it.
   - AC: `manifest.pending.deliveries` is the number of waiting messages. Tools > Export and `geekity export` print it before the export starts.
   - AC: A test shows that an export never contains the queue file.

Order: 1, then 2 and 3, then 4, then 5 and 6, then 7. Task 8 waits for TASK-379 and task 4. Tasks 1 to 3 change no behaviour a site can see, except the plugin API break in task 2.

## Open questions for the user

1. **tar.gz or zip.** decision-52 says zip. This record proposes `.tar.gz` for file modes and no new dependency. Accept, or keep zip and add a dependency?
2. **`dev-mode.json` is kept.** This changes decision-53's table. The alternative is that an import always comes up in dev mode, which makes every restore of a live site need a `dev-mode off`.
3. **Plugin declarations are strict.** An undeclared file throws. The lenient option treats undeclared files as kept and logs a warning, with no API break. Strict is proposed because the break rides an existing major.
4. **The queue is never exported.** The alternative is a SQLite backup-API snapshot of `queue.sqlite` behind a flag, for a move where the old host cannot wait for the drain.
5. **No admin import.** Restoring from the setup screen of a fresh install is possible later. It is left out because a running site replacing its own `data/` is the hard case.
6. **Plugin bundles are not exported**, only names and versions. An offline restore would need `pluginsDir` too.
7. **`indieauth-activity.json` is rebuildable**, to keep 14 days of request logs out of exports. Keep it instead?
