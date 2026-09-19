import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { createCms } from '../index.ts';
import type { Cms } from '../index.ts';

const started: Cms[] = [];
const temporaryDirs: string[] = [];

after(async () => {
  for (const instance of started) await instance.close();
  await Promise.all(temporaryDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

async function temporaryDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  temporaryDirs.push(dir);
  return dir;
}

/** A CMS over a content directory holding `files`, already synced. */
async function site(
  files: Record<string, string> = {},
): Promise<{ cms: Cms; contentDir: string; dataDir: string }> {
  const contentDir = await temporaryDir('geekity-health-content-');
  const dataDir = await temporaryDir('geekity-health-data-');
  for (const [relative, contents] of Object.entries(files)) {
    const file = path.join(contentDir, relative);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, contents, 'utf8');
  }

  const instance = createCms({ contentDir, dataDir, watch: false });
  started.push(instance);
  await instance.sync();
  return { cms: instance, contentDir, dataDir };
}

describe('GET /healthz', () => {
  it('answers 200 with every check passing when the site can serve', async () => {
    const { cms } = await site();

    const response = await cms.app.request('/healthz');

    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /application\/json/);
    assert.deepEqual(await response.json(), {
      status: 'ok',
      checks: { database: 'ok', content: 'ok' },
    });
  });

  it('answers 503 when the content index cannot be queried', async () => {
    const { cms } = await site();
    cms.store.close();

    const response = await cms.app.request('/healthz');

    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      status: 'fail',
      checks: { database: 'fail', content: 'ok' },
    });
  });

  it('answers 503 when the content directory cannot be read', async () => {
    const { cms, contentDir } = await site();
    await rm(contentDir, { recursive: true, force: true });

    const response = await cms.app.request('/healthz');

    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      status: 'fail',
      checks: { database: 'ok', content: 'fail' },
    });
  });

  it('is not shadowed by a page whose permalink is /healthz/', async () => {
    const { cms } = await site({
      'pages/healthz.md': '---\ntitle: Healthz\npermalink: /healthz/\n---\n\nA page.\n',
    });

    const response = await cms.app.request('/healthz');

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      status: 'ok',
      checks: { database: 'ok', content: 'ok' },
    });
    // The page is still there at its own address.
    const page = await cms.app.request('/healthz/');
    assert.equal(page.status, 200);
    assert.match(await page.text(), /A page\./);
  });

  it('is never cached and sets no cookie, healthy or not', async () => {
    const { cms } = await site();

    const healthy = await cms.app.request('/healthz');
    cms.store.close();
    const failing = await cms.app.request('/healthz');

    for (const response of [healthy, failing]) {
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.equal(response.headers.get('set-cookie'), null);
    }
  });

  it('names each check and nothing else a stranger should not learn', async () => {
    const { cms, contentDir, dataDir } = await site();
    await rm(contentDir, { recursive: true, force: true });
    cms.store.close();

    const response = await cms.app.request('/healthz');
    const body = await response.text();

    assert.deepEqual(JSON.parse(body), {
      status: 'fail',
      checks: { database: 'fail', content: 'fail' },
    });
    assert.doesNotMatch(body, /ENOENT|closed|Error/i);
    assert.equal(body.includes(contentDir), false);
    assert.equal(body.includes(dataDir), false);
    assert.equal(response.headers.get('x-powered-by'), null);
  });
});
