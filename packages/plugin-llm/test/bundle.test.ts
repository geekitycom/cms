import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import type { Plugin } from '@geekity/cms';

import { fakeProvider } from './provider.ts';
import type { FakeProvider } from './provider.ts';
import { closeSites, flashes, llmSite, SCREEN } from './site.ts';

/**
 * The bundle a folder install loads (decision-33), run against the site: its
 * settings form and Test connection work with nothing but Node beside it.
 */

let bundled: Plugin;
let provider: FakeProvider;

before(async () => {
  const bundle = new URL('../dist/bundle/index.js', import.meta.url).href;
  bundled = ((await import(bundle)) as { default: Plugin }).default;
  provider = await fakeProvider();
});
after(async () => {
  await closeSites();
  await provider.close();
});

describe('the bundled plugin', () => {
  it('saves its settings and tests the connection', async () => {
    assert.equal(bundled.name, '@geekity/plugin-llm');
    const { admin } = await llmSite(bundled);
    await admin.post(SCREEN, {
      action: 'save',
      'setting.base_url': provider.baseUrl,
      'setting.api_key': 'sk-bundle',
    });
    await admin.post(SCREEN, { action: 'test-connection' });
    assert.deepEqual(flashes(await (await admin.get(SCREEN)).text()), [
      'Connected. acme/tiny-1 answered.',
    ]);
  });
});
