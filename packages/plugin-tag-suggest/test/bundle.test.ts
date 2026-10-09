import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import type { Plugin } from '@geekity/cms';
import llm from '@geekity/plugin-llm';

import { fakeProvider, replying } from '../../plugin-llm/test/provider.ts';
import type { FakeProvider } from '../../plugin-llm/test/provider.ts';
import { actionUrl, closeSites, tagSite } from './site.ts';
import { fakeTagsPub } from './tags-pub.ts';
import type { FakeTagsPub } from './tags-pub.ts';

/**
 * The bundle a folder install loads (decision-33), run against the site: its
 * button answers ranked tags with nothing but Node beside it.
 */

let bundled: Plugin;
let provider: FakeProvider;
let tagsPub: FakeTagsPub;

before(async () => {
  const bundle = new URL('../dist/bundle/index.js', import.meta.url).href;
  bundled = ((await import(bundle)) as { default: Plugin }).default;
  provider = await fakeProvider();
  tagsPub = await fakeTagsPub();
});
after(async () => {
  await closeSites();
  await provider.close();
  await tagsPub.close();
});

describe('the bundled plugin', () => {
  it('suggests tags through the llm service and tags.pub', async () => {
    assert.equal(bundled.name, '@geekity/plugin-tag-suggest');
    const { admin } = await tagSite([llm, bundled], {
      baseUrl: provider.baseUrl,
      tagsServer: tagsPub.url,
      apiKey: 'sk-bundle',
    });
    tagsPub.followers.set('bundled', 3);
    provider.answer(replying(JSON.stringify({ tags: ['Bundled'] })));
    const response = await admin.post(actionUrl('suggest-tags'), { type: 'post', body: 'Words.' });
    assert.deepEqual(await response.json(), {
      ok: true,
      choices: [{ value: 'bundled', note: '3 followers on tags.pub' }],
    });
  });
});
