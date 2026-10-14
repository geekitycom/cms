import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { jpegWithMetadata, leakedSecrets, pngWithMetadata } from '../../__testing__/metadata.ts';
import { createFileRecords } from '../../jobs/file-records.ts';
import { createInProcessTransport } from '../../jobs/in-process.ts';
import { createJobQueue } from '../../jobs/queue.ts';
import type { JobQueue, JobRecords } from '../../jobs/types.ts';
import { systemClock } from '../../util/clock.ts';
import { finishedResult } from '../../jobs/types.ts';
import { STRIP_METADATA_JOB, stripMetadataJob } from './strip-job.ts';
import { stripStoredUploads } from './sweep.ts';

const directories: string[] = [];
after(async () => {
  await Promise.all(
    directories.map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

const MODIFIED = new Date('2025-05-01T00:00:00Z');

interface Site {
  readonly contentDir: string;
  readonly jobsFile: string;
  uploads(): Promise<Record<string, string>>;
}

async function site(files: Record<string, Uint8Array>): Promise<Site> {
  const directory = await mkdtemp(path.join(tmpdir(), 'geekity-strip-job-'));
  directories.push(directory);
  const contentDir = path.join(directory, 'content');
  const uploadsDir = path.join(contentDir, 'uploads');
  for (const [relative, bytes] of Object.entries(files)) {
    const file = path.join(uploadsDir, ...relative.split('/'));
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, bytes);
    await utimes(file, MODIFIED, MODIFIED);
  }
  return {
    contentDir,
    jobsFile: path.join(directory, 'data', 'jobs.json'),
    async uploads() {
      const entries = await readdir(uploadsDir, { recursive: true, withFileTypes: true });
      const found: Record<string, string> = {};
      for (const entry of entries.filter((each) => each.isFile())) {
        const file = path.join(entry.parentPath, entry.name);
        const relative = path.relative(uploadsDir, file).split(path.sep).join('/');
        const { mtime } = await stat(file);
        const bytes = await readFile(file);
        found[relative] = [
          createHash('sha256').update(bytes).digest('hex'),
          mtime.toISOString(),
          ...leakedSecrets(bytes),
        ].join(' ');
      }
      return found;
    },
  };
}

async function photos(): Promise<Record<string, Uint8Array>> {
  return {
    '2025/05/a.jpg': await jpegWithMetadata(4),
    '2025/05/b.png': await pngWithMetadata(),
    '2025/05/c.jpg': await jpegWithMetadata(5),
    '2025/05/d.png': await pngWithMetadata(),
  };
}

function worker(sweep: Site, records: JobRecords = createFileRecords(sweep.jobsFile)): JobQueue {
  return createJobQueue({
    transport: createInProcessTransport(),
    records,
    jobs: [stripMetadataJob(sweep.contentDir)],
    now: systemClock,
  });
}

async function sweepOnce(sweep: Site) {
  const queue = worker(sweep);
  const id = await queue.enqueue(STRIP_METADATA_JOB, null);
  return queue.run(id);
}

function stoppingWorker(
  sweep: Site,
  afterFiles: number,
): { queue: JobQueue; stopped: Promise<void> } {
  const records = createFileRecords(sweep.jobsFile);
  let stopped: () => void = () => undefined;
  const queue = worker(sweep, {
    ...records,
    async transition(id, expected, next) {
      const changed = await records.transition(id, expected, next);
      if (next.state === 'running' && next.progress?.done === afterFiles) {
        queue.stop();
        stopped();
      }
      return changed;
    },
  });
  return { queue, stopped: new Promise((resolve) => (stopped = resolve)) };
}

describe('the strip-metadata job', () => {
  it('reports what it stripped, what was clean and what it could not read', async () => {
    const broken = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0x40, 0x00, 0x45, 0x78]);
    const sweep = await site({
      '2025/05/a.jpg': await jpegWithMetadata(4),
      '2025/05/broken.jpg': broken,
      '2025/05/notes.txt': new TextEncoder().encode('Notes.\n'),
    });

    const status = await sweepOnce(sweep);

    assert.equal(status.state, 'finished');
    const report = finishedResult(STRIP_METADATA_JOB, status);
    assert.equal(report?.checked, 2);
    assert.equal(report.clean, 0);
    assert.deepEqual(
      report.stripped.map((file) => file.path),
      ['2025/05/a.jpg'],
    );
    assert.ok(report.stripped[0]?.removed.length);
    assert.deepEqual(
      report.unreadable.map((file) => file.path),
      ['2025/05/broken.jpg'],
    );
  });

  it('leaves out a file deleted while the sweep runs', async () => {
    const sweep = await site(await photos());
    const uploads = path.join(sweep.contentDir, 'uploads');

    const swept = await stripStoredUploads(uploads, {
      async progress(done) {
        if (done === 1) await rm(path.join(uploads, '2025', '05', 'b.png'));
      },
    });

    assert.deepEqual(
      swept.map((file) => file.path),
      ['2025/05/a.jpg', '2025/05/c.jpg', '2025/05/d.png'],
    );
  });

  it('removes every temporary file a cut-off sweep left behind', async () => {
    const sweep = await site({
      '2025/05/clean.jpg': await jpegWithMetadata(4),
      '2025/05/b.png': await pngWithMetadata(),
    });
    await sweepOnce(sweep);
    const stripped = await sweep.uploads();
    const uploads = path.join(sweep.contentDir, 'uploads');
    const leftovers = ['2025/05/clean.jpg', '2025/05/b.png', '2025/05/gone.jpg', 'notes.txt'];
    for (const relative of leftovers) {
      await writeFile(path.join(uploads, `${relative}.geekity-strip`), 'half a file');
    }

    await sweepOnce(sweep);

    assert.deepEqual(await sweep.uploads(), stripped);
  });

  it('leaves every upload the same when it runs twice (AC #3)', async () => {
    const sweep = await site(await photos());

    await sweepOnce(sweep);
    const once = await sweep.uploads();
    const second = await sweepOnce(sweep);

    assert.deepEqual(await sweep.uploads(), once);
    for (const [relative, line] of Object.entries(once)) {
      assert.equal(line.split(' ').slice(1).join(' '), MODIFIED.toISOString(), relative);
    }
    const report = finishedResult(STRIP_METADATA_JOB, second);
    assert.equal(report?.clean, 4);
    assert.deepEqual(report.stripped, []);
  });

  it('leaves every upload as one run does when it is run again after being cut off (AC #3)', async () => {
    const files = await photos();
    const whole = await site(files);
    await sweepOnce(whole);

    const cut = await site(files);
    const first = stoppingWorker(cut, 2);
    const id = await first.queue.enqueue(STRIP_METADATA_JOB, null);
    await first.queue.start();
    await first.stopped;
    await first.queue.close();
    const leftover = path.join(cut.contentDir, 'uploads', '2025', '05', 'd.png.geekity-strip');
    await writeFile(leftover, 'half a file from a worker that died');

    const second = worker(cut);
    await second.start();
    const status = await second.run(id);
    await second.close();

    assert.equal(status.state, 'finished');
    assert.deepEqual(await cut.uploads(), await whole.uploads());
  });

  it('stops between files when the queue stops, and finishes in the next worker (AC #4)', async () => {
    const sweep = await site(await photos());
    const first = stoppingWorker(sweep, 1);
    const id = await first.queue.enqueue(STRIP_METADATA_JOB, null);

    await first.queue.start();
    await first.stopped;
    await first.queue.close();

    const handedBack = await createFileRecords(sweep.jobsFile).get(id);
    assert.equal(handedBack?.state, 'queued', 'the job went back to the queue');
    assert.equal(handedBack.attempt, 1);
    const after = await sweep.uploads();
    const stripped = Object.entries(after).filter(([, line]) => line.split(' ').length === 2);
    assert.deepEqual(
      stripped.map(([relative]) => relative),
      ['2025/05/a.jpg'],
      'it stopped after the file it was on',
    );

    const next = worker(sweep);
    await next.start();
    const status = await next.run(id);
    await next.close();

    assert.equal(status.state, 'finished');
    assert.equal(status.attempt, 1);
    const report = finishedResult(STRIP_METADATA_JOB, status);
    assert.equal(report?.checked, 4);
    assert.deepEqual(
      report.stripped.map((file) => file.path),
      ['2025/05/b.png', '2025/05/c.jpg', '2025/05/d.png'],
    );
    assert.equal(report.clean, 1);
    for (const [relative, line] of Object.entries(await sweep.uploads())) {
      assert.equal(line.split(' ').length, 2, `${relative} still leaks ${line}`);
    }
  });
});
