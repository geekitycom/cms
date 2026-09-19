import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { cleanupTemporaryDirs, exists, runCli, siteWithContent } from './__testing__/cli.ts';
import { createCms } from './index.ts';

after(cleanupTemporaryDirs);

describe('geekity rebuild', () => {
  const ADA = 'https://remote.example/users/ada';

  /** A site directory holding these files under `content/`, and nothing else. */
  async function site(files: Record<string, string>): Promise<string> {
    return await siteWithContent('geekity-rebuild-', files);
  }

  /** A federated site: two posts, one follower, two inbound activities. */
  async function federatedSite(): Promise<string> {
    return await site({
      'posts/2026-01-01-one.md': '---\ntitle: One\npermalink: /one/\n---\n\nOne.\n',
      'posts/2026-01-02-two.md': '---\ntitle: Two\npermalink: /two/\n---\n\nTwo.\n',
      '_data/federation/ada/followers.json': `${JSON.stringify(
        [
          {
            actorId: ADA,
            inboxId: `${ADA}/inbox`,
            sharedInboxId: null,
            handle: '@ada@remote.example',
            name: 'Ada Lovelace',
            iconUrl: null,
            url: 'https://remote.example/@ada',
            followedAt: '2026-01-03T10:00:00.000Z',
          },
        ],
        null,
        2,
      )}\n`,
      '_data/federation/inbox/2026-01.jsonl': [
        JSON.stringify({
          receivedAt: '2026-01-04T10:00:00.000Z',
          '@context': 'https://www.w3.org/ns/activitystreams',
          id: 'https://remote.example/likes/1',
          type: 'Like',
          actor: ADA,
          object: 'https://blog.example/ap/posts/one',
        }),
        JSON.stringify({
          receivedAt: '2026-01-05T10:00:00.000Z',
          '@context': 'https://www.w3.org/ns/activitystreams',
          id: 'https://remote.example/announces/1',
          type: 'Announce',
          actor: ADA,
          object: 'https://blog.example/ap/posts/two',
        }),
        '',
      ].join('\n'),
    });
  }

  it('deletes the database and reports what it read back out of the files', async () => {
    const directory = await federatedSite();
    const database = path.join(directory, 'data', 'geekity.db');
    await runCli(['sync'], directory);
    // Something the rebuild must not carry over: a table nothing in the files
    // says anything about. Its absence afterwards is what proves the file was
    // replaced rather than migrated in place — an inode comparison would say
    // the same on macOS, but Linux hands a deleted file's inode straight to
    // the next file created in the directory.
    const marker = new DatabaseSync(database);
    marker.exec('CREATE TABLE leftover (x)');
    marker.close();

    const run = await runCli(['rebuild'], directory);

    assert.equal(run.code, 0, run.stderr);
    const rebuilt = new DatabaseSync(database);
    const leftover = rebuilt
      .prepare("SELECT name FROM sqlite_master WHERE name = 'leftover'")
      .all();
    rebuilt.close();
    assert.equal(leftover.length, 0, 'a different file entirely');
    assert.match(run.stdout, /Rebuilt/);
    assert.match(run.stdout, /geekity\.db/);
    assert.match(run.stdout, /Scanned 2: 2 created/);
    assert.match(run.stdout, /1 follower/);
    assert.match(run.stdout, /2 inbox activities/);
  });

  it('builds one for a site that has never had a database', async () => {
    const directory = await federatedSite();

    const run = await runCli(['rebuild'], directory);

    assert.equal(run.code, 0, run.stderr);
    assert.match(run.stdout, /2 created/);
    assert.ok(await exists(path.join(directory, 'data', 'geekity.db')));
  });

  it('is the way past a database the site would otherwise refuse to open', async () => {
    const directory = await federatedSite();
    await fs.mkdir(path.join(directory, 'data'), { recursive: true });
    await fs.writeFile(path.join(directory, 'data', 'geekity.db'), 'not a database\n', 'utf8');

    const refused = await runCli(['sync'], directory);
    assert.equal(refused.code, 1);
    assert.match(refused.stderr, /geekity rebuild/);

    const run = await runCli(['rebuild'], directory);

    assert.equal(run.code, 0, run.stderr);
    assert.match(run.stdout, /2 created/);
  });

  it('refuses while a server holds the database, and leaves it where it is', async () => {
    const directory = await federatedSite();
    await runCli(['sync'], directory);
    const database = path.join(directory, 'data', 'geekity.db');
    const before = (await fs.stat(database)).ino;

    const cms = createCms({
      contentDir: path.join(directory, 'content'),
      dataDir: path.join(directory, 'data'),
      watch: false,
    });
    try {
      const run = await runCli(['rebuild'], directory);

      assert.equal(run.code, 1);
      assert.match(run.stderr, /in use/);
      assert.equal((await fs.stat(database)).ino, before);
    } finally {
      await cms.close();
    }
  });

  it('exits non-zero and says so when a file will not parse', async () => {
    const directory = await site({
      'posts/2026-01-01-one.md': '---\ntitle: One\npermalink: /one/\n---\n\nOne.\n',
      'posts/2026-01-02-broken.md': '---\ntitle: [unclosed\n---\n\nBroken.\n',
    });

    const run = await runCli(['rebuild'], directory);

    assert.equal(run.code, 1);
    assert.match(run.stdout, /1 failed/);
    assert.match(run.stderr, /could not be parsed/);
  });
});
