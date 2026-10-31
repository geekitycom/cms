import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import sharp from 'sharp';

import { findImageVariant, settleImageVariants } from './variants.ts';
import type { ImageConfig } from './variants.ts';

const temporary: string[] = [];
after(async () => {
  await Promise.all(temporary.map((dir) => rm(dir, { recursive: true, force: true })));
});

async function site(): Promise<ImageConfig> {
  const root = await mkdtemp(path.join(tmpdir(), 'geekity-icons-'));
  temporary.push(root);
  return {
    contentDir: path.join(root, 'content'),
    dataDir: path.join(root, 'data'),
    imageOptimization: true,
    imageWidths: [320, 640],
    imageFormats: ['webp'],
  };
}

async function picture(config: ImageConfig, name: string, size = 1500): Promise<string> {
  const file = path.join(config.contentDir, 'uploads', name);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(
    file,
    await sharp({
      create: { width: size, height: size, channels: 3, background: { r: 10, g: 120, b: 200 } },
    })
      .png()
      .toBuffer(),
  );
  return name;
}

const ICON = '2026/09/avatar.png';

describe('the site icons', () => {
  it('are drawn only from the site icon', async () => {
    const config = await site();
    await picture(config, ICON);
    const other = await picture(config, '2026/09/other.png');

    assert.equal(await findImageVariant(config, `${other}/icon-512.png`, ICON), undefined);
    assert.equal(await findImageVariant(config, `${other}/favicon.ico`), undefined);
    assert.equal(existsSync(path.join(config.dataDir, 'images', other)), false);
    assert.ok(await findImageVariant(config, `${ICON}/icon-512.png`, ICON));
  });

  it('run one sharp pipeline at a time however many requests arrive at once', async () => {
    const config = await site();
    await picture(config, ICON);

    let busiest = 0;
    const sample = setInterval(() => {
      const { queue, process } = sharp.counters();
      busiest = Math.max(busiest, queue + process);
    }, 1);
    try {
      const served = await Promise.all(
        Array.from({ length: 10 }, () => findImageVariant(config, `${ICON}/icon-512.png`, ICON)),
      );
      assert.ok(served.every((asset) => asset !== undefined));
    } finally {
      clearInterval(sample);
    }

    // sharp's counters can show the next pipeline queued for an instant
    // before the last one is counted out, so one derivation can read as two.
    assert.ok(busiest <= 2, `${String(busiest)} sharp pipelines ran at once`);
  });

  it('are waited for by settleImageVariants', async () => {
    const config = await site();
    await picture(config, ICON);

    let finished = false;
    const request = findImageVariant(config, `${ICON}/icon-512.png`, ICON).then(() => {
      finished = true;
    });
    await settleImageVariants(config);
    const finishedAtSettle = finished;
    await request;

    assert.ok(finishedAtSettle, 'settleImageVariants returned while the icons were being drawn');
  });

  it('raise a write the server could not make rather than answering a missing icon', async (t) => {
    if (process.getuid?.() === 0) t.skip('root ignores directory permissions');
    const config = await site();
    await picture(config, ICON, 64);
    const images = path.join(config.dataDir, 'images');
    await mkdir(images, { recursive: true });
    await chmod(images, 0o555);
    try {
      await assert.rejects(findImageVariant(config, `${ICON}/icon-32.png`, ICON));
    } finally {
      await chmod(images, 0o755);
    }
  });
});
