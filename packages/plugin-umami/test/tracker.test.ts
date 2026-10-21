import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';

import umami from '../src/index.ts';
import { anonymous, closeSites, PAGES, signIn, trackersOn, umamiSite } from './site.ts';

after(closeSites);

const SET = { umami_url: 'https://stats.example.com/', website_id: 'a1b2c3' };

const PLAIN_TAG =
  '<script src="https://stats.example.com/script.js" defer data-website-id="a1b2c3"></script>';

function headOf(html: string): string {
  return html.slice(html.indexOf('<head>'), html.indexOf('</head>'));
}

describe('the Umami tracker', () => {
  it('puts one script tag in the head of every public page once the URL and website ID are set', async () => {
    const cms = await umamiSite(umami, { settings: SET });

    for (const pathname of PAGES) {
      const html = await anonymous(cms, pathname);
      assert.deepEqual(trackersOn(html), [PLAIN_TAG], pathname);
      assert.ok(headOf(html).includes(PLAIN_TAG), `${pathname} draws the tag outside <head>`);
    }
  });

  it('carries the configured tracker options as data attributes', async () => {
    const cms = await umamiSite(umami, {
      settings: {
        ...SET,
        domains: 'example.com, www.example.com',
        do_not_track: true,
        exclude_search: true,
        exclude_hash: true,
      },
    });

    assert.deepEqual(trackersOn(await anonymous(cms, '/about/')), [
      '<script src="https://stats.example.com/script.js" defer data-website-id="a1b2c3"' +
        ' data-domains="example.com,www.example.com" data-do-not-track="true"' +
        ' data-exclude-search="true" data-exclude-hash="true"></script>',
    ]);
  });

  for (const [unset, settings] of [
    ['nothing', undefined],
    ['the website ID', { umami_url: SET.umami_url }],
    ['the Umami URL', { website_id: SET.website_id }],
  ] as const) {
    it(`draws no tag with ${unset} set`, async () => {
      const cms = await umamiSite(umami, settings === undefined ? {} : { settings });
      for (const pathname of PAGES) {
        assert.deepEqual(trackersOn(await anonymous(cms, pathname)), [], pathname);
      }
    });
  }

  it('leaves out a signed-in reader, unless the site counts signed-in visits', async () => {
    const skipping = await umamiSite(umami, { settings: SET });
    const admin = await signIn(skipping);
    assert.deepEqual(trackersOn(await (await admin.get('/about/')).text()), []);

    const counting = await umamiSite(umami, { settings: { ...SET, count_signed_in: true } });
    const counted = await signIn(counting);
    assert.deepEqual(trackersOn(await (await counted.get('/about/')).text()), [PLAIN_TAG]);
  });

  it('draws no tag in dev mode', async () => {
    const cms = await umamiSite(umami, {
      settings: { ...SET, count_signed_in: true },
      devMode: true,
    });
    assert.deepEqual(trackersOn(await anonymous(cms, '/about/')), []);
  });

  it('draws no tag in the editor preview', async () => {
    const cms = await umamiSite(umami, { settings: { ...SET, count_signed_in: true } });
    const admin = await signIn(cms);

    for (const type of ['post', 'page']) {
      const response = await admin.post('/admin/preview', {
        type,
        title: 'Unsaved',
        body: 'Words.',
      });
      const html = await response.text();
      assert.equal(response.status, 200);
      assert.match(html, /Unsaved/);
      assert.deepEqual(trackersOn(html), [], `the ${type} preview`);
    }
  });
});
