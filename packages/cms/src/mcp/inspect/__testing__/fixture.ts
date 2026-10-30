import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { Sandbox } from '../../../admin/__testing__/harness.ts';
import { writeUsers } from '../../../admin/__testing__/users.ts';
import type { Cms, GeekityConfig } from '../../../index.ts';
import type { Scope } from '../../../indieauth/request.ts';
import { issueTokens } from '../../../indieauth/tokens.ts';

export const BASE = 'https://blog.example';
export const MCP = '/_geekity/mcp';
export const POST_ID = `${BASE}/2026/03/hello/`;
export const POST_ID_WITHOUT_SLASH = POST_ID.slice(0, -1);
export const ALICE = 'https://mastodon.example/users/alice';
export const BOB = 'https://me.example/users/bob';
export const RELAY = 'https://relay.example/inbox';

export async function fixtureSite(box: Sandbox, config: GeekityConfig = {}): Promise<Cms> {
  const contentDir = await box.dir('geekity-inspect-content-');
  const dataDir = await box.dir('geekity-inspect-data-');
  await mkdir(path.join(contentDir, '_data', 'federation', 'ada'), { recursive: true });
  await mkdir(path.join(contentDir, 'posts'), { recursive: true });
  await writeFile(
    path.join(contentDir, '_data', 'site.json'),
    JSON.stringify({ title: 'A Site', author: 'ada' }),
  );
  await writeFile(
    path.join(contentDir, 'posts', '2026-03-01-hello.md'),
    [
      '---',
      'title: Hello',
      "date: '2026-03-01T10:00:00Z'",
      'permalink: /2026/03/hello/',
      'author: ada',
      'activitypub:',
      "  published: '2026-03-01T10:00:05Z'",
      '---',
      '',
      'Hello, fediverse.',
      '',
    ].join('\n'),
  );
  await writeFile(
    path.join(contentDir, '_data', 'federation', 'ada', 'quotes.json'),
    JSON.stringify([
      {
        id: 'q1',
        quote: 'https://mastodon.example/statuses/7',
        post: POST_ID,
        request: 'https://mastodon.example/requests/7',
        actor: ALICE,
        authorizedAt: '2026-03-04T00:00:00.000Z',
      },
    ]),
  );
  writeUsers(dataDir, [{ username: 'ada' }]);
  const cms = await box.open({ ...config, contentDir, dataDir, baseUrl: BASE });

  const { admin } = cms;
  admin.putFollower({
    username: 'ada',
    actorId: ALICE,
    inboxId: `${ALICE}/inbox`,
    sharedInboxId: 'https://mastodon.example/inbox',
    handle: '@alice@mastodon.example',
    name: 'Alice',
    iconUrl: null,
    url: null,
    followedAt: '2026-02-01T00:00:00.000Z',
  });
  admin.putFollower({
    username: 'ada',
    actorId: BOB,
    inboxId: `${BOB}/inbox`,
    sharedInboxId: 'https://me.example/inbox',
    handle: '@bob@me.example',
    name: null,
    iconUrl: null,
    url: null,
    followedAt: '2026-02-02T00:00:00.000Z',
  });
  admin.putRelay({ inboxId: RELAY, actorId: null, state: 'pending', reason: null, followId: null });

  admin.logInboxActivity({
    activityId: 'https://mastodon.example/likes/1',
    activityType: 'Like',
    actorId: ALICE,
    objectId: POST_ID,
    recipient: 'ada',
    receivedAt: '2026-03-02T00:00:00.000Z',
    json: JSON.stringify({ type: 'Like', actor: ALICE, object: POST_ID }),
  });
  admin.logInboxActivity({
    activityId: 'https://me.example/notes/9/activity',
    activityType: 'Create',
    actorId: BOB,
    objectId: 'https://me.example/notes/9',
    recipient: 'ada',
    receivedAt: '2026-03-03T00:00:00.000Z',
    json: JSON.stringify({
      type: 'Create',
      actor: BOB,
      object: {
        id: 'https://me.example/notes/9',
        type: 'Note',
        inReplyTo: POST_ID_WITHOUT_SLASH,
        content: 'Nice post!',
      },
    }),
  });

  admin.recordDelivery({
    activityId: `${POST_ID}#create`,
    activityType: 'Create',
    objectId: POST_ID,
    slug: 'hello',
    actorId: ALICE,
    inboxId: 'https://mastodon.example/inbox',
    status: 'sent',
    error: null,
    attemptedAt: '2026-03-01T10:00:06.000Z',
  });
  admin.recordDelivery({
    activityId: `${POST_ID}#create`,
    activityType: 'Create',
    objectId: POST_ID,
    slug: 'hello',
    actorId: BOB,
    inboxId: 'https://me.example/inbox',
    status: 'failed',
    error: 'HTTP 403 Forbidden',
    attemptedAt: '2026-03-01T10:00:07.000Z',
  });

  admin.recordSentWebmention({
    slug: 'hello',
    source: POST_ID,
    target: 'https://elsewhere.example/a',
    endpoint: 'https://elsewhere.example/webmention',
    status: 'sent',
    error: null,
  });
  admin.recordSentWebmention({
    slug: 'hello',
    source: POST_ID,
    target: 'https://broken.example/b',
    endpoint: 'https://broken.example/webmention',
    status: 'failed',
    error: 'HTTP 500',
  });
  return cms;
}

export async function inspectToken(cms: Cms, scopes: readonly Scope[] = ['inspect']) {
  return (
    await issueTokens(
      cms.config.dataDir,
      {
        clientId: 'https://claude.example/client.json',
        clientName: 'Claude Code',
        redirectUri: 'http://localhost:4567/callback',
        codeChallenge: { method: 'S256', value: 'unused' },
        userId: 1,
        me: `${BASE}/`,
        scopes,
        resource: `${BASE}${MCP}`,
      },
      new Date(),
    )
  ).accessToken;
}

let nextId = 1;

export async function rpc(
  cms: Cms,
  token: string,
  method: string,
  params: Record<string, unknown> = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await cms.app.request(MCP, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method, params }),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

export interface ToolAnswer {
  readonly isError: boolean;
  readonly text: string;
  readonly structured: Record<string, unknown>;
}

export async function call(
  cms: Cms,
  token: string,
  name: string,
  args: Record<string, unknown> = {},
): Promise<ToolAnswer> {
  const { status, body } = await rpc(cms, token, 'tools/call', { name, arguments: args });
  assert.equal(status, 200, JSON.stringify(body));
  const result = body['result'] as Record<string, unknown>;
  const content = result['content'] as Array<{ text: string }>;
  return {
    isError: result['isError'] === true,
    text: content[0]?.text ?? '',
    structured: (result['structuredContent'] ?? {}) as Record<string, unknown>,
  };
}
