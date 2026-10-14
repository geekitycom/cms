import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, describe, it } from 'node:test';

import { SqliteMessageQueue } from '@fedify/sqlite';

import { cleanupTemporaryDirs, runCli, siteWithContent } from './__testing__/cli.ts';
import { readTar } from './files/tar.ts';
import { createCms } from './index.ts';
import { FEDERATION_QUEUE_TABLE, queueFile } from './store/queue-database.ts';

after(cleanupTemporaryDirs);

const BASE = 'https://blog.example';

async function site(): Promise<string> {
  const directory = await siteWithContent('geekity-export-', {
    'posts/2026-01-01-one.md': '---\ntitle: One\npermalink: /one/\n---\n\nOne.\n',
  });
  const data = path.join(directory, 'data');
  await fs.mkdir(data, { recursive: true });
  await fs.writeFile(path.join(data, 'users.json'), '{"users":[],"nextId":1}\n', { mode: 0o600 });
  await fs.writeFile(path.join(data, 'mail.json'), '{"brevo_api_key":"k"}\n', { mode: 0o600 });
  await fs.writeFile(path.join(data, 'surprise.json'), '{}\n');
  return directory;
}

async function queueMessages(dataDir: string, count: number): Promise<void> {
  const queue = new SqliteMessageQueue(new DatabaseSync(queueFile(dataDir)), {
    tableName: FEDERATION_QUEUE_TABLE,
  });
  for (let n = 0; n < count; n += 1) await queue.enqueue({ n });
  queue[Symbol.dispose]();
}

/**
 * Every file under a folder, with its hash, mode and modification time. A
 * SQLite `-shm` file is left out: it is the lock area every reader writes its
 * read marks into, the site's own readers as much as the export's read-only
 * count of the queue, and it holds no data.
 */
async function snapshot(dir: string): Promise<Record<string, string>> {
  const found: Record<string, string> = {};
  for (const entry of await fs.readdir(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || entry.name.endsWith('-shm')) continue;
    const file = path.join(entry.parentPath, entry.name);
    const { mode, mtimeMs, size } = await fs.stat(file);
    const hash = createHash('sha256')
      .update(await fs.readFile(file))
      .digest('hex');
    found[path.relative(dir, file)] =
      `${hash} ${mode.toString(8)} ${String(mtimeMs)} ${String(size)}`;
  }
  return found;
}

describe('geekity export', () => {
  it('prints the deliveries waiting before it writes, and what it left out', async () => {
    const directory = await site();
    await queueMessages(path.join(directory, 'data'), 3);

    const run = await runCli(['export', '--out', 'site.tar.gz'], directory, undefined, {
      GEEKITY_BASE_URL: BASE,
    });
    assert.equal(run.code, 0, run.stderr);
    const lines = run.stdout.split('\n');
    const waiting = lines.findIndex((line) => line.startsWith('3 deliveries are waiting'));
    const wrote = lines.findIndex((line) => line.startsWith('Wrote '));
    assert.ok(waiting !== -1 && wrote > waiting, run.stdout);
    assert.match(run.stdout, /as carefully as data\//);
    assert.match(run.stdout, /Credentials left out: mail\. --with-credentials includes them\./);
    assert.match(run.stderr, /data\/surprise\.json/);

    const archive = path.join(directory, 'site.tar.gz');
    assert.equal((await fs.stat(archive)).mode & 0o777, 0o600);
    const names = readTar(await fs.readFile(archive)).map((entry) => entry.name);
    assert.equal(names[0], 'manifest.json');
    assert.ok(names.includes('data/users.json'));
    assert.ok(!names.some((name) => name.includes('queue.sqlite')));
  });

  it('names each entry under content/ that is not a regular file, and leaves it out', async () => {
    const directory = await site();
    const contentDir = path.join(directory, 'content');
    await fs.symlink(
      path.join(contentDir, 'posts', '2026-01-01-one.md'),
      path.join(contentDir, 'posts', 'alias.md'),
    );

    const run = await runCli(['export', '--out', 'site.tar.gz'], directory, undefined, {
      GEEKITY_BASE_URL: BASE,
    });
    assert.equal(run.code, 0, run.stderr);
    assert.match(
      run.stderr,
      /^Left out content\/posts\/alias\.md: it is a symbolic link, and an export holds only regular files\.$/m,
    );
    const names = readTar(await fs.readFile(path.join(directory, 'site.tar.gz'))).map(
      (entry) => entry.name,
    );
    assert.ok(!names.includes('content/posts/alias.md'));
  });

  it('names the archive after the host and the time when --out is not given', async () => {
    const directory = await site();
    const run = await runCli(['export', '--with-credentials'], directory, undefined, {
      GEEKITY_BASE_URL: BASE,
    });
    assert.equal(run.code, 0, run.stderr);
    const written = (await fs.readdir(directory)).filter((name) => name.endsWith('.tar.gz'));
    assert.equal(written.length, 1);
    assert.match(written[0] ?? '', /^geekity-blog\.example-\d{8}T\d{6}Z\.tar\.gz$/);
    const names = readTar(await fs.readFile(path.join(directory, written[0] ?? ''))).map(
      (entry) => entry.name,
    );
    assert.ok(names.includes('data/mail.json'));
  });

  it('--list prints each declaration, its class and what is lost, and writes nothing', async () => {
    const directory = await site();
    const before = await fs.readdir(directory, { recursive: true });
    const run = await runCli(['export', '--list'], directory);
    assert.equal(run.code, 0, run.stderr);
    assert.match(run.stdout, /^data\/users\.json +kept +Every account/m);
    assert.match(run.stdout, /^data\/queue\.sqlite +pending +Queued deliveries/m);
    assert.match(run.stdout, /^data\/mail\.json +credential +The Brevo key/m);
    assert.match(run.stdout, /^data\/geekity\.db +rebuildable +/m);
    assert.match(run.stdout, /^data\/exports\/\*\* +scratch +/m);
    assert.match(run.stdout, /^content\/\*\* +kept +/m);
    assert.deepEqual(await fs.readdir(directory, { recursive: true }), before);
  });

  it('runs while the site serves, and changes no file under data/ or content/', async () => {
    const directory = await site();
    const contentDir = path.join(directory, 'content');
    const dataDir = path.join(directory, 'data');
    const cms = createCms({ contentDir, dataDir, baseUrl: BASE, port: 0, watch: false });
    try {
      const { port } = await cms.serve();
      await queueMessages(dataDir, 1);
      const health = await fetch(`http://127.0.0.1:${String(port)}/_geekity/health`);
      assert.equal(health.status, 200);

      const before = { content: await snapshot(contentDir), data: await snapshot(dataDir) };
      const run = await runCli(['export', '--out', 'site.tar.gz'], directory, undefined, {
        GEEKITY_BASE_URL: BASE,
      });
      const afterwards = { content: await snapshot(contentDir), data: await snapshot(dataDir) };

      assert.equal(run.code, 0, run.stderr);
      assert.deepEqual(afterwards, before);
      const names = readTar(await fs.readFile(path.join(directory, 'site.tar.gz'))).map(
        (entry) => entry.name,
      );
      assert.ok(names.includes('content/posts/2026-01-01-one.md'));
    } finally {
      await cms.close();
    }
  });
});
