import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { sandbox } from '../admin/__testing__/harness.ts';
import type { Cms } from '../index.ts';

const box = sandbox();
after(() => box.cleanup());

const EPISODE = '/uploads/2026/episode.mp3';
const SIZE = 200_000;

let cms: Cms;
let uploads: string;
before(async () => {
  const contentDir = await box.dir('geekity-asset-descriptors-');
  uploads = path.join(contentDir, 'uploads', '2026');
  await mkdir(uploads, { recursive: true });
  await writeFile(path.join(uploads, 'episode.mp3'), Buffer.alloc(SIZE, 7));
  cms = await box.site({ contentDir });
});

function openDescriptors(): number {
  return readdirSync(process.platform === 'linux' ? '/proc/self/fd' : '/dev/fd').length;
}

describe('asset response bodies', () => {
  it('leave no descriptor open after HEAD requests', async () => {
    const before = openDescriptors();
    for (let i = 0; i < 50; i += 1) {
      const response = await cms.app.request(EPISODE, { method: 'HEAD' });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('content-length'), String(SIZE));
    }
    assert.ok(openDescriptors() - before < 5, 'HEAD requests held files open');
  });

  it('leave no descriptor open for GETs whose bodies are never read', async () => {
    const before = openDescriptors();
    const unread = [];
    for (let i = 0; i < 50; i += 1) {
      unread.push(await cms.app.request(EPISODE));
      unread.push(await cms.app.request(EPISODE, { headers: { range: 'bytes=100-150000' } }));
    }
    assert.ok(openDescriptors() - before < 5, 'unread bodies held files open');
    assert.equal(unread.length, 100);
  });

  it('close the file when a partly read body is cancelled', async () => {
    const before = openDescriptors();
    for (let i = 0; i < 20; i += 1) {
      const reader = (await cms.app.request(EPISODE)).body!.getReader();
      assert.equal((await reader.read()).done, false);
      await reader.cancel();
    }
    assert.ok(openDescriptors() - before < 5, 'cancelled bodies held files open');
  });

  it('still deliver the whole file and a range of it', async () => {
    const whole = new Uint8Array(await (await cms.app.request(EPISODE)).arrayBuffer());
    assert.equal(whole.byteLength, SIZE);
    assert.ok(whole.every((byte) => byte === 7));

    const part = await cms.app.request(EPISODE, { headers: { range: 'bytes=100-150000' } });
    assert.equal(part.status, 206);
    assert.equal((await part.arrayBuffer()).byteLength, 149_901);
  });

  it('fail rather than send other bytes than the headers describe', async () => {
    await writeFile(path.join(uploads, 'swap.mp3'), Buffer.alloc(SIZE, 1));
    const response = await cms.app.request('/uploads/2026/swap.mp3');
    assert.equal(response.headers.get('content-length'), String(SIZE));

    await writeFile(path.join(uploads, 'other.mp3'), Buffer.alloc(SIZE / 2, 2));
    await rename(path.join(uploads, 'other.mp3'), path.join(uploads, 'swap.mp3'));

    await assert.rejects(response.arrayBuffer());
  });
});
