import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { csrfField, sandbox, signedIn } from './admin/__testing__/harness.ts';
import type { Browser } from './admin/__testing__/harness.ts';
import { saveSettings } from './admin/__testing__/settings.ts';
import { DEFAULT_SITE_SETTINGS, writeSiteJson } from './admin/settings.ts';
import type { Cms } from './index.ts';
import { INDEXNOW_ENDPOINT } from './indexnow.ts';

/**
 * IndexNow (TASK-151): a site that turns it on serves a key at `/{key}.txt`
 * and tells the search engines which URLs a publish, an edit or a deletion
 * moved. Every request here goes to a fetch the test hands in, never to the
 * network.
 */

const BASE_URL = 'https://blog.example';
const KEY = '0123456789abcdef0123456789abcdef';

const box = sandbox();
after(() => box.cleanup());

/** One submission the site made. */
interface Submission {
  url: string;
  contentType: string | null;
  body: { host: string; key: string; keyLocation: string; urlList: string[] };
}

/**
 * A fetch that records every IndexNow submission and answers each with the
 * next status in `statuses`, then 200 once they run out.
 */
function recorder(statuses: number[] = []): {
  fetch: typeof fetch;
  submissions: Submission[];
} {
  const submissions: Submission[] = [];
  const fetchStub = (async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init);
    submissions.push({
      url: request.url,
      contentType: request.headers.get('content-type'),
      body: JSON.parse(await request.text()) as Submission['body'],
    });
    return new Response(null, { status: statuses.shift() ?? 200 });
  }) as typeof fetch;
  return { fetch: fetchStub, submissions };
}

/** A post file. */
function post(slug: string, extra = ''): string {
  return `---\ntitle: ${slug}\ndate: '2026-09-02T09:00:00Z'\npermalink: /${slug}/\n${extra}---\n\nA post.\n`;
}

/** A site with IndexNow on unless told otherwise, submitting through `fetch`. */
async function site(
  options: {
    fetch: typeof fetch;
    baseUrl?: string;
    indexNow?: boolean;
    files?: Record<string, string>;
    warnings?: string[];
  } = { fetch: recorder().fetch },
): Promise<Cms> {
  const contentDir = await box.dir('geekity-indexnow-content-');
  for (const [relative, source] of Object.entries(options.files ?? {})) {
    const file = path.join(contentDir, ...relative.split('/'));
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, source, 'utf8');
  }

  const baseUrl = options.baseUrl ?? BASE_URL;
  await writeSiteJson({
    contentDir,
    settings: {
      ...DEFAULT_SITE_SETTINGS,
      baseUrl,
      indexNow: options.indexNow ?? true,
      indexNowKey: KEY,
    },
  });

  return await box.site({
    contentDir,
    baseUrl,
    indexNow: {
      fetch: options.fetch,
      backoffMs: () => 0,
      // Long enough that only `settled()` sends a batch, so what goes out
      // together is decided by the test rather than the clock.
      batchMs: 60_000,
      logger: { warn: (message) => options.warnings?.push(message) },
    },
  });
}

/** Submit the editor at `url`, keeping every value it came with. */
async function submit(
  agent: Browser,
  url: string,
  changes: Record<string, string>,
): Promise<Response> {
  const html = await (await agent.get(url)).text();
  const token = csrfField(html);
  assert.ok(token !== undefined, `the editor at ${url} carried a CSRF token`);

  const fields: Record<string, string> = { csrf_token: token, action: 'publish' };
  for (const name of ['title', 'slug', 'permalink', 'date', 'tags', 'categories', 'hash']) {
    fields[name] = new RegExp(`name="${name}"[^>]*value="([^"]*)"`).exec(html)?.[1] ?? '';
  }
  fields['body'] = /<textarea[^>]*name="body"[^>]*>([\s\S]*?)<\/textarea>/.exec(html)?.[1] ?? '';

  const saveUrl = /<form class="admin-editor" method="post" action="([^"]+)"/.exec(html)?.[1];
  return agent.post(saveUrl ?? url, { ...fields, ...changes });
}

/** Every URL submitted so far, sorted. */
function submitted(submissions: readonly Submission[]): string[] {
  return submissions.flatMap((submission) => submission.body.urlList).sort();
}

describe('turning IndexNow on (AC #1)', () => {
  it('is off by default, and turning it on stores a key and serves it at /{key}.txt', async () => {
    const contentDir = await box.dir('geekity-indexnow-settings-');
    const cms = await box.site({ contentDir, baseUrl: BASE_URL });
    const agent = await signedIn(cms);

    const before = await (await agent.get('/admin/settings/reading')).text();
    assert.match(before, /name="index_now" type="checkbox" value="1"/);
    assert.doesNotMatch(before, /name="index_now" type="checkbox" value="1" checked/);

    assert.equal((await saveSettings(agent, 'reading', { index_now: '1' })).status, 303);
    const file = JSON.parse(
      await readFile(path.join(contentDir, '_data', 'site.json'), 'utf8'),
    ) as Record<string, unknown>;
    assert.equal(file['indexNow'], true);
    const key = file['indexNowKey'];
    assert.equal(typeof key, 'string');
    assert.match(key as string, /^[0-9a-f]{32}$/);

    const served = await cms.app.request(`/${key as string}.txt`);
    assert.equal(served.status, 200);
    assert.match(served.headers.get('content-type') ?? '', /^text\/plain/);
    assert.equal(await served.text(), key);

    assert.equal((await cms.app.request(`/${KEY}.txt`)).status, 404, 'only its own key');

    // Off takes the file away and keeps the key, so on again is the same key
    // the search engines already verified.
    assert.equal((await saveSettings(agent, 'reading', { index_now: '' })).status, 303);
    assert.equal((await cms.app.request(`/${key as string}.txt`)).status, 404);
    assert.equal((await saveSettings(agent, 'reading', { index_now: '1' })).status, 303);
    const again = JSON.parse(
      await readFile(path.join(contentDir, '_data', 'site.json'), 'utf8'),
    ) as Record<string, unknown>;
    assert.equal(again['indexNowKey'], key);
    assert.equal((await cms.app.request(`/${key as string}.txt`)).status, 200);
  });
});

describe('submitting URLs (AC #2)', () => {
  it('submits a published post as JSON, naming the host, the key and where it is', async () => {
    const { fetch, submissions } = recorder();
    const cms = await site({ fetch });
    const agent = await signedIn(cms);

    const response = await submit(agent, '/admin/posts/new', {
      title: 'Hello',
      slug: 'hello',
      permalink: '/hello/',
      date: '2026-03-04T10:00:00.000Z',
    });
    assert.equal(response.status, 303);
    await cms.indexNow.settled();

    assert.equal(submissions.length, 1);
    const [only] = submissions as [Submission];
    assert.equal(only.url, INDEXNOW_ENDPOINT);
    assert.match(only.contentType ?? '', /^application\/json/);
    assert.deepEqual(only.body, {
      host: 'blog.example',
      key: KEY,
      keyLocation: `${BASE_URL}/${KEY}.txt`,
      urlList: [`${BASE_URL}/hello/`],
    });
  });

  it('submits a published page', async () => {
    const { fetch, submissions } = recorder();
    const cms = await site({ fetch });
    const agent = await signedIn(cms);

    await submit(agent, '/admin/pages/new', { title: 'About', action: 'publish' });
    await cms.indexNow.settled();

    assert.deepEqual(submitted(submissions), [`${BASE_URL}/about/`]);
  });

  it('submits both URLs of a post that moved', async () => {
    const { fetch, submissions } = recorder();
    const cms = await site({ fetch, files: { 'posts/2026-09-02-old.md': post('old') } });
    const agent = await signedIn(cms);

    const moved = await submit(agent, '/admin/posts/old', { permalink: '/new/' });
    assert.equal(moved.status, 303);
    await cms.indexNow.settled();

    assert.deepEqual(submitted(submissions), [`${BASE_URL}/new/`, `${BASE_URL}/old/`]);
  });

  it('submits the URL of a post that was deleted', async () => {
    const { fetch, submissions } = recorder();
    const cms = await site({ fetch, files: { 'posts/2026-09-02-gone.md': post('gone') } });
    const agent = await signedIn(cms);

    const trashed = await submit(agent, '/admin/posts/gone', { action: 'trash' });
    assert.equal(trashed.status, 303);
    await cms.indexNow.settled();

    assert.deepEqual(submitted(submissions), [`${BASE_URL}/gone/`]);
  });

  it('submits nothing for an unlisted post', async () => {
    const { fetch, submissions } = recorder();
    const cms = await site({ fetch });
    const agent = await signedIn(cms);

    const response = await submit(agent, '/admin/posts/new', {
      title: 'Hushed',
      slug: 'hushed',
      permalink: '/hushed/',
      date: '2026-03-04T10:00:00.000Z',
      visibility: 'unlisted',
    });
    assert.equal(response.status, 303);
    await cms.indexNow.settled();

    assert.deepEqual(submitted(submissions), []);
  });

  it('submits the URL of a post that was unlisted, so its noindex is read', async () => {
    const { fetch, submissions } = recorder();
    const cms = await site({ fetch, files: { 'posts/2026-09-02-quiet.md': post('quiet') } });
    const agent = await signedIn(cms);

    const unlisted = await submit(agent, '/admin/posts/quiet', { visibility: 'unlisted' });
    assert.equal(unlisted.status, 303);
    await cms.indexNow.settled();

    assert.deepEqual(submitted(submissions), [`${BASE_URL}/quiet/`]);
  });

  it('sends the changes that come together as one batch', async () => {
    const { fetch, submissions } = recorder();
    const cms = await site({
      fetch,
      files: { 'posts/2026-09-02-one.md': post('one'), 'posts/2026-09-03-two.md': post('two') },
    });
    const agent = await signedIn(cms);

    await submit(agent, '/admin/posts/one', { title: 'One, edited' });
    await submit(agent, '/admin/posts/two', { title: 'Two, edited' });
    await cms.indexNow.settled();

    assert.equal(submissions.length, 1, 'one request');
    assert.deepEqual(submitted(submissions), [`${BASE_URL}/one/`, `${BASE_URL}/two/`]);
  });

  it('retries a busy or failing endpoint and gives up on a refusal', async () => {
    const { fetch, submissions } = recorder([429, 503]);
    const warnings: string[] = [];
    const cms = await site({ fetch, warnings, files: { 'posts/2026-09-02-one.md': post('one') } });
    const agent = await signedIn(cms);

    await submit(agent, '/admin/posts/one', { title: 'Edited' });
    await cms.indexNow.settled();
    assert.equal(submissions.length, 3, 'tried until it was accepted');
    assert.deepEqual(warnings, []);

    const refused = recorder([403]);
    const quiet: string[] = [];
    const other = await site({
      fetch: refused.fetch,
      warnings: quiet,
      files: { 'posts/2026-09-02-one.md': post('one') },
    });
    await submit(await signedIn(other), '/admin/posts/one', { title: 'Edited' });
    await other.indexNow.settled();
    assert.equal(refused.submissions.length, 1, 'a bad key is not fixed by asking again');
    assert.equal(quiet.length, 1);
    assert.match(quiet[0] ?? '', /403/);
  });
});

describe('what is never sent (AC #3)', () => {
  it('sends nothing for a draft', async () => {
    const { fetch, submissions } = recorder();
    const cms = await site({ fetch });
    const agent = await signedIn(cms);

    const saved = await submit(agent, '/admin/posts/new', {
      title: 'Not yet',
      slug: 'not-yet',
      action: 'save-draft',
    });
    assert.equal(saved.status, 303);
    await cms.indexNow.settled();

    assert.deepEqual(submissions, []);
  });

  it('sends nothing when the base URL is not public', async () => {
    const { fetch, submissions } = recorder();
    const cms = await site({ fetch, baseUrl: 'http://localhost:3000' });
    const agent = await signedIn(cms);

    await submit(agent, '/admin/posts/new', { title: 'Local', slug: 'local' });
    await cms.indexNow.settled();

    assert.deepEqual(submissions, []);
  });

  it('sends nothing while IndexNow is off', async () => {
    const { fetch, submissions } = recorder();
    const cms = await site({
      fetch,
      indexNow: false,
      files: { 'posts/2026-09-02-one.md': post('one') },
    });
    const agent = await signedIn(cms);

    await submit(agent, '/admin/posts/one', { title: 'Edited' });
    await cms.indexNow.settled();

    assert.deepEqual(submissions, []);
    assert.equal((await cms.app.request(`/${KEY}.txt`)).status, 404);
  });

  it('sends nothing for a full scan, which is a rebuilt index rather than news', async () => {
    const { fetch, submissions } = recorder();
    const cms = await site({ fetch });
    const contentDir = cms.config.contentDir;
    await mkdir(path.join(contentDir, 'posts'), { recursive: true });
    await writeFile(path.join(contentDir, 'posts', '2026-09-02-found.md'), post('found'), 'utf8');

    assert.equal((await cms.sync()).created, 1, 'the scan found the new file');
    await cms.indexNow.settled();

    assert.deepEqual(submissions, []);
  });
});
