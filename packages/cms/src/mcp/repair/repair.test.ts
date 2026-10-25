/**
 * The federation repair tools from the outside: an MCP client with the repair
 * scope resending a post, retrying the deliveries that failed and refreshing
 * a follower whose inbox moved, with every remote server played by a stub.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';

import { sandbox } from '../../admin/__testing__/harness.ts';
import { RESEND_JOB } from '../../federation/resend-job.ts';
import { RETRY_DELIVERIES_JOB } from '../../federation/retry-job.ts';
import type { Cms } from '../../index.ts';
import { problemsWith } from '../../util/json-schema.ts';
import type { JsonSchema } from '../../util/json-schema.ts';
import { readActivityLog } from '../../web/indieauth-activity-log.ts';
import { BOB, call, fixtureSite, inspectToken, rpc } from '../inspect/__testing__/fixture.ts';

const box = sandbox();

const REPAIR_TOOLS = ['resend_post', 'retry_deliveries', 'refresh_actor'] as const;

const SAMPLE_ARGS: Readonly<Record<(typeof REPAIR_TOOLS)[number], Record<string, unknown>>> = {
  resend_post: { post: 'hello' },
  retry_deliveries: { post: 'hello' },
  refresh_actor: { actor: BOB },
};

const BOB_SHARED_INBOX = 'https://me.example/inbox';
const BOB_MOVED_INBOX = 'https://moved.example/inbox';

type Row = Record<string, unknown>;

interface Posted {
  readonly url: string;
  readonly type: unknown;
}

const posted: Posted[] = [];
let bobInbox = BOB_SHARED_INBOX;

const original = globalThis.fetch;

before(() => {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init);
    if (request.url.startsWith('https://blog.example/')) return await original(input, init);
    if (request.method === 'POST') {
      const body = (await request.json()) as Row;
      posted.push({ url: request.url, type: body['type'] });
      return new Response(null, { status: 202 });
    }
    if (request.url === BOB) {
      return new Response(
        JSON.stringify({
          '@context': 'https://www.w3.org/ns/activitystreams',
          id: BOB,
          type: 'Person',
          preferredUsername: 'bob',
          name: 'Bob',
          inbox: `${BOB}/inbox`,
          endpoints: { sharedInbox: bobInbox },
        }),
        { headers: { 'content-type': 'application/activity+json' } },
      );
    }
    return new Response('not here', { status: 404 });
  }) as typeof fetch;
});

after(async () => {
  globalThis.fetch = original;
  await box.cleanup();
});

beforeEach(() => {
  posted.length = 0;
  bobInbox = BOB_SHARED_INBOX;
});

async function repairSite(): Promise<{ cms: Cms; token: string }> {
  const cms = await fixtureSite(box, { federation: { queue: null, allowPrivateAddress: true } });
  return { cms, token: await inspectToken(cms, ['repair']) };
}

describe('the repair tools', () => {
  it('are listed as writes that reach other servers, never destructive, safe to repeat, with output that fits their schema', async () => {
    const { cms, token } = await repairSite();
    const { body } = await rpc(cms, token, 'tools/list');
    const listed = (body['result'] as { tools: Row[] }).tools;

    for (const name of REPAIR_TOOLS) {
      const tool = listed.find((entry) => entry['name'] === name);
      assert.ok(tool !== undefined, `${name} is listed`);
      assert.deepEqual(
        tool['annotations'],
        { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
        name,
      );
      const answer = await call(cms, token, name, SAMPLE_ARGS[name]);
      assert.equal(answer.isError, false, `${name}: ${answer.text}`);
      assert.deepEqual(
        problemsWith(tool['outputSchema'] as JsonSchema, answer.structured),
        [],
        `${name} answers with what its output schema says`,
      );
      assert.notEqual(answer.text, '', `${name} has a summary`);
    }
  });

  it('record every call in the app activity record', async () => {
    const { cms, token } = await repairSite();
    for (const name of REPAIR_TOOLS) await call(cms, token, name, SAMPLE_ARGS[name]);
    await call(cms, token, 'resend_post', { post: 'no-such-post' });

    const entries = (await readActivityLog(cms.config.dataDir)).filter(
      (entry) => entry.endpoint === 'mcp',
    );
    assert.deepEqual(entries.map((entry) => [entry.action, entry.status, entry.error]).sort(), [
      ['refresh_actor', 200, undefined],
      ['resend_post', 200, undefined],
      ['resend_post', 200, 'tool_error'],
      ['retry_deliveries', 200, undefined],
    ]);
  });
});

describe('resend_post', () => {
  it('queues the resend job the admin’s Resend button queues, and sends nothing itself', async () => {
    const { cms, token } = await repairSite();

    const answer = await call(cms, token, 'resend_post', {
      post: 'https://blog.example/2026/03/hello/',
    });

    assert.equal(answer.isError, false, answer.text);
    const job = answer.structured['job'] as Row;
    assert.equal(answer.structured['queued'], true);
    assert.equal(answer.structured['slug'], 'hello');
    assert.equal(job['state'], 'queued');
    const status = await cms.jobs.status(job['id'] as string);
    assert.equal(status?.name, RESEND_JOB.name);
    assert.deepEqual(status.payload, { slugs: ['hello'], webmentions: true });
    assert.deepEqual(posted, [], 'nothing is sent inside the request');
  });

  it('can leave the webmentions out', async () => {
    const { cms, token } = await repairSite();
    const answer = await call(cms, token, 'resend_post', { post: 'hello', webmentions: false });
    const status = await cms.jobs.status((answer.structured['job'] as Row)['id'] as string);
    assert.deepEqual(status?.payload, { slugs: ['hello'], webmentions: false });
  });

  it('queues nothing new while a resend waits, and names the one that does', async () => {
    const { cms, token } = await repairSite();
    const first = await call(cms, token, 'resend_post', { post: 'hello' });
    const second = await call(cms, token, 'resend_post', { post: 'hello' });

    assert.equal(second.isError, false, second.text);
    assert.equal(second.structured['queued'], false);
    assert.deepEqual(second.structured['job'], first.structured['job']);
    assert.equal((await cms.jobs.list(['queued'])).length, 1);
  });

  it('answers a post that does not exist with a tool error', async () => {
    const { cms, token } = await repairSite();
    const answer = await call(cms, token, 'resend_post', { post: 'no-such-post' });
    assert.equal(answer.isError, true);
    assert.match(answer.text, /no-such-post/);
  });
});

describe('retry_deliveries', () => {
  it('names the recipients whose newest delivery of a post failed, and queues a job for them', async () => {
    const { cms, token } = await repairSite();

    const answer = await call(cms, token, 'retry_deliveries', { post: 'hello' });

    assert.equal(answer.isError, false, answer.text);
    assert.equal(answer.structured['queued'], true);
    assert.deepEqual(answer.structured['retries'], [
      {
        slug: 'hello',
        recipients: [
          {
            actorId: BOB,
            inboxId: BOB_SHARED_INBOX,
            error: 'HTTP 403 Forbidden',
            missedAnnouncement: true,
          },
        ],
      },
    ]);
    const status = await cms.jobs.status((answer.structured['job'] as Row)['id'] as string);
    assert.equal(status?.name, RETRY_DELIVERIES_JOB.name);
    assert.deepEqual(posted, [], 'nothing is sent inside the request');
  });

  it('finds the same failures by the inbox they went to, and none at an inbox that took them', async () => {
    const { cms, token } = await repairSite();

    const failing = await call(cms, token, 'retry_deliveries', { inbox: BOB_SHARED_INBOX });
    const fine = await call(cms, token, 'retry_deliveries', {
      inbox: 'https://mastodon.example/inbox',
    });

    assert.deepEqual(
      (failing.structured['retries'] as Row[]).map((retry) => retry['slug']),
      ['hello'],
    );
    assert.deepEqual(fine.structured['retries'], []);
    assert.equal(fine.structured['queued'], false);
    assert.equal(fine.structured['job'], null);
  });

  it('sends the post again to the failed recipients alone when the job runs, and then has nothing left to retry', async () => {
    const { cms, token } = await repairSite();
    const answer = await call(cms, token, 'retry_deliveries', { post: 'hello' });

    const finished = await cms.jobs.run((answer.structured['job'] as Row)['id'] as string);

    assert.equal(finished.state, 'finished', JSON.stringify(finished));
    assert.deepEqual(posted, [{ url: BOB_SHARED_INBOX, type: 'Create' }]);
    const again = await call(cms, token, 'retry_deliveries', { post: 'hello' });
    assert.deepEqual(again.structured['retries'], []);
    assert.equal(again.structured['queued'], false);
  });

  it('asks for a post or an inbox', async () => {
    const { cms, token } = await repairSite();
    const answer = await call(cms, token, 'retry_deliveries', {});
    assert.equal(answer.isError, true);
  });
});

describe('refresh_actor', () => {
  it('reads the actor again and moves every follower record of it to the inbox it publishes now', async () => {
    const { cms, token } = await repairSite();
    bobInbox = BOB_MOVED_INBOX;

    const answer = await call(cms, token, 'refresh_actor', { actor: BOB });

    assert.equal(answer.isError, false, answer.text);
    assert.equal(answer.structured['inbox'], `${BOB}/inbox`);
    assert.equal(answer.structured['sharedInbox'], BOB_MOVED_INBOX);
    assert.deepEqual(answer.structured['followers'], [
      { username: 'ada', before: { inbox: `${BOB}/inbox`, sharedInbox: BOB_SHARED_INBOX } },
    ]);
    const stored = cms.admin.listFollowers('ada').find((follower) => follower.actorId === BOB);
    assert.equal(stored?.sharedInboxId, BOB_MOVED_INBOX);
    assert.equal(stored.name, 'Bob');
    assert.equal(stored.followedAt, '2026-02-02T00:00:00.000Z', 'the follow keeps its time');
    const file = await readFile(
      path.join(cms.config.contentDir, '_data', 'federation', 'ada', 'followers.json'),
      'utf8',
    );
    assert.match(file, /moved\.example/);
  });

  it('lets a retry reach the follower at its new inbox', async () => {
    const { cms, token } = await repairSite();
    bobInbox = BOB_MOVED_INBOX;
    await call(cms, token, 'refresh_actor', { actor: BOB });

    const answer = await call(cms, token, 'retry_deliveries', { inbox: BOB_SHARED_INBOX });
    await cms.jobs.run((answer.structured['job'] as Row)['id'] as string);

    assert.deepEqual(
      posted.filter((post) => post.type === 'Create'),
      [{ url: BOB_MOVED_INBOX, type: 'Create' }],
    );
  });

  it('answers an actor it cannot read with a tool error, and changes nothing', async () => {
    const { cms, token } = await repairSite();
    const answer = await call(cms, token, 'refresh_actor', {
      actor: 'https://gone.example/users/zed',
    });
    assert.equal(answer.isError, true);
    assert.match(answer.text, /gone\.example/);
  });
});

describe('without the repair scope', () => {
  it('every repair tool is refused and does nothing', async () => {
    const { cms } = await repairSite();
    const token = await inspectToken(cms, ['profile', 'create', 'update', 'media', 'inspect']);

    for (const name of REPAIR_TOOLS) {
      const { status, body } = await rpc(cms, token, 'tools/call', {
        name,
        arguments: SAMPLE_ARGS[name],
      });
      assert.equal(status, 403, name);
      assert.equal(body['result'], undefined, `${name} returns no result`);
      assert.deepEqual((body['error'] as { data: Row }).data, { scope: 'repair' }, name);
    }
    assert.deepEqual(await cms.jobs.list(['queued']), []);
    assert.deepEqual(posted, []);
  });
});
