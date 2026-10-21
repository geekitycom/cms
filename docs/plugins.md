# Plugins and hooks

## Plugins

A plugin adds a feature that only some sites need, such as the WordPress
compatibility paths or a language model behind the editor (decision-33). Each
plugin is an npm package, such as `@geekity/plugin-llm`. Every installed plugin
loads when the site starts. Admin > Plugins enables and disables each one with
no restart.

On a site with its own entry file, install a plugin with npm and list it in
`plugins` in the config. A site on Docker has no npm and no `package.json`. On
Docker, install a plugin into the plugins folder with `geekity plugin add`.

> [!WARNING]
> A plugin runs inside the site process. It can read and write everything the
> site can, including every file under `data/`: the accounts, the actor key
> pairs and other plugins' secrets. Install only plugins you trust.

### The plugins in this repository

These plugins are published from this repository with each release. Each
package's README describes its settings.

| Package                                                                     | What it does                                                       |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| [`@geekity/plugin-wordpress`](../packages/plugin-wordpress/README.md)       | Imports a WordPress site and its ActivityPub followers.            |
| [`@geekity/plugin-llm`](../packages/plugin-llm/README.md)                   | A language model connection that other plugins call.               |
| [`@geekity/plugin-post-summary`](../packages/plugin-post-summary/README.md) | Suggests a post's title and description in the editor.             |
| [`@geekity/plugin-tag-suggest`](../packages/plugin-tag-suggest/README.md)   | Suggests tags for a post in the editor.                            |
| [`@geekity/plugin-umami`](../packages/plugin-umami/README.md)               | Adds the Umami tracker to public pages and stats to the dashboard. |

The Umami plugin replaces an Umami snippet in a site theme's
`partials/head-end.njk`. Install it on Docker with
`geekity plugin add @geekity/plugin-umami`, or with **Add plugin** on Admin >
Plugins. Enable it and set its Umami URL and website ID on its screen. Then
delete the old `<script>` from the theme, or each visit is counted twice. Its
[README](../packages/plugin-umami/README.md#moving-from-a-theme-snippet)
gives the steps.

### Installing a plugin on Docker

The image sets `GEEKITY_PLUGINS_DIR` to `/site/plugins`, and
[`deploy/compose.yaml`](../deploy/compose.yaml) mounts `./plugins` there. The
folder holds one folder per plugin, named by its package:
`plugins/@geekity/plugin-llm/`.

1. Install the package into the folder:

   ```sh
   docker compose exec geekity geekity plugin add @geekity/plugin-llm
   ```

   `plugin add` fetches the package's tarball from the npm registry, checks it
   against the integrity hash the registry published, and unpacks its bundle
   and manifest into the folder. To choose a version, give a version, a
   dist-tag or a range after the name, for example
   `@geekity/plugin-llm@0.1.0`. With no version, it installs `latest`. Running
   it again for the same version changes nothing. A newer version replaces the
   old folder in one step. Set `npm_config_registry` to use another registry.

   Then the command asks the running site to reload and prints the result. The
   reload starts a new worker with the current folder and retires the old one.
   The container does not restart and no request is refused.

2. Enable the plugin on Admin > Plugins.

`plugin add` installs only the package you name. If that plugin requires
other plugins, the command names each one that is missing or out of range. The
plugin's row on the Plugins screen names them too. Add each one the same way.
The command installs and enables nothing else.

`plugin add` refuses, and leaves the folder as it was, when:

- the tarball does not match the registry's integrity hash
- the package has no bundle (`dist/bundle/index.js` and `plugin.json`). Such a
  plugin installs only with npm, on a site with its own entry file.
- the bundle targets a host API version other than the one this core provides

To bring every plugin in the folder up to date, run `plugin upgrade`:

```sh
docker compose exec geekity geekity plugin upgrade
```

For each plugin, it installs the newest version that this core and the other
installed plugins can run. It checks each release's `@geekity/cms` range and
the ranges between plugins, and installs the same way as `plugin add`. It does
not install a prerelease, or a version newer than the `latest` dist-tag.

- If two plugins must upgrade together, such as a plugin that needs a newer
  `@geekity/plugin-llm`, it upgrades both, the required one first.
- If only one of them can upgrade, it holds that one back and says why.
- It never leaves an installed plugin with a requirement that is not met.

It prints one line per plugin. The line gives the old and new versions, says
the version is already the newest, or names the version it held back and why.
Then it names any requirement that is still not met. If anything changed, it
asks the running site to reload. It skips a plugin that is not on the
registry, or whose registry is unreachable, and continues with the others. The
command exits non-zero only when an install it attempted failed, or the site
could not start with the new versions.

- `geekity plugin upgrade @geekity/plugin-llm @geekity/plugin-post-summary`
  upgrades only the plugins it is given.
- `geekity plugin upgrade --check` prints the same report and installs
  nothing.

To remove a plugin, disable it on the Plugins screen, then delete its folder.
The site reloads without it:

```sh
docker compose exec geekity geekity plugin remove @geekity/plugin-llm
```

`plugin remove` refuses a plugin the site has enabled, as WordPress does.

To install a plugin that is not on npm, copy its bundle folder (`index.js`
and `plugin.json`) to `plugins/<package name>/`. The site loads it about five
seconds after the copy finishes, or at once when you press Reload.

A folder that cannot load does not stop the site. Its row on the Plugins screen
gives one of these reasons:

- the bundle failed to import
- it exports no plugin
- it targets another host API version
- its manifest names a range of `@geekity/cms` or of a required plugin that is
  not met

The commands a folder plugin adds, such as `geekity import wordpress-actor`,
run with `docker compose exec` the same way as core's.

### Installing from the admin

Admin > Plugins does the same as `geekity plugin add`, `upgrade` and `remove`
on a site with a plugins folder:

- **Add plugin** takes a package name and, optionally, a version, a range or a
  dist-tag. It installs the same way as `plugin add`, with the same checks, and
  names each requirement that is missing or out of range.
- **Check for updates** asks the registry for newer versions. A plugin with
  one shows **Update to** that version on its row.
- **Update all** brings every folder plugin up to date, the same way as
  `plugin upgrade`.
- **Remove** deletes the plugin's folder. Its folder under `data/plugins/`,
  which holds its settings, stays. Only a disabled plugin has Remove. Disable a plugin
  first, as in WordPress.

Each change asks for your password. An update or a removal first shows what it
will change. One change runs at a time. Under `geekity serve`, the site reloads
as soon as the change is made, and the screen then shows the change. On a site
you run another way, restart the site to load the change. Plugins passed in
`plugins` on a site's own config are shown as managed in code, with no
controls.

`data/plugin-changes.json` records every change made here, with who made it,
when, the package and the versions. The Plugins screen lists them under Recent
changes.

> [!WARNING]
> This puts new code on the server from a browser. A plugin runs as the site,
> with access to everything under `data/`, including the accounts, the actor
> key pairs and every plugin's secrets. Anyone who can sign in to the admin and
> knows their password can install one. To keep plugin changes on the command
> line, set `GEEKITY_PLUGIN_INSTALL=off`. The Plugins screen then shows no add,
> update or remove controls, and refuses those requests.

### Writing a plugin

A plugin package imports only `@geekity/cms/plugin`. Besides its types and
`definePlugin`, that module exports the helpers core uses, so a plugin does not
need its own copy:

- `slugify`: the slug the editor gives a title.
- `serializeDocument`: the Markdown file the site writes for a
  `DocumentContent`. When the site reads a file written this way and writes it
  back with no changes, the bytes stay the same.
- `writeFileAtomically`: writes to a temporary file beside the target, then
  renames it over the target.
- `isRecord`, `messageOf`, `withTrailingSlash`, `withoutTrailingSlash`.
- `repliesKey` and `webmentionKey`: the keys of a comment. `isKey` says whether an id is already one.

Its default export is the plugin:

```ts
import { definePlugin } from '@geekity/cms/plugin';

export default definePlugin({
  name: '@acme/plugin-hello',
  version: '0.1.0',
  label: 'Hello',
  description: 'Says hello.',
  hostApi: 3,
  requires: {},
  register(host) {
    host.get('/hello', () => new Response('hello'));
  },
});
```

`register` runs once when the site starts, whether the plugin is enabled or
not. It declares what the plugin adds through `host`:

- public routes (`get`)
- federation middleware
- one admin screen
- commands
- editor actions
- page tags
- dashboard widgets
- settings
- one service

`start` and `stop`, if present, run when the plugin is enabled and disabled.
`host` is the plugin's only access to the CMS, so a bundle needs no runtime
import of `@geekity/cms`.

**The package shape.** A `geekity` field in `package.json` marks the package as
a plugin and names the host API version it targets and the plugins it
requires. Each required plugin and `@geekity/cms` are also peer dependencies,
with a range:

```json
{
  "name": "@acme/plugin-hello",
  "version": "0.1.0",
  "type": "module",
  "files": ["dist"],
  "geekity": {
    "plugin": true,
    "hostApi": 3,
    "requires": { "@geekity/plugin-llm": ">=0.2.0 <1.0.0" }
  },
  "peerDependencies": {
    "@geekity/cms": ">=0.26.0 <1.0.0",
    "@geekity/plugin-llm": ">=0.2.0 <1.0.0"
  }
}
```

The plugin's `requires` holds the same names and ranges as the `geekity` field.

**Requires and services.** A plugin provides at most one service, named by its
package name, with `host.provide(service)` in `register`. A plugin that lists
another in `requires` reaches its service with `host.use('<package name>')`
when it handles a request, a command or a job. `use` throws during `register`.
A plugin cannot be enabled until everything it requires is installed, in range
and enabled. Pass plain data across a service, never an object built by a
library. Each bundle carries its own copy of its dependencies.

**Core services.** The core provides services of its own. Any plugin reaches
them with `host.use` and does not list them in `requires`. A core service is
available while the site runs: in a route, a widget, an editor action or a
job. A command run from the command line cannot reach one, and `use` throws
there.

`host.use('@geekity/cms/engagement')` returns the engagement service. Its
`posts({ since })` method takes an ISO 8601 instant and resolves to the posts
that drew any engagement at or after it, highest `total` first:

| Field         | What it holds                                                    |
| ------------- | ---------------------------------------------------------------- |
| `slug`        | The post's slug.                                                 |
| `title`       | The post's title, or the label the admin gives an untitled post. |
| `path`        | The post's permalink, such as `/2026/10/hello/`.                 |
| `editUrl`     | The admin path of the post's editor.                             |
| `likes`       | Fediverse likes. A like its actor undid is not counted.          |
| `boosts`      | Fediverse boosts. A boost its actor undid is not counted.        |
| `replies`     | Fediverse replies in the post's thread, without deleted ones.    |
| `webmentions` | Approved webmentions of any kind.                                |
| `comments`    | Approved comments from the comment form.                         |
| `total`       | The five counts added up.                                        |

A post that drew nothing is not in the list. Fediverse comments imported from
another system are not counted, because the inbox counts what arrives after
the import. These are the numbers the dashboard's Top posts card shows.

```ts
host.widget({
  id: 'engagement',
  title: 'Engagement',
  width: 'half',
  refreshSeconds: 300,
  async load({ period }) {
    const since = new Date(Date.now() - period * 86_400_000).toISOString();
    const posts = await host.use('@geekity/cms/engagement').posts({ since });
    return [
      {
        ranked: {
          caption: 'Most engaged posts',
          items: posts.map((post) => ({
            label: post.title,
            value: post.total,
            href: post.editUrl,
          })),
        },
      },
    ];
  },
});
```

`host.use('@geekity/cms/posts')` returns the posts service. Its
`byPath(paths)` method takes paths on the site, such as the paths an
analytics tool records, and resolves to the published post each one leads to,
in the order asked:

| Field       | What it holds                                                    |
| ----------- | ---------------------------------------------------------------- |
| `path`      | The path as it was asked for.                                    |
| `permalink` | The post's permalink, such as `/2026/10/hello/`.                 |
| `title`     | The post's title, or the label the admin gives an untitled post. |
| `editUrl`   | The admin path of the post's editor.                             |

`byPath` drops a path's query string and fragment. On a site served from a
directory, such as `https://example.com/blog/`, it removes the directory from
the front of the path. A path without a trailing slash also matches the permalink
with one. A path that leads to a page, a draft, a post not yet published or
nothing at all is not in the list.

```ts
const posts = await host
  .use('@geekity/cms/posts')
  .byPath(['/2026/10/hello', '/about/']);
// [{ path: '/2026/10/hello', permalink: '/2026/10/hello/', title: 'Hello', editUrl: '/admin/posts/hello' }]
```

Its `publishedSince({ since })` method takes an ISO 8601 instant and resolves
to the posts a reader can open, public or unlisted, dated at or after it,
newest first:

| Field       | What it holds                                                    |
| ----------- | ---------------------------------------------------------------- |
| `permalink` | The post's permalink, such as `/2026/10/hello/`.                 |
| `title`     | The post's title, or the label the admin gives an untitled post. |
| `editUrl`   | The admin path of the post's editor.                             |
| `published` | The post's date, an ISO 8601 instant.                            |

Drafts, trashed posts and posts dated in the future are not in the list.

```ts
const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
const recent = await host.use('@geekity/cms/posts').publishedSince({ since });
```

**Settings and secrets.** `host.settings([...])` declares fields of type
`text`, `url`, `select`, `checkbox` and `secret`, each with a `label` and an
optional `hint`. They become a settings namespace named by the package name.
The plugin's admin screen draws them as a form. Public values are stored in
`data/plugins/<package name>/settings.json`. A `secret` is stored in
`data/plugins/<package name>/secrets.json`, mode `0600`. An environment
variable overrides any of them, as
[Plugin settings](configuration.md#plugin-settings) describes.

**Data files.** `host.data` reads and writes other files in
`data/plugins/<package name>/`. A plugin declares each of these files in the
`data` field of its definition, with the file's class:

```ts
export default definePlugin({
  name: '@acme/plugin-hello',
  // ...
  data: { 'greetings.json': 'kept', 'cache.json': 'rebuildable' },
  register(host) {
    host.get('/hello', () => new Response(host.data.read('greetings.json')));
  },
});
```

The class says what a site export does with the file:

| Class         | Meaning                                                                  | In an export        |
| ------------- | ------------------------------------------------------------------------ | ------------------- |
| `kept`        | The site cannot be rebuilt without it.                                   | Always              |
| `rebuildable` | The plugin makes it again, fetches it again, or falls back to a default. | Never               |
| `credential`  | A key or login that is typed in again from another service.              | Only when asked for |

A `credential` file is written at mode `0600`. A plugin cannot use the other
classes core uses (`pending` and `scratch`).

A name in `data` is one path segment, such as `cache.json`. It cannot be
`settings.json` or `secrets.json`, which hold the plugin's settings. A
declaration that breaks these rules makes the plugin unavailable, and the
Plugins screen shows why.

`host.data.read` and `host.data.update` throw on a file that `data` does not
declare. The error names the file and the `data` field. There is no other way
into the folder: the plugin is not given its path.

The folder of a plugin that is not loaded, such as one that was removed, is
kept whole in an export, apart from its `secrets.json`, which is a credential.
The site may add the plugin again.

`settings.current()` returns a promise of the values in effect. It reads the
files and the environment on each call, so call it when the plugin handles a
request, a command or a job:

```ts
const settings = host.settings([
  {
    type: 'text',
    key: 'default_model',
    label: 'Default model',
    default: 'small',
  },
  { type: 'secret', key: 'api_key', label: 'API key' },
]);
host.get(
  '/model',
  async () => new Response((await settings.current()).default_model),
);
```

A screen's `render` may also return a promise, so it can await the settings.

**Blocks.** A screen's `render` returns cards, and each card holds blocks. A
dashboard widget's `load` returns blocks too. A block is plain data, of type
`PluginBlock`, and the CMS writes the markup:

| Block        | Data                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `paragraph`  | An array of strings and `{ code }` parts.                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `table`      | A `caption`, the `columns` and the `rows`. A cell is text, `{ code }`, `{ time }` (an ISO instant, or `null` for never), or `{ text, href }`, a link when `href` is a path or a web address and text otherwise.                                                                                                                                                                                                                                                   |
| `stats`      | An array of `{ label, value, previous?, better?, format? }`. With `previous`, the stat shows its change in words, such as `+20%, up from 100`. Set `better` to `down` when a fall is good, such as for a bounce rate. `format` is `number` (the default), `percent` for a percentage from 0 to 100, so `41.5` shows as `41.5%`, or `duration` for a number of seconds, so `90` shows as `1m 30s`. The previous value in the change is written in the same format. |
| `timeSeries` | A `caption`, consecutive `days` (`YYYY-MM-DD`) and up to four `series`, each a `name` and one value per day.                                                                                                                                                                                                                                                                                                                                                      |
| `bars`       | A `caption`, up to 24 `groups` (labels such as month names), an optional `groupName` for the table's first column (`Group` when left out) and up to four `series`, each a `name` and one value per group. Each group is a stacked bar with its total above it; each series has its own colour and texture.                                                                                                                                                        |
| `ranked`     | A `caption`, an optional `format` and `items` of `{ label, value, href? }`, drawn largest first. `href` must be a path that starts with `/` or an `http(s)` address. `format` writes every value as the stats `format` does.                                                                                                                                                                                                                                      |
| `calendar`   | A `caption` and `days` of `{ day, count }`, at most 366 days from the first to the last. A day between them that is not listed counts as zero.                                                                                                                                                                                                                                                                                                                    |

The charts are SVG drawn on the server in the admin theme's colours. Each
chart has a description and a table of its numbers for screen readers. Values
and counts are numbers of zero or more. A block that does not follow these
rules, for example a negative value or a time series with no days, shows "No
data to show." instead.

**Page tags.** `host.pageTags(read)` adds tags to the end of `<head>` and the
end of `<body>` on every public HTML page while the plugin is enabled. `read`
returns `{ headEnd, bodyEnd }`, each an array of tags, or a promise of it. A
tag is one of these:

| Tag      | Data                                                      |
| -------- | --------------------------------------------------------- |
| `script` | A `src` and optional `attributes`. It has no inline body. |
| `link`   | `attributes`, such as `rel` and `href`.                   |
| `meta`   | `attributes`, such as `name` and `content`.               |

The CMS writes the markup and escapes every attribute value. An attribute
value is text, `true` for a bare attribute such as `defer`, or `false` to
leave it out. An attribute name starts with a letter and holds only letters,
digits, `-`, `_`, `:` and `.`. A name that starts with `on`, such as `onload`,
is refused. A `src` or `href` is an `http:` or `https:` URL or a path that
starts with `/`. When a tag breaks one of these rules, or `read` throws, that
plugin adds no tags to the page, the server logs a warning, and the rest of the
page is drawn as normal.

The CMS calls `read` each time it draws a page, so the tags follow the
plugin's settings. `read` gets one argument, the page's context:

| Field      | Value                                                                     |
| ---------- | ------------------------------------------------------------------------- |
| `signedIn` | `true` when the reader is signed in to the site and sees the admin bar.   |
| `devMode`  | `true` when the site is in dev mode and holds every outbound side effect. |

These are the same values a theme reads as `signedIn` and `devMode`. A page
drawn for a signed-in reader is never cached or answered with `304`, and the
`ETag` of a listing changes when its tags change, so a reader never gets a copy
that carries another reader's tags.

Return no tags while a setting the tags need is unset. An analytics plugin also
returns none for a signed-in reader and in dev mode, so the site's own visits
are not counted:

```ts
register(host) {
  const settings = host.settings([
    { type: 'text', key: 'website_id', label: 'Website ID' },
  ]);
  host.pageTags(async ({ signedIn, devMode }) => {
    if (signedIn || devMode) return {};
    const { website_id } = await settings.current();
    if (website_id === '') return {};
    return {
      headEnd: [
        {
          tag: 'script',
          src: 'https://cloud.umami.is/script.js',
          attributes: { defer: true, 'data-website-id': website_id },
        },
      ],
    };
  });
},
```

The default theme draws plugin tags just before the site's
`partials/head-end.njk` and `partials/body-end.njk`, in the order the plugins
run: a plugin after the plugins it requires, otherwise in the order they were
installed. The partials keep working. A site theme that replaces
`layouts/base.njk` prints `{{ pluginTags.headEnd }}` and
`{{ pluginTags.bodyEnd }}` itself. The tags are left out of the editor's
preview, the admin, the feeds, and the Markdown, text and JSON
representations. A site built with Eleventy runs no plugins, so a static build
has no plugin tags. Use the partials for a tag that a static build must carry.
[Adding to every page](theme/adding-to-every-page.md) describes the partials.

**Dashboard widgets.** `host.widget(widget)` adds a card to the admin
dashboard while the plugin is enabled. A plugin may declare more than one. A
widget has these fields:

| Field            | Value                                                                                                         |
| ---------------- | ------------------------------------------------------------------------------------------------------------- |
| `id`             | Lower case words joined by `-`, unique among the plugin's widgets.                                            |
| `title`          | The card's heading.                                                                                           |
| `width`          | `half` or `full`. Two `half` widgets sit side by side when the screen is wide. A `full` widget spans the row. |
| `refreshSeconds` | How many seconds the dashboard reuses a result before it calls `load` again. Zero or more.                    |
| `load`           | Returns the card's blocks, or a promise of them.                                                              |

`load` gets one argument with four fields: `site`, the same `PluginSite` a
screen's `render` gets; `timezone`, the site's time zone, such as
`Europe/London`, which decides where a day starts; `period`, the number of
days the dashboard covers, ending today; and `signal`, an `AbortSignal` that
aborts when the widget's time limit runs out. Pass `signal` to `host.fetch` so
a request stops when the dashboard stops waiting for it. `period` is `7` unless
the owner chooses 30 days on the dashboard (`/admin?period=30`), when it is `30`. A
widget that shows a period covers that many days and compares totals with the
same number of days before them. A widget that does not show a period ignores
it. The dashboard keeps a separate result for each period. A widget with an id that
breaks the rule, a duplicate id, an unknown width or a negative
`refreshSeconds` fails the plugin's `register`, and the Plugins screen shows
why.

The dashboard draws the stat tiles first, then the core's own widgets, then
each enabled plugin's widgets in the order the plugins run. Within one plugin,
the widgets keep the order they were declared in. When a plugin is disabled,
its widgets are gone from the next dashboard request. No restart is needed.

The dashboard loads every widget at the same time and waits at most 3 seconds
for each. A good result is kept in memory for `refreshSeconds`, so a dashboard
request in that time does not call `load`. While a load is still running,
another request waits for that load and does not start a second one. The time
limit counts from the start of the load, and `signal` aborts when it runs out.
When a load ignores `signal` and finishes after the time limit, its result is
kept for the next request. When `load` throws, rejects, returns something other than an array, or runs out of time,
the server logs a warning and the card shows the last good result with a
Stale badge and the time it was loaded. If there is no earlier result, the card
says the stats are unavailable. The rest of the dashboard draws as normal. A
`load` that returns an empty array draws no card. Use this for a widget that
has content only some of the time. Results are not kept across a
restart.

```ts
register(host) {
  const settings = host.settings([
    { type: 'secret', key: 'api_key', label: 'API key' },
  ]);
  host.widget({
    id: 'visits',
    title: 'Visits',
    width: 'full',
    refreshSeconds: 300,
    async load({ timezone, period }) {
      const { api_key } = await settings.current();
      if (api_key === '') return [];
      const response = await host.fetch(
        `https://stats.example/api/daily?tz=${encodeURIComponent(timezone)}&days=${String(period)}`,
        { headers: { authorization: `Bearer ${api_key}` } },
      );
      if (!response.ok) throw new Error(`The stats API answered ${String(response.status)}.`);
      const { days, visitors, total, previousTotal } = (await response.json()) as {
        days: string[];
        visitors: number[];
        total: number;
        previousTotal: number;
      };
      return [
        { stats: [{ label: 'Visitors', value: total, previous: previousTotal }] },
        {
          timeSeries: {
            caption: 'Visitors per day',
            days,
            series: [{ name: 'Visitors', values: visitors }],
          },
        },
      ];
    },
  });
},
```

`geekity settings` reads and changes an enabled plugin's settings with the
site stopped, as it does the core ones. The setting is the package name, a
`.` and the key:

```
$ geekity settings get @geekity/plugin-llm.default_model
openai/gpt-4.1-mini
$ geekity settings set @geekity/plugin-llm.api_key sk-...
@geekity/plugin-llm.api_key  (set)  file  API key
```

The command loads the site's plugins as a plugin command does, so each
plugin's `register` runs. `list` prints the settings of each plugin the
server would run after the core ones. A plugin that is installed but not
enabled, that did not load, or that is enabled but needs a plugin that is not
running, is named in a warning on standard error, and its settings are left
out. If the plugins cannot be loaded at all, for example because two share a
name, the command says so and works on the core settings.

**Site info.** `await host.siteInfo()` resolves to the site's base URL and its
title as the settings have it at that moment. It reads the settings, so it
returns a promise; call it when the plugin handles a request, a command or a
job rather than once in `register`.

**Outbound requests.** `host.fetch(url, init)` asks another site and resolves
to its `Response`, whatever the status. `init` takes `headers`, `signal`,
`method` and `json`. `method` is `GET` when absent, or `POST`. `json` is sent
with `POST` as `JSON.stringify(json)` with `content-type: application/json`;
a `json` without `method: 'POST'` rejects.

```ts
const response = await host.fetch('https://stats.example/api/auth/login', {
  method: 'POST',
  json: { username, password },
  signal: AbortSignal.timeout(3_000),
});
```

Redirects are followed, at most five. Every address on the way must be
public: a loopback, private or link-local address, or a name that resolves to
one, rejects with an error before it is asked, unless the site lets its
federation reach private addresses. After a `POST`, a 301, 302 or 303 is
followed as a `GET` without the body. A 307 or 308 resends the method and
body to the same origin. A 307 or 308 to another origin rejects, and that
origin is not asked. The headers the plugin passes go only to the origin of
the URL it asked for, meaning the same scheme, host and port. A hop to any
other origin carries only the plugin's `accept`, `accept-language` and
`user-agent` headers, and drops the rest, such as `authorization`, `cookie`
or an API-key header. A redirect from `http` to `https` on the same host is
another origin, so it drops them too. A later hop back to the first origin
sends them again. A core release before `method` and `json` sends every
request as a `GET`, so a plugin that posts sets its `@geekity/cms` peer range
to start at a release that has them.

**Federation middleware.** A federation middleware is handed a
`PluginFederationContext` for each request. Its `outbox(username)` and
`followers(username)` return promises of the collection, or of `undefined`
for a user the site does not have. Await them before reading `totalItems`,
`firstCursor`, `lastCursor` or a page. In host API version 1 they returned the
collection directly. A plugin inbox that registers Fedify's
`onUnverifiedActivity` hands the activity's JSON-LD and the reason to
`refused(activity, reason)`. The site then logs the refusal in the same format
and under the same rate limit as its own inboxes.

**The host API version and the peer range.** `HOST_API_VERSION` in
`@geekity/cms/plugin` is the newest version of the host API this core
provides. The core also runs plugins that target an earlier version, back to
the oldest version it keeps, which is 2. A plugin that targets a newer version,
or one older than that, is unavailable, with the reason on the Plugins screen.
Version 3 added page tags and dashboard widgets. A plugin that calls
`host.pageTags` or `host.widget` targets 3. The peer range of `@geekity/cms` says which releases of core
the package works with. npm checks it for a site that installs with npm. The
registry checks the copy in `plugin.json` for a folder install. Before 1.0,
write it as `>=<the core you built against> <1.0.0`, and write the range of a
required plugin the same way. The host API version marks a breaking change. The
core minor version does not.
[Core releases and the plugins' core range](development.md#core-releases-and-the-plugins-core-range)
says how the packages in this repository get those ranges, and when the host
API version goes up.

**The bundle.** A folder install has no `node_modules`. Each plugin package
also ships one self-contained ES module with every dependency inlined. The
plugin packages in this repository build it with the shared script after `tsc`:

```json
"build": "tsc -p tsconfig.build.json && node ../../scripts/build-plugin-bundle.js"
```

It writes `dist/bundle/index.js` and `dist/bundle/plugin.json`. `plugin.json`
holds the package's name, version, host API version and the peer ranges of
`@geekity/cms` and of each required plugin, as the packed `package.json`
publishes them. The build fails when:

- the package is not marked as a plugin
- a required plugin is not a peer dependency with the same range
- the plugin's name, version, `hostApi` or `requires` differ from
  `package.json`
- it meets a native module, which a bundle cannot carry

A plugin that needs a native module installs with npm only.

### Testing a plugin

A plugin's tests build a site the way a site does, with `createCms` and the
other names in [The package API](public-api.md). When a test also needs a part
of the host on its own, such as the admin store or the `PluginSite` that
`register` is given, it imports it from `@geekity/cms/testing`.

`@geekity/cms/testing` is for tests only. A plugin's `src/` imports only
`@geekity/cms/plugin`, so the bundle never carries these helpers. The names
below are not covered by semantic versioning and can change in a minor
release.

```ts
import { createCms } from '@geekity/cms';
import { pluginDataFolder, pluginSite } from '@geekity/cms/testing';
```

| Export                  | Kind     | What it is                                                                                                        |
| ----------------------- | -------- | ----------------------------------------------------------------------------------------------------------------- |
| `addComment`            | function | Record a comment: append it to its post's file and index it.                                                      |
| `deleteComment`         | function | Forget a comment altogether.                                                                                      |
| `documentContent`       | function | The writable half of a parsed document: what it would be written back from.                                       |
| `intakeComment`         | function | The one door into `content/_data/comments/`.                                                                      |
| `openAdminStore`        | function | Open (and if needed create) the admin tables in `dataDir`, applying every migration the package ships.            |
| `pluginDataFolder`      | function | Takes the data folder and the plugin. It returns the plugin's `host.data`, holding the files its `data` declares. |
| `pluginSite`            | function | The `PluginSite` a plugin's host is given, built from a site's admin store and config.                            |
| `updateComment`         | function | Move a stored comment: approve it, mark it spam, put it back, or rewrite what it says.                            |
| `CommentIntakeOutcome`  | type     | What became of one proposed comment.                                                                              |
| `CommentOrigin`         | type     | Who is proposing a comment, which is the one thing the rules differ on.                                           |
| `IntakeCommentOptions`  | type     | What `intakeComment` needs around a proposed comment.                                                             |
| `NewComment`            | type     | A `CommentRecord` on its way in, before the store has named it.                                                   |
| `OpenAdminStoreOptions` | type     | Where `openAdminStore` puts, and finds, its tables. Pass `now` to pin the time its records carry.                 |
| `ProposedComment`       | type     | A comment as its writer proposes it: everything but its name, where it stands, and where it came from.            |

`src/public-api.test.ts` in `packages/cms` compares `src/testing.ts` with this
table, and fails when a value here is not imported by any plugin test. It also
fails when a plugin test or script imports from `@geekity/cms` a name that
[The package API](public-api.md) does not list, and when a plugin's `src/`
imports anything but `@geekity/cms/plugin`.

## Hooks

Two hooks run a site's own code when content changes. Both are config
options. Both are also methods, for a site that subscribes from its entry
file:

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
`onPublish` runs when a document becomes visible on the public site. That
happens when a document is created already published, when a draft is
published, or when a document is restored from the trash. A hook may be
`async`. The CMS never waits for it. If a hook throws or rejects, the CMS
reports the error, and the scan and the watcher continue.

**Mind the origin.** Every change carries `origin`:

| `origin`   | Change                                    |
| ---------- | ----------------------------------------- |
| `watch`    | A live edit.                              |
| `admin`    | A write the editor made.                  |
| `schedule` | A post whose date arrived.                |
| `scan`     | A full scan, _including the one on boot_. |

A cold index reports its whole first scan as `created`, and every published
document as `published`. A hook that must not run again when the index is
rebuilt has to check the origin:

```ts
cms.onPublish((change) => {
  if (change.origin === 'scan') return; // not a rebuilt index
  void announce(change.next);
});
```

Deleting `data/geekity.db` is supported. The next boot then rebuilds the
index with `scan` changes.

For anything the two hooks do not cover, subscribe to the events directly. The
CMS _does_ wait for an `async` listener registered this way, unlike the two
hooks. The listener can finish writing before the change is complete. A slow
listener also holds up the watcher.

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

Each event carries the whole document before and after the change, as
`previous` and `next`. Either may be `undefined`. A subscriber can compare
them. Each event also carries the content-relative `path` and `origin`. A
`schedule` change carries no `previous`. No earlier event announced the post,
so every subscriber sees its arrival as a creation. `on()` returns the function
that unsubscribes. `once()` and `off()` also exist.
