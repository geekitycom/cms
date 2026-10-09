import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';

import { csrfField, FIRST_ADMIN, sandbox, signedIn } from './admin/__testing__/harness.ts';
import type { Browser } from './admin/__testing__/harness.ts';
import { DEFAULT_SITE_SETTINGS, writeSiteJson } from './admin/settings.ts';
import { addFollower } from './federation/records.ts';
import type { Cms } from './index.ts';

const BASE_URL = 'https://blog.example';
const FOLLOWER = 'https://remote.example/users/bob';
const FOLLOWER_INBOX = 'https://remote.example/users/bob/inbox';
const SHARED_INBOX = 'https://remote.example/inbox';
const LINKED_PAGE = 'https://linked.example/a-page/';
const WEBMENTION_ENDPOINT = 'https://linked.example/webmention';
const NOTIFY_SERVER = 'https://cloud.example';
const INDEXNOW_KEY = '0123456789abcdef0123456789abcdef';
const BOOKMARKED_PAGE = 'https://unread.example/an-essay/';

const ANNOUNCED_ID = `${BASE_URL}/?p=813`;
const QUIET_ID = `${BASE_URL}/?p=42`;

/** One POST that left the process. */
interface Sent {
  url: string;
  body: string;
}

const box = sandbox();
const sent: Sent[] = [];
let restoreFetch: () => void;

before(() => {
  const passOn = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.origin === BASE_URL) return await passOn(input, init);
    if (request.method === 'POST') {
      sent.push({ url: request.url, body: await request.text() });
      return new Response('', { status: 202 });
    }
    if (url.href === LINKED_PAGE) {
      return new Response(`<link rel="webmention" href="${WEBMENTION_ENDPOINT}"><p>A page.</p>`, {
        headers: { 'content-type': 'text/html; charset=utf-8' },
      });
    }
    return await passOn(input, init);
  };
  restoreFetch = () => {
    globalThis.fetch = passOn;
  };
});

after(async () => {
  restoreFetch();
  await box.cleanup();
});

beforeEach(() => {
  sent.length = 0;
});

/** Every activity a follower was sent, as `Type object-id`. */
function activities(): string[] {
  return sent
    .filter((one) => one.url === SHARED_INBOX)
    .map((one) => {
      const body = JSON.parse(one.body) as { type: string; object: { id?: string } | string };
      const object = typeof body.object === 'string' ? body.object : (body.object.id ?? '');
      return `${body.type} ${object}`;
    });
}

/** The posts a webmention was sent about. */
function webmentionSources(): string[] {
  return sent
    .filter((one) => one.url === WEBMENTION_ENDPOINT)
    .map((one) => new URLSearchParams(one.body).get('source') ?? '');
}

function feedPings(): Sent[] {
  return sent.filter((one) => one.url.startsWith(NOTIFY_SERVER));
}

function indexNowSubmissions(): Sent[] {
  return sent.filter((one) => new URL(one.url).hostname.includes('indexnow'));
}

function assertSilent(why: string): void {
  assert.deepEqual(
    sent.map((one) => one.url),
    [],
    `${why}: no activity, webmention, feed ping or IndexNow submission went out`,
  );
}

interface Site {
  cms: Cms;
  agent: Browser;
  contentDir: string;
  setNow: (now: Date) => void;
}

async function site(
  options: { files?: Record<string, string>; watch?: boolean } = {},
): Promise<Site> {
  let now = new Date('2026-10-09T12:00:00Z');
  const contentDir = await box.dir('geekity-migrated-content-');
  for (const [relative, source] of Object.entries(options.files ?? {})) {
    await writeDocument(contentDir, relative, source);
  }
  await writeSiteJson({
    contentDir,
    settings: {
      ...DEFAULT_SITE_SETTINGS,
      title: 'Geekity',
      baseUrl: BASE_URL,
      timezone: 'UTC',
      author: FIRST_ADMIN.username,
      webmentionsSend: true,
      notifyServer: NOTIFY_SERVER,
      indexNow: true,
      indexNowKey: INDEXNOW_KEY,
    },
  });
  const cms = await box.site({
    contentDir,
    baseUrl: BASE_URL,
    port: 0,
    watch: options.watch ?? false,
    now: () => now,
    federation: { queue: null, allowPrivateAddress: true },
    indexNow: { batchMs: 0, backoffMs: () => 0 },
  });
  const agent = await signedIn(cms);
  await addFollower({ admin: cms.admin, contentDir }, FIRST_ADMIN.username, {
    actorId: FOLLOWER,
    inboxId: FOLLOWER_INBOX,
    sharedInboxId: SHARED_INBOX,
    handle: '@bob@remote.example',
    name: 'Bob',
    iconUrl: null,
    url: null,
  });
  if (options.watch === true) await cms.serve();
  await cms.scheduler.start();
  await settle(cms);
  sent.length = 0;
  return {
    cms,
    agent,
    contentDir,
    setNow: (next) => {
      now = next;
    },
  };
}

async function writeDocument(contentDir: string, relative: string, source: string): Promise<void> {
  const file = path.join(contentDir, ...relative.split('/'));
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, source, 'utf8');
}

async function settle(cms: Cms): Promise<void> {
  await cms.scheduler.settled();
  await cms.delivery.settled();
  await cms.webmentions.settled();
  await cms.notifier.settled();
  await cms.indexNow.settled();
}

/** Wait for the watcher to index a file whose body now says `marker`. */
async function indexed(cms: Cms, slug: string, marker: string): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (!(cms.store.getBySlug(slug)?.body.includes(marker) ?? false)) {
    assert.ok(Date.now() < deadline, `the watcher indexed ${slug}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  await new Promise((resolve) => setTimeout(resolve, 50));
  await settle(cms);
}

async function editor(
  agent: Browser,
  url: string,
  fields: Record<string, string>,
): Promise<Response> {
  const html = await (await agent.get(url)).text();
  const token = csrfField(html);
  assert.ok(token !== undefined, `the editor at ${url} carried a CSRF token`);
  const value = (name: string) =>
    new RegExp(`name="${name}"[^>]*value="([^"]*)"`).exec(html)?.[1] ?? '';
  return await agent.post(url, {
    csrf_token: token,
    hash: value('hash'),
    title: value('title'),
    slug: value('slug'),
    permalink: value('permalink'),
    date: value('date'),
    tags: value('tags'),
    description: value('description'),
    body: /<textarea[^>]*name="body"[^>]*>([\s\S]*?)<\/textarea>/.exec(html)?.[1] ?? '',
    ...fields,
  });
}

/** A post its followers were sent before it reached this site. */
function announcedPost(body = `Thoughts on [a page](${LINKED_PAGE}).`): string {
  return `---
title: Already announced
date: 2025-11-02T10:00:00.000Z
permalink: /2025/11/already-announced/
author: ${FIRST_ADMIN.username}
migrated: true
activitypub:
  id: ${ANNOUNCED_ID}
  published: 2025-11-02T10:00:00.000Z
---

${body}
`;
}

/** A post that was public before it reached this site, and never federated. */
function quietPost(body = `An old essay about [a page](${LINKED_PAGE}).`): string {
  return `---
title: An old essay
date: 2019-05-01T10:00:00.000Z
permalink: /2019/05/an-old-essay/
author: ${FIRST_ADMIN.username}
migrated: true
activitypub:
  id: ${QUIET_ID}
---

${body}
`;
}

/** A draft restored from content that was public before it reached this site. */
function quietDraft(): string {
  return `---
title: A restored essay
date: 2012-02-03T10:00:00.000Z
permalink: /2012/02/a-restored-essay/
author: ${FIRST_ADMIN.username}
migrated: true
draft: true
---

An essay from 2012 about [a page](${LINKED_PAGE}).
`;
}

/** A post first published here, the control every rule above leaves alone. */
function freshPost(body = `New words about [a page](${LINKED_PAGE}).`): string {
  return `---
title: Brand new
date: 2026-10-09T10:00:00.000Z
permalink: /2026/10/brand-new/
author: ${FIRST_ADMIN.username}
---

${body}
`;
}

const ANNOUNCED_FILE = 'posts/2025-11-02-already-announced.md';
const QUIET_FILE = 'posts/2019-05-01-an-old-essay.md';
const DRAFT_FILE = 'posts/2012-02-03-a-restored-essay.md';
const FRESH_FILE = 'posts/2026-10-09-brand-new.md';

describe('a post first published on this site (TASK-296 AC #4)', () => {
  it('is announced, mentioned, pinged and submitted when its file is written', async () => {
    const { cms, contentDir } = await site({ watch: true });

    await writeDocument(contentDir, FRESH_FILE, freshPost());
    await indexed(cms, 'brand-new', 'New words');

    assert.deepEqual(activities(), [`Create ${BASE_URL}/2026/10/brand-new/`]);
    assert.deepEqual(webmentionSources(), [`${BASE_URL}/2026/10/brand-new/`]);
    assert.ok(feedPings().length > 0, 'the feeds were pinged');
    assert.equal(indexNowSubmissions().length, 1, 'IndexNow was told');
  });
});

describe('a migrated post written while the site watches (TASK-296 AC #1, #2, #7)', () => {
  it('sends nothing for a post its followers already hold, nor for one never federated', async () => {
    const { cms, contentDir } = await site({ watch: true });

    await writeDocument(contentDir, ANNOUNCED_FILE, announcedPost());
    await writeDocument(contentDir, QUIET_FILE, quietPost());
    await indexed(cms, 'already-announced', 'Thoughts');
    await indexed(cms, 'an-old-essay', 'An old essay');

    assertSilent('a file arriving that was public before it reached this site');
    const quiet = await readFile(path.join(contentDir, QUIET_FILE), 'utf8');
    assert.doesNotMatch(quiet, /published:/, 'the quiet post was not stamped as announced');
  });
});

describe('a migrated post on a fresh database, edited later (TASK-296 AC #1, #2, #3, #7)', () => {
  it('sends one Update for the announced post, nothing to followers for the quiet one, and the mentions an edit earns', async () => {
    const { cms, contentDir } = await site({
      watch: true,
      files: { [ANNOUNCED_FILE]: announcedPost(), [QUIET_FILE]: quietPost() },
    });
    assertSilent('booting over the migrated archive');

    await writeDocument(
      contentDir,
      ANNOUNCED_FILE,
      announcedPost(`Second thoughts on [a page](${LINKED_PAGE}).`),
    );
    await indexed(cms, 'already-announced', 'Second thoughts');
    await writeDocument(
      contentDir,
      QUIET_FILE,
      quietPost(`A revised essay about [a page](${LINKED_PAGE}).`),
    );
    await indexed(cms, 'an-old-essay', 'A revised essay');

    assert.deepEqual(activities(), [`Update ${ANNOUNCED_ID}`], 'one Update, and no Create');
    assert.deepEqual(webmentionSources().sort(), [
      `${BASE_URL}/2019/05/an-old-essay/`,
      `${BASE_URL}/2025/11/already-announced/`,
    ]);
    assert.ok(feedPings().length > 0, 'a real edit pings the feeds');
    assert.ok(indexNowSubmissions().length > 0, 'and tells IndexNow');
  });
});

describe('a migrated post the scheduler comes to (TASK-296 AC #1, #2)', () => {
  it('announces neither one when its date arrives', async () => {
    const { cms, setNow } = await site({
      files: {
        [ANNOUNCED_FILE]: announcedPost().replace(
          'date: 2025-11-02T10:00:00.000Z',
          'date: 2026-10-10T10:00:00.000Z',
        ),
        [QUIET_FILE]: quietPost().replace(
          'date: 2019-05-01T10:00:00.000Z',
          'date: 2026-10-10T11:00:00.000Z',
        ),
      },
    });

    setNow(new Date('2026-10-10T12:00:00Z'));
    assert.equal(await cms.scheduler.run(), 2, 'both came due');
    await settle(cms);

    assertSilent('a migrated post coming due');
  });
});

describe('resending a migrated post (TASK-296 AC #1, #2)', () => {
  it('sends an Update for the announced post and nothing for the quiet one', async () => {
    const { cms } = await site({
      files: { [ANNOUNCED_FILE]: announcedPost(), [QUIET_FILE]: quietPost() },
    });

    assert.equal(await cms.delivery.resend('an-old-essay'), undefined);
    const report = await cms.delivery.resend('already-announced');

    assert.equal(report?.activityType, 'Update');
    assert.deepEqual(activities(), [`Update ${ANNOUNCED_ID}`]);
  });
});

describe('a reply context arriving for migrated posts (TASK-296 AC #2, #6)', () => {
  it('revises the announced post that cites it and leaves the quiet one alone', async () => {
    const bookmarking = (source: string) =>
      source.replace('migrated: true', `migrated: true\nbookmark-of: ${BOOKMARKED_PAGE}`);
    const { cms } = await site({
      files: {
        [ANNOUNCED_FILE]: bookmarking(announcedPost('')),
        [QUIET_FILE]: bookmarking(quietPost('')),
        '_data/replyContexts.json': JSON.stringify({
          [BOOKMARKED_PAGE]: { url: BOOKMARKED_PAGE, name: 'An unread essay' },
        }),
      },
    });

    cms.delivery.citedPageStored(BOOKMARKED_PAGE, undefined);
    await settle(cms);

    assert.deepEqual(activities(), [`Update ${ANNOUNCED_ID}`]);
  });
});

describe('a peer fetching a migrated post that never federated (TASK-296 AC #2)', () => {
  it('is served the object at its stored id', async () => {
    const { cms } = await site({ files: { [QUIET_FILE]: quietPost() } });

    const response = await cms.app.request(QUIET_ID, {
      headers: { accept: 'application/activity+json' },
    });

    assert.equal(response.status, 200);
    const object = (await response.json()) as { id: string };
    assert.equal(object.id, QUIET_ID);
  });
});

describe('an announced migrated draft published from the admin (TASK-296 AC #1)', () => {
  it('sends no Create, nor anything else', async () => {
    const { cms, agent } = await site({
      files: {
        [ANNOUNCED_FILE]: announcedPost().replace('migrated: true', 'migrated: true\ndraft: true'),
      },
    });

    const published = await editor(agent, '/admin/posts/already-announced', { action: 'publish' });
    assert.equal(published.status, 303, await published.text());
    await settle(cms);

    assertSilent('publishing a draft its followers already hold');
  });
});

describe('a migrated draft published later (TASK-296 AC #9)', () => {
  it('appears at its original date and tells nobody, until an edit earns a mention', async () => {
    const { cms, agent, contentDir } = await site({ files: { [DRAFT_FILE]: quietDraft() } });

    const published = await editor(agent, '/admin/posts/a-restored-essay', { action: 'publish' });
    assert.equal(published.status, 303, await published.text());
    await settle(cms);

    assertSilent('publishing a migrated draft');
    const file = await readFile(path.join(contentDir, DRAFT_FILE), 'utf8');
    assert.match(file, /migrated: true/, 'the save kept the record');
    assert.doesNotMatch(file, /published:/, 'and stamped no announcement');

    const page = await cms.app.request(`${BASE_URL}/2012/02/a-restored-essay/`);
    assert.equal(page.status, 200, 'it is on the web');
    assert.match(await page.text(), /2012-02-03/, 'at its original date');
    const home = await (await cms.app.request(`${BASE_URL}/`)).text();
    assert.match(home, /A restored essay/, 'and on the home page');
    assert.match(home, /datetime="2012-02-03/, 'dated as it was first published');

    const edited = await editor(agent, '/admin/posts/a-restored-essay', {
      body: `A revised essay about [a page](${LINKED_PAGE}).`,
      action: 'update',
    });
    assert.equal(edited.status, 303);
    await settle(cms);

    assert.deepEqual(activities(), [], 'an edit federates nothing either');
    assert.deepEqual(webmentionSources(), [`${BASE_URL}/2012/02/a-restored-essay/`]);
  });
});
