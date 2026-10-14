import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, describe, it } from 'node:test';

import { SqliteMessageQueue } from '@fedify/sqlite';

import { cleanupTemporaryDirs, runCli, siteWithContent } from '../__testing__/cli.ts';
import type { GeekityConfig } from '../config.ts';
import { createCms } from '../index.ts';
import { createFileRecords } from './file-records.ts';
import type { JobDefinition } from './types.ts';

after(cleanupTemporaryDirs);

function noted(): { job: JobDefinition<{ note: string }, string>; ran: Promise<void> } {
  let ran: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => {
    ran = resolve;
  });
  return {
    ran: promise,
    job: {
      name: 'note',
      parse: (payload) => ({ note: String((payload as { note?: unknown } | null)?.note) }),
      run({ note }) {
        ran();
        return Promise.resolve(`noted ${note}`);
      },
    },
  };
}

async function servedJob(
  directory: string,
  jobs: NonNullable<GeekityConfig['jobs']>,
  note: ReturnType<typeof noted>,
) {
  const cms = createCms({
    contentDir: path.join(directory, 'content'),
    dataDir: path.join(directory, 'data'),
    watch: false,
    port: 0,
    jobs: { ...jobs, definitions: [note.job] },
  });
  try {
    await cms.serve();
    const id = await cms.jobs.enqueue(note.job, { note: 'this' });
    await note.ran;
    await cms.jobs.settled();
    return await cms.jobs.status(id);
  } finally {
    await cms.close();
  }
}

describe('the job queue a CMS runs', () => {
  it('keeps its records in data/jobs.json, which geekity rebuild leaves alone', async () => {
    const directory = await siteWithContent('geekity-jobs-cms-', {
      'posts/2026-01-01-one.md': '---\ntitle: One\npermalink: /one/\n---\n\nOne.\n',
    });
    const status = await servedJob(directory, {}, noted());
    assert.equal(status?.state, 'finished');
    assert.equal(status.state === 'finished' && status.result, 'noted this');

    const file = path.join(directory, 'data', 'jobs.json');
    const before = await fs.readFile(file, 'utf8');
    const rebuilt = await runCli(['rebuild'], directory);
    assert.equal(rebuilt.code, 0, rebuilt.stderr);
    assert.equal(await fs.readFile(file, 'utf8'), before);
    assert.equal((await createFileRecords(file).get(status.id))?.state, 'finished');
  });

  it('runs on the transport and the record store the config names, Fedify SqliteMessageQueue included', async () => {
    const directory = await siteWithContent('geekity-jobs-swapped-', {});
    const queueFile = path.join(directory, 'queue.sqlite');
    const recordsFile = path.join(directory, 'elsewhere', 'jobs.json');
    const db = new DatabaseSync(queueFile);
    try {
      const status = await servedJob(
        directory,
        {
          transport: new SqliteMessageQueue(db, {
            tableName: 'geekity_job',
            pollInterval: { milliseconds: 50 },
          }),
          records: createFileRecords(recordsFile),
        },
        noted(),
      );
      assert.equal(status?.state, 'finished');
      assert.equal((await createFileRecords(recordsFile).get(status.id))?.state, 'finished');
      await assert.rejects(fs.access(path.join(directory, 'data', 'jobs.json')));
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'geekity_job'")
        .all();
      assert.equal(tables.length, 1, 'the job went through the SQLite queue');
    } finally {
      db.close();
    }
  });
});
