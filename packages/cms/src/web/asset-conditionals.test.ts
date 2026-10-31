import assert from 'node:assert/strict';
import { mkdir, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { sandbox } from '../admin/__testing__/harness.ts';
import type { Cms } from '../index.ts';

const box = sandbox();
after(() => box.cleanup());

const EPISODE = '/uploads/2026/episode.mp3';
const EMPTY = '/uploads/2026/empty.txt';
const LONG_AGO = new Date('2026-01-01T00:00:00Z');

let cms: Cms;
let lastModified: string;
let etag: string;

before(async () => {
  const contentDir = await box.dir('geekity-asset-conditionals-');
  const uploads = path.join(contentDir, 'uploads', '2026');
  await mkdir(uploads, { recursive: true });
  await writeFile(path.join(uploads, 'episode.mp3'), Buffer.alloc(100, 7));
  await writeFile(path.join(uploads, 'empty.txt'), '');
  await utimes(path.join(uploads, 'episode.mp3'), LONG_AGO, LONG_AGO);
  cms = await box.site({ contentDir });

  const whole = await request(EPISODE);
  lastModified = whole.headers.get('last-modified') ?? '';
  etag = whole.headers.get('etag') ?? '';
  assert.notEqual(lastModified, '');
  assert.notEqual(etag, '');
});

async function request(url: string, headers: Record<string, string> = {}): Promise<Response> {
  const response = await cms.app.request(url, { headers });
  await response.arrayBuffer();
  return response;
}

describe('a range request for an asset', () => {
  it('reads the range unit in any case', async () => {
    const response = await request(EPISODE, { range: 'Bytes=10-19' });
    assert.equal(response.status, 206);
    assert.equal(response.headers.get('content-range'), 'bytes 10-19/100');
  });

  it('honours an If-Range that carries the ETag or the Last-Modified date', async () => {
    for (const ifRange of [etag, lastModified]) {
      const response = await request(EPISODE, { range: 'bytes=10-19', 'if-range': ifRange });
      assert.equal(response.status, 206, ifRange);
    }
  });

  it('sends the whole file for an If-Range naming another date or a weak tag', async () => {
    for (const ifRange of ['Thu, 01 Jan 2026 00:00:01 GMT', `W/${etag}`]) {
      const response = await request(EPISODE, { range: 'bytes=10-19', 'if-range': ifRange });
      assert.equal(response.status, 200, ifRange);
    }
  });

  it('answers an unsatisfiable range with a 416 no shared cache keeps', async () => {
    const response = await request(EPISODE, { range: 'bytes=500-' });
    assert.equal(response.status, 416);
    assert.doesNotMatch(response.headers.get('cache-control') ?? '', /\bpublic\b|max-age/);
  });

  it('answers a suffix range on an empty file with the whole, empty file', async () => {
    const response = await request(EMPTY, { range: 'bytes=-500' });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-length'), '0');
  });
});

describe('a conditional request for an asset', () => {
  it('is answered 304 when If-Modified-Since is not before Last-Modified', async () => {
    assert.equal((await request(EPISODE, { 'if-modified-since': lastModified })).status, 304);
    assert.equal(
      (await request(EPISODE, { 'if-modified-since': 'Fri, 02 Jan 2026 00:00:00 GMT' })).status,
      304,
    );
  });

  it('gets the file when it changed since If-Modified-Since, or the date is not one', async () => {
    for (const since of ['Wed, 31 Dec 2025 00:00:00 GMT', 'yesterday']) {
      assert.equal((await request(EPISODE, { 'if-modified-since': since })).status, 200, since);
    }
  });

  it('lets If-None-Match decide alone when both are sent', async () => {
    const response = await request(EPISODE, {
      'if-none-match': '"something-else"',
      'if-modified-since': lastModified,
    });
    assert.equal(response.status, 200);
  });

  it('is answered 304 by If-Modified-Since on every kind of asset', async () => {
    const theme = await request('/theme/style.css');
    const since = theme.headers.get('last-modified') ?? '';
    assert.equal((await request('/theme/style.css', { 'if-modified-since': since })).status, 304);
  });
});
