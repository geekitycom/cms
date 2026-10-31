import assert from 'node:assert/strict';
import { statSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import sharp from 'sharp';

import { sandbox } from '../admin/__testing__/harness.ts';
import type { Cms } from '../index.ts';

const box = sandbox();
after(() => box.cleanup());

async function siteWithUpload(
  name: string,
): Promise<{ cms: Cms; contentDir: string; dataDir: string }> {
  const contentDir = await box.dir('geekity-asset-paths-content-');
  const dataDir = await box.dir('geekity-asset-paths-data-');
  const file = path.join(contentDir, 'uploads', name);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(
    file,
    await sharp({
      create: { width: 1000, height: 500, channels: 3, background: { r: 40, g: 90, b: 160 } },
    })
      .png()
      .toBuffer(),
  );
  const cms = await box.site({ contentDir, dataDir });
  return { cms, contentDir, dataDir };
}

async function postEmbedding(cms: Cms, contentDir: string, url: string): Promise<void> {
  const file = path.join(contentDir, 'posts', 'a-photo.md');
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(
    file,
    `---\ntitle: A photo\ndate: 2026-01-01T00:00:00Z\npermalink: /a-photo/\n---\n\n![A photo](${url})\n`,
    'utf8',
  );
  await cms.sync();
}

const OUT_AND_BACK = '/uploads/_/x%2F..%2F..%2Fuploads%2F2026%2F01%2Fphoto.png/320.webp';

describe('asset request paths', () => {
  it('answers 404 for a variant path that walks out and back in, encoding nothing', async () => {
    const { cms, contentDir, dataDir } = await siteWithUpload('2026/01/photo.png');
    await postEmbedding(cms, contentDir, '/uploads/2026/01/photo.png');
    assert.equal((await cms.app.request('/uploads/_/2026/01/photo.png/320.webp')).status, 200);
    const variant = path.join(dataDir, 'images', '2026', '01', 'photo.png', '320.webp');
    const before = statSync(variant).mtimeMs;

    assert.equal((await cms.app.request(OUT_AND_BACK)).status, 404);
    assert.equal(statSync(variant).mtimeMs, before, 'the existing 320.webp was encoded again');
  });

  it('keeps every srcset URL canonical after such a request', async () => {
    const { cms, contentDir } = await siteWithUpload('2026/01/photo.png');
    await postEmbedding(cms, contentDir, '/uploads/2026/01/photo.png');
    assert.equal((await cms.app.request('/uploads/_/2026/01/photo.png/320.webp')).status, 200);

    await cms.app.request(OUT_AND_BACK);

    const html = await (await cms.app.request('/a-photo/')).text();
    const hrefs = [...html.matchAll(/(\/uploads\/_\/[^\s",?]+)/g)].map((match) => match[1]);
    assert.ok(hrefs.length > 0, 'the page offered variants');
    for (const href of hrefs) {
      assert.ok(
        href?.startsWith('/uploads/_/2026/01/photo.png/'),
        `srcset carried ${String(href)}`,
      );
    }
  });

  it('serves the variants of an upload whose name holds a literal %XX', async () => {
    const { cms } = await siteWithUpload('2026/01/a%41.png');

    assert.equal((await cms.app.request('/uploads/2026/01/a%2541.png')).status, 200);
    assert.equal((await cms.app.request('/uploads/_/2026/01/a%2541.png/320.webp')).status, 200);
  });

  it('answers 404 for a half-written strip file however its path is spelled', async () => {
    const contentDir = await box.dir('geekity-asset-paths-strip-');
    const dir = path.join(contentDir, 'uploads', '2026', '09');
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'beach.jpg'), 'stripped');
    await writeFile(path.join(dir, 'beach.jpg.geekity-strip'), 'half written');
    const cms = await box.site({ contentDir });

    for (const spelling of [
      '/uploads/2026/09/beach.jpg.geekity-strip',
      '/uploads/2026/09/beach.jpg.geekity-strip%2F.',
      '/uploads/2026/09/./beach.jpg.geekity-strip',
      '/uploads/2026//09/beach.jpg.geekity-strip',
    ]) {
      const response = await cms.app.request(spelling);
      assert.equal(response.status, 404, `${spelling} answered ${String(response.status)}`);
    }
  });

  it('answers 404 for a theme asset path with a dot segment', async () => {
    const { cms } = await siteWithUpload('2026/01/photo.png');
    assert.equal((await cms.app.request('/theme/style.css')).status, 200);
    assert.equal((await cms.app.request('/theme/x/..%2Fstyle.css')).status, 404);
  });
});
