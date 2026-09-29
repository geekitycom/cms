import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { writeUsers } from './admin/__testing__/users.ts';
import { cleanupTemporaryDirs, runCli, siteWithContent } from './__testing__/cli.ts';

after(cleanupTemporaryDirs);

/** A post announced before quote policies existed, and one never announced. */
const FILES = {
  'posts/2026-09-02-hello.md': [
    '---',
    'title: Hello',
    "date: '2026-09-02T09:00:00Z'",
    'permalink: /2026/09/hello/',
    'author: ada',
    'activitypub:',
    "  published: '2026-09-02T09:00:01Z'",
    '---',
    '',
    'Hello.',
    '',
  ].join('\n'),
  'posts/2026-09-03-quiet.md': [
    '---',
    'title: Quiet',
    "date: '2026-09-03T09:00:00Z'",
    'permalink: /2026/09/quiet/',
    'author: ada',
    '---',
    '',
    'Never announced.',
    '',
  ].join('\n'),
};

/** A follower's inbox on loopback, recording each activity POSTed to it. */
async function inbox(): Promise<{
  url: string;
  received: Record<string, unknown>[];
  close: () => void;
}> {
  const received: Record<string, unknown>[] = [];
  const server = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk: Buffer) => (body += chunk.toString()));
    request.on('end', () => {
      if (request.method === 'POST') received.push(JSON.parse(body) as Record<string, unknown>);
      response.writeHead(202).end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${String(port)}/inbox`, received, close: () => server.close() };
}

async function site(inboxUrl: string): Promise<string> {
  const directory = await siteWithContent('geekity-resend-', FILES);
  writeUsers(path.join(directory, 'data'), [{ username: 'ada', profile: { displayName: 'Ada' } }]);
  const followers = path.join(directory, 'content', '_data', 'federation', 'ada', 'followers.json');
  await fs.mkdir(path.dirname(followers), { recursive: true });
  await fs.writeFile(
    followers,
    JSON.stringify([
      {
        actorId: 'http://127.0.0.1/users/bea',
        inboxId: inboxUrl,
        followedAt: '2026-09-01T00:00:00Z',
      },
    ]),
  );
  await fs.writeFile(
    path.join(directory, 'geekity.config.js'),
    "export default { baseUrl: 'https://blog.example', federation: { allowPrivateAddress: true } };\n",
  );
  return directory;
}

describe('geekity resend (TASK-125 AC #6)', () => {
  it('sends every announced post again as an Update that carries the quote policy', async () => {
    const follower = await inbox();
    try {
      const directory = await site(follower.url);

      const run = await runCli(['resend', '--all'], directory);

      assert.equal(run.code, 0, run.stderr);
      assert.match(run.stdout, /hello/);
      assert.doesNotMatch(run.stdout, /quiet/, 'a post nobody was told about stays unannounced');
      assert.equal(follower.received.length, 1, 'one Update, for the one announced post');
      const update = follower.received[0]!;
      assert.equal(update['type'], 'Update');
      const object = update['object'] as Record<string, unknown>;
      assert.equal(object['id'], 'https://blog.example/2026/09/hello/');
      assert.deepEqual(object['interactionPolicy'], {
        canQuote: { automaticApproval: 'as:Public' },
      });
    } finally {
      follower.close();
    }
  });

  it('resends only the posts it is named', async () => {
    const follower = await inbox();
    try {
      const directory = await site(follower.url);

      const run = await runCli(['resend', 'hello'], directory);

      assert.equal(run.code, 0, run.stderr);
      assert.equal(follower.received.length, 1);
      assert.equal(follower.received[0]!['type'], 'Update');
    } finally {
      follower.close();
    }
  });

  it('refuses to guess when it is given neither slugs nor --all', async () => {
    const directory = await siteWithContent('geekity-resend-', FILES);

    const run = await runCli(['resend'], directory);

    assert.notEqual(run.code, 0);
    assert.match(run.stderr, /--all/);
  });
});
