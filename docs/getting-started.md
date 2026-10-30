# Getting started

## Requirements

Node 26 or newer, the active LTS line. The content index is built on
`node:sqlite`.

You also need pnpm. Corepack installs it for you. Node 26 does not include
Corepack, so install it from npm first, then turn it on:

```sh
npm install --global corepack@latest
corepack enable
```

## A new site

```sh
pnpm dlx @geekity/cms init my-site
cd my-site
pnpm install
pnpm dev
```

The site now runs on <http://localhost:3000>, with a post, an About page, a
starter privacy page and the packaged theme. `geekity init` refuses a directory
that has any entry in it, so it never writes over an existing site.

`geekity init` writes these files:

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
  _data/comments/     after the first comment: one JSON file per post
.gitignore            node_modules, data and .env
```

`geekity init` does not write `data/` or `themes/`.

- The site creates the index under `data/` on first boot. You can delete it
  safely.
- `themes/` is optional. It exists only after you write your own theme. A
  theme is one folder, `themes/<name>/`, with a `theme.json` in it. Choose it
  on **Appearance > Themes** in the admin. Until then, every page comes from
  the theme inside the package. [Themes](themes.md) has the details. The
  comment beside `themesDir` in the generated `geekity.config.ts` says the
  same.

The generated `package.json` pins `@geekity/cms` to the version of the CLI that
wrote it. A new site therefore always starts on a version it was tested with.

## An existing project

```sh
pnpm add @geekity/cms
```

Then write a `geekity.config.ts` and a `content/` directory. Add an entry file,
or run the bin. Nothing else is required.

## Upgrading

```sh
pnpm up @geekity/cms
```

Database migrations ship inside the package and run on boot. A version bump is
the only upgrade step.

Semver covers the config schema, `createCms`, the template context, the JSON
representation and the content format. A breaking change to any of them is a
major release, with a migration note in the changelog.

The upgrade to the release that renamed the session cookie signs every user
out of an https site once. See [Session hardening](security.md#session-hardening).

An upgrade never deletes a visitor's data. From the release that added
[retention](personal-data.md#retention), a site whose `site.json` sets no
period keeps every commenter email, address hash and contact message.
