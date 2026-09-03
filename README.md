# Geekity CMS

A file-first CMS. Content is Markdown on disk, laid out so Eleventy can build
the same directory unchanged. One Node process is both the editor and the public
website. SQLite holds a derived index plus the data that has no natural file
form.

This repository is a pnpm workspace. The CMS ships to npm as `@geekity/cms`; a
site is its own repository that depends on the package.

This file is the contributor guide: the workspace, the gates, CI and releasing.
If you are **building a site** on the package, read
[`packages/cms/README.md`](packages/cms/README.md) instead — it covers
`geekity init`, the config options, the CLI, hooks and theme overrides.

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
  themes/default/      default theme, shipped inside the package
  templates/site/      files `geekity init` copies into a new site
  dist/                tsc output (JS + .d.ts), gitignored
apps/demo/             private site that consumes the package via workspace:*
  geekity.config.ts
  server.ts
  content/           six posts, three pages and _data/site.json
    _includes/       the two layouts an Eleventy build of the same files needs
  theme/             the two files this site overrides: post.njk and style.css
  eleventy.config.js re-exports the documented example config
  test/              boots the demo over HTTP, and builds it with Eleventy
scripts/               pack-install-smoke.sh, the body of the CI job of the same name
backlog/               tasks, docs and decisions (Backlog.md)
```

## Requirements

Node 24 or newer and pnpm. Node 24 is the active LTS line, and it is the first
one where `node:sqlite`, which the content index is built on, boots without an
`ExperimentalWarning`. CI also runs the suite on the current line so the next
LTS holds no surprises. The pnpm version is pinned in `packageManager`, so
Corepack picks the right one:

```sh
corepack enable
pnpm install
```

## Commands

Run from the repository root.

| Command              | What it does                                                              |
| -------------------- | ------------------------------------------------------------------------- |
| `pnpm install`       | Installs both workspace packages and links `apps/demo` to `packages/cms`. |
| `pnpm dev`           | Starts the demo site with `tsx watch` (`pnpm --filter demo dev`).         |
| `pnpm start`         | Starts the demo site once, without watching.                              |
| `pnpm build`         | Compiles `packages/cms` to `dist/` and bundles the admin editor.          |
| `pnpm test`          | Runs the `node:test` suites in every package through `tsx`.               |
| `pnpm test:coverage` | The same suites with `--experimental-test-coverage`.                      |
| `pnpm test:11ty`     | Builds the fixtures and the demo content with Eleventy, comparing URLs.   |
| `pnpm typecheck`     | `tsc --noEmit` across the workspace, tests included.                      |
| `pnpm lint`          | Fans out to each package's lint script.                                   |
| `pnpm lint:fix`      | The same, with eslint's fixes applied.                                    |
| `pnpm format`        | Rewrites every file prettier owns.                                        |
| `pnpm format:check`  | Fails if any of them is not already formatted.                            |
| `pnpm clean`         | Removes build output.                                                     |

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
  themeDir: 'theme',
  baseUrl: 'http://localhost:3000',
  watch: true,
});
```

Every field is optional. Relative directories resolve against the working
directory; absolute ones are used as given.

| Field        | Default                   | Environment override        | Meaning                                                                                    |
| ------------ | ------------------------- | --------------------------- | ------------------------------------------------------------------------------------------ |
| `port`       | `3000`                    | `GEEKITY_PORT`, then `PORT` | Port the HTTP server listens on.                                                           |
| `contentDir` | `<cwd>/content`           | `GEEKITY_CONTENT_DIR`       | Markdown content.                                                                          |
| `dataDir`    | `<cwd>/data`              | `GEEKITY_DATA_DIR`          | Derived state, including the SQLite index.                                                 |
| `themeDir`   | `<cwd>/theme`             | `GEEKITY_THEME_DIR`         | Site template overrides, resolved before the packaged default theme.                       |
| `baseUrl`    | `http://localhost:<port>` | `GEEKITY_BASE_URL`          | Public origin for canonical URLs, feeds and ActivityPub ids. A trailing slash is stripped. |
| `watch`      | `true`                    | `GEEKITY_WATCH`             | Watch `contentDir` while serving and keep the index in step.                               |

The admin adds two more:

| Field            | Default             | Environment override       | Meaning                                                        |
| ---------------- | ------------------- | -------------------------- | -------------------------------------------------------------- |
| `uploadMaxBytes` | `10485760` (10 MiB) | `GEEKITY_UPLOAD_MAX_BYTES` | Largest file the editor's upload endpoint accepts.             |
| `uploadTypes`    | every type below    | `GEEKITY_UPLOAD_TYPES`     | Extensions it accepts, as a list (comma-separated in the env). |

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

## The content index

Markdown files are the source of truth; SQLite is a derived index over them, so
deleting `data/geekity.db` is safe and the next boot rebuilds it.
`createCms` opens it against `dataDir` (creating the directory) and applies the
migrations the package ships. Migrations are versioned and recorded, so
applying them again does nothing.

```ts
const cms = createCms({ dataDir: 'data' });

cms.store.upsert(parseDocument(source, { path: 'posts/2026-09-02-hello.md' }));

cms.store.getByPermalink('/2026/09/hello/'); // the same Document back
cms.store.listPosts({ limit: 10, offset: 0 }); // published, newest first
cms.store.listByTag('eleventy', { type: 'post' });
cms.store.listAll({ draft: true }); // the admin's view
cms.store.counts(); // { total, posts, pages, drafts, trashed }
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
  trash is all it takes. `listPosts` and `listByTag` exclude drafts and trash;
  `listAll` shows drafts but hides trash unless asked with `{ trashed: true }`.
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
  never indexed.
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
for a scan (including the one on boot) and `watch` for a live edit. A cold
index reports its whole first scan as `created`, so a subscriber that must not
act on a rebuild should check `origin`.

Set `watch: false` (or `GEEKITY_WATCH=false`) to scan on boot and stop there.

## The public site

`createCms` mounts the public site on the app:

| Route                  | What it serves                                                                |
| ---------------------- | ----------------------------------------------------------------------------- |
| `/`                    | Published posts, newest first.                                                |
| `/page/2/` and up      | Later pages of the same archive.                                              |
| a document's permalink | The post or the page, through the theme.                                      |
| `/tags/{tag}/`         | Everything published carrying that tag, paginated at `/tags/{tag}/page/2/`.   |
| `/theme/…`             | The theme's own files, from its `static/` directory, cacheable and validated. |
| `/uploads/…`           | Files under `content/uploads/`, at the URLs an Eleventy build copies them to. |
| anything else          | The theme's 404.                                                              |

Drafts and documents in the trash 404 and appear in no listing. Trailing
slashes are canonical, and a request that arrives without one redirects 301 —
but only when the canonical URL resolves, so a missing address 404s straight
away instead of bouncing first. `/page/1/` redirects to `/`.

Documents are resolved after every registered route has failed to match, so
routes a site adds — and the admin and federation routes of later milestones —
always win over a permalink that would collide with them.

How many posts a listing page holds comes from `postsPerPage` in
`content/_data/site.json`, and defaults to 10. The same file is the `site`
global in every template.

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

`POST /admin/uploads` stores one file at
`content/uploads/{yyyy}/{mm}/{slug}{ext}` and answers with `{ url, markdown }`.
A name is never overwritten: a second `photo.png` becomes `photo-2.png`. Three
things have to agree before anything is written — the extension is on the
site's allowlist, the media type the browser declared is one that extension may
have, and the file's first bytes are that format's — and a file that is too
big gets a 413 and one of the wrong type a 415, both as JSON. See
[`uploadMaxBytes` and `uploadTypes`](#configuration).

Both endpoints are behind the admin's guard and need the session's CSRF token,
like every other POST in the admin.

## The theme

Templates are Nunjucks (decision-4). The default theme lives in
`packages/cms/themes/default` and ships inside the package: `layouts/` for the
base layout, home, post, page, tag archive and 404; `partials/` for the post
list, the pager and the tag macros; `static/style.css`, served at
`/theme/style.css`. It is plain CSS with no build step.

A template is looked up in the site's `themeDir` first and in the packaged
theme second, one file at a time, so a site that ships only
`theme/layouts/post.njk` replaces the post layout and keeps receiving updates
to every other template. Assets under `/theme/` resolve in the same order.

The context mirrors what an Eleventy layout receives — `title`, `date`, `tags`,
`content`, `page.url`, and every front matter key the file carried — so a
layout can move between an Eleventy build and the CMS with few edits. The
context, the blocks and the filter set (`date`, `url`, `absoluteUrl`) are part
of the semver contract; they are documented in
[`packages/cms/themes/default/README.md`](packages/cms/themes/default/README.md).

`apps/demo/theme/` is the worked example. It holds two files:
`layouts/post.njk`, which extends the packaged base layout and adds a byline
and a reading time, and `static/style.css`, which replaces the packaged
stylesheet at `/theme/style.css`. Everything else the demo serves still comes
from the package, which is what `apps/demo/test/site.test.ts` asserts over
HTTP. A stylesheet is the one all-or-nothing override: assets resolve file by
file the way templates do, so a site's `style.css` is served instead of the
packaged one, not after it.

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
   follow [Publishing to npm](#publishing-to-npm) below.

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
