/**
 * `@geekity/plugin-llm` (decision-33): the site's connection to a language
 * model, through the OpenAI chat-completions API. Its settings are the base
 * URL, OpenRouter's by default, the API key and the default model, and its
 * screen has a Test connection button that makes one tiny call.
 */

import { definePlugin } from '@geekity/cms/plugin';
import type { PluginScreen, PluginSettings } from '@geekity/cms/plugin';

import { describeFailure, testConnection } from './connection.ts';
import type { LlmConnection } from './connection.ts';
import { VERSION } from './version.ts';

export { chatCompletion, describeFailure, testConnection } from './connection.ts';
export type { LlmConnection, LlmFailure, LlmOutcome } from './connection.ts';

export const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';
export const DEFAULT_MODEL = 'openrouter/auto';

export const LLM_SETTINGS = [
  {
    type: 'url',
    key: 'base_url',
    label: 'Base URL',
    default: DEFAULT_BASE_URL,
    hint: 'Where the chat-completions API is. OpenAI and Ollama work by changing this.',
  },
  { type: 'secret', key: 'api_key', label: 'API key' },
  {
    type: 'text',
    key: 'default_model',
    label: 'Default model',
    default: DEFAULT_MODEL,
    hint: 'The model asked for when a call names none, such as openai/gpt-4o-mini.',
  },
] as const;

/** The connection the settings describe now. */
export function connectionFrom(settings: PluginSettings<typeof LLM_SETTINGS>): LlmConnection {
  const values = settings.current();
  return { baseUrl: values.base_url, apiKey: values.api_key, model: values.default_model };
}

function llmScreen(settings: PluginSettings<typeof LLM_SETTINGS>): PluginScreen {
  return {
    title: 'LLM',
    render() {
      const connection = connectionFrom(settings);
      return [
        {
          title: 'Connection',
          blocks: [
            {
              paragraph: [
                'Calls go to ',
                { code: `${connection.baseUrl.replace(/\/+$/, '')}/chat/completions` },
                ' and ask for ',
                { code: connection.model },
                ' unless they name a model. ',
                connection.apiKey === undefined
                  ? 'No API key is set, so no call is made.'
                  : 'An API key is set.',
              ],
            },
            {
              paragraph: [
                'Test connection sends one short message and reports which model answered. ' +
                  'It costs a few tokens.',
              ],
            },
          ],
        },
      ];
    },
    actions: [
      {
        id: 'test-connection',
        label: 'Test connection',
        async run() {
          const connection = connectionFrom(settings);
          const outcome = await testConnection(connection);
          return outcome.ok
            ? { ok: true, message: `Connected. ${outcome.value} answered.` }
            : { ok: false, message: describeFailure(outcome.error, connection) };
        },
      },
    ],
  };
}

export default definePlugin({
  name: '@geekity/plugin-llm',
  version: VERSION,
  label: 'LLM',
  description:
    'Connects the site to a language model through the OpenAI chat-completions API, ' +
    'OpenRouter by default, for other plugins to use.',
  hostApi: 1,
  register(host) {
    host.screen(llmScreen(host.settings(LLM_SETTINGS)));
  },
});
