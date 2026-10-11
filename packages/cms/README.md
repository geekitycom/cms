# @geekity/cms

A file-first CMS. Content is Markdown on disk, laid out so Eleventy can build
the same directory unchanged. One Node process is both the editor and the public
website. SQLite holds a derived index plus the data that has no natural file
form.

Requires Node 24 or newer, the active LTS line.

## A new site

```sh
pnpm dlx @geekity/cms init my-site
cd my-site
pnpm install
pnpm dev
```

That is a running site on <http://localhost:3000> with a post, an About page, a
starter privacy page and the packaged theme. `geekity init` refuses a directory
that already has anything in it, so it can never write over a site you already
have.

## An existing project

```sh
pnpm add @geekity/cms
```

Then write a `geekity.config.ts` and a `content/` directory, and either add an
entry file or run `geekity serve`.

## Upgrading

```sh
pnpm up @geekity/cms
```

Database migrations ship inside the package and run on boot, so a version bump
is the whole upgrade. [Upgrading](https://github.com/geekitycom/cms/blob/main/docs/getting-started.md#upgrading)
lists what semver covers.

## Documentation

The guides live in the repository's
[`docs/`](https://github.com/geekitycom/cms/blob/main/docs/README.md) folder:

- [Getting started](https://github.com/geekitycom/cms/blob/main/docs/getting-started.md)
- [The `geekity` command](https://github.com/geekitycom/cms/blob/main/docs/cli.md)
- [Configuration](https://github.com/geekitycom/cms/blob/main/docs/configuration.md)
- [Content](https://github.com/geekitycom/cms/blob/main/docs/content.md)
- [The admin](https://github.com/geekitycom/cms/blob/main/docs/admin.md)
- [The public site](https://github.com/geekitycom/cms/blob/main/docs/public-site.md)
- [Federation](https://github.com/geekitycom/cms/blob/main/docs/federation.md)
- [Feeds](https://github.com/geekitycom/cms/blob/main/docs/feeds.md)
- [Plugins and hooks](https://github.com/geekitycom/cms/blob/main/docs/plugins.md)
- [Themes](https://github.com/geekitycom/cms/blob/main/docs/themes.md)
- [Deploying](https://github.com/geekitycom/cms/blob/main/docs/deploying.md)
- [Building the same content with Eleventy](https://github.com/geekitycom/cms/blob/main/docs/eleventy.md)

## License

MIT
