import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';

import { sandbox } from '../../admin/__testing__/harness.ts';
import type { Cms } from '../../index.ts';
import { BOB, call, fixtureSite, inspectToken } from './__testing__/fixture.ts';

const box = sandbox();
after(() => box.cleanup());

type Row = Record<string, unknown>;

async function whyNoReply(cms: Cms, token: string, post: string, actor: string): Promise<string> {
  const target = await call(cms, token, 'post_federation', { post });
  const ids = target.structured['objectIds'] as string[];

  const creates = await call(cms, token, 'inbox_search', {
    type: 'Create',
    actor,
    includeJson: true,
  });
  const [create] = creates.structured['activities'] as Row[];
  if (create === undefined) return `The site never received a Create from ${actor}.`;

  const answers = create['inReplyTo'] as string | null;
  if (answers === null) return `${String(create['activityId'])} replies to nothing.`;
  if (create['post'] !== null && ids.includes(answers)) {
    const undone = await call(cms, token, 'inbox_search', {
      actor,
      object: String(create['objectId']),
    });
    return (undone.structured['activities'] as Row[]).some((row) => row['type'] === 'Delete')
      ? `${actor} deleted the reply.`
      : 'It names the post; look at moderation.';
  }
  return `${String(create['activityId'])} replies to ${answers}, which is none of the ids the post was federated under (${ids.join(', ')}).`;
}

async function failedInboxes(cms: Cms, token: string, post: string): Promise<string[]> {
  const failed = await call(cms, token, 'post_federation', { post, status: 'failed' });
  return (failed.structured['deliveries'] as Row[]).map(
    (row) => `${String(row['inboxId'])}: ${String(row['error'])}`,
  );
}

describe('an agent debugging federation with the inspect tools', () => {
  it('finds why a Create did not show as a reply, and which inboxes failed for the post', async () => {
    const cms = await fixtureSite(box);
    const token = await inspectToken(cms);

    assert.equal(
      await whyNoReply(cms, token, 'hello', BOB),
      'https://me.example/notes/9/activity replies to https://blog.example/2026/03/hello, which is none of the ids the post was federated under (https://blog.example/2026/03/hello/).',
    );
    assert.deepEqual(await failedInboxes(cms, token, 'hello'), [
      'https://me.example/inbox: HTTP 403 Forbidden',
    ]);
  });
});
