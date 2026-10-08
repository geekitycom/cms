/**
 * `@geekity/plugin-llm` (decision-33): the site's connection to a language
 * model, through the OpenAI chat-completions API. Its settings are the base
 * URL, OpenRouter's by default, the API key and the default model. It provides
 * the llm service other plugins reach with `host.use('@geekity/plugin-llm')`,
 * and its screen shows the last call and has a Test connection button.
 */

import { definePlugin } from '@geekity/cms/plugin';
import type {
  PluginDataFolder,
  PluginScreen,
  PluginScreenCard,
  PluginSettings,
  PluginSiteInfo,
} from '@geekity/cms/plugin';

import { callModel, DEFAULT_TIMEOUT_MS } from './complete.ts';
import type {
  Completion,
  JsonSchema,
  LlmRequest,
  LlmService,
  LlmUsage,
  ModelCall,
} from './complete.ts';
import { describeFailure, OPENROUTER_HOST } from './connection.ts';
import type { LlmConnection } from './connection.ts';
import { VERSION } from './version.ts';

export { DEFAULT_MAX_TOKENS, DEFAULT_TIMEOUT_MS } from './complete.ts';
export type {
  Completion,
  JsonSchema,
  LlmMessage,
  LlmRequest,
  LlmService,
  LlmUsage,
} from './complete.ts';
export { describeFailure } from './connection.ts';
export type { LlmConnection, LlmFailure } from './connection.ts';

declare module '@geekity/cms/plugin' {
  interface PluginServices {
    '@geekity/plugin-llm': LlmService;
  }
}

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

/** The connection the settings and the site describe now. */
export function connectionFrom(
  settings: PluginSettings<typeof LLM_SETTINGS>,
  site: PluginSiteInfo,
): LlmConnection {
  const values = settings.current();
  const onOpenRouter =
    URL.canParse(values.base_url) && new URL(values.base_url).hostname === OPENROUTER_HOST;
  return {
    baseUrl: values.base_url,
    apiKey: values.api_key,
    model: values.default_model,
    openRouter: onOpenRouter ? { siteUrl: site.baseUrl, siteTitle: site.title } : undefined,
    timeoutMs: DEFAULT_TIMEOUT_MS,
  };
}

/** The file in the plugin's data folder that keeps the last call's figures, never its words. */
const LAST_CALL_FILE = 'last-call.json';

interface LastCall {
  readonly at: string;
  readonly model: string;
  readonly usage: LlmUsage | undefined;
  /** `ok`, or the failure's kind. */
  readonly outcome: string;
  /** The outcome in plain words. */
  readonly message: string;
}

async function recordCall(data: PluginDataFolder, call: ModelCall, connection: LlmConnection) {
  const { completion } = call;
  const record: LastCall = {
    at: new Date().toISOString(),
    model: call.model,
    usage: call.usage,
    outcome: completion.ok ? 'ok' : completion.error.kind,
    message: completion.ok ? 'Answered.' : describeFailure(completion.error, connection),
  };
  try {
    await data.update(LAST_CALL_FILE, () => `${JSON.stringify(record, null, 2)}\n`);
  } catch (error) {
    console.warn(
      `@geekity/plugin-llm could not record its last call: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function readLastCall(data: PluginDataFolder): LastCall | undefined {
  const text = data.read(LAST_CALL_FILE);
  if (text === undefined) return undefined;
  try {
    return JSON.parse(text) as LastCall;
  } catch {
    return undefined;
  }
}

function lastCallCard(data: PluginDataFolder): PluginScreenCard {
  const last = readLastCall(data);
  const kept = 'Only these figures are kept. The prompt and the reply are not stored.';
  if (last === undefined) {
    return { title: 'Last call', blocks: [{ paragraph: ['No call has been made yet. ', kept] }] };
  }
  const tokens = (count: number | undefined) => (count === undefined ? '' : String(count));
  return {
    title: 'Last call',
    blocks: [
      {
        table: {
          caption: 'The most recent call to the model',
          columns: [
            'When',
            'Model',
            'Prompt tokens',
            'Reply tokens',
            'Total tokens',
            'Cost',
            'Outcome',
          ],
          rows: [
            [
              { time: last.at },
              { code: last.model },
              tokens(last.usage?.promptTokens),
              tokens(last.usage?.completionTokens),
              tokens(last.usage?.totalTokens),
              last.usage?.cost === undefined ? '' : `$${last.usage.cost.toFixed(6)}`,
              last.message,
            ],
          ],
        },
      },
      { paragraph: [kept] },
    ],
  };
}

function llmScreen(
  connection: () => LlmConnection,
  data: PluginDataFolder,
  call: (request: LlmRequest) => Promise<ModelCall>,
): PluginScreen {
  return {
    title: 'LLM',
    render() {
      const now = connection();
      return [
        {
          title: 'Connection',
          blocks: [
            {
              paragraph: [
                'Calls go to ',
                { code: `${now.baseUrl.replace(/\/+$/, '')}/chat/completions` },
                ' and ask for ',
                { code: now.model },
                ' unless they name a model. ',
                now.apiKey === undefined
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
        lastCallCard(data),
      ];
    },
    actions: [
      {
        id: 'test-connection',
        label: 'Test connection',
        async run() {
          const { completion, model } = await call({
            messages: [{ role: 'user', content: 'Reply with the word OK.' }],
            maxTokens: 16,
          });
          return completion.ok
            ? { ok: true, message: `Connected. ${model} answered.` }
            : { ok: false, message: describeFailure(completion.error, connection()) };
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
    const settings = host.settings(LLM_SETTINGS);
    const connection = () => connectionFrom(settings, host.siteInfo());

    async function call(request: LlmRequest): Promise<ModelCall> {
      const now = connection();
      const made = await callModel(now, request);
      await recordCall(host.data, made, now);
      return made;
    }

    function complete<Value = unknown>(
      request: LlmRequest & { readonly schema: JsonSchema },
    ): Promise<Completion<{ readonly value: Value }>>;
    function complete(
      request: LlmRequest & { readonly schema?: undefined },
    ): Promise<Completion<{ readonly text: string }>>;
    async function complete(request: LlmRequest): Promise<ModelCall['completion']> {
      return (await call(request)).completion;
    }

    host.provide({ complete });
    host.screen(llmScreen(connection, host.data, call));
  },
});
