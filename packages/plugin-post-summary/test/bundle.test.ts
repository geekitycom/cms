import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import type { Plugin } from '@geekity/cms';
import llm from '@geekity/plugin-llm';

import { fakeProvider, replying } from '../../plugin-llm/test/provider.ts';
import type { FakeProvider } from '../../plugin-llm/test/provider.ts';
import { actionUrl, closeSites, summarySite } from './site.ts';

/**
 * The bundle a folder install loads (decision-33), run against the site: its
 * button answers a suggestion with nothing but Node beside it.
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
  it('suggests a title through the llm service', async () => {
    assert.equal(bundled.name, '@geekity/plugin-post-summary');
    const { admin } = await summarySite([llm, bundled], {
      baseUrl: provider.baseUrl,
      apiKey: 'sk-bundle',
    });
    provider.answer(replying(JSON.stringify({ titles: ['From the Bundle'] })));
    const response = await admin.post(actionUrl('suggest-title'), { type: 'post', body: 'Words.' });
    assert.deepEqual(await response.json(), { ok: true, choices: [{ value: 'From the Bundle' }] });
  });
});
