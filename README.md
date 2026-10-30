# Geekity CMS

A file-first CMS. Content is Markdown on disk, in a layout that Eleventy can
build unchanged. One Node process serves both the editor and the public
website. Everything a site cannot afford to lose is a file. SQLite is a cache
over those files. You can delete it while the site is stopped, and the next
boot rebuilds it.

This repository is a pnpm workspace. The CMS ships to npm as `@geekity/cms`. A
site is its own repository that depends on the package.

## Start a site

You need Node 26 or newer.

```sh
pnpm dlx @geekity/cms init my-site
cd my-site
pnpm install
pnpm dev
```

The site runs on <http://localhost:3000> with a post, an About page, a privacy
page and the default theme. [Getting started](docs/getting-started.md) lists
what `geekity init` writes. To run a site from the published Docker image, see
[Deploying](docs/deploying.md).

## Work on the CMS

```sh
npm install --global corepack@latest
corepack enable
pnpm install
pnpm dev
```

Node 26 does not include Corepack, so the first command installs it.

`pnpm dev` serves the demo site in `apps/demo`.
[Developing Geekity CMS](docs/development.md) covers the workspace, the
commands, the quality gates, CI and releasing. Commit messages follow the rules
in [`CLAUDE.md`](CLAUDE.md).

## Documentation

[The documentation index](docs/README.md) lists every page. Start with
these:

- [Configuration](docs/configuration.md)
- [The `geekity` command](docs/cli.md)
- [Content](docs/content.md)
- [The admin](docs/admin.md)
- [Federation](docs/federation.md)
- [Plugins and hooks](docs/plugins.md)
- [Themes](docs/themes.md) and [the default theme](docs/theme/README.md)

## Packages

| Package                                                                  | What it is                                                         |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| [`@geekity/cms`](packages/cms/README.md)                                 | The CMS, its admin, the default theme and the `geekity` command.   |
| [`@geekity/plugin-wordpress`](packages/plugin-wordpress/README.md)       | Imports a WordPress site and its ActivityPub followers.            |
| [`@geekity/plugin-llm`](packages/plugin-llm/README.md)                   | A language model connection that other plugins call.               |
| [`@geekity/plugin-post-summary`](packages/plugin-post-summary/README.md) | Suggests a post's title and description in the editor.             |
| [`@geekity/plugin-tag-suggest`](packages/plugin-tag-suggest/README.md)   | Suggests tags for a post in the editor.                            |
| [`@geekity/plugin-umami`](packages/plugin-umami/README.md)               | Adds the Umami tracker to public pages and stats to the dashboard. |
| [`@geekity/md2gemini`](packages/md2gemini/README.md)                     | Converts Markdown to gemtext for Gemini.                           |

## License

MIT
