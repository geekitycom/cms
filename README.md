# Geekity CMS

A file-first CMS. Content is Markdown on disk, laid out so Eleventy can build
the same directory unchanged. One Node process is both the editor and the public
website. Everything a site cannot afford to lose is a file; SQLite is a cache
over those files that may be deleted at rest and is rebuilt on the next boot.

This repository is a pnpm workspace. The CMS ships to npm as `@geekity/cms`; a
site is its own repository that depends on the package.

## Start a site

You need Node 24 or newer.

```sh
pnpm dlx @geekity/cms init my-site
cd my-site
pnpm install
pnpm dev
```

The site runs on <http://localhost:3000> with a post, an About page, a privacy
page and the default theme. [Getting started](docs/getting-started.md) says
what `geekity init` writes. To run a site from the published Docker image, see
[Deploying](docs/deploying.md).

## Work on the CMS

```sh
corepack enable
pnpm install
pnpm dev
```

`pnpm dev` serves the demo site in `apps/demo`.
[Developing Geekity CMS](docs/development.md) covers the workspace, the
commands, the quality gates, CI and releasing. Commit messages follow the rules
in [`CLAUDE.md`](CLAUDE.md).

## Documentation

[The documentation index](docs/README.md) lists every page. These are the ones
most people start with:

- [Configuration](docs/configuration.md)
- [The `geekity` command](docs/cli.md)
- [Content](docs/content.md)
- [The admin](docs/admin.md)
- [Federation](docs/federation.md)
- [Plugins and hooks](docs/plugins.md)
- [Themes](docs/themes.md) and [the default theme](docs/theme/README.md)

## Packages

| Package                                                                  | What it is                                                       |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| [`@geekity/cms`](packages/cms/README.md)                                 | The CMS, its admin, the default theme and the `geekity` command. |
| [`@geekity/plugin-wordpress`](packages/plugin-wordpress/README.md)       | Imports a WordPress site and its ActivityPub followers.          |
| [`@geekity/plugin-llm`](packages/plugin-llm/README.md)                   | A language model connection that other plugins call.             |
| [`@geekity/plugin-post-summary`](packages/plugin-post-summary/README.md) | Suggests a post's title and description in the editor.           |
| [`@geekity/plugin-tag-suggest`](packages/plugin-tag-suggest/README.md)   | Suggests tags for a post in the editor.                          |

## License

MIT
