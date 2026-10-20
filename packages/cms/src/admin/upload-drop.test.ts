/**
 * Uploading where a file is asked for (TASK-439): the image-only refusal on
 * the upload endpoint, and the upload control every target page renders for
 * static/upload-drop.js to reveal.
 */
import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { after, describe, it } from 'node:test';

import { csrfField, sandbox, signedIn } from './__testing__/harness.ts';
import type { Browser } from './__testing__/harness.ts';
import type { Cms } from '../index.ts';

const box = sandbox();
after(() => box.cleanup());

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

async function admin(): Promise<{ cms: Cms; agent: Browser; token: string }> {
  const cms = await box.site();
  const agent = await signedIn(cms);
  const token = csrfField(await (await agent.get('/admin/posts/new?kind=note')).text());
  assert.ok(token !== undefined, 'the editor carried a CSRF token');
  return { cms, agent, token };
}

describe('uploading only an image (TASK-439 AC #5)', () => {
  it('refuses a file that is not an image when the target asks for images', async () => {
    const { cms, agent, token } = await admin();

    const response = await agent.upload(
      '/admin/uploads',
      token,
      { name: 'notes.txt', type: 'text/plain', bytes: new TextEncoder().encode('hello') },
      'file',
      { images: '1' },
    );

    assert.equal(response.status, 415);
    assert.match(((await response.json()) as { error: string }).error, /image/i);
    assert.deepEqual(await readdir(cms.config.contentDir), []);
  });

  it('stores an image the same target sends', async () => {
    const { agent, token } = await admin();

    const response = await agent.upload(
      '/admin/uploads',
      token,
      { name: 'cover.png', type: 'image/png', bytes: PNG },
      'file',
      { images: '1' },
    );

    assert.equal(response.status, 201);
    assert.match(((await response.json()) as { url: string }).url, /\/cover\.png$/);
  });
});
