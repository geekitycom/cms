---
id: decision-53
title: >-
  One settings registry over namespaced files: declarations, overrides,
  migration and the CLI
date: '2026-10-13 16:35'
status: accepted
---
## Context

decision-52 item 5 puts every runtime setting behind one registry over many files. TASK-383 is the spike that designs it. This record is its result. Nothing here is built; the follow-up tasks build it in waves, with maintenance and dev mode as the first users.

### What exists today

The code was read on 2026-10-13 in `packages/cms/src`. Five mechanisms hold runtime settings, each with its own read, write and validate code.

1. **Core rows.** `site/setting-rows.ts` (734 lines) declares 48 rows over `content/_data/site.json`. Each row has `read(file)`, `write(file, settings)`, `submitted(form)`, `shown(value)` and `check(form)`. The last three are form concerns. `site/site-json.ts` reads the file into the typed `SiteSettings` object and writes it back atomically with `updateSiteSettings`. `site/settings-form.ts` turns a form into settings. `admin/settings-page.ts` mounts the seven settings pages over these. `readSiteSettings` has 43 non-test callers; it is synchronous and returns the whole typed object.
2. **Plugin settings.** `plugins/settings.ts` (268 lines) resolves `host.settings([...])` fields. Public values live under `plugins.<name>` in `site.json`, beside `enabled`, written by `plugins/enabled.ts` `updatePluginEntry`. Secrets live in `data/plugins/<name>/secrets.json` at mode 0600. The environment variable `<PREFIX>__<KEY>` wins over the secrets file, where `<PREFIX>` is the package name upper-cased with every run of other characters as one `_` (`pluginEnvPrefix`). Only secrets read the environment. `admin/plugins.ts` draws the form and saves it.
3. **Mail credentials.** `mail/credentials.ts`: `data/mail.json` at 0600, holding a Brevo key and an SMTP connection. Read on every send. Saved by its own endpoints in `admin/settings-email.ts`.
4. **Akismet key.** `comments/akismet.ts`: `data/akismet.json` at 0600, holding `key`, `status` and `checkedAt`. Saved by endpoints in `admin/settings-discussion.ts`.
5. **Runtime flags.** `maintenance.ts`: the presence of `data/maintenance.json` means on, with an optional `until`. `config.maintenance` or `GEEKITY_MAINTENANCE` forces it on for the life of the process, through `createMaintenanceSwitch` in `cms/services.ts`, which memoises the file read for one second. `dev-mode.ts`: the presence of `data/dev-mode.json` means on. `config.devMode` or `GEEKITY_DEV_MODE` makes boot write the file (`cms/boot.ts` line 48). `geekity dev-mode off` refuses while the config still asks for dev mode. Entering and leaving are appended to `data/dev-mode.jsonl`, which Tools > Dev mode lists. Neither flag has an admin switch. Both have CLI commands in `cli.ts` (`maintenanceCommand`, `devModeCommand`).

Other `data/` files (`users.json`, `plugin-changes.json`, `locations.json`, `micropub-media.json`, keys, followers) are records, not settings, and are out of scope. TASK-384 classifies them.

### What was checked

- `pluginEnvPrefix` and `pluginVariable` were run on seven package names. `@geekity/plugin-llm` gives `GEEKITY_PLUGIN_LLM__API_KEY`, `@acme/plugin-llm` gives `ACME_PLUGIN_LLM__API_KEY`, `@a/b-c` and `@a-b/c` both give `A_B_C`, and a package named `geekity` would give `GEEKITY__API_KEY`. docs/configuration.md documents the `@acme` form. So decision-52's sentence "the env variable is `GEEKITY_<NAMESPACE>__<KEY>`" holds only for core namespaces and `@geekity`-scoped plugins. This record keeps the documented plugin behaviour and says so in section 8.
- A throwaway script ran the plugin migration (section 8) twice on one `site.json`, and a third time after restoring an older `site.json` to simulate a crash between its two writes. The second run moved nothing and left both files byte-identical. The third run kept the value already in the plugin file and dropped the stale one from `site.json`. The script was deleted.
- `resolveConfig` already applies environment, then config file, then default for every `GeekityConfig` field (`config.ts` `resolveEnvSettings`). The registry's "config or env" tier reads the resolved config, so this order is not re-implemented.
- `layer-boundary.test.ts`, `clock-boundary.test.ts` and `plugin-boundary.test.ts` scan `packages/cms/src` for imports with a regex and a named exception list. The registry's boundary test uses the same shape.
- The public package API (`exports.ts`, `testing.ts`, `plugin.ts`) exports none of `readSiteSettings`, `readMailCredentials`, `readAkismetKey`, `readMaintenance` or `devModeOn`. Deleting them breaks no site. `host.settings()` and `host.siteInfo()` on `PluginHost` are public.
- A census of the 98 non-test call sites of `readSiteSettings`, `devModeOn`, `holdOutbound`, `readMailCredentials` and `readAkismetKey` sorted them by whether an `await` is a local change. 32 sit in async functions. 39 sit in sync helpers whose nearest caller is async or a Hono handler. 12 sit in sync-only chains, and those chains are the real cost of an async interface. They are named in section 7, wave 3.

## Decision

### 1. Vocabulary

A **setting** is `namespace.key`. A **namespace** declares its file or files, one data class per file, and its settings. The **registry** holds every namespace and answers reads and writes for all of them through one async interface. A **value** is typed. The registry hands out an unparsed string only to the CLI printer.

Namespaces and keys are lower case words joined by `_`, the pattern `plugins/settings.ts` already enforces for plugin keys: `/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/`. A namespace never contains `__`. A plugin's namespace is its package name, as today. It is mapped to a folder and an environment prefix by the rules in section 7, wave 4, and is otherwise opaque.

### 2. Reserved core namespaces

| Namespace | File | Class | Holds |
| --- | --- | --- | --- |
| `site` | `content/_data/site.json` | kept, public | Every row of `SiteSettings` today, under the file keys it already uses |
| `maintenance` | `data/maintenance.json` | rebuildable | `on`, `until` |
| `dev_mode` | `data/dev-mode.json` | rebuildable | `on` |
| `mail` | `data/mail.json` | kept, secret | `brevo_api_key`, `smtp_host`, `smtp_port`, `smtp_secure`, `smtp_user`, `smtp_password` |
| `akismet` | `data/akismet.json` | kept, secret | `key`, `status`, `checked_at` |

The reserved list is one constant, `CORE_NAMESPACES`. The registry refuses a plugin whose namespace is in it, and refuses a plugin whose environment prefix equals `GEEKITY` or `GEEKITY_<NS>` for a core namespace. Core must never add a namespace whose upper-snake form starts with `PLUGIN`, because `@geekity/plugin-x` packages take the prefix `GEEKITY_PLUGIN_X`. The refusal is tested with a plugin named `site` and one named `@geekity/maintenance`.

`plugins.<name>.enabled` in `site.json` is not a setting. It is the enabled set (decision-33), read before any plugin registers, and it decides which plugin namespaces exist. It stays where it is and `plugins/enabled.ts` keeps it.

### 3. Types

The sketches use the names the build tasks should use. They live in a new `packages/cms/src/settings/` folder, which imports from `files/`, `util/` and `config.ts` only.

```ts
// settings/types.ts

/** How a value is parsed, checked and printed. One per kind of value. */
export interface SettingType<V> {
  /** A JSON value from the file, or `undefined` when the key is absent, to a value or a problem. */
  readonly fromJson: (raw: unknown) => Parsed<V>;
  /** The text of an environment variable or a CLI argument to a value or a problem. */
  readonly fromText: (text: string) => Parsed<V>;
  /** A value to what the file stores. `undefined` removes the key. */
  readonly toJson: (value: V) => unknown;
  /** A value as the CLI prints it and as a form field shows it. */
  readonly toText: (value: V) => string;
}

export type Parsed<V> = { ok: true; value: V } | { ok: false; problem: string };

export type DataClass =
  | { readonly kept: true; readonly secret: boolean }
  | { readonly kept: false };

export interface SettingDeclaration<V> {
  readonly key: string;
  /** The key in the file when it differs, such as `postsPerPage` for `posts_per_page`. */
  readonly fileKey?: string;
  readonly type: SettingType<V>;
  readonly default: V;
  /** One sentence the CLI prints beside the key. Not a label for a form. */
  readonly description: string;
  /** Never printed, never put on a render context, stored in the namespace's secret file. */
  readonly secret?: boolean;
  /**
   * The config tier. Called with the resolved config; a value other than
   * `undefined` wins over the file. The generic variable `GEEKITY_<NS>__<KEY>`
   * is read before this is called, unless `env` is false.
   */
  readonly override?: (config: ResolvedConfig) => V | undefined;
  readonly env?: boolean;
  /** A rule that needs more than the value: the pair of archive bases, a file on disk. */
  readonly check?: (value: V, others: NamespaceValues, dirs: SettingsDirs) => string | undefined;
  /** Runs after the file is written, with what changed. Errors are logged, not thrown. */
  readonly onChange?: (change: SettingChange<V>) => Promise<void> | void;
}

export interface SettingChange<V> {
  readonly previous: V;
  readonly next: V;
  readonly at: Date;
  /** Who asked: the admin, the CLI, boot, or a plugin's own code. */
  readonly by: 'admin' | 'cli' | 'boot' | 'plugin';
}

export interface NamespaceDeclaration {
  readonly namespace: string;
  /**
   * Where the values are. Core namespaces name one file. A plugin names a
   * folder with a public file and a secret file, because its settings are of
   * two classes.
   */
  readonly storage:
    | { readonly kind: 'file'; readonly under: 'content' | 'data'; readonly path: string; readonly dataClass: DataClass }
    | { readonly kind: 'folder'; readonly under: 'data'; readonly path: string; readonly publicFile: string; readonly secretFile: string };
  readonly settings: readonly SettingDeclaration<unknown>[];
  /**
   * A file written before this record. Runs on read; the result is parsed as
   * if it were the file. The next write stores the new shape.
   */
  readonly legacy?: (raw: unknown) => unknown;
  /** `GEEKITY_<NS>` for core. A plugin gives `pluginEnvPrefix(name)`. */
  readonly envPrefix: string;
}
```

```ts
// settings/registry.ts

/** Where a value in effect came from. */
export type ValueSource =
  | { readonly tier: 'env'; readonly variable: string }
  | { readonly tier: 'config'; readonly field: string }
  | { readonly tier: 'file' }
  | { readonly tier: 'default' };

export interface Resolved<V> {
  readonly value: V;
  readonly source: ValueSource;
  /** What the file holds, even when something overrides it. */
  readonly stored: V | undefined;
  /** Why a stored value was set aside for the default, or `undefined`. */
  readonly problem: string | undefined;
}

export interface SettingsRegistry {
  /** One value in effect. Throws on an unknown setting; that is a programming error. */
  get<V>(setting: SettingRef<V>): Promise<V>;
  /** The value, its source and its stored form. The CLI and the admin use this. */
  resolve<V>(setting: SettingRef<V>): Promise<Resolved<V>>;
  /** Every setting of one namespace in effect, typed by the namespace's declaration. */
  values<N extends NamespaceDeclaration>(namespace: N): Promise<ValuesOf<N>>;
  /**
   * Write one or more settings of one namespace in one atomic file update per
   * file. Values are checked first; a problem refuses the whole write and
   * nothing is written. A setting an override is in effect for is refused with
   * its source. Change hooks run after the write, one per setting whose value
   * changed.
   */
  set(
    namespace: string,
    changes: ReadonlyMap<string, unknown>,
    by: SettingChange<unknown>['by'],
  ): Promise<SetResult>;
  /** Every declared setting, for the CLI's `list`. */
  list(): readonly SettingRef<unknown>[];
  /** Register a plugin's namespace. Refuses a reserved or clashing namespace. */
  register(namespace: NamespaceDeclaration): void;
  unregister(namespace: string): void;
}

export type SetResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly problems: Readonly<Record<string, string>> };

/** A typed handle: the namespace and key, with the value type carried in the type. */
export interface SettingRef<V> {
  readonly namespace: string;
  readonly key: string;
  readonly declaration: SettingDeclaration<V>;
}
```

A namespace module exports its declaration and its refs together, so a caller writes `settings.get(MAINTENANCE.on)` and gets a `boolean`:

```ts
// settings/maintenance.ts
export const MAINTENANCE = declareNamespace({
  namespace: 'maintenance',
  storage: { kind: 'file', under: 'data', path: 'maintenance.json', dataClass: { kept: false } },
  envPrefix: 'GEEKITY_MAINTENANCE',
  legacy: (raw) => (isRecord(raw) && !('on' in raw) ? { on: true, ...raw } : raw),
  settings: {
    on: {
      type: boolean,
      default: false,
      description: 'Answer 503 to the public site, feeds and inboxes.',
      override: (config) => (config.maintenance ? true : undefined),
    },
    until: {
      type: instantOrEmpty,
      default: '',
      description: 'When the site is expected back, as an instant. Sent as Retry-After.',
    },
  },
});
```

The local implementation reads the namespace's file on every `get`, as `readSiteSettings` does today, through `readFileIfPresentSync` wrapped in a resolved promise. The interface is async so a build may replace it. Nothing is cached in the registry. The maintenance gate keeps its one-second memo as its own adapter over `get`, because it runs on every request, inbox bursts included.

A write is `updateFileAtomically` on the namespace's file: re-read, apply the changes to the parsed file, write. Keys the namespace does not declare are kept, so `feedSize` and anything a site put in `site.json` survive, as today. A secret file is written at mode 0600.

### 4. Override order

For every setting, in order: the environment variable `<envPrefix>__<KEY>`, then the declaration's `override(config)`, then the file, then the default. The first two together are decision-52's "config or env" tier. `override(config)` reads the resolved config, which `resolveConfig` has already built from environment, config file and defaults, so an existing config field keeps its own precedence and its own environment name.

Core settings that declare an `override`:

| Setting | `override(config)` | Why |
| --- | --- | --- |
| `site.base_url` | `config.baseUrlSource !== 'default' ? config.baseUrl : undefined` | What `effectiveBaseUrl` does today |
| `maintenance.on` | `config.maintenance ? true : undefined` | What `forced` does today |
| `dev_mode.on` | none, and `env: false` | See below |

An override in effect makes `set` refuse that key. The refusal names the source, and the admin page and the CLI print it. Today `geekity maintenance off` deletes the file and prints that the config keeps it on. Under the registry it is refused with the same sentence. The one difference is that a site which turned maintenance on through the file and also through the environment has to run `off` after removing the variable, which is what decision-35 already chose for dev mode.

**Dev mode is a latch, not an override.** decision-35 says a lost environment variable must not take a site live. So `GEEKITY_DEV_MODE` and `config.devMode` are not overrides of `dev_mode.on`. Boot keeps doing what `cms/boot.ts` line 48 does: when `config.devMode` is true, it calls `set('dev_mode', { on: true }, 'boot')`, which writes the file and runs the change hook. `geekity dev-mode off` and the admin switch keep refusing while `config.devMode` is true, with today's message, because the next boot would turn it back on. That check lives in the thin CLI and admin layers, not in the registry. `dev_mode.on` has no environment variable of the generic form; `env: false` says so and `geekity settings list` prints it as not overridable.

### 5. GEEKITY_MAINTENANCE and GEEKITY_DEV_MODE

Recommendation: both names stay, and a site changes nothing.

- `GEEKITY_MAINTENANCE` and `config.maintenance` stay as the `override` of `maintenance.on`. `GEEKITY_MAINTENANCE__ON` also works, because every setting has the generic variable, but the docs keep naming the old one.
- `GEEKITY_DEV_MODE` and `config.devMode` stay as the boot latch described above. There is no `GEEKITY_DEV_MODE__ON`.
- `GEEKITY_BASE_URL` and `config.baseUrl` stay as the override of `site.base_url`. `GEEKITY_SITE__BASE_URL` also works.

The alternative, dropping the old names for the namespaced form, would make shll.me's and andrewshell.org's compose files and four docs pages (deploying, public-site, federation, configuration) change for no gain. The old names are config fields with a documented meaning, and the registry reads the resolved config anyway.

### 6. Change hooks

A hook runs after the file is written, once per setting whose value differs from before, in the order the namespace declares them. It receives `previous`, `next`, `at` and `by`. It may be async. An error is logged with the setting's name and does not undo the write.

The two first users:

- `dev_mode.on`: `false → true` appends `{ type: 'on', at, by }` to `data/dev-mode.jsonl`; `true → false` appends `{ type: 'off', at, by }`. This is `enterDevMode` and `leaveDevMode` today, minus the file. The record's `by` keeps its stored spellings `config` and `command`, so the hook writes `boot` as `config` and `cli` as `command`, and adds `admin`. Tools > Dev mode prints "the admin switch" for `admin`.
- `maintenance.on`: no hook. The gate reads the value.

Later users, in wave 3: `site.relays` reconciles the relay subscriptions (today `FEDERATION_SETTINGS.saved`), and the profile fields tell the followers (today `saved` on General and Federation). A hook that sends activities needs the federation service, which the registry does not know. The namespace declarations that need services are built by a factory `createCms` calls after those services exist, and the registry is created with them. That is the one ordering constraint on the composition root.

### 7. Mapping every current setting

Every entry below moves in a wave. "Deleted" names what is removed in the same wave the entry moves. Nothing is kept behind for compatibility (decision-52 item 7).

**Wave 1: the registry, maintenance and dev mode.**

| Today | Setting | File | Class | Deleted when it moves |
| --- | --- | --- | --- | --- |
| `data/maintenance.json` present | `maintenance.on` (boolean, default false) | `data/maintenance.json` | rebuildable | `maintenance.ts` `enterMaintenance`, `leaveMaintenance`, `readMaintenance`, `MaintenanceWindow`; `createMaintenanceSwitch` becomes an adapter over `get` with the one-second memo |
| `until` in that file | `maintenance.until` (instant or empty, default empty) | same | rebuildable | `untilIn` |
| `data/dev-mode.json` present | `dev_mode.on` (boolean, default false) | `data/dev-mode.json` | rebuildable | `dev-mode.ts` `enterDevMode`, `leaveDevMode`, `devModeOn`; `holdOutbound` becomes async and reads the registry; `append` and `readDevModeRecord` stay, as the hook's writer and the admin's reader |
| `config.maintenance` forcing | `override` of `maintenance.on` | n/a | n/a | the `forced` parameter of `createMaintenanceSwitch` |
| `config.devMode` writing the file at boot | boot calls `set('dev_mode', {on: true}, 'boot')` | n/a | n/a | the direct `enterDevMode` call in `cms/boot.ts` |
| `geekity maintenance on|off|status` | `settings set maintenance.on true` and `maintenance.until` | | | the body of `maintenanceCommand` becomes a few lines over `settings` |
| `geekity dev-mode on|off|status` | `settings set dev_mode.on` | | | the body of `devModeCommand`, except the config check |

The legacy file shapes are read by `legacy`: a `maintenance.json` with no `on` key means `{ on: true, until }`, and a `dev-mode.json` with no `on` key means `{ on: true }`. The next write stores the new shape. Both files are rebuildable, so a site that deletes them loses nothing it cannot set again.

`devModeOn` has 12 non-test call sites and `holdOutbound` 8. Two of them sit in sync-only chains: `web/render.ts` line 586 inside the sync `Renderer`, and `web/listing-pages.ts` line 90 inside a response builder. Wave 1 handles them by reading `dev_mode.on` in the handler and passing it into the renderer as a render input, which is what the renderer's other inputs already are. The rest gain one `await`.

**Wave 2: credentials.**

| Today | Setting | File | Class | Deleted |
| --- | --- | --- | --- | --- |
| `data/mail.json` `brevo.apiKey` | `mail.brevo_api_key` (secret string, default empty) | `data/mail.json` | kept, secret | `mail/credentials.ts` whole: `readMailCredentials`, `writeMailCredentials`, `removeMailCredentials`, `brevoIn`, `smtpIn`; the `MailCredentials` type is replaced by the namespace's `ValuesOf` |
| `smtp.host`, `.port`, `.secure`, `.user`, `.password` | `mail.smtp_host`, `mail.smtp_port` (port, default 587), `mail.smtp_secure` (boolean), `mail.smtp_user`, `mail.smtp_password` (secret) | same | kept, secret | as above; the "465 when secure, else 587" fallback becomes `smtp_port`'s `check` |
| `data/akismet.json` `key`, `status`, `checkedAt` | `akismet.key` (secret), `akismet.status` (one of valid, invalid, unchecked), `akismet.checked_at` (instant or empty) | `data/akismet.json` | kept, secret | `readAkismetKey`, `writeAkismetKey`, `removeAkismetKey`, `AkismetKeyRecord` in `comments/akismet.ts`; `createAkismetChecker` and `verifyAkismetKey` read the registry |
| Email page credential endpoints | the Email page writes `mail.*` through `set` | | | the parsing in `mountMail`; the endpoints stay as the page's own POSTs |
| Discussion page Akismet endpoints | the Discussion page writes `akismet.*` through `set` | | | same |

The nested file shape (`{ brevo: { apiKey } }`) becomes flat through `legacy`. The files are kept data, so the legacy reader stays until TASK-384's export has shipped; it is one named line to delete then.

The sync `MailService` methods `configured()`, `providerName()` and `from()` read the credentials. `configured()` has eight callers, one of them `cms/services.ts` `mailConfigured`, which feeds the sync renderer through `page-sources.ts`. Wave 2 makes those three methods async and passes `mailConfigured` into the renderer as an input, as wave 1 does for dev mode.

**Wave 3: the site namespace.**

| Today | Setting | File | Class | Deleted |
| --- | --- | --- | --- | --- |
| 48 rows in `site/setting-rows.ts` | `site.<key>` with the same file keys (`url` for `base_url`, `license` holding a key or a URL, and so on) through `fileKey` | `content/_data/site.json` | kept, public | the `read` and `write` halves of `setting-rows.ts`; `site-json.ts` `settingsFromSiteJson`, `siteJsonFor`, `siteJsonText`, `readSiteJson`, `updateSiteSettings`, `writeSiteJson`, `readSiteSettings`; `SiteSettings` stays as `ValuesOf<typeof SITE>` |
| the `submitted`, `shown`, `check` halves of each row | stay as the settings pages' field table, moved to `admin/settings-fields.ts` | | | nothing deleted; they are form concerns and leave `site/` |
| `license`, `licenseUrl`, `licenseName` sharing one file key | one setting `site.license` whose type is `{ choice, url, name }` | | | `licenseIn` and the three rows' writers |
| `indexNowKey` minted when `indexNow` turns on | `site.index_now_key` with a change hook on `site.index_now` | | | the `submitted` branch that mints it |
| `menus`, `taxonomyRedirects`, `clientsWithoutPkce` | `site.menus`, `site.taxonomy_redirects`, `site.clients_without_pkce`, written by the Navigation, Taxonomy and Connected apps screens through `set` | | | the "carried" machinery: `CarriedField`, `CarriedSettings`, the `onFile` argument |
| `relays` save reconciling subscriptions, profile saves telling followers | change hooks on `site.relays` and the profile keys | | | the `saved` callbacks on the Federation and General pages |

The keys in `site.json` do not change spelling. Themes, Eleventy builds and hand edits keep working.

The census found 43 `readSiteSettings` callers. 30 are async or one hop from an async handler. The sync-only chains, which wave 3 must redesign rather than sprinkle with `await`:

| Chain root | Sites | What changes |
| --- | --- | --- |
| The sync `Renderer` (`renderDocument`, `renderListing` and the rest return `string`) | `web/render.ts` 586, `web/page-sources.ts` 65 and 72 | The handler awaits `values(SITE)` once and hands the snapshot to the renderer. The renderer's `syndication` and `location` callbacks read the snapshot. The renderer stays sync. |
| `MailService.from()` and the theme `chosen` callback | `notifications/mail-service.ts` 197, 373 | `from()` becomes async; the theme source takes the snapshot the mail service already has |
| `PluginRegistry.siteInfo()`, which is `host.siteInfo()` in the public plugin API | `plugins/site.ts` 47 | `host.siteInfo()` returns a `Promise<PluginSiteInfo>`. This is a plugin API break and a major release. Both published plugins that call it are in this repository. |
| `createCms`, a sync factory whose `boot()` reads `site.base_url` to settle the config | `cms/boot.ts` 122 | `settleConfig` moves into the async `serve()`, which already awaits. `createCms` stays sync. |
| `relays.sync()`, fire-and-forget at boot | `federation/relays.ts` 279 | It is already not awaited; it becomes an async function that reads the registry. |
| `reply-notices.ts` `tell()` inside the store change listener | `comments/reply-notices.ts` 116 | The listener becomes fire-and-forget async, which is what the senders it calls already are. |
| `web/indieauth-discovery.ts` `siteBaseUrl`, about 15 callers across IndieAuth and Micropub | line 114 | The base URL in effect is settled at boot (above) and is `config.baseUrl`; these callers read the config, not the registry. |
| `admin/settings-page.ts` `panels()` | the Email and Discussion panels | `panels` becomes async; it is called from the page's handler |

**Wave 4: plugins.**

| Today | Setting | File | Class | Deleted |
| --- | --- | --- | --- | --- |
| `plugins.<name>.<key>` in `site.json` | `<name>.<key>` | `data/plugins/<name>/settings.json` | kept, public | the settings use of `readPluginEntry`, the `updatePluginEntry` call in `savePluginSettings`; `plugins/settings.ts` `resolvePluginSettings`, `savePluginSettings`, `settingValues`, `accepts`, `defaultOf`, `EXPECTED` |
| `data/plugins/<name>/secrets.json` | `<name>.<key>` with `secret: true` | `data/plugins/<name>/secrets.json` | kept, secret | `readSecrets`, `secretsPath` |
| `host.settings(fields).current()` | the same public API, implemented as `registry.values(namespace)`; `current()` returns a `Promise` | | | the `place` closure in `plugins/registry.ts` |
| `settingFieldsProblem` | the registry's declaration check | | | moved, not deleted |
| `pluginEnvPrefix`, `pluginVariable` | the plugin namespace's `envPrefix` | | | moved to `settings/` |

A plugin namespace uses the `folder` storage: `data/plugins/<name>/` with `settings.json` and `secrets.json`. The folder already exists for secrets and `host.data`, and removing a plugin already means removing the folder.

`PluginSettingField` keeps its five types (`text`, `url`, `select`, `checkbox`, `secret`) and its `label` and `hint`. The registry maps each to a `SettingType`; `label` and `hint` are form data the plugin screen renders and the registry ignores. `current()` becoming async is the second plugin API break, released with the first.

### 8. The plugin migration

Moved: every key of `plugins.<name>` in `site.json` except `enabled`, into `data/plugins/<name>/settings.json`.

```
for each name, entry in site.json plugins:
  if entry is not an object: skip
  rest = entry minus enabled
  if rest is empty: skip
  current = parse data/plugins/<name>/settings.json or {}
  write settings.json as { ...rest, ...current }   # the file wins
  entry = enabled is undefined ? {} : { enabled }
write site.json
```

The file wins because a value saved to the plugin file after a half-finished run is newer than the one `site.json` still holds. Running it twice moves nothing the second time. Running it after a crash between the two writes converges on the same two files. The throwaway script in Context behaved so.

It runs at boot, before the plugin registry reconciles, where `cms/boot.ts` runs the legacy migrations today. It runs for every name under `plugins`, installed or not, so a disabled or removed plugin's values are not lost. It is also `geekity settings migrate-plugins` for a site that wants to run it with the site stopped. It logs each plugin it moved.

A plugin keeps its environment names: the namespace's `envPrefix` is `pluginEnvPrefix(packageName)`, unchanged, so `GEEKITY_PLUGIN_LLM__API_KEY` and `ACME_PLUGIN_LLM__API_KEY` keep working. This is the one place this record departs from decision-52's wording, which names `GEEKITY_<NAMESPACE>__<KEY>`: that form is true for core and for `@geekity`-scoped plugins, and the package-derived prefix is what ships and what docs/configuration.md documents. Under the registry every plugin setting, not only secrets, can be set from the environment, as `GEEKITY_PLUGIN_LLM__DEFAULT_MODEL`. `prefixCollisions` in `plugins/registry.ts` stays, and the reserved-prefix refusal of section 2 is added beside it.

### 9. Admin pages read and save through the registry

The registry imports nothing from `admin/`. The admin imports the registry. Two shapes:

**A custom page.** The maintenance switch, as Tools > Maintenance:

```ts
// admin/maintenance.ts
export function mountMaintenanceScreen(app, { render, settings }) {
  app.get(MAINTENANCE_PATH, async (c) => {
    const on = await settings.resolve(MAINTENANCE.on);
    const until = await settings.get(MAINTENANCE.until);
    return render(c, ADMIN_TEMPLATES.toolsMaintenance, {
      on: on.value,
      overridden: on.source.tier === 'env' || on.source.tier === 'config',
      overriddenBy: sourceSentence(on.source),
      until: MAINTENANCE.until.declaration.type.toText(until),
    });
  });
  app.post(MAINTENANCE_PATH, async (c) => {
    const body = await c.req.parseBody();
    const result = await settings.set('maintenance', new Map([
      ['on', body['on'] !== undefined],
      ['until', stringOrEmpty(body['until'])],
    ]), 'admin');
    if (!result.ok) {
      c.status(400);
      return render(c, ADMIN_TEMPLATES.toolsMaintenance, { problems: result.problems });
    }
    flash(c, 'notice', 'Maintenance saved.');
    return c.redirect(MAINTENANCE_PATH, 303);
  });
}
```

The page owns its template, its labels and its layout. It names settings by their refs. A `set` on a key with an override in effect returns a problem for that key, which the page shows as it shows a validation problem. The dev mode switch is the same shape on Tools > Dev mode, with the config check before `set`.

**The optional generic renderer.** `admin/settings-renderer.ts` takes a list of `{ ref, label, hint, widget }`, draws a form from each `SettingType`'s `toText`, and saves through the same `set`. Plugin screens use it, as `admin/plugins.ts` draws a plugin's fields from `PluginSettingField` today. A core page may use it for a field or two inside its own template. Nothing forces a page to use it, and the renderer is a consumer of the registry like any page.

**The boundary test.** `settings-boundary.test.ts` in `packages/cms/src` scans every file under `settings/` for import specifiers and fails when one resolves under `admin/`, `web/`, `cms/`, `plugins/` or `cli.ts`, naming the file and the specifier. It is the shape of `layer-boundary.test.ts`. The first build task also adds `settings/` as a layer below `site/` in that test's `LAYERS`, so the layer test enforces the same rule from the other side. The dedicated test exists so a failure reads as "the registry imported the admin" rather than as a layer number, and so it is shown to fail on a deliberately added import before the import is removed, as TASK-381 requires of its test.

### 10. The CLI

`geekity settings` is a core command with four verbs. The maintenance and dev-mode commands keep their names and become thin layers over it.

```
geekity settings list [<namespace>] [--config <file>]
geekity settings get <namespace.key> [--config <file>]
geekity settings set <namespace.key> <value> [--config <file>]
geekity settings set <namespace.key> --unset [--config <file>]
geekity settings migrate-plugins [--config <file>]
```

`list` prints one line per setting, namespaces in declaration order, core first: the setting, the value in effect as `toText`, the source, and the description. A secret prints `(set)` or `(not set)` and never its value. A setting with an override in effect prints the source and what the file holds:

```
maintenance.on     true             env GEEKITY_MAINTENANCE (file: false)  Answer 503 to the public site, feeds and inboxes.
maintenance.until                   default                                When the site is expected back, as an instant.
dev_mode.on        false            file                                   Hold every outbound side effect.
site.base_url      https://shll.me  config baseUrl (file: http://localhost:3000)  Public origin.
mail.smtp_password (set)            file                                   The SMTP password.
```

`get` prints the value in effect and, when overridden, a second line `overridden by env GEEKITY_MAINTENANCE; the file holds false`. Exit 0.

`set` parses the value with `fromText`, runs `check`, writes, runs the hooks, and prints the new line as `list` would. A problem prints it and exits 1 without writing. An override in effect prints `maintenance.on is set by GEEKITY_MAINTENANCE and cannot be changed here` and exits 1. `--unset` removes the key so the default applies. A secret is set the same way; the value is in the shell history, which is what editing `secrets.json` by hand is today, and the help text says so.

The setting argument is split at the last `.`: a plugin namespace such as `@geekity/plugin-llm` contains no `.`, and a key never does, so `geekity settings set @geekity/plugin-llm.default_model x` parses.

`geekity maintenance on [--until <time>]` is `set maintenance.on true` plus `maintenance.until`. `off` is `set maintenance.on false`. `status` is `get maintenance.on`, printing `Maintenance mode is on.` and the until line as today. `geekity dev-mode on|off|status` is the same over `dev_mode.on`, with the config refusal before `off`. `cli-maintenance.test.ts` and `cli-dev-mode.test.ts` keep their assertions on the printed sentences and on the files.

### 11. What the registry does not do

- It does not render forms or know labels. `description` is for the CLI.
- It does not cache. The maintenance gate's memo is the gate's.
- It does not own `plugins.<name>.enabled`.
- It does not model a farm, an owner or a supplied-secrets class. `DataClass` is a union so TASK-384 can add a member without touching callers.
- It does not import `node:sqlite`, `admin/`, `web/`, `cms/` or `plugins/`.

## Consequences

- Four waves, one PR each, in the order of section 7. Wave 1 ships the registry with two users and two admin switches. Waves 2 to 4 each move one group and delete its old code. No wave leaves two paths behind.
- Two plugin API breaks, `host.siteInfo()` and `settings.current()` returning promises, land in waves 3 and 4. They are released together as one major, and both published plugins that call them live in this repository and update in the same PRs.
- `holdOutbound` and `devModeOn` become async in wave 1. Two sync-chain callers in the renderer and a listing builder take the value as an input instead.
- The sync `Renderer` API stays sync. Every settings read it needs arrives as a snapshot its async caller took. That is a rule the wave 3 task states and its tests check.
- Every plugin setting becomes settable from the environment, not only secrets. docs/configuration.md's "Plugin secrets" section becomes "Plugin settings".
- `data/maintenance.json` and `data/dev-mode.json` change shape from presence-is-on to `{ "on": true }`. The legacy reader keeps old files working, so a `geekity maintenance on` from an older CLI against a newer site still works.
- `data/mail.json` and `data/akismet.json` flatten. Both are secret files a site owner never edits by hand; the legacy reader covers them.
- `site.json` loses the settings under `plugins.<name>` and keeps `enabled`. A site under git sees one commit's worth of change the first time it boots on the new version.
- The admin gains Tools > Maintenance and a switch on Tools > Dev mode. Each shows when a config field or variable overrides it and refuses the save with the source, as the General page does for the base URL today.
- `settings/` is a new layer below `site/`. The layer test gains a line; the dedicated boundary test fails on an import from `admin/`.
- docs/settings.md, docs/configuration.md, docs/plugins.md, docs/public-site.md and docs/deploying.md change: the credential section describes the `mail` and `akismet` namespaces, the plugin section describes `data/plugins/<name>/settings.json`, and a new section documents `geekity settings`.
- Two departures from decision-52's wording, for the user to accept or change: the environment name for a plugin setting keeps the package-derived prefix (`ACME_PLUGIN_LLM__API_KEY`) rather than always starting `GEEKITY_`, because that is what ships and is documented; and `GEEKITY_DEV_MODE` is a boot latch rather than an override, because decision-35 forbids an unset variable taking a site live.
