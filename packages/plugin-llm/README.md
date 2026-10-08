# @geekity/plugin-llm

A [Geekity CMS](../cms/README.md) plugin that connects the site to a language
model. It speaks the OpenAI chat-completions API, so it works with OpenRouter,
its default, and with OpenAI or Ollama by changing the base URL. It calls the
provider with Node's built-in `fetch` and depends on no SDK.

Other plugins use it to call a model, so that none of them carries a client of
its own (decision-33).

## Installing it

Add the package to the site and to `plugins` in its config:

```sh
pnpm add @geekity/plugin-llm
```

```ts
import { defineConfig } from '@geekity/cms';
import llm from '@geekity/plugin-llm';

export default defineConfig({
  plugins: [llm],
});
```

Enable it under `/admin/plugins`. Its screen is
`/admin/plugins/@geekity/plugin-llm`.

## Settings

| Setting       | Key             | Default                        | Where it is kept                                           |
| ------------- | --------------- | ------------------------------ | ---------------------------------------------------------- |
| Base URL      | `base_url`      | `https://openrouter.ai/api/v1` | `content/_data/site.json`, under `@geekity/plugin-llm`     |
| API key       | `api_key`       | none                           | `data/plugins/@geekity/plugin-llm/secrets.json`, mode 0600 |
| Default model | `default_model` | `openrouter/auto`              | `content/_data/site.json`, under `@geekity/plugin-llm`     |

The API key is never drawn on a page. The screen says whether one is set, and a
save with the box left blank keeps the stored key.

`GEEKITY_PLUGIN_LLM__API_KEY` sets the key from the environment instead, which
is how a Docker site keeps it in `.env`. A set variable wins over the file, and
the screen shows the key as set by the environment, with no box to change it.

## Test connection

The screen's **Test connection** button sends one short message and asks for a
reply of a few tokens, so it costs almost nothing. It reports which model
answered, or why nothing did:

| Outcome      | What it means                                                     |
| ------------ | ----------------------------------------------------------------- |
| Unconfigured | No API key is set, so nothing was sent.                           |
| Unauthorized | The provider refused the key (401 or 403).                        |
| No credit    | The account behind the key has no credit left (402).              |
| Rate limited | The provider is limiting requests (429), with when to try again.  |
| Unavailable  | The provider answered with an error, with its status and message. |
| Network      | The provider could not be reached, or did not answer in time.     |

## The bundle

The package's build also writes `dist/bundle/index.js`, one module with the
plugin as its default export. It is what a plugins folder holds on a site that
runs the Docker image, which has no `node_modules` of its own (decision-33).
