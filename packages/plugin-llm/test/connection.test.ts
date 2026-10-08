import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, describe, it } from 'node:test';

import { describeFailure, testConnection } from '../src/connection.ts';
import type { LlmConnection } from '../src/connection.ts';
import { ANSWERED, fakeProvider } from './provider.ts';
import type { FakeProvider } from './provider.ts';

/**
 * Test connection against a provider on loopback: the one request it makes,
 * and each typed failure in plain words.
 */

const KEY = 'sk-or-v1-test-key-0000';
let provider: FakeProvider;

before(async () => {
  provider = await fakeProvider();
});
after(() => provider.close());

function connection(overrides: Partial<LlmConnection> = {}): LlmConnection {
  return { baseUrl: provider.baseUrl, apiKey: KEY, model: 'openrouter/auto', ...overrides };
}

describe('testConnection', () => {
  it('makes one small chat completion and reports the model that answered', async () => {
    provider.answer(ANSWERED);
    const before = provider.received.length;
    assert.deepEqual(await testConnection(connection()), { ok: true, value: 'acme/tiny-1' });

    const sent = provider.received.slice(before);
    assert.equal(sent.length, 1);
    assert.equal(sent[0]?.method, 'POST');
    assert.equal(sent[0]?.url, '/api/v1/chat/completions');
    assert.equal(sent[0]?.headers.authorization, `Bearer ${KEY}`);
    const body = sent[0]?.body as { model: string; max_tokens: number; messages: unknown[] };
    assert.equal(body.model, 'openrouter/auto');
    assert.ok(body.max_tokens <= 16, 'a reply of a few tokens');
    assert.equal(body.messages.length, 1);
  });

  it('sends nothing without an API key', async () => {
    const before = provider.received.length;
    const outcome = await testConnection(connection({ apiKey: undefined }));
    assert.deepEqual(outcome, { ok: false, error: { kind: 'unconfigured' } });
    assert.equal(provider.received.length, before);
  });

  for (const [status, headers, kind, words] of [
    [401, {}, 'unauthorized', /refused the API key/],
    [402, {}, 'no-credit', /no credit left/],
    [429, { 'retry-after': '20' }, 'rate-limited', /Try again in 20 seconds/],
    [503, {}, 'unavailable', /could not answer \(status 503\): Busy right now/],
  ] as const) {
    it(`reports ${String(status)} as ${kind}, in plain words without the key`, async () => {
      provider.answer({
        status,
        headers,
        body: JSON.stringify({ error: { code: status, message: `Busy right now (${KEY})` } }),
      });
      const outcome = await testConnection(connection());
      assert.equal(outcome.ok, false);
      if (outcome.ok) return;
      assert.equal(outcome.error.kind, kind);
      const message = describeFailure(outcome.error, connection());
      assert.match(message, words);
      assert.ok(!message.includes(KEY), 'the key is never in the message');
    });
  }

  it('reports a provider that cannot be reached as a network failure', async () => {
    const closed = await fakeProvider();
    await closed.close();
    const unreachable = connection({ baseUrl: closed.baseUrl });
    const outcome = await testConnection(unreachable);
    assert.deepEqual(outcome, { ok: false, error: { kind: 'network' } });
    assert.match(describeFailure({ kind: 'network' }, unreachable), /could not be reached/);
  });
});

describe('the package', () => {
  it('calls the provider with the built-in fetch and depends on no SDK', () => {
    const manifest = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    ) as { dependencies?: Record<string, string> };
    assert.deepEqual(manifest.dependencies ?? {}, {});
  });
});
