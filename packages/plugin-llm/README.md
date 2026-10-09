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

On Docker, add the package to the plugins folder instead, then press Reload
under `/admin/plugins`:

```sh
docker compose exec geekity geekity plugin add @geekity/plugin-llm
```

Enable it under `/admin/plugins`. Its screen is
`/admin/plugins/@geekity/plugin-llm`.

## Settings

| Setting       | Key             | Default                        | Where it is kept                                           |
| ------------- | --------------- | ------------------------------ | ---------------------------------------------------------- |
| Base URL      | `base_url`      | `https://openrouter.ai/api/v1` | `content/_data/site.json`, under `@geekity/plugin-llm`     |
| API key       | `api_key`       | none                           | `data/plugins/@geekity/plugin-llm/secrets.json`, mode 0600 |
| Default model | `default_model` | `openrouter/auto`              | `content/_data/site.json`, under `@geekity/plugin-llm`     |

### Choosing a model

Choose a model that supports structured outputs and does not reason by
default, such as `openai/gpt-4.1-mini`. On OpenRouter's
[model list](https://openrouter.ai/models), filter by structured outputs, and
check that the model's supported parameters do not include `reasoning`. Such a
model answers an editor suggestion quickly, in a few dozen tokens.

The default, `openrouter/auto`, lets OpenRouter pick a model for each call. It
may pick a reasoning model, which thinks before it answers and bills those
tokens as reply tokens. The plugin asks a reasoning model to keep its reasoning
short (see [Reasoning models](#reasoning-models)), so most calls still succeed,
but the model, the cost and the time vary from call to call. The Last call row
shows which model answered.

The API key is never drawn on a page. The screen says whether one is set, and a
save with the box left blank keeps the stored key.

`GEEKITY_PLUGIN_LLM__API_KEY` sets the key from the environment instead, which
is how a Docker site keeps it in `.env`. A set variable wins over the file, and
the screen shows the key as set by the environment, with no box to change it.

## The llm service

The plugin provides one service, named by its package name. Another plugin
reaches it in three steps:

1. List `@geekity/plugin-llm` in `requires` with the range it needs.
2. Add the same range as a peer dependency in its `package.json`.
3. Import the package's types with `import type`, never its code.

The type import adds the service to `@geekity/cms/plugin`'s service map, so
`host.use('@geekity/plugin-llm')` is typed without a cast. Call `use` when the
plugin handles a request, a command or a job. It throws during `register`.

```ts
import { definePlugin } from '@geekity/cms/plugin';
import type {} from '@geekity/plugin-llm';

export default definePlugin({
  name: '@acme/plugin-titles',
  version: '1.0.0',
  label: 'Titles',
  description: 'Suggests a title for a post.',
  hostApi: 1,
  requires: { '@geekity/plugin-llm': '^0.2.0' },
  register(host) {
    host.get('/suggest-title', async () => {
      const llm = host.use('@geekity/plugin-llm');
      const completion = await llm.complete<{ title: string }>({
        messages: [
          { role: 'user', content: 'Suggest a title for this post: …' },
        ],
        schema: {
          type: 'object',
          properties: { title: { type: 'string' } },
          required: ['title'],
          additionalProperties: false,
        },
      });
      return completion.ok
        ? Response.json({ title: completion.value.title })
        : Response.json({ error: completion.message }, { status: 502 });
    });
  },
});
```

`complete` takes these fields:

| Field       | Default           | What it does                                                                                               |
| ----------- | ----------------- | ---------------------------------------------------------------------------------------------------------- |
| `messages`  | none              | The conversation, each a `role` (`system`, `user`, `assistant`) and `content`.                             |
| `schema`    | none              | A JSON Schema the reply must satisfy. With one, a success carries `value`. Without one, it carries `text`. |
| `model`     | the default model | The model to ask.                                                                                          |
| `maxTokens` | 4096              | The longest reply, in tokens, reasoning included.                                                          |
| `reasoning` | `low`             | How hard a reasoning model on OpenRouter thinks. See [Reasoning models](#reasoning-models).                |
| `signal`    | none              | An `AbortSignal` that stops the call.                                                                      |

A call that gets no answer within 60 seconds fails as `timeout`.

A success is `{ ok: true, model, usage }` plus `text` or `value`. `model` is
the model that answered. `usage` gives the prompt, reply and total tokens, and
the cost when the provider reports it. A failure is `{ ok: false, error, message }`.
`error` is the typed failure below. `message` is the failure in plain words,
with where to put it right, such as "Check the key on Plugins > LLM". Show
`message` to the person who asked. The LLM screen shows the same words.

With a schema, the plugin asks for strict `json_schema` output. On OpenRouter
it also sends `provider.require_parameters`, so the request goes only to a
provider that supports structured output. The plugin then checks the reply
against the schema itself, whatever the provider claims, and a reply that does
not match fails as `invalid-output`. A consumer never parses a model's output.
The generic type `Value` is the type the schema describes. Keep the two in step.

On OpenRouter, every call sends the site's base URL as `HTTP-Referer` and its
title as `X-OpenRouter-Title`, which OpenRouter uses for app attribution.

| Error            | What it means                                                                                                                                   |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `unconfigured`   | No API key is set, so nothing was sent.                                                                                                         |
| `unauthorized`   | The provider refused the key (401 or 403).                                                                                                      |
| `no-credit`      | The account behind the key has no credit left (402).                                                                                            |
| `rate-limited`   | The provider is limiting requests (429). `retryAfter` gives the seconds to wait, when the provider says.                                        |
| `unavailable`    | The provider failed to answer (5xx and other statuses). A later try may succeed.                                                                |
| `rejected`       | The provider refused the request as asked (400, 404 or 422), such as an unknown model or one without structured output. Retrying does not help. |
| `invalid-output` | The reply had no text, was not JSON, or did not match the schema.                                                                               |
| `cut-off`        | The reply reached `maxTokens` before the answer was finished. `reasoningTokens` says how many went on reasoning, when the provider said.        |
| `timeout`        | The provider did not answer in time.                                                                                                            |
| `aborted`        | The caller's signal stopped the call.                                                                                                           |
| `network`        | The provider could not be reached.                                                                                                              |

## Reasoning models

A reasoning model thinks before it answers, and its thinking counts against
`maxTokens`. Left to its own default, such a model can spend the whole limit
thinking and return no answer. The provider then reports `finish_reason`
`length`, and the call fails as `cut-off`, whose message names the limit.

On OpenRouter, the plugin sends a reasoning model OpenRouter's
[`reasoning` parameter](https://openrouter.ai/docs/use-cases/reasoning-tokens)
with `effort` set to the call's `reasoning`, `low` by default, and `exclude`
set to `true`, because no consumer reads the reasoning text. When the model
lists the efforts it supports and not the one asked for, the plugin sends the
nearest one above it. A model that must reason gets its lowest effort instead of
`none`. Pass `reasoning: 'model-default'` to send no `reasoning` parameter and
leave the effort to the model.

The plugin reads OpenRouter's public model list (`GET /api/v1/models`, sent
without the API key) to learn which models take the `reasoning` parameter, and
keeps it for an hour. Only those models get it. A model that does not reason
gets the request it would get without this feature. With a schema, the
plugin also sends `provider.require_parameters`, and OpenRouter then routes
only to endpoints that support every parameter sent. If the list cannot be
read, the call goes ahead without the `reasoning` parameter.

At `low` effort, OpenRouter gives a model that takes a token budget about a
fifth of `maxTokens` for reasoning. The default of 4096 leaves about 800
tokens for brief reasoning and plenty for a short structured answer.

Other providers get no `reasoning` field, because an OpenAI-compatible API
may refuse a field it does not know. On those, choose a model that does not
reason, or pass a larger `maxTokens`.

## The last call

Calls cost the site owner money, so the screen shows the last call: when it
was made, the model, the prompt, reply and total tokens, the cost when the
provider reports it, and the outcome. The plugin keeps these figures in
`data/plugins/@geekity/plugin-llm/last-call.json`. It never stores the prompt
or the reply.

## Test connection

The screen's **Test connection** button sends one short message through the same
call as every other plugin, with the default limit and reasoning effort. A model
that does not reason answers in a few tokens, so it costs almost nothing. It
reports which model answered, or the error in plain words. It counts as the
last call.

## The bundle

The package's build also writes `dist/bundle/index.js`, one module with the
plugin as its default export. It is what a plugins folder holds on a site that
runs the Docker image, which has no `node_modules` of its own (decision-33).
