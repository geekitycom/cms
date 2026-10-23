import assert from 'node:assert/strict';
import { readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, afterEach, before, describe, it } from 'node:test';

import { sandbox } from '../admin/__testing__/harness.ts';
import { BODY, FAMILY, googleLookup, stubGoogle } from '../fonts/__testing__/google.ts';
import type { StubbedGoogle } from '../fonts/__testing__/google.ts';
import { FONT_FETCH_JOB, queueFontFetch } from '../fonts/index.ts';
import type { Cms } from '../index.ts';

const box = sandbox();
let google: StubbedGoogle;

before(() => {
  google = stubGoogle();
});
after(async () => {
  google.restore();
  await box.cleanup();
});
afterEach(() => {
  google.reset();
});

async function site(): Promise<Cms> {
  return await box.site({ hostLookup: googleLookup });
}

async function fetched(cms: Cms): Promise<{ href: string; woff2: string }> {
  google.serveFamily(BODY);
  const answer = await cms.fonts.ensure(FAMILY, BODY);
  assert.ok(answer.ok, JSON.stringify(answer));
  const folder = path.join(cms.config.dataDir, 'fonts', 'atkinson-hyperlegible');
  const woff2 = (await readdir(folder)).find((name) => name.endsWith('.woff2'));
  assert.ok(woff2 !== undefined);
  return { href: answer.stylesheet.href, woff2 };
}

describe('the font route', () => {
  it('serves the stylesheet as CSS, for a year when its v is current', async () => {
    const cms = await site();
    const { href } = await fetched(cms);

    const response = await cms.app.request(href);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'text/css; charset=utf-8');
    assert.equal(response.headers.get('cache-control'), 'public, max-age=31536000, immutable');
    assert.match(await response.text(), /url\(\/_geekity\/fonts\/atkinson-hyperlegible\//);

    const stale = await cms.app.request(href.replace(/v=\w+/, 'v=000000000000'));
    assert.equal(stale.status, 200);
    assert.equal(stale.headers.get('cache-control'), 'public, max-age=3600');
  });

  it('serves a font file as WOFF2, for a year, because its name is its hash', async () => {
    const cms = await site();
    const { woff2 } = await fetched(cms);

    const response = await cms.app.request(`/_geekity/fonts/atkinson-hyperlegible/${woff2}`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'font/woff2');
    assert.equal(response.headers.get('cache-control'), 'public, max-age=31536000, immutable');
    assert.ok(response.headers.get('etag'));
    assert.equal(
      Buffer.from(await response.arrayBuffer())
        .subarray(0, 4)
        .toString('latin1'),
      'wOF2',
    );
  });

  it('answers 404 for anything the store did not write', async () => {
    const cms = await site();
    const { woff2 } = await fetched(cms);
    const folder = path.join(cms.config.dataDir, 'fonts', 'atkinson-hyperlegible');
    await writeFile(path.join(folder, 'notes.txt'), 'hello');
    await writeFile(path.join(folder, `${woff2}.123-1.tmp`), 'half');

    for (const href of [
      '/_geekity/fonts/atkinson-hyperlegible/notes.txt',
      `/_geekity/fonts/atkinson-hyperlegible/${woff2}.123-1.tmp`,
      '/_geekity/fonts/atkinson-hyperlegible/000000000000.woff2',
      '/_geekity/fonts/nosuch/400.css',
      `/_geekity/fonts/..%2Fatkinson-hyperlegible/${woff2}`,
      '/_geekity/fonts/atkinson-hyperlegible/',
    ]) {
      const response = await cms.app.request(href);
      assert.equal(response.status, 404, href);
    }
  });
});

describe('the fetch-font job', () => {
  it('fetches a family again once its files are gone', async () => {
    const cms = await site();
    await fetched(cms);
    await rm(path.join(cms.config.dataDir, 'fonts'), { recursive: true });
    assert.equal(cms.fonts.stylesheet(FAMILY, BODY), undefined);

    const id = await queueFontFetch(cms.jobs, FAMILY, BODY);
    assert.equal(await queueFontFetch(cms.jobs, FAMILY, [...BODY].reverse()), id);
    const status = await cms.jobs.run(id);
    assert.equal(status.state, 'finished', JSON.stringify(status));
    assert.equal(status.name, FONT_FETCH_JOB.name);

    const stylesheet = cms.fonts.stylesheet(FAMILY, BODY);
    assert.ok(stylesheet !== undefined);
    const response = await cms.app.request(stylesheet.href);
    assert.equal(response.status, 200);
  });

  it('fails with the refusal when Google does not have the family', async () => {
    const cms = await site();
    const id = await queueFontFetch(cms.jobs, 'Nosuch Family', BODY);
    const status = await cms.jobs.run(id);
    assert.equal(status.state, 'failed');
    assert.ok(status.state === 'failed');
    assert.match(status.error, /Google Fonts has no family called Nosuch Family/);
  });
});
