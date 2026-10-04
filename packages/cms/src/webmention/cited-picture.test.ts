import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, afterEach, describe, it } from 'node:test';

import { gifWithMetadata, jpegWithMetadata, leakedSecrets } from '../__testing__/metadata.ts';
import {
  copyCitedPicture,
  parseCitedPicture,
  sweepCitedPictures,
  CITED_PICTURE_PREFIX,
} from './cited-picture.ts';
import type { CitedPictureConfig } from './cited-picture.ts';
import type { HostLookup } from './public-address.ts';

const ADDRESSES: Record<string, string[]> = {
  'media.giphy.com': ['203.0.113.30'],
  'i.ytimg.com': ['203.0.113.31'],
  'inside.example': ['10.0.0.9'],
};

const lookup: HostLookup = (hostname) => {
  const found = ADDRESSES[hostname];
  return found === undefined
    ? Promise.reject(new Error(`getaddrinfo ENOTFOUND ${hostname}`))
    : Promise.resolve(found);
};

const requested: string[] = [];
let answer: (request: Request) => Response | Promise<Response> = () =>
  new Response('missing', { status: 404 });

const original = globalThis.fetch;
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const request = new Request(input, init);
  requested.push(request.url);
  return answer(request);
}) as typeof fetch;

const directories: string[] = [];

after(async () => {
  globalThis.fetch = original;
  await Promise.all(
    directories.map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

afterEach(() => {
  requested.length = 0;
  answer = () => new Response('missing', { status: 404 });
});

async function site(uploadMaxBytes = 1_000_000): Promise<CitedPictureConfig> {
  const root = await mkdtemp(path.join(tmpdir(), 'geekity-cited-picture-'));
  directories.push(root);
  return {
    contentDir: path.join(root, 'content'),
    dataDir: path.join(root, 'data'),
    imageOptimization: true,
    imageWidths: [16, 32],
    imageFormats: ['webp'],
    uploadMaxBytes,
  };
}

function image(bytes: Uint8Array, type: string): Response {
  return new Response(bytes, { headers: { 'content-type': type } });
}

const GIF_URL = 'https://media.giphy.com/media/abc/giphy.gif';
const JPEG_URL = 'https://i.ytimg.com/vi/abc/hqdefault.jpg';

describe('copyCitedPicture', () => {
  it('copies a GIF under uploads/cited, with its metadata stripped and its size recorded', async () => {
    const config = await site();
    const gif = await gifWithMetadata();
    assert.notDeepEqual(leakedSecrets(gif), []);
    answer = () => image(gif, 'image/gif');

    const picture = await copyCitedPicture({ url: GIF_URL, kind: 'photo' }, { lookup, config });

    assert.ok(picture !== undefined);
    assert.match(picture.src, /^\/uploads\/cited\/[0-9a-f]{16}\.gif$/);
    assert.deepEqual(
      { ...picture, src: undefined },
      {
        src: undefined,
        width: 40,
        height: 20,
        kind: 'photo',
      },
    );
    const stored = await readFile(path.join(config.contentDir, picture.src));
    assert.deepEqual(leakedSecrets(stored), []);
    assert.deepEqual(requested, [GIF_URL]);
  });

  it('strips a JPEG thumbnail, keeps the video mark and derives its variants', async () => {
    const config = await site();
    answer = async () => image(await jpegWithMetadata(), 'image/jpeg');

    const picture = await copyCitedPicture(
      { url: JPEG_URL, kind: 'thumbnail', video: true },
      { lookup, config },
    );

    assert.ok(picture !== undefined);
    assert.match(picture.src, /^\/uploads\/cited\/[0-9a-f]{16}\.jpg$/);
    assert.equal(picture.kind, 'thumbnail');
    assert.equal(picture.video, true);
    const stored = await readFile(path.join(config.contentDir, picture.src));
    assert.deepEqual(leakedSecrets(stored), []);
    const derived = await readdir(
      path.join(config.dataDir, 'images', 'cited', path.basename(picture.src)),
    );
    assert.ok(derived.includes('16.webp'), derived.join(', '));
  });

  it('names a copy after its bytes, so the same picture is stored once', async () => {
    const config = await site();
    const gif = await gifWithMetadata();
    answer = () => image(gif, 'image/gif');

    const first = await copyCitedPicture({ url: GIF_URL, kind: 'photo' }, { lookup, config });
    const second = await copyCitedPicture(
      { url: `${GIF_URL}?again`, kind: 'thumbnail' },
      { lookup, config },
    );

    assert.equal(first?.src, second?.src);
    assert.equal((await readdir(path.join(config.contentDir, 'uploads', 'cited'))).length, 1);
  });

  it('copies nothing bigger than the site’s upload limit', async () => {
    const gif = await gifWithMetadata();
    const config = await site(gif.length - 1);
    answer = () => image(gif, 'image/gif');

    assert.equal(
      await copyCitedPicture({ url: GIF_URL, kind: 'photo' }, { lookup, config }),
      undefined,
    );
    await assert.rejects(readdir(path.join(config.contentDir, 'uploads', 'cited')));
  });

  it('copies nothing that is not an image, inside or by its type', async () => {
    const config = await site();
    for (const [body, type] of [
      [new TextEncoder().encode('<svg onload="alert(1)"/>'), 'image/svg+xml'],
      [new TextEncoder().encode('GIF89a but not really'), 'text/html'],
      [new TextEncoder().encode('<html>not a picture</html>'), 'image/png'],
    ] as const) {
      answer = () => image(body, type);

      assert.equal(
        await copyCitedPicture({ url: GIF_URL, kind: 'photo' }, { lookup, config }),
        undefined,
        type,
      );
    }
    await assert.rejects(readdir(path.join(config.contentDir, 'uploads', 'cited')));
  });

  it('never asks a private address for a picture', async () => {
    const config = await site();
    answer = async () => image(await gifWithMetadata(), 'image/gif');

    assert.equal(
      await copyCitedPicture(
        { url: 'https://inside.example/a.gif', kind: 'photo' },
        { lookup, config },
      ),
      undefined,
    );
    assert.deepEqual(requested, []);
  });

  it('gives up on a picture that does not arrive in time', async () => {
    const config = await site();
    answer = (request) =>
      new Promise((_resolve, reject) => {
        request.signal.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'));
        });
      });

    const started = Date.now();
    assert.equal(
      await copyCitedPicture({ url: GIF_URL, kind: 'photo' }, { lookup, config, timeoutMs: 50 }),
      undefined,
    );
    assert.ok(Date.now() - started < 2_000);
  });
});

describe('sweepCitedPictures', () => {
  it('deletes every copy no entry names, with its variants, and keeps the rest', async () => {
    const config = await site();
    answer = async (request) =>
      request.url === GIF_URL
        ? image(await gifWithMetadata(), 'image/gif')
        : image(await jpegWithMetadata(), 'image/jpeg');
    const kept = await copyCitedPicture({ url: GIF_URL, kind: 'photo' }, { lookup, config });
    const dropped = await copyCitedPicture(
      { url: JPEG_URL, kind: 'thumbnail' },
      { lookup, config },
    );
    assert.ok(kept !== undefined && dropped !== undefined);

    await sweepCitedPictures(config, new Set([kept.src]));

    const cited = path.join(config.contentDir, 'uploads', 'cited');
    assert.deepEqual(await readdir(cited), [path.basename(kept.src)]);
    await assert.rejects(
      readdir(path.join(config.dataDir, 'images', 'cited', path.basename(dropped.src))),
    );
  });

  it('leaves the author’s own uploads alone', async () => {
    const config = await site();
    const own = path.join(config.contentDir, 'uploads', '2026', '10');
    await mkdir(own, { recursive: true });
    await writeFile(path.join(own, 'mine.gif'), await gifWithMetadata());

    await sweepCitedPictures(config, new Set());

    assert.deepEqual(await readdir(own), ['mine.gif']);
  });
});

describe('parseCitedPicture', () => {
  const PICTURE = {
    src: `${CITED_PICTURE_PREFIX}0123456789abcdef.gif`,
    width: 480,
    height: 270,
    kind: 'photo',
  };

  it('reads a picture the file holds', () => {
    assert.deepEqual(parseCitedPicture(PICTURE), PICTURE);
    assert.deepEqual(parseCitedPicture({ ...PICTURE, kind: 'thumbnail', video: true }), {
      ...PICTURE,
      kind: 'thumbnail',
      video: true,
    });
  });

  it('drops a picture that is not a copy the CMS made', () => {
    for (const broken of [
      { ...PICTURE, src: 'https://media.giphy.com/media/abc/giphy.gif' },
      { ...PICTURE, src: '/uploads/2026/10/mine.gif' },
      { ...PICTURE, src: `${CITED_PICTURE_PREFIX}../../secret.gif` },
      { ...PICTURE, width: 0 },
      { ...PICTURE, height: '270' },
      { ...PICTURE, kind: 'rich' },
      'a picture',
    ]) {
      assert.equal(parseCitedPicture(broken), undefined, JSON.stringify(broken));
    }
  });
});
