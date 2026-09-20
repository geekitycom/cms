import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { addComment } from '../comments/records.ts';
import { addFollower, appendInboxActivity } from '../federation/records.ts';
import { SCHEDULE_WATERMARK_KEY } from '../index.ts';
import type { Cms, GeekityConfig } from '../index.ts';
import { csrfField, FIRST_ADMIN, sandbox, signedIn } from './__testing__/harness.ts';
import type { Browser } from './__testing__/harness.ts';
import { REBUILD_INDEX_PATH, TOOLS_FIELDS, TOOLS_PATH } from './tools.ts';

/**
 * Tools > Content index: the one button that reads every file again without
 * stopping the site (TASK-95).
 */

const box = sandbox();

after(async () => {
  await box.cleanup();
});

/** The post the rebuild has to put back. */
const POST = `---
title: Hello world
date: '2026-09-19T09:00:00Z'
permalink: /2026/09/hello-world/
---

Words.
`;

/** Where that post is served. */
const PERMALINK = '/2026/09/hello-world/';

/**
 * The same post, by a user this site has and linking out of the site: what a
 * delivery, a webmention and a feed ping would all have something to say
 * about, if anything the rebuild did counted as news.
 */
const LINKING_POST = `---
title: Hello world
date: '2026-09-19T09:00:00Z'
permalink: /2026/09/hello-world/
author: ${FIRST_ADMIN.username}
---

Words, and [a page elsewhere](https://peer.example/page).
`;

/** The moment the site's clock is stopped at: the day after the post. */
const NOW = new Date('2026-09-20T12:00:00.000Z');

/** A signed-in admin over a site with one published post. */
async function toolsSite(
  options: { post?: string } & GeekityConfig = {},
): Promise<{ cms: Cms; agent: Browser; token: string }> {
  const { post = POST, ...config } = options;
  const contentDir = await box.dir('geekity-tools-content-');
  const dataDir = await box.dir('geekity-tools-data-');
  await mkdir(path.join(contentDir, 'posts'), { recursive: true });
  await writeFile(path.join(contentDir, 'posts/2026-09-19-hello-world.md'), post, 'utf8');

  const cms = await box.open({
    contentDir,
    dataDir,
    baseUrl: 'https://blog.example',
    now: () => NOW,
    ...config,
  });
  const agent = await signedIn(cms);
  const token = csrfField(await (await agent.get(TOOLS_PATH)).text());
  assert.ok(token !== undefined, 'the tools screen carried a CSRF token');
  return { cms, agent, token };
}

/** Press the button, past the confirm step. */
function rebuild(agent: Browser, token: string): Promise<Response> {
  return agent.post(REBUILD_INDEX_PATH, { csrf_token: token, [TOOLS_FIELDS.confirm]: '1' });
}

/** Wait for everything the site might have set off to have finished. */
async function quiet(cms: Cms): Promise<void> {
  await cms.delivery.settled();
  await cms.webmentions.settled();
  await cms.notifier.settled();
}

/**
 * Route everything this site tries to send into memory, and remember where it
 * was aimed.
 *
 * A request to one of the make-believe hosts is answered rather than sent;
 * anything else — a JSON-LD context Fedify has not cached — reaches the real
 * `fetch`, and is recorded either way, because the question this answers is
 * "did the rebuild make the site talk to anybody at all".
 */
function recordOutboundRequests(): { urls: string[]; restore: () => void } {
  const original = globalThis.fetch;
  const urls: string[] = [];

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    urls.push(href);
    if (new URL(href).origin !== 'https://peer.example') return await original(input, init);
    return new Response('', { status: 202 });
  }) as typeof fetch;

  return {
    urls,
    restore() {
      globalThis.fetch = original;
    },
  };
}

describe('rebuilding the content index from the admin (TASK-95)', () => {
  it('serves every post again after the index is emptied under the running site (AC #2)', async () => {
    const { cms, agent, token } = await toolsSite();

    assert.equal((await cms.app.request(PERMALINK)).status, 200, 'the post was being served');

    // What an out-of-band edit or a damaged index leaves behind: the files are
    // all there and the index knows nothing about them.
    cms.store.clear();
    assert.equal((await cms.app.request(PERMALINK)).status, 404, 'and then it was not');

    const response = await rebuild(agent, token);

    assert.equal(response.status, 303, 'the rebuild redirects');
    assert.equal(response.headers.get('location'), TOOLS_PATH);
    assert.equal((await cms.app.request(PERMALINK)).status, 200, 'the post is served again');
    assert.equal(cms.store.counts().total, 1, 'and indexed exactly once');
  });

  it('reads the followers, the inbox log and the comments back too (AC #2)', async () => {
    const { cms, agent, token } = await toolsSite();
    const contentDir = cms.config.contentDir;
    const records = { admin: cms.admin, contentDir };

    await addFollower(records, FIRST_ADMIN.username, {
      actorId: 'https://peer.example/users/bob',
      inboxId: 'https://peer.example/users/bob/inbox',
      sharedInboxId: null,
      handle: '@bob@peer.example',
      name: 'Bob',
      iconUrl: null,
      url: 'https://peer.example/users/bob',
    });
    await appendInboxActivity(
      records,
      JSON.stringify({
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: 'https://peer.example/likes/1',
        type: 'Like',
        actor: 'https://peer.example/users/bob',
        object: `https://blog.example${PERMALINK}`,
      }),
      { recipient: FIRST_ADMIN.username, receivedAt: '2026-09-19T12:00:00.000Z' },
    );
    await addComment(records, {
      slug: 'hello-world',
      permalink: PERMALINK,
      source: 'comment',
      kind: 'reply',
      status: 'approved',
      author: { name: 'Ada', url: null, email: 'ada@example.com', avatar: null },
      content: { markdown: 'Good post.', html: '<p>Good post.</p>\n' },
      submitted: '2026-09-19T10:00:00.000Z',
      addressHash: 'deadbeefcafe',
      notify: false,
      inReplyTo: null,
      url: null,
    });

    // The three indexes emptied behind the site, as a damaged database would
    // leave them. The files that are the source of all three are untouched.
    cms.admin.replaceFollowers([]);
    cms.admin.replaceInboxActivities([]);
    cms.admin.replaceComments([]);

    await rebuild(agent, token);

    assert.equal(cms.admin.countFollowers(), 1, 'the followers file was read again');
    assert.equal(cms.admin.countInboxActivities(), 1, 'and the inbox log');
    assert.equal(cms.admin.countCommentsByStatus().approved, 1, 'and the comment files');
  });

  it('keeps the session, the delivery log, the relays and the watermark (AC #3)', async () => {
    const { cms, agent, token } = await toolsSite();
    const session = agent.session();

    cms.admin.recordDelivery({
      activityId: 'https://blog.example/activities/1',
      activityType: 'Create',
      objectId: `https://blog.example${PERMALINK}`,
      slug: 'hello-world',
      actorId: 'https://peer.example/users/bob',
      inboxId: 'https://peer.example/users/bob/inbox',
      status: 'sent',
      error: null,
    });
    cms.admin.putRelay({
      inboxId: 'https://relay.example/inbox',
      actorId: 'https://relay.example/actor',
      state: 'accepted',
      reason: null,
      followId: 'https://blog.example/activities/follow-1',
    });
    cms.admin.setState(SCHEDULE_WATERMARK_KEY, '2026-09-20T11:00:00.000Z');

    const response = await rebuild(agent, token);

    assert.equal(response.status, 303, 'the rebuild finished');
    assert.equal(agent.session(), session, 'the session was not replaced');
    assert.equal(
      (await agent.get(TOOLS_PATH)).status,
      200,
      'and the admin who pressed the button is still signed in',
    );
    assert.equal(
      cms.admin.listDeliveries('https://blog.example/activities/1').length,
      1,
      'the delivery log survived',
    );
    assert.equal(
      cms.admin.getRelay('https://relay.example/inbox')?.state,
      'accepted',
      'the relay handshake survived, so no relay is asked again',
    );
    assert.equal(
      cms.admin.getState(SCHEDULE_WATERMARK_KEY),
      '2026-09-20T11:00:00.000Z',
      'and the scheduler knows how far it had got',
    );
  });

  it('offers the rebuild before it runs one, and runs nothing until it is confirmed (AC #5)', async () => {
    const { cms, agent, token } = await toolsSite();
    cms.store.clear();

    const offered = await agent.post(REBUILD_INDEX_PATH, { csrf_token: token });

    assert.equal(offered.status, 200, 'the confirm step is a screen, not a redirect');
    const html = await offered.text();
    assert.match(html, /Rebuild the index now\?/);
    assert.match(html, /404/, 'it says what the site answers while the scan runs');
    assert.match(
      html,
      new RegExp(`<input type="hidden" name="${TOOLS_FIELDS.confirm}"`),
      'and carries the field that says it was seen',
    );
    assert.equal(
      (await cms.app.request(PERMALINK)).status,
      404,
      'nothing was rebuilt by being asked about',
    );

    await rebuild(agent, token);
    assert.equal((await cms.app.request(PERMALINK)).status, 200, 'and everything was by saying so');
  });

  it('refuses a second rebuild while one is running (AC #5)', async () => {
    const { cms, agent, token } = await toolsSite();

    const first = rebuild(agent, token);
    const second = rebuild(agent, token);
    const [one, two] = await Promise.all([first, second]);

    assert.equal(one.status, 303);
    assert.equal(two.status, 303);
    assert.match(
      await (await agent.get(TOOLS_PATH)).text(),
      /A rebuild is already running\. Nothing was started/,
      'the second press was told so',
    );
    assert.equal(cms.store.counts().total, 1, 'and the index was built once, not twice over');
    assert.equal((await cms.app.request(PERMALINK)).status, 200);
  });

  it('tells nobody about a post the scan re-indexes (AC #4)', async () => {
    // A site that would federate, send webmentions and ping the feed servers
    // if anything it did counted as news: a follower to deliver to, a link out
    // of the post to tell about, and the default notify server.
    const { cms, agent, token } = await toolsSite({
      post: LINKING_POST,
      federation: { queue: null, allowPrivateAddress: true },
    });
    await addFollower(
      { admin: cms.admin, contentDir: cms.config.contentDir },
      FIRST_ADMIN.username,
      {
        actorId: 'https://peer.example/users/bob',
        inboxId: 'https://peer.example/users/bob/inbox',
        sharedInboxId: null,
        handle: '@bob@peer.example',
        name: 'Bob',
        iconUrl: null,
        url: 'https://peer.example/users/bob',
      },
    );

    const outbound = recordOutboundRequests();
    try {
      await rebuild(agent, token);
      await quiet(cms);

      assert.equal(cms.store.counts().posts, 1, 'the post really was indexed again');
      assert.equal(
        outbound.urls.length,
        0,
        `and not one request went out about it (went to: ${outbound.urls.join(', ')})`,
      );
      assert.equal(
        cms.admin.lastDeliveryToObject(`https://blog.example${PERMALINK}`),
        undefined,
        'no delivery was even attempted',
      );
      assert.deepEqual(cms.admin.listSentWebmentions('hello-world'), [], 'and no webmention');

      // The control, on the same site with the same stub: the same post moved
      // for a reason that is not a scan does reach the outside world. Without
      // it, the silence above could be the silence of a site that was never
      // able to say anything.
      const trashed = await agent.post('/admin/posts/hello-world', {
        csrf_token: token,
        action: 'trash',
      });
      assert.equal(trashed.status, 303, 'the post was trashed');
      await quiet(cms);

      assert.ok(
        outbound.urls.some((url) => url.startsWith('https://peer.example/')),
        `the follower was told about that one (went to: ${outbound.urls.join(', ')})`,
      );
    } finally {
      outbound.restore();
    }
  });
});
