import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

import { modelCatalog } from '../src/catalog.ts';
import type { ModelCatalog } from '../src/catalog.ts';
import { callModel, DEFAULT_MAX_TOKENS } from '../src/complete.ts';
import type { LlmRequest } from '../src/complete.ts';
import { describeFailure } from '../src/connection.ts';
import { connectionFrom, DEFAULT_BASE_URL } from '../src/index.ts';
import type { LlmConnection } from '../src/connection.ts';
import { fakeProvider, replying, thinker } from './provider.ts';
import type { FakeProvider } from './provider.ts';

/**
 * The llm service's one call (TASK-284) against a provider on loopback: what
 * it sends, what it hands back, and each way it can fail.
 */

const KEY = 'sk-or-v1-complete-key-2222';
let provider: FakeProvider;
let catalog: ModelCatalog;

before(async () => {
  provider = await fakeProvider();
});
after(() => provider.close());
beforeEach(() => {
  provider.answer(replying('Hello.'));
  catalog = modelCatalog();
});

function connection(overrides: Partial<LlmConnection> = {}): LlmConnection {
  return {
    baseUrl: provider.baseUrl,
    apiKey: KEY,
    model: 'acme/default',
    openRouter: undefined,
    timeoutMs: 5_000,
    ...overrides,
  };
}

async function complete(request: LlmRequest, overrides: Partial<LlmConnection> = {}) {
  return (await callModel(connection(overrides), request, catalog)).completion;
}

function errorOf(completion: Awaited<ReturnType<typeof complete>>) {
  return completion.ok ? undefined : completion.error;
}

const OPENROUTER = { openRouter: { siteUrl: 'https://example.test/', siteTitle: 'Example' } };

function lastSent(): { headers: Record<string, unknown>; body: Record<string, unknown> } {
  const sent = provider.received.at(-1);
  assert.ok(sent !== undefined, 'a request reached the provider');
  return { headers: sent.headers, body: sent.body as Record<string, unknown> };
}

const MESSAGES = [
  { role: 'system', content: 'Be brief.' },
  { role: 'user', content: 'Say hello.' },
] as const;

const TITLE = {
  type: 'object',
  properties: { title: { type: 'string', maxLength: 40 } },
  required: ['title'],
  additionalProperties: false,
} as const;

describe('complete without a schema', () => {
  it('sends the messages with the default model and max tokens, and returns the text', async () => {
    const completion = await complete({ messages: MESSAGES });
    assert.deepEqual(completion, {
      ok: true,
      text: 'Hello.',
      model: 'acme/tiny-1',
      usage: { promptTokens: 40, completionTokens: 12, totalTokens: 52, cost: 0.00031 },
    });
    const { body } = lastSent();
    assert.deepEqual(body['messages'], MESSAGES);
    assert.equal(body['model'], 'acme/default');
    assert.equal(body['max_tokens'], DEFAULT_MAX_TOKENS);
    assert.equal(body['response_format'], undefined);
  });

  it('asks for the model and max tokens a call names', async () => {
    await complete({ messages: MESSAGES, model: 'acme/large', maxTokens: 64 });
    const { body } = lastSent();
    assert.equal(body['model'], 'acme/large');
    assert.equal(body['max_tokens'], 64);
  });

  it('reports a reply with no text as invalid output', async () => {
    provider.answer({
      status: 200,
      body: JSON.stringify({ model: 'acme/tiny-1', choices: [{ message: { content: null } }] }),
    });
    const completion = await complete({ messages: MESSAGES });
    assert.equal(completion.ok, false);
    if (completion.ok) return;
    assert.equal(completion.error.kind, 'invalid-output');
  });
});

describe('complete with a schema', () => {
  it('asks for strict json_schema output and returns the value', async () => {
    provider.answer(replying('{"title":"A short title"}'));
    const completion = await complete({ messages: MESSAGES, schema: TITLE });
    assert.ok(completion.ok);
    assert.ok('value' in completion);
    assert.deepEqual(completion.value, { title: 'A short title' });
    const { body } = lastSent();
    assert.deepEqual(body['response_format'], {
      type: 'json_schema',
      json_schema: { name: 'reply', strict: true, schema: TITLE },
    });
    assert.equal(body['provider'], undefined, 'only OpenRouter takes provider preferences');
  });

  it('asks OpenRouter to route only to providers that honour the schema', async () => {
    provider.answer(replying('{"title":"A short title"}'));
    await complete(
      { messages: MESSAGES, schema: TITLE },
      { openRouter: { siteUrl: 'https://example.test/', siteTitle: 'Example' } },
    );
    assert.deepEqual(lastSent().body['provider'], { require_parameters: true });
  });

  for (const [what, content, reason] of [
    ['is missing a required property', '{"name":"x"}', /title/],
    ['breaks a limit the schema sets', `{"title":"${'x'.repeat(41)}"}`, /title/],
    ['is not JSON', 'Here is a title: A short title', /not JSON/],
  ] as const) {
    it(`reports a reply that ${what} as invalid output, though strict was asked for`, async () => {
      provider.answer(replying(content));
      const completion = await complete(
        { messages: MESSAGES, schema: TITLE },
        { openRouter: { siteUrl: 'https://example.test/', siteTitle: 'Example' } },
      );
      assert.equal(completion.ok, false);
      if (completion.ok) return;
      assert.equal(completion.error.kind, 'invalid-output');
      assert.match(describeFailure(completion.error, connection()), reason);
    });
  }

  it('accepts JSON a model wrapped in a code fence', async () => {
    provider.answer(replying('```json\n{"title":"Fenced"}\n```'));
    const completion = await complete({ messages: MESSAGES, schema: TITLE });
    assert.ok(completion.ok && 'value' in completion);
    assert.deepEqual(completion.value, { title: 'Fenced' });
  });
});

describe('a reply cut off at the limit', () => {
  it('reports finish_reason length as cut off, naming the limit, not as invalid output', async () => {
    provider.answer({
      status: 200,
      body: JSON.stringify({
        model: 'acme/tiny-1',
        choices: [{ finish_reason: 'length', message: { content: '{"title":"Half a' } }],
        usage: { prompt_tokens: 40, completion_tokens: 64, total_tokens: 104 },
      }),
    });
    const completion = await complete({ messages: MESSAGES, schema: TITLE, maxTokens: 64 });
    assert.deepEqual(completion, {
      ok: false,
      error: { kind: 'cut-off', maxTokens: 64, reasoningTokens: undefined },
      message: describeFailure(
        { kind: 'cut-off', maxTokens: 64, reasoningTokens: undefined },
        connection(),
      ),
    });
    assert.match(completion.ok ? '' : completion.message, /limit of 64 tokens/);
  });

  it('reports empty content with the reply tokens at the cap as cut off, with the reasoning spent', async () => {
    provider.answer({
      status: 200,
      body: JSON.stringify({
        model: 'z-ai/glm-5.3-flash',
        choices: [{ message: { content: null, reasoning: null } }],
        usage: {
          prompt_tokens: 40,
          completion_tokens: 1024,
          total_tokens: 1064,
          completion_tokens_details: { reasoning_tokens: 1024 },
        },
      }),
    });
    const completion = await complete({ messages: MESSAGES, maxTokens: 1024 });
    assert.equal(completion.ok, false);
    if (completion.ok) return;
    assert.deepEqual(completion.error, { kind: 'cut-off', maxTokens: 1024, reasoningTokens: 1024 });
    assert.match(completion.message, /1024 tokens/);
    assert.match(completion.message, /reasoning/);
    assert.doesNotMatch(completion.message, /no text/);
  });
});

describe('reasoning', () => {
  const reasoningSent = () => lastSent().body['reasoning'];

  it('asks a reasoning model on OpenRouter to keep its reasoning short, and gets its answer', async () => {
    provider.answer(thinker('{"title":"Brief"}'));
    const completion = await complete(
      { messages: MESSAGES, schema: TITLE, model: 'acme/thinker' },
      OPENROUTER,
    );
    assert.deepEqual(reasoningSent(), { effort: 'low', exclude: true });
    assert.ok(completion.ok && 'value' in completion);
    assert.deepEqual(completion.value, { title: 'Brief' });
  });

  it('leaves the default budget room for a short answer after brief reasoning', async () => {
    provider.answer(thinker('{"title":"Brief"}', { briefly: DEFAULT_MAX_TOKENS / 2 }));
    const completion = await complete(
      { messages: MESSAGES, schema: TITLE, model: 'acme/thinker' },
      OPENROUTER,
    );
    assert.ok(completion.ok, 'half the budget spent reasoning still leaves room');
  });

  it('takes the effort a call names, mapped to the nearest one the model lists', async () => {
    provider.answer(thinker('Hi'));
    await complete({ messages: MESSAGES, model: 'acme/thinker', reasoning: 'high' }, OPENROUTER);
    assert.deepEqual(reasoningSent(), { effort: 'high', exclude: true });
    await complete({ messages: MESSAGES, model: 'acme/thinker', reasoning: 'minimal' }, OPENROUTER);
    assert.deepEqual(reasoningSent(), { effort: 'low', exclude: true });
    await complete({ messages: MESSAGES, model: 'acme/thinker', reasoning: 'none' }, OPENROUTER);
    assert.deepEqual(reasoningSent(), { effort: 'low', exclude: true }, 'it may not turn off');
  });

  it('sends no reasoning field when a call leaves it to the model, which then runs out', async () => {
    provider.answer(thinker('{"title":"Brief"}'));
    const completion = await complete(
      { messages: MESSAGES, schema: TITLE, model: 'acme/thinker', reasoning: 'model-default' },
      OPENROUTER,
    );
    assert.equal(reasoningSent(), undefined);
    assert.equal(completion.ok, false);
    if (completion.ok) return;
    assert.equal(completion.error.kind, 'cut-off');
  });

  it('sends a model that does not reason the same request as before', async () => {
    await complete({ messages: MESSAGES, schema: TITLE, model: 'acme/plain' }, OPENROUTER);
    assert.deepEqual(Object.keys(lastSent().body).sort(), [
      'max_tokens',
      'messages',
      'model',
      'provider',
      'response_format',
    ]);
    await complete({ messages: MESSAGES, model: 'acme/unlisted' }, OPENROUTER);
    assert.equal(reasoningSent(), undefined, 'a model the list does not name is not asked');
  });

  it('reads the model list once and matches a variant by its model', async () => {
    const before = provider.catalogFetches;
    await complete({ messages: MESSAGES, model: 'acme/thinker:nitro' }, OPENROUTER);
    assert.deepEqual(reasoningSent(), { effort: 'low', exclude: true });
    await complete({ messages: MESSAGES }, OPENROUTER);
    assert.deepEqual(reasoningSent(), undefined, 'acme/default is not on the list');
    assert.equal(provider.catalogFetches, before + 1);
  });

  it('sends a provider that is not OpenRouter no reasoning field and reads no model list', async () => {
    const before = provider.catalogFetches;
    await complete({ messages: MESSAGES, model: 'acme/thinker', reasoning: 'high' });
    assert.equal(reasoningSent(), undefined);
    assert.equal(provider.catalogFetches, before);
  });
});

describe('OpenRouter attribution', () => {
  it('sends the site URL and title on OpenRouter', async () => {
    await complete(
      { messages: MESSAGES },
      { openRouter: { siteUrl: 'https://example.test/', siteTitle: 'Example Site' } },
    );
    const { headers } = lastSent();
    assert.equal(headers['http-referer'], 'https://example.test/');
    assert.equal(headers['x-openrouter-title'], 'Example Site');
  });

  it('sends neither to another provider', async () => {
    await complete({ messages: MESSAGES });
    const { headers } = lastSent();
    assert.equal(headers['http-referer'], undefined);
    assert.equal(headers['x-openrouter-title'], undefined);
  });
});

describe('failures', () => {
  it('sends nothing without an API key', async () => {
    const before = provider.received.length;
    assert.deepEqual(await complete({ messages: MESSAGES }, { apiKey: undefined }), {
      ok: false,
      error: { kind: 'unconfigured' },
      message: describeFailure({ kind: 'unconfigured' }, connection()),
    });
    assert.equal(provider.received.length, before);
  });

  for (const [status, headers, error] of [
    [401, {}, { kind: 'unauthorized' }],
    [402, {}, { kind: 'no-credit' }],
    [429, { 'retry-after': '20' }, { kind: 'rate-limited', retryAfter: 20 }],
    [502, {}, { kind: 'unavailable', status: 502, message: 'Upstream down' }],
    [503, {}, { kind: 'unavailable', status: 503, message: 'Upstream down' }],
    [400, {}, { kind: 'rejected', status: 400, message: 'Upstream down' }],
  ] as const) {
    it(`maps ${String(status)} to ${error.kind}`, async () => {
      provider.answer({
        status,
        headers,
        body: JSON.stringify({ error: { code: status, message: 'Upstream down' } }),
      });
      assert.deepEqual(await complete({ messages: MESSAGES }), {
        ok: false,
        error,
        message: describeFailure(error, connection()),
      });
    });
  }

  it('gives up after the timeout', async () => {
    provider.answer({ ...replying('late'), delayMs: 1_000 });
    const completion = await complete({ messages: MESSAGES }, { timeoutMs: 100 });
    assert.deepEqual(errorOf(completion), { kind: 'timeout', seconds: 0.1 });
  });

  it('maps a refused connection to network', async () => {
    const closed = await fakeProvider();
    await closed.close();
    assert.deepEqual(errorOf(await complete({ messages: MESSAGES }, { baseUrl: closed.baseUrl })), {
      kind: 'network',
    });
  });

  it('stops when the caller aborts', async () => {
    provider.answer({ ...replying('late'), delayMs: 1_000 });
    const controller = new AbortController();
    const pending = complete({ messages: MESSAGES, signal: controller.signal });
    setTimeout(() => controller.abort(), 50);
    assert.deepEqual(errorOf(await pending), { kind: 'aborted' });
  });

  it('sends nothing for a signal already aborted', async () => {
    const before = provider.received.length;
    const completion = await complete({ messages: MESSAGES, signal: AbortSignal.abort() });
    assert.deepEqual(errorOf(completion), { kind: 'aborted' });
    assert.equal(provider.received.length, before);
  });
});

describe('connectionFrom', () => {
  const site = { baseUrl: 'https://example.test/', title: 'Example' };
  const settings = (base_url: string) => ({
    current: () => ({ base_url, api_key: KEY, default_model: 'acme/default' }),
  });

  it('treats only openrouter.ai as OpenRouter', () => {
    assert.deepEqual(connectionFrom(settings(DEFAULT_BASE_URL), site).openRouter, {
      siteUrl: 'https://example.test/',
      siteTitle: 'Example',
    });
    for (const other of ['https://api.openai.com/v1', 'http://localhost:11434/v1']) {
      assert.equal(connectionFrom(settings(other), site).openRouter, undefined);
    }
  });
});
