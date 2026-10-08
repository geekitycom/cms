import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import llm from '../src/index.ts';
import { fakeProvider } from './provider.ts';
import type { FakeProvider } from './provider.ts';
import { closeSites, flashes, llmSite, SCREEN } from './site.ts';

/**
 * The plugin's screen under Plugins (TASK-283): base URL, API key and
 * default model, and Test connection against a provider on loopback.
 */

const KEY = 'sk-or-v1-screen-key-1111';
let provider: FakeProvider;

before(async () => {
  provider = await fakeProvider();
});
after(async () => {
  await closeSites();
  await provider.close();
});

describe('the LLM screen', () => {
  it('has base URL, API key and default model, with OpenRouter as the default', async () => {
    const { admin } = await llmSite(llm);
    const html = await (await admin.get(SCREEN)).text();
    assert.match(html, /<h1[^>]*>LLM<\/h1>/);
    assert.match(html, /Base URL/);
    assert.match(html, /value="https:\/\/openrouter\.ai\/api\/v1"/);
    assert.match(html, /API key/);
    assert.match(html, /<code>GEEKITY_PLUGIN_LLM__API_KEY<\/code>/);
    assert.match(html, /Default model/);
    assert.match(html, /value="openrouter\/auto"/);
    assert.match(html, /<button[^>]*>\s*Test connection/);
  });

  it('reports an unconfigured connection without calling anyone', async () => {
    const { admin } = await llmSite(llm);
    const sent = provider.received.length;
    await admin.post(SCREEN, { action: 'save', 'setting.base_url': provider.baseUrl });
    await admin.post(SCREEN, { action: 'test-connection' });
    assert.deepEqual(flashes(await (await admin.get(SCREEN)).text()), [
      'No API key is set, so nothing was sent.',
    ]);
    assert.equal(provider.received.length, sent);
  });

  it('saves the settings, tests the connection and names the model that answered', async () => {
    const { admin, contentDir, dataDir } = await llmSite(llm);
    const saved = await admin.post(SCREEN, {
      action: 'save',
      'setting.base_url': provider.baseUrl,
      'setting.api_key': KEY,
      'setting.default_model': 'acme/tiny',
    });
    assert.equal(saved.status, 303);

    const siteJson = readFileSync(path.join(contentDir, '_data', 'site.json'), 'utf8');
    assert.ok(!siteJson.includes(KEY));
    const secrets = path.join(dataDir, 'plugins', '@geekity', 'plugin-llm', 'secrets.json');
    assert.equal(statSync(secrets).mode & 0o777, 0o600);

    const tested = await admin.post(SCREEN, { action: 'test-connection' });
    assert.equal(tested.status, 303);
    const html = await (await admin.get(SCREEN)).text();
    assert.deepEqual(flashes(html), ['Connected. acme/tiny-1 answered.']);
    assert.ok(!html.includes(KEY), 'the key is never on the page');
    const last = provider.received.at(-1);
    assert.equal(last?.headers.authorization, `Bearer ${KEY}`);
    assert.equal((last?.body as { model: string }).model, 'acme/tiny');
  });

  it('reports a refused key in plain words', async () => {
    const { admin } = await llmSite(llm);
    await admin.post(SCREEN, {
      action: 'save',
      'setting.base_url': provider.baseUrl,
      'setting.api_key': KEY,
    });
    provider.answer({ status: 401, body: '{"error":{"code":401,"message":"No auth"}}' });
    await admin.post(SCREEN, { action: 'test-connection' });
    const host = new URL(provider.baseUrl).host;
    assert.deepEqual(flashes(await (await admin.get(SCREEN)).text()), [
      `${host} refused the API key.`,
    ]);
  });
});
