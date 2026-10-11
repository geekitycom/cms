# Getting started

## Requirements

Node 24 or newer, the active LTS line. It is the first line where `node:sqlite`,
which the content index is built on, boots without an `ExperimentalWarning`.

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
every page comes from the theme inside the package. [Themes](themes.md) has the whole of it, and the comment beside
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
of an https site once. See [Session hardening](security.md#session-hardening).

Upgrading never deletes a reader's data. The release that added
[retention](personal-data.md#retention) keeps every commenter email, address hash and contact
message on a site whose `site.json` has not set a period.
