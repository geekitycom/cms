import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { csrfField, sandbox, signedIn, FIRST_ADMIN } from './admin/__testing__/harness.ts';
import type { Browser } from './admin/__testing__/harness.ts';
import { resendMessage } from './admin/federation.ts';
import { DEFAULT_SITE_SETTINGS, writeSiteJson } from './admin/settings.ts';
import { readDevModeRecord } from './dev-mode.ts';
import type { DevModeEntry } from './dev-mode.ts';
import { addFollower } from './federation/records.ts';
import type { Cms } from './index.ts';
import { createMemoryMailProvider } from './mail/memory.ts';
import type { MemoryMailProvider } from './mail/memory.ts';

const BASE_URL = 'https://blog.example';
const FOLLOWER = 'https://remote.example/users/bob';
const FOLLOWER_INBOX = 'https://remote.example/users/bob/inbox';
const SHARED_INBOX = 'https://remote.example/inbox';
const RELAY_INBOX = 'https://relay.example/inbox';
const LINKED_PAGE = 'https://linked.example/a-page/';
const INDEXNOW_KEY = '0123456789abcdef0123456789abcdef';

const box = sandbox();
const outbound: string[] = [];
let restoreFetch: () => void;

before(() => {
  const passOn = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.origin !== BASE_URL) {
      outbound.push(
        `${init?.method ?? (input instanceof Request ? input.method : 'GET')} ${url.href}`,
      );
    }
    return passOn(input, init);
  };
  restoreFetch = () => {
    globalThis.fetch = passOn;
  };
});

after(async () => {
  restoreFetch();
  await box.cleanup();
});

interface DevSite {
  cms: Cms;
  agent: Browser;
  mail: MemoryMailProvider;
  setNow: (now: Date) => void;
}

async function devSite(): Promise<DevSite> {
  let now = new Date('2026-10-09T12:00:00Z');
  const contentDir = await box.dir('geekity-dev-mode-content-');
  await writeSiteJson({
    contentDir,
    settings: {
      ...DEFAULT_SITE_SETTINGS,
      title: 'Geekity',
      baseUrl: BASE_URL,
      timezone: 'UTC',
      author: FIRST_ADMIN.username,
      webmentionsSend: true,
      indexNow: true,
      indexNowKey: INDEXNOW_KEY,
      relays: [RELAY_INBOX],
    },
  });
  const mail = createMemoryMailProvider();
  const cms = await box.site({
    contentDir,
    baseUrl: BASE_URL,
    devMode: true,
    now: () => now,
    federation: { queue: null, allowPrivateAddress: true },
    hostLookup: () => Promise.resolve(['203.0.113.7']),
    mail: { provider: mail, backoffMs: () => 0 },
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
  await cms.scheduler.start();
  return {
    cms,
    agent,
    mail,
    setNow: (next) => {
      now = next;
    },
  };
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

async function settle(cms: Cms): Promise<void> {
  await cms.scheduler.settled();
  await cms.delivery.settled();
  await cms.relays.settled();
  await cms.webmentions.settled();
  await cms.notifier.settled();
  await cms.indexNow.settled();
  await cms.mail.settled();
}

function held(record: readonly DevModeEntry[]) {
  return record.flatMap((entry) => (entry.type === 'held' ? [entry] : []));
}

describe('a site in dev mode', () => {
  it('publishes, edits, schedules, resends and deletes without one outbound request (AC #1, #8)', async () => {
    const { cms, agent, mail, setNow } = await devSite();
    outbound.length = 0;

    const published = await editor(agent, '/admin/posts/new', {
      title: 'Hello, world',
      slug: 'hello-world',
      date: '2026-10-09T10:00:00.000Z',
      body: `The first post, about [a page](${LINKED_PAGE}).`,
      action: 'publish',
    });
    assert.equal(published.status, 303);
    await settle(cms);

    assert.equal(
      (await editor(agent, '/admin/posts/hello-world', { body: 'Edited.', action: 'update' }))
        .status,
      303,
    );
    await settle(cms);

    await editor(agent, '/admin/posts/new', {
      title: 'Later',
      slug: 'later',
      date: '2026-10-10T09:00:00.000Z',
      body: 'Not yet.',
      action: 'publish',
    });
    setNow(new Date('2026-10-10T09:00:00Z'));
    await cms.scheduler.run();
    await settle(cms);

    const resent = await cms.delivery.resend('hello-world');
    assert.equal(resent?.held, true);
    assert.match(resendMessage(resent), /dev mode held the Update/i);
    await cms.webmentions.send('hello-world');
    await cms.relays.retry(RELAY_INBOX);
    await cms.notifyFeeds([`${BASE_URL}/feed/`]);
    await cms.mail.send({ to: 'ada@example.com', template: 'test', subject: 'Hello' });

    await editor(agent, '/admin/posts/hello-world', { action: 'trash', return: '' });
    await settle(cms);

    assert.deepEqual(outbound, [], 'nothing left the process');
    assert.deepEqual(mail.sent, [], 'no mail reached the provider');

    const record = held(readDevModeRecord(cms.config.dataDir));
    const kinds = new Set(record.map((entry) => entry.kind));
    assert.deepEqual(
      [...kinds].sort(),
      ['activitypub', 'feed-ping', 'indexnow', 'mail', 'webmention'],
      'every kind of side effect was held and recorded',
    );
    const activities = record
      .filter((entry) => entry.kind === 'activitypub')
      .map((entry) => entry.what.split(' ')[0]);
    for (const type of ['Create', 'Update', 'Delete', 'Follow']) {
      assert.ok(activities.includes(type), `a ${type} was held, saw ${activities.join(', ')}`);
    }
    assert.ok(
      record.some((entry) => entry.what.startsWith('Create') && entry.to.includes(SHARED_INBOX)),
      'the record says the Create would have gone to the follower’s inbox',
    );
    assert.ok(
      record.some((entry) => entry.what.startsWith('Follow') && entry.to.includes(RELAY_INBOX)),
      'and the relay Follow to the relay',
    );
    assert.ok(
      record.some((entry) => entry.kind === 'webmention' && entry.to.includes(LINKED_PAGE)),
      'and the webmention to the page the post linked',
    );
    assert.ok(
      record.some((entry) => entry.kind === 'mail' && entry.to.includes('ada@example.com')),
      'and the mail to its address',
    );
  });

  it('records no delivery as sent, so going live has nothing to resend (AC #4)', async () => {
    const { cms, agent } = await devSite();

    await editor(agent, '/admin/posts/new', {
      title: 'Hello, world',
      slug: 'hello-world',
      date: '2026-10-09T10:00:00.000Z',
      body: `Words about [a page](${LINKED_PAGE}).`,
      action: 'publish',
    });
    await cms.relays.retry(RELAY_INBOX);
    await settle(cms);

    const relay = cms.admin.listRelays()[0];
    assert.equal(relay?.state, 'pending', 'the relay was not followed');
    assert.match(relay.reason ?? '', /dev mode/i);
    assert.deepEqual(cms.admin.listSentWebmentions('hello-world'), []);
    assert.equal(
      cms.admin.lastDeliveryToInbox(SHARED_INBOX),
      undefined,
      'no delivery row says the follower was sent anything',
    );
  });
});
