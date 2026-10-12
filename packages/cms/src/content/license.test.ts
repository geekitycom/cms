import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { CREATIVE_COMMONS_LICENSES, resolveLicense } from './license.ts';

const BY_SA = { name: 'CC BY-SA 4.0', url: 'https://creativecommons.org/licenses/by-sa/4.0/' };

describe('the license a page is under (TASK-206)', () => {
  it('has none when the site names none, which is all rights reserved', () => {
    assert.equal(resolveLicense({}), undefined);
    assert.equal(resolveLicense({ license: '' }), undefined);
    assert.equal(resolveLicense({ license: 'none' }), undefined);
  });

  it('reads a Creative Commons key, in any case', () => {
    assert.deepEqual(resolveLicense({ license: 'cc-by-sa' }), BY_SA);
    assert.deepEqual(resolveLicense({ license: ' CC-BY-SA ' }), BY_SA);
    assert.deepEqual(resolveLicense({ license: 'cc0' }), {
      name: 'CC0 1.0',
      url: 'https://creativecommons.org/publicdomain/zero/1.0/',
    });
  });

  it('knows all seven Creative Commons choices, each with its own deed', () => {
    assert.deepEqual(Object.keys(CREATIVE_COMMONS_LICENSES), [
      'cc-by',
      'cc-by-sa',
      'cc-by-nc',
      'cc-by-nc-sa',
      'cc-by-nd',
      'cc-by-nc-nd',
      'cc0',
    ]);
    const urls = Object.values(CREATIVE_COMMONS_LICENSES).map((license) => license.url);
    assert.equal(new Set(urls).size, urls.length);
  });

  it('reads a custom URL with its name', () => {
    assert.deepEqual(
      resolveLicense({ license: 'https://example.com/terms', licenseName: 'House terms' }),
      { name: 'House terms', url: 'https://example.com/terms' },
    );
  });

  it('names a Creative Commons URL by its deed, and an unnamed custom URL by itself', () => {
    assert.deepEqual(resolveLicense({ license: BY_SA.url }), BY_SA);
    assert.deepEqual(resolveLicense({ license: 'https://example.com/terms' }), {
      name: 'https://example.com/terms',
      url: 'https://example.com/terms',
    });
  });

  it('has nothing for a value that is neither a key nor a web URL', () => {
    assert.equal(resolveLicense({ license: 'cc-by-9' }), undefined);
    assert.equal(resolveLicense({ license: 'javascript:alert(1)' }), undefined);
    assert.equal(resolveLicense({ license: 42 }), undefined);
  });

  it("lets a post's license override the site's", () => {
    const site = { license: 'cc-by' };
    assert.deepEqual(resolveLicense(site, { license: 'cc-by-sa' }), BY_SA);
    assert.deepEqual(
      resolveLicense(site, { license: 'https://example.com/terms', licenseName: 'House terms' }),
      { name: 'House terms', url: 'https://example.com/terms' },
    );
  });

  it('lets a post say none, and keeps the site license for a post that says nothing usable', () => {
    const site = { license: 'cc-by' };
    assert.equal(resolveLicense(site, { license: 'none' }), undefined);
    const ccBy = { name: 'CC BY 4.0', url: 'https://creativecommons.org/licenses/by/4.0/' };
    assert.deepEqual(resolveLicense(site, {}), ccBy);
    assert.deepEqual(resolveLicense(site, { license: 'cc-by-9' }), ccBy);
  });

  it("does not lend the site's custom name to a post's own URL", () => {
    const site = { license: 'https://example.com/terms', licenseName: 'House terms' };
    assert.deepEqual(resolveLicense(site, { license: 'https://example.com/other' }), {
      name: 'https://example.com/other',
      url: 'https://example.com/other',
    });
  });
});
