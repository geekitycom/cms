import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { sandbox } from '../../admin/__testing__/harness.ts';
import { RESEND_JOB } from '../../federation/resend-job.ts';
import type { Cms } from '../../index.ts';
import { problemsWith } from '../../util/json-schema.ts';
import type { JsonSchema } from '../../util/json-schema.ts';
import {
  ALICE,
  BASE,
  BOB,
  call,
  fixtureSite,
  inspectToken,
  POST_ID,
  POST_ID_WITHOUT_SLASH,
  RELAY,
  rpc,
} from './__testing__/fixture.ts';
import type { ToolAnswer } from './__testing__/fixture.ts';

const box = sandbox();
after(() => box.cleanup());

const INSPECT_TOOLS = [
  'federation_status',
  'inbox_search',
  'post_federation',
  'followers',
  'relays',
  'quote_approvals',
  'webmentions',
] as const;

const SAMPLE_ARGS: Readonly<Record<(typeof INSPECT_TOOLS)[number], Record<string, unknown>>> = {
  federation_status: {},
  inbox_search: {},
  post_federation: { post: 'hello' },
  followers: {},
  relays: {},
  quote_approvals: {},
  webmentions: { post: 'hello', direction: 'sent' },
};

type Row = Record<string, unknown>;

function rows(answer: ToolAnswer, key: string): Row[] {
  return answer.structured[key] as Row[];
}

describe('the inspect tools', () => {
  let cms: Cms;
  let token: string;

  before(async () => {
    cms = await fixtureSite(box);
    token = await inspectToken(cms);
  });

  it('are listed read-only, each with an output schema, and answer with structured content that fits it plus a summary', async () => {
    const { body } = await rpc(cms, token, 'tools/list');
    const listed = (body['result'] as { tools: Row[] }).tools;

    for (const name of INSPECT_TOOLS) {
      const tool = listed.find((entry) => entry['name'] === name);
      assert.ok(tool !== undefined, `${name} is listed`);
      const annotations = tool['annotations'] as Row;
      assert.equal(annotations['readOnlyHint'], true, name);
      assert.equal(annotations['destructiveHint'], false, name);
      const outputSchema = tool['outputSchema'] as JsonSchema;
      assert.equal((outputSchema as { type: string }).type, 'object', name);

      const answer = await call(cms, token, name, SAMPLE_ARGS[name]);
      assert.equal(answer.isError, false, `${name}: ${answer.text}`);
      assert.notEqual(answer.text, '', `${name} says what it found`);
      assert.deepEqual(problemsWith(outputSchema, answer.structured), [], name);
    }
  });

  it('search the inbox by type, actor, object, reply target, recipient and time, and page', async () => {
    const types = async (args: Record<string, unknown>) =>
      rows(await call(cms, token, 'inbox_search', args), 'activities').map((row) => row['type']);

    assert.deepEqual(await types({}), ['Create', 'Like']);
    assert.deepEqual(await types({ type: 'Like' }), ['Like']);
    assert.deepEqual(await types({ actor: BOB }), ['Create']);
    assert.deepEqual(await types({ object: POST_ID }), ['Like']);
    assert.deepEqual(await types({ inReplyTo: POST_ID_WITHOUT_SLASH }), ['Create']);
    assert.deepEqual(await types({ recipient: 'nobody' }), []);
    assert.deepEqual(await types({ since: '2026-03-03' }), ['Create']);
    assert.deepEqual(await types({ until: '2026-03-03' }), ['Like']);

    const first = await call(cms, token, 'inbox_search', { limit: 1 });
    assert.equal(first.structured['total'], 2);
    assert.equal(first.structured['nextOffset'], 1);
    const second = await call(cms, token, 'inbox_search', { limit: 1, offset: 1 });
    assert.deepEqual(
      rows(second, 'activities').map((row) => row['type']),
      ['Like'],
    );
    assert.equal(second.structured['nextOffset'], null);

    const bad = await call(cms, token, 'inbox_search', { since: 'last tuesday' });
    assert.equal(bad.isError, true);
  });

  it('return an inbox activity’s full JSON on request, and the post it was about', async () => {
    const [like] = rows(await call(cms, token, 'inbox_search', { type: 'Like' }), 'activities');
    assert.equal(like?.['activity'], undefined, 'no JSON unless asked');
    assert.equal((like?.['post'] as Row | null)?.['slug'], 'hello');

    const [withJson] = rows(
      await call(cms, token, 'inbox_search', { id: like?.['id'], includeJson: true }),
      'activities',
    );
    assert.deepEqual(withJson?.['activity'], { type: 'Like', actor: ALICE, object: POST_ID });
  });

  it('show a post’s object as peers see it, every activity sent, and each delivery with its error', async () => {
    const answer = await call(cms, token, 'post_federation', { post: 'hello' });
    const { structured } = answer;

    assert.equal(structured['objectId'], POST_ID);
    assert.equal(structured['peerState'], 'served');
    const object = structured['object'] as Row;
    assert.equal(object['id'], POST_ID);
    assert.equal(object['type'], 'Note');
    assert.equal(object['attributedTo'], `${BASE}/author/ada/`);

    const fetched = await cms.app.request(POST_ID, {
      headers: { accept: 'application/activity+json' },
    });
    assert.deepEqual(await fetched.json(), object, 'the same object a peer fetches');

    assert.deepEqual(
      rows(answer, 'activities').map((sent) => [sent['activityType'], sent['counts']]),
      [['Create', { sent: 1, queued: 0, retrying: 0, failed: 1, unknown: 0 }]],
    );
    assert.deepEqual(
      rows(answer, 'deliveries').map((row) => [row['inboxId'], row['status'], row['error']]),
      [
        ['https://me.example/inbox', 'failed', 'HTTP 403 Forbidden'],
        ['https://mastodon.example/inbox', 'sent', null],
      ],
    );

    const failed = await call(cms, token, 'post_federation', { post: POST_ID, status: 'failed' });
    assert.deepEqual(
      rows(failed, 'deliveries').map((row) => row['inboxId']),
      ['https://me.example/inbox'],
    );

    const missing = await call(cms, token, 'post_federation', { post: 'nope' });
    assert.equal(missing.isError, true);

    const malformed = `${BASE}/2026/03/%E0%A4%A/`;
    const unmatched = await call(cms, token, 'post_federation', { post: malformed });
    assert.equal(unmatched.text, `No post answers to ${malformed}.`);
  });

  it('query followers, relays, quote approvals and webmentions with the same filters and paging', async () => {
    const followers = await call(cms, token, 'followers', { limit: 1 });
    assert.equal(followers.structured['total'], 2);
    assert.equal(followers.structured['nextOffset'], 1);
    assert.deepEqual(
      rows(followers, 'followers').map((row) => row['actorId']),
      [BOB],
    );
    assert.deepEqual(
      rows(await call(cms, token, 'followers', { actor: ALICE }), 'followers').map(
        (row) => row['sharedInboxId'],
      ),
      ['https://mastodon.example/inbox'],
    );
    assert.deepEqual(
      rows(await call(cms, token, 'followers', { until: '2026-02-02' }), 'followers').map(
        (row) => row['actorId'],
      ),
      [ALICE],
    );

    const relays = await call(cms, token, 'relays', { state: 'pending' });
    assert.deepEqual(
      rows(relays, 'relays').map((row) => [row['inboxId'], row['retriable']]),
      [[RELAY, true]],
    );
    assert.equal((await call(cms, token, 'relays', { state: 'accepted' })).structured['total'], 0);

    const quotes = await call(cms, token, 'quote_approvals', { post: POST_ID });
    assert.deepEqual(
      rows(quotes, 'approvals').map((row) => [row['username'], row['actor']]),
      [['ada', ALICE]],
    );
    assert.equal(
      (await call(cms, token, 'quote_approvals', { since: '2026-03-05' })).structured['total'],
      0,
    );

    const failedMentions = await call(cms, token, 'webmentions', {
      post: 'hello',
      direction: 'sent',
      status: 'failed',
    });
    assert.deepEqual(
      rows(failedMentions, 'sent').map((row) => [row['target'], row['error']]),
      [['https://broken.example/b', 'HTTP 500']],
    );
    const pagedMentions = await call(cms, token, 'webmentions', {
      post: 'hello',
      direction: 'sent',
      limit: 1,
    });
    assert.equal(pagedMentions.structured['total'], 2);
    assert.equal(pagedMentions.structured['nextOffset'], 1);
    assert.equal(
      (await call(cms, token, 'webmentions', { post: 'hello', direction: 'received' })).structured[
        'total'
      ],
      0,
    );
  });

  it('report queue depth, retrying deliveries and recent job outcomes in the federation status', async () => {
    const id = await cms.jobs.enqueue(RESEND_JOB, { slugs: ['nope'], webmentions: false });
    await cms.jobs.run(id);

    const status = await call(cms, token, 'federation_status');
    const { structured } = status;

    assert.deepEqual(structured['queue'], { waiting: 0, retrying: 0 });
    assert.deepEqual(structured['relays'], { pending: 1, accepted: 0, rejected: 0 });
    const [actor] = structured['actors'] as Row[];
    assert.equal(actor?.['username'], 'ada');
    assert.equal(actor?.['followerCount'], 2);
    assert.deepEqual(
      (actor?.['keys'] as Row[]).map((key) => key['state']),
      ['usable', 'usable'],
    );
    assert.deepEqual(
      (structured['recentFailures'] as Row[]).map((row) => row['error']),
      ['HTTP 403 Forbidden'],
    );
    const [job] = structured['jobs'] as Row[];
    assert.equal(job?.['id'], id);
    assert.equal(job?.['name'], RESEND_JOB.name);
    assert.equal(job?.['state'], 'finished');
  });
});

describe('without the inspect scope', () => {
  it('every inspect tool is refused and returns nothing', async () => {
    const cms = await fixtureSite(box);
    const token = await inspectToken(cms, ['profile', 'create', 'update', 'media', 'repair']);

    for (const name of INSPECT_TOOLS) {
      const { status, body } = await rpc(cms, token, 'tools/call', {
        name,
        arguments: SAMPLE_ARGS[name],
      });
      assert.equal(status, 403, name);
      assert.equal(body['result'], undefined, `${name} returns no result`);
      assert.equal((body['error'] as Row)['data'] !== undefined, true, name);
      assert.deepEqual((body['error'] as { data: Row }).data, { scope: 'inspect' }, name);
    }
  });
});
