---
id: doc-1
title: Architecture Overview
type: specification
created_date: '2026-09-02 13:21'
updated_date: '2026-09-02 13:37'
---
# Architecture Overview

Geekity CMS is a single Node.js process that is both the editing backend and the public website, in the same way WordPress is. Content is plain Markdown files on disk. A SQLite database holds a derived index of those files plus data that has no natural file form (users, sessions, ActivityPub followers and keys).

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
    cli.ts                    bin: geekity serve | init | sync | user add
    config.ts                 config schema and defaults
    content/
      parser.ts               front matter + markdown -> Document
      store.ts                SQLite index (upsert, delete, query)
      sync.ts                 full scan on boot + chokidar watcher
      writer.ts               Document -> markdown file (used by admin)
    web/                      public routes, content negotiation, theme rendering
    admin/                    auth, session, posts/pages/settings screens
    federation/               Fedify setup, actor, inbox handlers, outbox delivery
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
data/                         SQLite database, gitignored
.env                          secrets (session secret), gitignored
```

The `geekity` CLI also runs without an entry file (`geekity serve` reads `geekity.config.ts`), so the entry file exists only for sites that want to add their own Hono routes or middleware.

## Public API surface

- `createCms(config): Cms` returning `{ app: Hono, serve(), sync(), close() }`.
- `defineConfig(config)` for typed config files.
- Theme resolution: a template is looked up in the site `theme/` first, then in the package default theme. Sites override one file at a time.
- Hooks: `onDocumentChange`, `onPublish` for site-specific behaviour. Kept minimal in phase one.
- Semver applies to the config schema, the public API, the JSON representation, the content format, and the template context. Breaking changes to any of these are majors.

## Request flow

1. Hono receives the request. The Fedify middleware runs first and claims WebFinger, actor, inbox, outbox, and any request whose `Accept` asks for ActivityStreams.
2. Admin routes under `/admin` require a session cookie.
3. Everything else resolves the path against the content index. A hit returns the document in the negotiated format; a miss returns 404 through the theme.

## Sync model

- **Boot:** walk `content/`, parse every `.md`, upsert into the index, delete index rows whose file is gone.
- **Watch:** chokidar emits add/change/unlink. Changes are debounced per path (about 100 ms) and re-parsed. A content hash skips no-op writes.
- **Admin writes:** the writer serialises front matter and body, writes the file atomically (temp file + rename), then upserts the index directly so the response does not wait for the watcher. The watcher event that follows is a no-op because the hash matches.
- **Conflicts:** files win. If the admin edits a document whose on-disk hash changed since the form loaded, the save is refused with a diff-style warning rather than silently overwriting.

## Data that lives only in SQLite

- Users and password hashes, sessions.
- Site settings (title, tagline, base URL, timezone, posts per page). These are also mirrored to `content/_data/site.json` so an Eleventy build sees the same values.
- ActivityPub: actor key pairs, followers, delivered activity IDs, inbound activity log.

Database migrations ship inside the package and run on boot, so a site upgrade that changes the schema needs no manual step.

## Quality and release

- Every push and pull request runs lint (eslint), typecheck (tsc --noEmit), and tests (node:test) in GitHub Actions.
- Commits follow Conventional Commits, enforced locally by husky and commitlint and in CI on pull request titles.
- release-please opens a release pull request from the commit history; merging it tags a version and publishes `@geekity/cms` to npm with provenance (see decision-7).

## Non-goals for phase one

- Search.
- Media library beyond a simple upload directory.
- Comments (ActivityPub replies may be stored later).
- Multi-site.
- Plugin system beyond the two hooks above.
