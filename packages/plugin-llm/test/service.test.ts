import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { definePlugin } from '@geekity/cms/plugin';

import llm from '../src/index.ts';
import type { LlmService } from '../src/index.ts';
import { fakeProvider, replying } from './provider.ts';
import type { FakeProvider } from './provider.ts';
import { closeSites, llmSite, SCREEN } from './site.ts';

/**
 * The service path a third-party plugin takes (TASK-284): it requires
 * `@geekity/plugin-llm`, reaches the service with `host.use` while handling a
 * request, and gets a value that satisfies its schema.
 */

const KEY = 'sk-or-v1-service-key-3333';
const PROMPT = 'Suggest a title for a post about sourdough starters.';
let provider: FakeProvider;

before(async () => {
  provider = await fakeProvider();
});
after(async () => {
  await closeSites();
  await provider.close();
});

const TITLE_SCHEMA = {
  type: 'object',
  properties: { title: { type: 'string' } },
  required: ['title'],
  additionalProperties: false,
} as const;

const consumer = definePlugin({
  name: '@acme/plugin-titles',
  version: '1.0.0',
  label: 'Titles',
  description: 'Suggests a title.',
  hostApi: 1,
  requires: { '@geekity/plugin-llm': '^0.0.0' },
  register(host) {
    host.get('/suggest-title', async () => {
      const service: LlmService = host.use('@geekity/plugin-llm');
      const completion = await service.complete<{ title: string }>({
        messages: [{ role: 'user', content: PROMPT }],
        schema: TITLE_SCHEMA,
      });
      return completion.ok
        ? Response.json({ title: completion.value.title, model: completion.model })
        : Response.json({ error: completion.error.kind }, { status: 502 });
    });
  },
});

describe('a plugin that requires @geekity/plugin-llm', () => {
  it('calls the service end to end and the screen shows the call, not the prompt', async () => {
    const { cms, admin, dataDir } = await llmSite(llm, consumer);
    await admin.post(SCREEN, {
      action: 'save',
      'setting.base_url': provider.baseUrl,
      'setting.api_key': KEY,
      'setting.default_model': 'acme/default',
    });
    provider.answer(replying('{"title":"Feeding a sourdough starter"}'));

    const response = await cms.app.request('/suggest-title');
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      title: 'Feeding a sourdough starter',
      model: 'acme/tiny-1',
    });
    const sent = provider.received.at(-1);
    assert.equal(sent?.headers.authorization, `Bearer ${KEY}`);
    assert.equal((sent?.body as { model: string }).model, 'acme/default');

    const html = await (await admin.get(SCREEN)).text();
    const lastCall = /Last call[\s\S]*?<\/table>/.exec(html)?.[0] ?? '';
    for (const shown of [
      '<code>acme/tiny-1</code>',
      '>40<',
      '>12<',
      '>52<',
      '$0.000310',
      'Answered.',
    ]) {
      assert.ok(lastCall.includes(shown), `the last call shows ${shown}`);
    }

    const kept = readFileSync(
      path.join(dataDir, 'plugins', '@geekity', 'plugin-llm', 'last-call.json'),
      'utf8',
    );
    for (const words of ['sourdough', 'Feeding']) {
      assert.ok(!kept.includes(words) && !html.includes(words), `nothing keeps "${words}"`);
    }
  });

  it('gets a typed failure when the reply does not satisfy its schema', async () => {
    const { cms, admin } = await llmSite(llm, consumer);
    await admin.post(SCREEN, {
      action: 'save',
      'setting.base_url': provider.baseUrl,
      'setting.api_key': KEY,
    });
    provider.answer(replying('{"heading":"Not what was asked"}'));
    const response = await cms.app.request('/suggest-title');
    assert.deepEqual(await response.json(), { error: 'invalid-output' });
    const html = await (await admin.get(SCREEN)).text();
    assert.match(html, /does not match the schema/);
  });
});
