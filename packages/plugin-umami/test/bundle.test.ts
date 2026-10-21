import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import type { Plugin } from '@geekity/cms';

import { anonymous, closeSites, trackersOn, umamiSite, UMAMI } from './site.ts';

/**
 * The bundle a folder install loads (decision-33), run against the site: it
 * draws the tracker with nothing but Node beside it.
 */

let bundled: Plugin;

before(async () => {
  const bundle = new URL('../dist/bundle/index.js', import.meta.url).href;
  bundled = ((await import(bundle)) as { default: Plugin }).default;
});
after(closeSites);

describe('the bundled plugin', () => {
  it('draws the tracker on a public page', async () => {
    assert.equal(bundled.name, UMAMI);
    const cms = await umamiSite(bundled, {
      settings: { umami_url: 'https://cloud.umami.is', website_id: 'from-the-bundle' },
    });
    assert.deepEqual(trackersOn(await anonymous(cms, '/')), [
      '<script src="https://cloud.umami.is/script.js" defer data-website-id="from-the-bundle"></script>',
    ]);
  });
});
