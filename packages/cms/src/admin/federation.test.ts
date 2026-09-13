import assert from 'node:assert/strict';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { csrfField, sandbox, signedIn, signIn } from './__testing__/harness.ts';
import type { Browser } from './__testing__/harness.ts';
import type { Cms } from '../index.ts';

/** The site under test. Its origin is what an ActivityStreams id is built on. */
const BASE_URL = 'https://blog.example';

/** The account the setup form creates, and so the site's one actor. */
const ADA = 'ada';
const ACTOR_URL = `${BASE_URL}/author/${ADA}/`;

/** A post's ActivityStreams id is its permalink (decision-13). */
const HELLO_WORLD = `${BASE_URL}/2026/03/hello-world/`;

/** The peer whose likes, boosts and replies the screen shows. */
const REMOTE_ORIGIN = 'https://remote.example';
const REMOTE_ACTOR = `${REMOTE_ORIGIN}/users/ada`;
const REMOTE_INBOX = `${REMOTE_ACTOR}/inbox`;

/** Every POST the site made to the make-believe peer while a test ran. */
const deliveries: { url: string; body: Record<string, unknown> }[] = [];

let restoreFetch: () => void;

before(() => {
  restoreFetch = routeRemoteHost();
});

after(() => {
  restoreFetch();
});

const box = sandbox();
after(() => box.cleanup());

/**
 * Route the peer through memory: a POST to its inbox is recorded rather than
 * sent, and its actor document is served from here. Every other host reaches
 * the real `fetch`, which is what a JSON-LD context Fedify has not cached
 * needs.
 */
function routeRemoteHost(): () => void {
  const original = globalThis.fetch;

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(href);
    if (url.origin !== REMOTE_ORIGIN) return await original(input, init);

    const request = new Request(input, init);
    if (request.method === 'POST') {
      deliveries.push({
        url: request.url,
        body: (await request.json()) as Record<string, unknown>,
      });
      return new Response('', { status: 202 });
    }
    return new Response(
      JSON.stringify({
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: REMOTE_ACTOR,
        type: 'Person',
        preferredUsername: 'ada',
        name: 'Ada Lovelace',
        inbox: REMOTE_INBOX,
      }),
      { headers: { 'content-type': 'application/activity+json' } },
    );
  }) as typeof fetch;

  return () => {
    globalThis.fetch = original;
  };
}

/**
 * A site whose posts have ids a test can write out by hand, with no queue —
 * so a delivery has already happened by the time `settled()` resolves — and
 * the private-address guard off, because the peer does not resolve.
 */
async function federatedSite(): Promise<Cms> {
  deliveries.length = 0;
  return await box.site({
    baseUrl: BASE_URL,
    federation: { queue: null, allowPrivateAddress: true },
  });
}

/** The federation screen's HTML. */
async function federationScreen(agent: Browser): Promise<string> {
  const response = await agent.get('/admin/federation');
  assert.equal(response.status, 200, 'the federation screen answered');
  return await response.text();
}

/** The federation screen's HTML and the CSRF token its forms carry. */
async function federationForm(agent: Browser): Promise<{ html: string; token: string }> {
  const html = await federationScreen(agent);
  const token = csrfField(html);
  assert.ok(token !== undefined, 'the federation screen carried a CSRF token');
  return { html, token };
}

/** Publish a post through the editor, which is what sets a delivery going. */
async function publishPost(agent: Browser, cms: Cms): Promise<void> {
  const token = csrfField(await (await agent.get('/admin/posts/new')).text());
  assert.ok(token !== undefined, 'the editor carried a CSRF token');

  const response = await agent.post('/admin/posts/new', {
    csrf_token: token,
    title: 'Hello, world',
    slug: 'hello-world',
    permalink: '',
    date: '2026-03-04T10:00:00.000Z',
    tags: '',
    description: '',
    body: 'The first post.',
    hash: '',
    action: 'publish',
  });
  assert.equal(response.status, 303, 'the post was published');
  await cms.delivery.settled();
}

/** Write one published post into the content directory and index it. */
async function writePost(cms: Cms, slug: string, title: string): Promise<void> {
  const file = path.join(cms.config.contentDir, 'posts', `2026-03-04-${slug}.md`);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(
    file,
    `---\ntitle: ${title}\ndate: 2026-03-04T10:00:00.000Z\nauthor: ${ADA}\n---\n\nThe first post.\n`,
    'utf8',
  );
  await cms.sync();
}

/** One follower, with everything the screen has to show about them. */
function follow(cms: Cms, overrides: Record<string, unknown> = {}): void {
  cms.admin.putFollower({
    username: ADA,
    actorId: 'https://remote.example/users/ada',
    inboxId: 'https://remote.example/users/ada/inbox',
    sharedInboxId: 'https://remote.example/inbox',
    handle: '@ada@remote.example',
    name: 'Ada Lovelace',
    iconUrl: 'https://remote.example/avatars/ada.png',
    url: 'https://remote.example/@ada',
    followedAt: '2026-03-04T10:00:00.000Z',
    ...overrides,
  } as Parameters<Cms['admin']['putFollower']>[0]);
}

describe('the follower list', () => {
  it('shows a follower’s name, handle, avatar, profile and follow date (AC #1)', async () => {
    const cms = await federatedSite();
    const agent = await signedIn(cms);
    follow(cms);

    const html = await federationScreen(agent);

    assert.match(html, /Ada Lovelace/, 'the display name is there');
    assert.match(html, /@ada@remote\.example/, 'the handle is there');
    assert.match(html, /2026/, 'the follow date is there');
    assert.match(html, /https:\/\/remote\.example\/@ada/, 'the profile is linked');
    assert.match(html, /avatars\/ada\.png/, 'the avatar is shown');
  });

  it('falls back to the actor id when the actor published no name or handle', async () => {
    const cms = await federatedSite();
    const agent = await signedIn(cms);
    follow(cms, { handle: null, name: null, iconUrl: null, url: null });

    const html = await federationScreen(agent);

    assert.match(html, /https:\/\/remote\.example\/users\/ada/, 'the id stands in for both');
  });

  it('says so when nobody follows the site yet', async () => {
    const cms = await federatedSite();
    const agent = await signedIn(cms);

    assert.match(await federationScreen(agent), /Nobody follows/);
  });
});

describe('the actor panels', () => {
  it('shows one actor per user, with the handle, the id and the follower count', async () => {
    const cms = await federatedSite();
    const agent = await signedIn(cms);
    follow(cms);

    const html = await federationScreen(agent);

    assert.match(html, /@ada@blog\.example/, 'the handle is the username and the host');
    assert.match(html, new RegExp(ACTOR_URL.replaceAll('/', '\\/')), 'the actor id is shown');
    assert.match(html, /Followers[\s\S]{0,120}>1</, 'the follower count is shown');
  });

  it('shows the user’s avatar beside them, and a placeholder without one (AC #5)', async () => {
    const cms = await federatedSite();
    const agent = await signedIn(cms);

    assert.match(
      await federationScreen(agent),
      /admin-avatar-blank/,
      'a user with no avatar gets the placeholder',
    );

    const token = csrfField(await (await agent.get('/admin/users')).text());
    assert.ok(token !== undefined);
    await agent.post('/admin/users/profile', {
      csrf_token: token,
      user_id: '1',
      display_name: 'Ada Lovelace',
      bio: '',
      avatar: '/uploads/2026/09/me.png',
      links: '',
    });

    assert.match(
      await federationScreen(agent),
      new RegExp(`<img class="admin-avatar[^"]*" src="${BASE_URL}/uploads/2026/09/me\\.png"`),
      'and the avatar itself once there is one',
    );
  });

  it('names the user each announced post was announced by', async () => {
    const cms = await federatedSite();
    const agent = await signedIn(cms);
    follow(cms, { sharedInboxId: null, inboxId: REMOTE_INBOX });
    await publishPost(agent, cms);

    const html = await federationScreen(agent);
    assert.match(html, /Announced by/, 'the delivery table has a column for it');
    assert.match(html, /<td>@ada<\/td>/, 'and the row says whose post it was');
  });
});

describe('an actor update in the delivery log', () => {
  it('is not shown as a post, because it is not about one', async () => {
    const cms = await federatedSite();
    const agent = await signedIn(cms);
    follow(cms, { sharedInboxId: null, inboxId: REMOTE_INBOX });

    const token = csrfField(await (await agent.get('/admin/users')).text());
    assert.ok(token !== undefined);
    await agent.post('/admin/users/profile', {
      csrf_token: token,
      user_id: '1',
      display_name: 'Ada Lovelace',
      bio: '',
      avatar: '',
      links: '',
    });
    await cms.delivery.settled();

    const recorded = cms.admin.lastDeliveryToObject(ACTOR_URL);
    assert.equal(recorded?.activityType, 'Update', 'the actor update was recorded');
    assert.equal(recorded?.slug, null, 'against no post');

    const html = await federationScreen(agent);
    assert.match(html, /No post has been announced/, 'the delivery table is still about posts');
    assert.doesNotMatch(html, /author\/ada\/#update/, 'and the actor update is not a row in it');
  });
});

describe('recent inbox activity', () => {
  it('lists likes, boosts and replies with links to the remote objects (AC #2)', async () => {
    const cms = await federatedSite();
    const agent = await signedIn(cms);
    await writePost(cms, 'hello-world', 'Hello, world');
    logLike(cms);
    logAnnounce(cms);
    logReply(cms);

    const html = await federationScreen(agent);

    assert.match(html, /liked/, 'a Like reads as a like');
    assert.match(html, /boosted/, 'an Announce reads as a boost');
    assert.match(html, /replied/, 'a Create of a Note reads as a reply');

    assert.match(html, /https:\/\/remote\.example\/likes\/1/, 'the Like links to the activity');
    assert.match(
      html,
      /https:\/\/remote\.example\/users\/ada\/statuses\/8\/activity/,
      'the Announce links to the activity',
    );
    assert.match(html, /https:\/\/remote\.example\/@ada\/9/, 'the reply links to the note itself');
    assert.match(html, new RegExp(REMOTE_ACTOR.replaceAll('.', '\\.')), 'the actor is linked');

    // Every one of the three was about the same post, so the row says which.
    const mentions = html.match(/Hello, world/g) ?? [];
    assert.equal(mentions.length, 3, 'each row names the post it was about');
    assert.match(html, /\/admin\/posts\/hello-world/, 'and links to its editor');
  });

  it('leaves out the follow traffic, which the follower list already shows', async () => {
    const cms = await federatedSite();
    const agent = await signedIn(cms);
    cms.admin.logInboxActivity({
      activityId: 'https://remote.example/follows/1',
      activityType: 'Follow',
      actorId: REMOTE_ACTOR,
      objectId: ACTOR_URL,
      json: '{}',
    });

    const html = await federationScreen(agent);

    assert.doesNotMatch(html, /remote\.example\/follows\/1/, 'a Follow is not an interaction');
    assert.match(html, /Nothing has arrived/, 'and the list reads as empty');
  });
});

describe('per-post delivery status', () => {
  it('shows the last activity for a post and how it landed', async () => {
    const cms = await federatedSite();
    const agent = await signedIn(cms);
    follow(cms, { sharedInboxId: null, inboxId: REMOTE_INBOX });
    await publishPost(agent, cms);

    const html = await federationScreen(agent);

    assert.match(html, /Hello, world/, 'the post is named');
    assert.match(html, /\/admin\/posts\/hello-world/, 'and links to its editor');
    assert.match(html, /Create/, 'the last activity type is shown');
    assert.match(html, /<button type="submit">Resend<\/button>/, 'and it can be sent again');
  });

  it('lists a post in the trash, which is a copy the followers still hold', async () => {
    const cms = await federatedSite();
    const agent = await signedIn(cms);
    follow(cms, { sharedInboxId: null, inboxId: REMOTE_INBOX });
    await publishPost(agent, cms);

    const token = csrfField(await (await agent.get('/admin/posts/hello-world')).text());
    assert.ok(token !== undefined);
    await agent.post('/admin/posts/hello-world', {
      csrf_token: token,
      action: 'trash',
      return: '',
    });
    await cms.delivery.settled();

    const html = await federationScreen(agent);
    assert.match(html, /Hello, world/, 'the post is still a row');
    assert.match(html, /In the trash/, 'and the row says where it is');
    assert.match(html, /Delete/, 'with the withdrawal it last sent');
  });

  it('says so when no post has been announced yet', async () => {
    const cms = await federatedSite();
    const agent = await signedIn(cms);

    assert.match(await federationScreen(agent), /No post has been announced/);
  });

  it('leaves out a post that has never been announced', async () => {
    const cms = await federatedSite();
    const agent = await signedIn(cms);
    await writePost(cms, 'never-announced', 'Never announced');

    const html = await federationScreen(agent);
    assert.doesNotMatch(html, /Never announced/, 'no follower holds a copy of it');
    assert.match(html, /No post has been announced/);
  });

  it('lists the posts with no outcomes when the database has been deleted (AC #4)', async () => {
    const cms = await federatedSite();
    const agent = await signedIn(cms);
    follow(cms, { sharedInboxId: null, inboxId: REMOTE_INBOX });
    await publishPost(agent, cms);
    assert.match(
      await federationScreen(agent),
      /Create <span class="admin-inbox-when">/,
      'the outcome was recorded first',
    );

    const { contentDir, dataDir } = cms.config;
    await cms.close();
    for (const suffix of ['', '-wal', '-shm']) {
      await rm(path.join(dataDir, `geekity.db${suffix}`), { force: true });
    }

    const rebooted = await box.open({
      contentDir,
      dataDir,
      baseUrl: BASE_URL,
      federation: { queue: null, allowPrivateAddress: true },
    });
    const rebootedAgent = await signIn(rebooted);

    const html = await federationScreen(rebootedAgent);
    assert.match(html, /Hello, world/, 'the post is listed, because its file says it was sent');
    assert.match(html, /Nothing recorded/, 'with no outcome, because the cache is gone');
    assert.match(html, /<button type="submit">Resend<\/button>/, 'and it can be sent again');
  });
});

describe('resending a post', () => {
  it('sends the post as it now reads and says how it went (AC #3)', async () => {
    const cms = await federatedSite();
    const agent = await signedIn(cms);
    follow(cms, { sharedInboxId: null, inboxId: REMOTE_INBOX });
    await publishPost(agent, cms);

    assert.equal(deliveries.length, 1, 'publishing delivered once');
    const announced = deliveries[0]?.body['id'];

    const { token } = await federationForm(agent);
    const response = await agent.post('/admin/federation/resend', {
      csrf_token: token,
      slug: 'hello-world',
    });

    assert.equal(response.status, 303);
    assert.equal(response.headers.get('location'), '/admin/federation');

    await cms.delivery.settled();
    assert.equal(deliveries.length, 2, 'the post went out a second time');
    assert.equal(deliveries[1]?.url, REMOTE_INBOX, 'to the follower’s inbox');
    assert.equal(deliveries[1]?.body['type'], 'Update', 'as an update of what they hold');
    assert.notEqual(deliveries[1]?.body['id'], announced, 'under an id they have not seen');

    const after = await federationScreen(agent);
    assert.match(after, /Sent Update to 1 recipient: 1 sent, 0 failed/);
    assert.match(after, /1 sent/, 'and the row now counts the delivery');
  });

  it('refuses a name no post answers to, without pretending it sent anything', async () => {
    const cms = await federatedSite();
    const agent = await signedIn(cms);
    const { token } = await federationForm(agent);

    const response = await agent.post('/admin/federation/resend', {
      csrf_token: token,
      slug: 'nothing-of-the-sort',
    });

    assert.equal(response.status, 303);
    assert.match(await federationScreen(agent), /no post to send under that name/i);
    assert.equal(deliveries.length, 0, 'and nothing was sent');
  });
});

/** A like of `hello-world`, exactly as the inbox would have logged it. */
function logLike(cms: Cms): void {
  cms.admin.logInboxActivity({
    activityId: 'https://remote.example/likes/1',
    activityType: 'Like',
    actorId: REMOTE_ACTOR,
    objectId: HELLO_WORLD,
    json: JSON.stringify({
      id: 'https://remote.example/likes/1',
      type: 'Like',
      actor: REMOTE_ACTOR,
      object: HELLO_WORLD,
    }),
  });
}

/** A boost of `hello-world`. */
function logAnnounce(cms: Cms): void {
  cms.admin.logInboxActivity({
    activityId: 'https://remote.example/users/ada/statuses/8/activity',
    activityType: 'Announce',
    actorId: REMOTE_ACTOR,
    objectId: HELLO_WORLD,
    json: JSON.stringify({
      id: 'https://remote.example/users/ada/statuses/8/activity',
      type: 'Announce',
      actor: REMOTE_ACTOR,
      object: HELLO_WORLD,
    }),
  });
}

/** A reply to `hello-world`: a `Create` whose object is the Note itself. */
function logReply(cms: Cms): void {
  cms.admin.logInboxActivity({
    activityId: 'https://remote.example/users/ada/statuses/9/activity',
    activityType: 'Create',
    actorId: REMOTE_ACTOR,
    objectId: 'https://remote.example/users/ada/statuses/9',
    json: JSON.stringify({
      id: 'https://remote.example/users/ada/statuses/9/activity',
      type: 'Create',
      actor: REMOTE_ACTOR,
      object: {
        id: 'https://remote.example/users/ada/statuses/9',
        type: 'Note',
        url: 'https://remote.example/@ada/9',
        content: '<p>Lovely post.</p>',
        inReplyTo: HELLO_WORLD,
      },
    }),
  });
}

describe('the relays panel', () => {
  const RELAY_INBOX = `${REMOTE_ORIGIN}/user/_____relay_____/inbox`;
  const RELAY_ACTOR = `${REMOTE_ORIGIN}/actor`;

  it('says nothing is subscribed to when the site has no relays', async () => {
    const cms = await federatedSite();
    const agent = await signedIn(cms);

    const html = await federationScreen(agent);

    assert.match(html, /Relays/);
    assert.match(html, /The site subscribes to no relay/);
  });

  it('lists each relay with its state and its last outcome (AC #5)', async () => {
    const cms = await federatedSite();
    const agent = await signedIn(cms);
    cms.admin.putRelay({
      inboxId: RELAY_INBOX,
      actorId: RELAY_ACTOR,
      state: 'accepted',
      reason: null,
      followId: `${ACTOR_URL}#relay-follow/1`,
    });
    cms.admin.recordDelivery({
      activityId: `${BASE_URL}/2026/03/hello/#create`,
      activityType: 'Create',
      objectId: `${BASE_URL}/2026/03/hello/`,
      slug: 'hello',
      actorId: RELAY_ACTOR,
      inboxId: RELAY_INBOX,
      status: 'sent',
      error: null,
    });

    const html = await federationScreen(agent);

    assert.match(html, new RegExp(RELAY_INBOX.replace(/[/.]/g, '\\$&')));
    assert.match(html, /Accepted/);
    assert.match(html, /Create sent/, 'the last thing that went there, and how it went');
  });

  it('shows why a rejected relay refused (AC #2, AC #5)', async () => {
    const cms = await federatedSite();
    const agent = await signedIn(cms);
    cms.admin.putRelay({
      inboxId: RELAY_INBOX,
      actorId: RELAY_ACTOR,
      state: 'rejected',
      reason: 'This relay is invitation only.',
      followId: `${ACTOR_URL}#relay-follow/1`,
    });

    const html = await federationScreen(agent);

    assert.match(html, /Rejected/);
    assert.match(html, /This relay is invitation only\./);
  });

  it('offers Retry for a pending relay, which sends the follow again (AC #5)', async () => {
    const cms = await federatedSite();
    const agent = await signedIn(cms);
    cms.admin.putRelay({
      inboxId: RELAY_INBOX,
      actorId: null,
      state: 'pending',
      reason: null,
      followId: `${ACTOR_URL}#relay-follow/1`,
    });

    const { html, token } = await federationForm(agent);
    assert.match(html, /Waiting/);
    assert.match(html, /Retry/);

    const response = await agent.post('/admin/federation/relays/retry', {
      csrf_token: token,
      relay: RELAY_INBOX,
    });
    assert.equal(response.status, 303);
    await cms.relays.settled();

    const follows = deliveries.filter((one) => one.body['type'] === 'Follow');
    assert.equal(follows.length, 1, `expected one Follow, saw ${JSON.stringify(deliveries)}`);
    assert.equal(follows[0]?.url, RELAY_INBOX);
    assert.equal(
      follows[0]?.body['object'],
      'https://www.w3.org/ns/activitystreams#Public',
      'a relay follow names the Public collection',
    );
    assert.notEqual(
      cms.admin.getRelay(RELAY_INBOX)?.followId,
      `${ACTOR_URL}#relay-follow/1`,
      'and the retry is a follow of its own',
    );
  });

  it('says so when Retry names a relay the site does not subscribe to', async () => {
    const cms = await federatedSite();
    const agent = await signedIn(cms);
    const { token } = await federationForm(agent);

    const response = await agent.post('/admin/federation/relays/retry', {
      csrf_token: token,
      relay: 'https://nowhere.example/inbox',
    });

    assert.equal(response.status, 303);
    assert.match(await federationScreen(agent), /does not subscribe to that relay/);
  });
});
