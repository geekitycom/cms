import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { sandbox } from '../admin/__testing__/harness.ts';
import type { Cms } from '../index.ts';

const box = sandbox();
after(() => box.cleanup());

const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script></svg>';

let cms: Cms;
before(async () => {
  const contentDir = await box.dir('geekity-upload-disposition-');
  const files: Record<string, string | Uint8Array> = {
    'uploads/2026/09/logo.svg': SVG,
    'uploads/2026/09/run.js': 'alert(1);\n',
    'uploads/2026/09/page.html': '<script>alert(1)</script>',
    'uploads/2026/09/photo.png': new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    'uploads/2026/09/notes.txt': 'Plain notes.\n',
  };
  for (const [relative, contents] of Object.entries(files)) {
    const file = path.join(contentDir, ...relative.split('/'));
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, contents);
  }
  cms = await box.site({ contentDir });
});

async function fetched(url: string, headers: Record<string, string> = {}): Promise<Response> {
  const response = await cms.app.request(url, { headers });
  await response.arrayBuffer();
  return response;
}

describe('an upload the upload door would not take', () => {
  it('is an SVG served as an image that cannot run script', async () => {
    const response = await fetched('/uploads/2026/09/logo.svg');
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'image/svg+xml');
    const policy = response.headers.get('content-security-policy') ?? '';
    assert.match(policy, /\bsandbox\b/);
    assert.match(policy, /default-src 'none'/);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  });

  it('is any other file served as a download', async () => {
    for (const url of ['/uploads/2026/09/run.js', '/uploads/2026/09/page.html']) {
      const response = await fetched(url);
      assert.equal(response.status, 200, url);
      assert.equal(response.headers.get('content-type'), 'application/octet-stream', url);
      assert.equal(response.headers.get('content-disposition'), 'attachment', url);
    }
    const part = await fetched('/uploads/2026/09/run.js', { range: 'bytes=0-3' });
    assert.equal(part.status, 206);
    assert.equal(part.headers.get('content-disposition'), 'attachment');
  });
});

describe('an upload the upload door takes', () => {
  it('is served inline under its own media type', async () => {
    const photo = await fetched('/uploads/2026/09/photo.png');
    assert.equal(photo.headers.get('content-type'), 'image/png');
    assert.equal(photo.headers.get('content-disposition'), null);

    const notes = await fetched('/uploads/2026/09/notes.txt');
    assert.equal(notes.headers.get('content-type'), 'text/plain; charset=utf-8');
    assert.equal(notes.headers.get('content-disposition'), null);
  });
});
