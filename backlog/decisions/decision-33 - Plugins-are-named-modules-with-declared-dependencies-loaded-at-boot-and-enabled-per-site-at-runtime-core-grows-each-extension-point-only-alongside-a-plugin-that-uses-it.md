---
id: decision-33
title: >-
  Plugins are named modules with declared dependencies, loaded at boot and
  enabled per site at runtime; core grows each extension point only alongside a
  plugin that uses it
date: '2026-10-06 12:06'
status: proposed
---
## Context

doc-1 put a plugin system out of scope and left two hooks, `onDocumentChange` and `onPublish`. Site code can reach further only from a `server.ts` that calls `createCms`: `cms.app` for routes registered after core's, `cms.events` to observe document changes, `cms.renderer.environment` for public filters. The Docker image runs the generic `geekity serve` with `content/`, `data/` and an optional read-only `themes/` mounted, so a site deployed that way runs no code of its own.

On 2026-10-06 the owner asked for plugins, because some logic is useful to some sites and should not be in core. They named the first users:

- **WordPress compatibility.** decision-14's switch, `wordpressActivityPub` in `site.json`, mounts a second Fedify federation at `/wp-json/activitypub/1.0/` for a site moving from the WordPress ActivityPub plugin. It records each request in `data/wordpress-activitypub.json` and shows the record on Federation > Settings. Beside it sit the `geekity import wordpress-actor` command and the `wordpressActorId` field on every user record. A site born on the CMS never needs any of it.
- **An LLM service.** One consistent API that other plugins use to call a language model, so that no plugin rolls its own client. OpenRouter is the likely first provider.
- **Two consumers of it.** One suggests a post's title and description. The other suggests tags for a post, ranked by how many people follow each tag on tags.pub.

The owner asked for the infrastructure and the use cases to be built hand in hand, so that each piece of core exists because a plugin needs it. They also asked that plugins may depend on each other, and that the design keep the Docker deploy in mind.

The inventory of the WordPress code (2026-10-06) found exactly one switch, read once per request in `wordPressGate` (`src/federation/mount.ts`). The rest of what looks WordPress-shaped is core by decision:

- Stored actor and object ids, served at their URLs and listed as WebFinger aliases, are identity (decision-14: "nothing about this is WordPress-specific").
- The `/feed/`, `/author/`, `/tag/` and `/category/` layout is the site's URL design.
- oEmbed and the embed frame serve any consumer.

tags.pub (Social Web Foundation) runs one ActivityPub `Service` actor per hashtag at `https://tags.pub/user/<tag>`. Its public `followers` collection carries `totalItems`. Any string returns an actor, so a count of zero means nobody follows the tag. tags.pub has no search and no popular-tags endpoint.

OpenRouter speaks the OpenAI chat-completions shape at `https://openrouter.ai/api/v1/chat/completions` behind a bearer key. It takes `response_format: {type: "json_schema", ...}` on models whose `supported_parameters` list it. It reports usage on each response and returns typed errors: 401, 402 for no credits, 429 and 503 with `Retry-After`. OpenAI and Ollama accept the same shape at their own base URLs.

## Decision

- **A plugin is a named module.** It declares `name`, `label`, `description`, `requires` (the names of the plugins it depends on), optional `settings`, and a `register(host)` function. Names are lower-case slugs and unique. The host passed to `register` is the plugin's only door into the CMS. A plugin imports nothing from core but types.
- **Every installed plugin registers at boot, and the site enables the ones it uses.** Enabling and disabling take effect on the next request, without a restart, because an operator on Docker cannot restart the container from the admin. Core routes each request to a plugin's contributions, such as routes, middleware, admin screens and editor actions, only while that plugin is enabled. A disabled plugin's routes fall through as if absent. A plugin may have `start` and `stop` hooks for timers and caches. Core calls them on enable, on disable, at boot for enabled plugins and in `close()`.
- **The enabled set is a site setting.** It is the `plugins` key in `content/_data/site.json`, an object keyed by plugin name, alongside the other settings and written the same way. A plugin's public settings live under its key there. A plugin's secret settings live in `data/plugins/<name>.json`, mode 0600. An environment variable `GEEKITY_PLUGIN_<NAME>_<SETTING>` overrides a secret, so a Docker operator can keep a key in `.env`. The admin then shows that setting as set by the environment and does not edit it.
- **Dependencies are names, resolved at boot and checked on every change.** The registry orders plugins by their dependencies, and `register` runs dependencies first. An installed plugin whose dependency is missing, or that sits in a cycle, is unavailable. The Plugins screen names the reason. The site still boots, so a broken plugin never takes the site down. Enabling a plugin offers to enable the plugins it requires. Disabling a plugin that enabled plugins require is refused, and the refusal names them. Version ranges on dependencies are left out until a third-party plugin needs one.
- **Plugins share services by name.** A plugin calls `host.provide('llm', service)` and a dependent calls `host.use('llm')`. The types come from a declaration map that the providing plugin augments, so `use('llm')` is typed without a cast. `use` on a name that is not in `requires` is a type error and a boot error.
- **Core grows an extension point only with its first consumer.** The milestone builds each point in the same task as the plugin that needs it:

  | Extension point | First consumer |
  | --- | --- |
  | Registry, dependencies, enable/disable, the Plugins screen | WordPress (its switch becomes enabling the plugin) |
  | A middleware phase in the federation mount, access to the site federation's KV and handlers, plugin data files, CLI commands | WordPress (the second federation, its request record, `import wordpress-actor`) |
  | Settings and secrets, drawn as a form from the plugin's declared fields | LLM |
  | Services between plugins | LLM, used by post summaries |
  | Editor actions, plugin admin JSON endpoints and plugin static scripts | Post summaries |
  | An outbound fetch that refuses private addresses unless the site allows them, with a cache in `data/` | Tag suggestions (tags.pub) |
  | A folder of mounted plugins | A third-party plugin on Docker |

  A host API with no consumer is not added. MCP tools from plugins wait for M27.
- **The WordPress plugin takes the switch and everything behind it.** That is the second federation and its gate, the request record, the import command, the user's WordPress actor id and the Federation > Settings section, which moves to the plugin's own screen. Stored ids, WebFinger aliases, the feed and archive layout, and oEmbed stay in core. The canonical inbox keeps `withIdempotency('per-origin')`, because two federations sharing one KV dedupe on it. That is a core invariant, held by a core test. An upgrade migrates on its own at boot, idempotently: `wordpressActivityPub: true` becomes `plugins.wordpress` enabled, and each `wordpressActorId` in `data/users.json` moves to the plugin's data file. A site deployed on Docker needs no action. A lint holds that nothing under `src/` imports from `plugins/` or names WordPress outside the migration.
- **The LLM plugin is one provider shape, the OpenAI chat-completions API.** Its settings are a base URL (OpenRouter by default), an API key (secret), and a default model. The service it provides is:

  ```ts
  complete(request: {
    messages: Message[];
    schema?: JsonSchema;
    model?: string;
    maxTokens?: number;
    signal?: AbortSignal;
  }): Promise<Completion>;
  ```

  A `Completion` is either `{ ok: true, text | value, usage, model }` or `{ ok: false, error }`. The error is one of `unconfigured`, `unauthorized`, `no-credit`, `rate-limited` (with `retryAfter`), `unavailable`, `invalid-output` or `network`. With a schema, the plugin asks for `json_schema` output and sends `provider.require_parameters` to OpenRouter. It validates the reply against the schema whatever the provider claims. A consumer never parses a model's output itself. OpenAI and Ollama work by changing the base URL. Another provider shape, such as Anthropic's Messages API, would be a second implementation of the same service, added when someone needs it.
- **Draft text leaves the server only when a person asks.** An editor action runs on a click and never on save or publish. Every call goes from the server, because the admin CSP's `connect-src 'self'` would refuse a browser call to a third party. That also keeps the key off the page.
- **First-party plugins ship inside `@geekity/cms`, under `packages/cms/plugins/<name>/`, behind the same host API a third-party plugin gets.** They are installed in every image and disabled by default. That keeps one package, one release and one Docker image. A lint proves the boundary: a plugin imports only the host API's types and its own files. Splitting them into packages of their own later would move folders and change nothing in the code.
- **Third-party plugins on Docker are self-contained ES modules in a mounted folder.** `GEEKITY_PLUGINS_DIR`, `/site/plugins` in the image, holds one folder per plugin with a bundled `index.js`. The module's default export is the plugin. Because the host is passed in, the module needs no import of `@geekity/cms` at runtime, which a mounted folder could not resolve. Types for authors come from a `@geekity/cms/plugin` subpath export. A site that runs its own `server.ts` passes plugin objects in `plugins` on its config instead. A plugin runs as the site process, with the site's access to `data/`. The Plugins screen marks third-party plugins as third-party.

## Consequences

- doc-1's "Plugin system beyond the two hooks above" leaves the out-of-scope list. doc-1 gains a Plugins section, and the README gains a section for plugin authors.
- decision-14's paragraph "WordPress's paths are a switch" stays true in effect. The switch is now the `wordpress` plugin, and the cutover's "turn the switch on" means "enable the WordPress plugin". The rest of decision-14 is unchanged.
- The host API joins the semver contract under decision-6. Removing or reshaping a host method is a breaking change to `@geekity/cms`. The host API carries a version number, and a mounted plugin declares the version it targets. A plugin that targets a newer version than the core is unavailable, with a reason.
- Settings now have two homes per plugin: public values in `site.json` and secrets in `data/plugins/`. Both are files, which keeps decision-9. No plugin keeps durable state in SQLite.
- Each enabled-check is a read of `site.json`, which settings already cache per request. Disabled plugins cost one lookup per request and nothing else.
- The Dockerfile gains `/site/plugins` and `GEEKITY_PLUGINS_DIR`, and `deploy/compose.yaml` gains a commented read-only volume for it, like `themes/`.
- Calls to a model cost the site owner money. The LLM plugin shows the usage of its last call on its screen, and no plugin calls the model without a person asking.
- tags.pub has no published rate limits. Tag lookups send a descriptive User-Agent, run a few at a time, and cache counts for a day.
