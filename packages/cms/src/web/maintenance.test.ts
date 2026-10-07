/**
 * Maintenance mode (TASK-130), through HTTP: what a reader, a crawler, a
 * fediverse server and a signed-in admin are each told while the site is down
 * on purpose.
 */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { sandbox, signedIn } from '../admin/__testing__/harness.ts';
import type { GeekityConfig } from '../config.ts';
import type { Cms } from '../index.ts';
import { enterMaintenance, leaveMaintenance } from '../maintenance.ts';

const box = sandbox();
after(() => box.cleanup());

const POST = `---\ntitle: Hello\ndate: '2026-09-02T09:00:00Z'\npermalink: /2026/09/hello/\n---\n\nBody of hello.\n`;

/** A clock a test can move, starting after the post was published. */
function movableClock(): { now: () => Date; advance(ms: number): void } {
  let current = Date.parse('2026-09-28T12:00:00Z');
  return {
    now: () => new Date(current),
    advance(ms) {
      current += ms;
    },
  };
}

interface Site {
  cms: Cms;
  dataDir: string;
  clock: ReturnType<typeof movableClock>;
}

/**
 * Turn maintenance on and move the clock past the second a running site
 * trusts its last look at the file for, as the CLI does to a live site.
 */
async function turnOn(target: Site, window: { until?: Date } = {}): Promise<void> {
  await enterMaintenance(target.dataDir, window);
  target.clock.advance(1001);
}

async function site(config: GeekityConfig = {}): Promise<Site> {
  const clock = movableClock();
  const contentDir = await box.dir('geekity-maintenance-content-');
  const dataDir = await box.dir('geekity-maintenance-data-');
  const file = path.join(contentDir, 'posts', '2026-09-02-hello.md');
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, POST, 'utf8');
  const cms = await box.open({
    contentDir,
    dataDir,
    baseUrl: 'https://blog.example',
    now: clock.now,
    ...config,
  });
  return { cms, dataDir, clock };
}

function assertUnavailable(response: Response, retryAfter = '600'): void {
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('retry-after'), retryAfter);
  assert.equal(response.headers.get('cache-control'), 'no-store');
}

describe('maintenance mode, off', () => {
  it('serves the site as usual and says so on /healthz', async () => {
    const { cms } = await site();

    assert.equal((await cms.app.request('/2026/09/hello/')).status, 200);
    const health = await cms.app.request('/healthz');
    assert.equal(health.status, 200);
    assert.equal(((await health.json()) as { maintenance: boolean }).maintenance, false);
  });
});

describe('maintenance mode, on', () => {
  it('answers a public page with 503, Retry-After and the themed maintenance page', async () => {
    const target = await site();
    const { cms } = target;
    await turnOn(target);

    const response = await cms.app.request('/2026/09/hello/');
    const body = await response.text();

    assertUnavailable(response);
    assert.match(response.headers.get('content-type') ?? '', /^text\/html/);
    assert.match(body, /<article class="maintenance">/);
    assert.match(body, /down for maintenance/i);
    assert.match(body, /\/theme\/style\.css/, 'wearing the theme');
    assert.doesNotMatch(body, /Body of hello/);
  });

  it('answers feeds, sitemaps and the home page with 503 too', async () => {
    const target = await site();
    const { cms } = target;
    await turnOn(target);

    for (const url of ['/', '/feed/', '/feed/atom/', '/sitemap.xml', '/robots.txt']) {
      assertUnavailable(await cms.app.request(url));
    }
  });

  it('answers a .json or .md request in the representation it asked for', async () => {
    const target = await site();
    const { cms } = target;
    await turnOn(target);

    const json = await cms.app.request('/2026/09/hello.json');
    assertUnavailable(json);
    assert.equal(((await json.json()) as { error: string }).error, 'maintenance');

    const markdown = await cms.app.request('/2026/09/hello.md');
    assertUnavailable(markdown);
    assert.match(markdown.headers.get('content-type') ?? '', /^text\/markdown/);

    const plain = await cms.app.request('/2026/09/hello/', { headers: { accept: 'text/plain' } });
    assertUnavailable(plain);
    assert.equal(plain.headers.get('content-type'), 'text/plain; charset=utf-8');
    assert.equal(await plain.text(), await markdown.text());
  });

  it("still serves the theme's own files, so the maintenance page is styled", async () => {
    const target = await site();
    const { cms } = target;
    await turnOn(target);

    assert.equal((await cms.app.request('/theme/style.css')).status, 200);
  });

  it('names the expected return as an HTTP date when the operator gave one', async () => {
    const target = await site();
    const { cms } = target;
    const until = new Date('2026-09-28T14:00:00Z');
    await turnOn(target, { until });

    const response = await cms.app.request('/2026/09/hello/');

    assertUnavailable(response, until.toUTCString());
    assert.match(await response.text(), /Mon, 28 Sep 2026 14:00:00 GMT/);
  });

  it('falls back to seconds once the expected return has passed', async () => {
    const target = await site();
    const { cms } = target;
    await turnOn(target, { until: new Date('2026-09-28T11:00:00Z') });

    assertUnavailable(await cms.app.request('/2026/09/hello/'));
  });

  it('turns on and off without a restart, noticing within a second', async () => {
    const { cms, dataDir, clock } = await site();

    assert.equal((await cms.app.request('/2026/09/hello/')).status, 200);

    await enterMaintenance(dataDir);
    clock.advance(1001);
    assertUnavailable(await cms.app.request('/2026/09/hello/'));

    await leaveMaintenance(dataDir);
    clock.advance(1001);
    assert.equal((await cms.app.request('/2026/09/hello/')).status, 200);
  });

  it('is forced on for the life of the process by the maintenance setting', async () => {
    const { cms, dataDir, clock } = await site({ maintenance: true });

    assertUnavailable(await cms.app.request('/2026/09/hello/'));
    await leaveMaintenance(dataDir);
    clock.advance(1001);
    assertUnavailable(await cms.app.request('/2026/09/hello/'));
  });

  it('reports the mode on /healthz, which stays 200 while the checks pass', async () => {
    const target = await site();
    const { cms } = target;
    await turnOn(target);

    const health = await cms.app.request('/healthz');

    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), {
      status: 'ok',
      maintenance: true,
      checks: { database: 'ok', content: 'ok' },
    });
  });
});

describe('maintenance mode and the admin', () => {
  it('lets a stranger reach the login page, so an admin can sign in', async () => {
    const target = await site();
    const { cms } = target;
    await signedIn(cms);
    await turnOn(target);

    assert.equal((await cms.app.request('/admin/login')).status, 200);
  });

  it('lets a signed-in admin use the admin and browse the public site', async () => {
    const target = await site();
    const { cms } = target;
    const admin = await signedIn(cms);
    await turnOn(target);

    assert.equal((await admin.get('/admin')).status, 200);

    const page = await admin.get('/2026/09/hello/');
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Body of hello/);
    assert.equal(page.headers.get('cache-control'), 'private, no-store');
  });

  it('does not let a forged session cookie past', async () => {
    const target = await site();
    const { cms } = target;
    await turnOn(target);

    const response = await cms.app.request('/2026/09/hello/', {
      headers: { cookie: 'geekity_session=forged' },
    });

    assertUnavailable(response);
  });
});

describe('maintenance mode and federation', () => {
  const ACTIVITY = JSON.stringify({
    '@context': 'https://www.w3.org/ns/activitystreams',
    id: 'https://remote.example/likes/1',
    type: 'Like',
    actor: 'https://remote.example/users/bob',
    object: 'https://blog.example/2026/09/hello/',
  });

  it('answers every inbox delivery with 503, so the sender retries later', async () => {
    const target = await site();
    const { cms } = target;
    await turnOn(target);

    for (const inbox of [
      '/inbox/',
      '/author/ada/inbox/',
      '/wp-json/activitypub/1.0/inbox',
      '/wp-json/activitypub/1.0/actors/1/inbox',
    ]) {
      const response = await cms.app.request(inbox, {
        method: 'POST',
        headers: { 'content-type': 'application/activity+json' },
        body: ACTIVITY,
      });
      assertUnavailable(response);
    }
  });
});
