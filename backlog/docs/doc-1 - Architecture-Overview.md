---
id: doc-1
title: Architecture Overview
type: specification
created_date: '2026-09-02 13:21'
updated_date: '2026-10-08 16:49'
---
# Architecture Overview

Geekity CMS is a single Node.js process that is both the editing backend and the public website, in the same way WordPress is. Content is plain Markdown files on disk. Everything a site cannot afford to lose is a file; the SQLite database is a cache — a derived index of those files, plus the sessions and the indexes rebuilt from them — and may be deleted at rest (decision-9).

The CMS ships as an npm package. A site is its own repository that depends on the package, owns its content and theme, and upgrades by bumping a version number. There is no upstream git relationship between a site and the CMS.

## Goals

- Posts and pages are Markdown files in a `content/` directory, laid out so that the same directory can be built by Eleventy with no conversion (see doc-2).
- Editing a file on disk shows up on the live site within a second or two. The admin UI writes files; it never bypasses them.
- One HTTP surface serves HTML, Markdown, JSON, and ActivityStreams JSON for the same URL, chosen by content negotiation (see doc-3).
- The site is an ActivityPub actor via Fedify. Publishing a post delivers it to followers (see doc-4).
- Admin UI is loosely modelled on WordPress classic: dashboard, posts, pages, settings. No block editor, no site editor (see doc-5).
- A site repo is small: content, theme overrides, one entry file, one dependency. Updates come from npm (see decision-6).
- Search is explicitly deferred. The design leaves room for a full-text index over the same SQLite database.

## Repository layout (this repo)

pnpm workspace with one publishable package and one private demo app.

```
packages/cms/                 published as @geekity/cms
  src/
    index.ts                  public API: createCms(config) and types
    cache.ts                  the SQLite file: its name, its migration ledgers, and what
                              happens to one this version cannot use
    cli.ts                    bin: geekity serve (a supervisor) | init | sync | rebuild | user add
    config.ts                 config schema and defaults
    content/
      parser.ts               front matter + markdown -> Document
      store.ts                SQLite index (upsert, delete, query)
      sync.ts                 full scan on boot + chokidar watcher
      writer.ts               Document -> markdown file (used by admin)
    web/                      public routes, content negotiation, theme rendering
    admin/                    auth, session, posts/pages/settings screens
    comments/                 the comment form, its restricted Markdown, the spam checker
                              seam and whether a post is still taking comments
      records.ts              content/_data/comments, and intakeComment: the one door
                              every comment enters by, whether the form, the webmention
                              endpoint or a moderator's reply proposed it (doc-6)
    webmention/               sending a post's webmentions, and verifying the ones sent
                              here before handing them to the intake (doc-7)
    federation/               Fedify setup, actor, inbox handlers, outbox delivery
      records.ts              content/_data/federation: followers.json + the inbox log
  themes/default/             default theme, shipped in the package
  templates/site/             files copied by geekity init
  test/
apps/demo/                    private site that consumes packages/cms via workspace
  content/
  theme/                      overrides a few default templates to prove the mechanism
  server.ts
.github/workflows/            ci.yml (lint, typecheck, test), release-please.yml
.husky/                       commit-msg (commitlint), pre-commit (lint-staged)
```

## Site layout (a repo created by geekity init)

```
package.json                  depends on @geekity/cms; scripts: dev, start
server.ts                     import { createCms } from '@geekity/cms'; createCms({...}).serve()
geekity.config.ts             content dir, data dir, theme dir, base URL, port
content/                      posts, pages, uploads, _data (see doc-2)
theme/                        optional overrides, resolved before the default theme
data/                         users.json and keys/ (back these up), the SQLite
                              cache and the derived images (delete freely); gitignored
.env                          secrets (session secret), gitignored
```

The `geekity` CLI also runs without an entry file (`geekity serve` reads `geekity.config.ts`), so the entry file exists only for sites that want to add their own Hono routes or middleware.

## Public API surface

- `createCms(config): Cms` returning `{ app: Hono, serve(), sync(), drain(), resume(), close() }`.
- `defineConfig(config)` for typed config files.
- Theme resolution: a template is looked up in the site `theme/` first, then in the package default theme. Sites override one file at a time.
- Hooks: `onDocumentChange`, `onPublish` for site-specific behaviour.
- Plugins: `plugins` on the config, and the `@geekity/cms/plugin` export a plugin builds against. See Plugins below.
- Semver applies to the config schema, the public API, the JSON representation, the content format, and the template context. Breaking changes to any of these are majors.

## Request flow

1. Hono receives the request. The Fedify middleware runs first and claims WebFinger, actor, inbox, outbox, and any request whose `Accept` asks for ActivityStreams.
2. Admin routes under `/admin` require a session cookie.
3. Everything else resolves the path against the content index. A hit returns the document in the negotiated format; a miss returns 404 through the theme.

## Sync model

- **Boot:** walk `content/`, parse every `.md`, upsert into the index, delete index rows whose file is gone. A missing database is created and filled by the same scan, so deleting it is a supported thing to do.
- **Watch:** chokidar emits add/change/unlink. Changes are debounced per path (about 100 ms) and re-parsed. A content hash skips no-op writes.
- **Admin writes:** the writer serialises front matter and body, writes the file atomically (temp file + rename), then upserts the index directly so the response does not wait for the watcher. The watcher event that follows is a no-op because the hash matches.
- **Conflicts:** files win. If the admin edits a document whose on-disk hash changed since the form loaded, the save is refused with a diff-style warning rather than silently overwriting.

## Where durable state lives (decision-9)

Files are the source of truth for everything a site cannot afford to lose; the database is a cache that can be deleted at rest and is rebuilt on the next boot or by `geekity rebuild`.

- `content/_data/site.json`: site settings (title, tagline, base URL, timezone, posts per page, author, actor handle and type, avatar). Public, in git, read by Eleventy.
- `content/_data/federation/followers.json` and `content/_data/federation/inbox/{yyyy}-{mm}.jsonl`: ActivityPub followers, one object per follower, and the inbound activity log, one compact JSON-LD activity per line with the time it arrived in front of it. Public, in git, exposed to Eleventy as `federation.followers` and `federation.inbox`. Every write updates the `followers` and `ap_inbox` indexes inside the same lock on the file, and both indexes are emptied and read back from the files on every boot.
- `data/keys/`: the actor's key pairs as JWK files. Private, backed up, never in git.
- `data/users.json`: usernames and password hashes. Private, backed up, never in git.
- `data/geekity.db`: the content index, the followers and inbox indexes, sessions, delivery outcomes, the relay handshake state, the scheduler's watermark, and later the search index. Disposable.
- `data/images/`: image variants derived from `content/uploads/` with an `image.json` sidecar each (decision-10). Disposable; a request for a variant that is not there derives it.

No table holds anything that is not either read back from the files on boot or something a site is told it may lose. What a delete actually costs is three things: every login (the accounts are in `users.json` and survive), the relay handshakes (each relay named in `site.json` is sent a fresh `Follow` on the next boot, and a `Reject` reason is lost), and any scheduled post that came due while the process was down — the scheduler treats an absent watermark as "start from here", precisely so a rebuilt database cannot re-announce the archive.

Database migrations ship inside the package and run on boot, so a site upgrade that changes the cache schema needs no manual step. A database older than the oldest migration the package still ships is thrown away and read back from the files without asking. One written by a newer `@geekity/cms`, or one SQLite will not open at all, refuses the boot naming the file: both are decisions for a person, and `geekity rebuild` is the command that acts on them — it deletes the database and rebuilds it exactly as a boot does.

The one capability this design gives up is that a post whose file is gone entirely cannot be tombstoned, because the `activitypub.id` a `Delete` needs was in the file. Trashing a post keeps the file under `_trash/` with its id, so the ordinary way of unpublishing still withdraws it.

## Plugins (decision-33)

Logic that some sites want and others do not lives in plugins rather than in core.

- **A plugin is a named module.** It declares `name`, `version`, `label`, `description`, `hostApi`, `requires` and `register(host)`, with optional `start` and `stop`. Its name is its npm package name, such as `@geekity/plugin-llm`. A plugin installed by hand declares a package-style name too. Two installed plugins with one name refuse the boot, and the error names both sources.
- **The package boundary.** A plugin imports nothing from core but `@geekity/cms/plugin`, a subpath export that holds the plugin and host types, `HOST_API_VERSION` and `definePlugin`. `definePlugin` returns its argument, so a bundled plugin needs no runtime import of core. The `host` passed to `register` is the plugin's only door into the CMS. It carries `apiVersion`, and a plugin whose `hostApi` is newer than the core's is unavailable. Removing or reshaping anything in the export is a breaking change. An ESLint rule holds the boundary for `apps/demo/plugins/` and `packages/plugin-*/`.
- **The registry.** Every installed plugin registers once at boot, in any order. No plugin can reach another during `register`. A site with its own `server.ts` installs plugins by passing them in `plugins` on its config. The registry lives in `src/plugins/registry.ts`.
- **Dependencies.** `requires` maps each required package name to the semver range it needs, the same pairs as the plugin package's peer dependencies. An installed plugin is unavailable, with the reason, when a dependency is missing or unavailable, or when it sits in a dependency cycle. The same applies when its name is not a package name, when it targets a newer host API, or when its `register` throws. The site still boots.
- **The enabled state.** The enabled set is the `plugins` key of `content/_data/site.json`, an object keyed by package name whose entries carry `"enabled": true`. A plugin's public settings sit beside `enabled` in its entry. The set is read on every request, so enabling and disabling take effect on the next request without a restart, whether made on Admin > Plugins or by editing the file. A plugin runs only while it is enabled, available, and everything it requires is running. A disabled plugin's routes fall through as if absent.
- **Enable and disable.** Admin > Plugins lists every installed plugin with its package, version, source, dependencies and state. A plugin cannot be enabled until every plugin it requires is installed and enabled. Its row names each one that is missing or disabled, with the range it needs and a link to that plugin's row. Nothing is enabled on the operator's behalf. Disabling a plugin that enabled plugins require is refused, and the refusal names them.
- **Lifecycle.** `start` runs for each running plugin, dependencies first, when the site serves and when the plugin is enabled. `stop` runs dependents first, on disable and in `close()`. Each request converges the running set on the enabled set, so a hand edit of `site.json` starts and stops plugins as well.
- **Extension points.** Core grows a host API only alongside the first plugin that uses it. The first one is public `GET` routes (`host.get`), used by the example plugins in `apps/demo/plugins/`.
- **Settings and secrets (TASK-283).** `host.settings(fields)` declares a plugin's settings as typed fields (text, url, select, checkbox, secret) and returns a reader whose `current()` gives typed values, read from the files and the environment on every call. A stored value a field does not accept falls back to the field's default. Public values sit in the plugin's entry under `plugins` in `site.json`, beside `enabled`, through the one writer of that key in `src/plugins/enabled.ts`. Secrets sit in `data/plugins/<package name>/secrets.json` at mode 0600, written atomically. An environment variable wins over the file: the package name, `__`, then the key, each upper-cased with every run of other characters as one `_` (`GEEKITY_PLUGIN_LLM__API_KEY`). Two installed packages whose names convert to one prefix are both unavailable, each naming the other. The code is `src/plugins/settings.ts`. First user: `@geekity/plugin-llm`.
- **Services between plugins (TASK-284).** A plugin provides at most one service, named by its package name, with `host.provide(service)` during `register`; a second `provide` fails its register, naming it. A plugin that lists the provider in `requires` reaches it with `host.use(name)`, which hands every consumer the one instance. `use` throws during `register` and on a name outside `requires`, so registration order never matters. The types come from `PluginServices`, a declaration map in `@geekity/cms/plugin` that the provider package augments: a consumer peer-depends on the provider and imports its types with `import type` (an ESLint rule refuses a value import of another plugin package), and `definePlugin` keeps `name` and `requires` as written, so `use` on a name outside `requires` is a type error and `use` returns the service without a cast. `host.siteInfo()` gives the site's base URL and title, read when asked. First provider: `@geekity/plugin-llm`'s `complete`.
- **Editor actions (TASK-285).** `host.editorAction({ id, field, label, offers?, suggest })` puts a button beside the editor's title, description or tags field while the plugin runs. Core draws the button, the suggestion and its Accept and Dismiss, and one core script, `admin/static/editor-actions.js`, drives them, so a plugin ships no markup and no browser script (the admin stylesheet is compiled from core's templates alone, and the admin policy stays `script-src 'self'`, `connect-src 'self'`). A press posts the form to `/admin/plugins/<package name>/editor/<id>`, inside the admin guard, so it needs a session and the page's CSRF token. Core reads the form as a save would (`submittedForm`) into a `PluginEditorDraft`: type, the post's kind by Post Type Discovery, whether it is saved, title, body, description, tags and language. It answers JSON, `{ ok, value }` or `{ ok: false, message }`. `offers(draft)` decides whether the button is drawn and is asked again on a press, which answers `withdrawn` when the draft no longer fits. A plugin that is not running, or an unknown id, falls through to a 404. Accepting fills the field (tags merge without duplicates) and saves nothing. The code is `src/admin/editor-actions.ts`. First user: `@geekity/plugin-post-summary`.
- **Choices and the site's tags (TASK-286).** A tags action may answer `{ ok: true, choices: [{ value, note?, badge? }] }` instead of one value. The editor draws each choice from a `<template>` row in `editor.njk` with a box to tick, its badge and its note, and Accept adds the ticked ones through the same merge. The boxes have no name, so a save never posts them. Choices beside the title or description are a failure. `PluginEditorContext.siteTags` hands the action every tag on a published document, most used first (`store.listTags()`), read when the button is pressed. First user: `@geekity/plugin-tag-suggest`.
- **Outbound fetch (TASK-286).** `host.fetch(url, { headers, signal })` is a `GET` that answers the `Response` as it came. It follows at most five redirects by hand, and checks every hop with `publicHost` over the config's `hostLookup`: a loopback, private or link-local address, or a name that resolves to one, rejects. `federation.allowPrivateAddress` on the config lifts the check, the same switch the federation's document loader uses. The plugin sets its own User-Agent, timeout and concurrency. A plugin caches in its own `host.data` folder; core adds no cache API. The code is `src/plugins/fetch.ts`. First user: `@geekity/plugin-tag-suggest`, which asks tags.pub for follower counts.
- **The plugins folder and a supervised reload (TASK-288).** `pluginsDir` on the config (`GEEKITY_PLUGINS_DIR`, no default) names a folder of plugins, `<name>/` or `@scope/<name>/`, each with a bundled `index.js` whose default export is the plugin; `geekity serve` imports them at boot and registers them beside `plugins` (`src/plugins/folder.ts`). `geekity serve` is a `node:cluster` supervisor that owns the port and runs the CMS in one worker (`src/supervisor/`). The Plugins screen fingerprints the folder and offers Reload, a CSRF-guarded POST to `/admin/plugins/reload`, when it differs from what the worker loaded. A reload drains the old worker first (`cms.drain()`): writes other than the reload itself get `503` and `Retry-After`, in-flight writes finish, the timers, the watcher and the plugins stop, the queues empty (the default Fedify queue is wrapped so its in-process messages are waited for), and then both SQLite connections go `query_only` and `src/files/atomic.ts` refuses every write under `dataDir` and `contentDir`. Only then is the new worker forked, so its boot migrations run alone. Once it listens, the old worker stops accepting and lets each open connection end on its own, by `Connection: close` or the keep-alive timeout. A new worker that fails to boot leaves the old one to `cms.resume()`, and the screen shows why. A worker that crashes is respawned with backoff. SIGTERM and SIGINT close every worker and exit 0.

## Quality and release

- Every push and pull request runs lint (eslint), typecheck (tsc --noEmit), and tests (node:test) in GitHub Actions.
- Commits follow Conventional Commits, enforced locally by husky and commitlint and in CI on pull request titles.
- release-please opens a release pull request from the commit history; merging it tags a version and publishes `@geekity/cms` to npm with provenance (see decision-7).

## Non-goals for phase one

- Search.
- Media library beyond a simple upload directory.
- Comments (ActivityPub replies may be stored later).
- Multi-site.
