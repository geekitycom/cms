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
- **Remove** deletes the plugin's folder. Its settings and its folder under
  `data/plugins/` stay. Only a disabled plugin has Remove. Disable a plugin
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

A plugin package imports only `@geekity/cms/plugin`, and only its types and
`definePlugin`. Its default export is the plugin:

```ts
import { definePlugin } from '@geekity/cms/plugin';

export default definePlugin({
  name: '@acme/plugin-hello',
  version: '0.1.0',
  label: 'Hello',
  description: 'Says hello.',
  hostApi: 1,
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
    "hostApi": 1,
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

**Settings and secrets.** `host.settings([...])` declares fields of type
`text`, `url`, `select`, `checkbox` and `secret`. The plugin's admin screen
shows them as a form. Public values are stored in `site.json` under the
package's name. A `secret` is stored in
`data/plugins/<package name>/secrets.json`, mode `0600`. An environment
variable overrides it, as
[Plugin secrets](configuration.md#plugin-secrets) describes.
`host.data` reads and writes other files in that folder.

**The host API version and the peer range.** `HOST_API_VERSION` in
`@geekity/cms/plugin` is the version of the host API this core provides. A
plugin that targets another version is unavailable, with the reason on the
Plugins screen. The peer range of `@geekity/cms` says which releases of core
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
