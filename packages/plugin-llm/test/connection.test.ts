import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, describe, it } from 'node:test';

import { modelCatalog } from '../src/catalog.ts';
import { callModel } from '../src/complete.ts';
import { describeFailure } from '../src/connection.ts';
import type { LlmConnection } from '../src/connection.ts';
import { fakeProvider } from './provider.ts';
import type { FakeProvider } from './provider.ts';

/** Each typed failure in plain words, against a provider on loopback. */

const KEY = 'sk-or-v1-test-key-0000';
let provider: FakeProvider;

before(async () => {
  provider = await fakeProvider();
});
after(() => provider.close());

function connection(overrides: Partial<LlmConnection> = {}): LlmConnection {
  return {
    baseUrl: provider.baseUrl,
    apiKey: KEY,
    model: 'openrouter/auto',
    openRouter: undefined,
    timeoutMs: 5_000,
    ...overrides,
  };
}

const HELLO = { messages: [{ role: 'user', content: 'Hello.' }] } as const;

describe('describeFailure', () => {
  for (const [status, headers, kind, words] of [
    [401, {}, 'unauthorized', /refused the API key/],
    [402, {}, 'no-credit', /no credit left/],
    [429, { 'retry-after': '20' }, 'rate-limited', /Try again in 20 seconds/],
    [503, {}, 'unavailable', /could not answer \(status 503\): Busy right now/],
    [400, {}, 'rejected', /refused the request \(status 400\): Busy right now/],
  ] as const) {
    it(`words ${String(status)} as ${kind}, without the key`, async () => {
      provider.answer({
        status,
        headers,
        body: JSON.stringify({ error: { code: status, message: `Busy right now (${KEY})` } }),
      });
      const { completion } = await callModel(connection(), HELLO, modelCatalog());
      assert.equal(completion.ok, false);
      if (completion.ok) return;
      assert.equal(completion.error.kind, kind);
      const message = describeFailure(completion.error, connection());
      assert.match(message, words);
      assert.ok(!message.includes(KEY), 'the key is never in the message');
    });
  }

  it('words the rest', () => {
    const words = (error: Parameters<typeof describeFailure>[0]) =>
      describeFailure(error, connection());
    assert.match(words({ kind: 'network' }), /could not be reached/);
    assert.match(words({ kind: 'timeout', seconds: 60 }), /did not answer within 60 seconds/);
    assert.match(words({ kind: 'aborted' }), /stopped/);
    assert.match(words({ kind: 'invalid-output', reason: 'It was not JSON.' }), /not JSON/);
    assert.match(
      words({ kind: 'cut-off', maxTokens: 4096, reasoningTokens: 4096 }),
      /limit of 4096 tokens .* 4096 of them went on reasoning\. Choose a model .* that does not reason/,
    );
    assert.doesNotMatch(
      words({ kind: 'cut-off', maxTokens: 64, reasoningTokens: undefined }),
      /reasoning\. /,
    );
  });
});

describe('the package', () => {
  it('calls the provider with the built-in fetch and depends only on a schema validator', () => {
    const manifest = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    ) as { dependencies?: Record<string, string> };
    assert.deepEqual(Object.keys(manifest.dependencies ?? {}), ['@cfworker/json-schema']);
  });
});
