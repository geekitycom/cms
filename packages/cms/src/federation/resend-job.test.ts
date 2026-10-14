import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { createFileRecords } from '../jobs/file-records.ts';
import { createInProcessTransport } from '../jobs/in-process.ts';
import { createJobQueue } from '../jobs/queue.ts';
import type { Document } from '../content/document.ts';
import { finishedResult } from '../jobs/types.ts';
import type { JobQueue, JobRecords, JobStatus } from '../jobs/types.ts';
import type { DeliveryStatus } from '../store/deliveries.ts';
import { systemClock } from '../util/clock.ts';
import type { WebmentionReport } from '../webmention/service.ts';
import type { DeliveryReport } from './delivery.ts';
import { RESEND_JOB, resendJob } from './resend-job.ts';
import type { ResendJobServices, ResendPayload } from './resend-job.ts';

const directories: string[] = [];
after(async () => {
  await Promise.all(
    directories.map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function jobsFile(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'geekity-resend-job-'));
  directories.push(directory);
  return path.join(directory, 'jobs.json');
}

function report(slug: string, statuses: readonly DeliveryStatus[], held = false): DeliveryReport {
  return {
    activityId: `https://blog.example/${slug}#update`,
    activityType: 'Update',
    objectId: `https://blog.example/${slug}/`,
    held,
    deliveries: statuses.map((status, index) => ({
      activityId: `https://blog.example/${slug}#update`,
      activityType: 'Update',
      objectId: `https://blog.example/${slug}/`,
      slug,
      actorId: `https://remote.example/users/${String(index)}`,
      inboxId: `https://remote.example/users/${String(index)}/inbox`,
      status,
      error: status === 'failed' ? 'refused' : null,
      attemptedAt: '2026-10-14T09:00:00.000Z',
    })),
  };
}

function services(
  reports: Record<string, DeliveryReport>,
  links: Record<string, WebmentionReport> = {},
): ResendJobServices & { resent: string[]; mentioned: string[] } {
  const resent: string[] = [];
  const mentioned: string[] = [];
  return {
    resent,
    mentioned,
    store: {
      listFederated: () => Object.keys(reports).map((slug) => ({ slug }) as Document),
    },
    delivery: {
      resend(slug) {
        resent.push(slug);
        return Promise.resolve(reports[slug]);
      },
    },
    webmentions: {
      send(slug) {
        mentioned.push(slug);
        return Promise.resolve(links[slug]);
      },
    },
  };
}

function worker(site: ResendJobServices, records: JobRecords): JobQueue {
  return createJobQueue({
    transport: createInProcessTransport(),
    records,
    jobs: [resendJob(site)],
    now: systemClock,
  });
}

async function resendOnce(site: ResendJobServices, payload: ResendPayload): Promise<JobStatus> {
  const queue = worker(site, createFileRecords(await jobsFile()));
  return queue.run(await queue.enqueue(RESEND_JOB, payload));
}

function resultOf(status: JobStatus) {
  assert.equal(status.state, 'finished', status.state === 'failed' ? status.error : status.state);
  const read = finishedResult(RESEND_JOB, status);
  assert.ok(read);
  return read;
}

describe('the resend job', () => {
  it('reports per post the inboxes reached, and the slugs with nothing to resend (AC #3)', async () => {
    const site = services({
      hello: report('hello', ['sent', 'sent', 'failed']),
      later: report('later', ['sent', 'queued']),
    });

    const result = resultOf(
      await resendOnce(site, { slugs: ['hello', 'missing', 'later'], webmentions: false }),
    );

    assert.deepEqual(result.posts, [
      {
        slug: 'hello',
        resent: true,
        activity: {
          activityType: 'Update',
          heldByDevMode: false,
          inboxes: 3,
          reached: 2,
          queued: 0,
          failed: 1,
        },
        webmentions: null,
      },
      { slug: 'missing', resent: false },
      {
        slug: 'later',
        resent: true,
        activity: {
          activityType: 'Update',
          heldByDevMode: false,
          inboxes: 2,
          reached: 1,
          queued: 1,
          failed: 0,
        },
        webmentions: null,
      },
    ]);
    assert.deepEqual(site.mentioned, [], 'no webmention was sent when none was asked for');
  });

  it('resends every announced post as the job runs, not as it was queued (AC #2)', async () => {
    const site = services({ one: report('one', ['sent']), two: report('two', ['sent']) });

    const result = resultOf(await resendOnce(site, { slugs: 'all', webmentions: false }));

    assert.deepEqual(
      result.posts.map((post) => post.slug),
      ['one', 'two'],
    );
    assert.deepEqual(site.resent, ['one', 'two']);
  });

  it('says which posts dev mode held (AC #5)', async () => {
    const site = services({ hello: report('hello', [], true) });

    const result = resultOf(await resendOnce(site, { slugs: ['hello'], webmentions: false }));

    const [post] = result.posts;
    assert.equal(post?.resent && post.activity?.heldByDevMode, true);
  });

  it('sends the post’s webmentions with it when asked, and counts them', async () => {
    const target = (url: string, status: 'sent' | 'none' | 'failed') => ({
      slug: 'hello',
      source: 'https://blog.example/hello/',
      target: url,
      endpoint: null,
      status,
      error: null,
      attemptedAt: '2026-10-14T09:00:00.000Z',
    });
    const site = services(
      {},
      {
        hello: {
          slug: 'hello',
          source: 'https://blog.example/hello/',
          sent: [target('https://a.example/', 'sent'), target('https://b.example/', 'none')],
        },
      },
    );

    const result = resultOf(await resendOnce(site, { slugs: ['hello'], webmentions: true }));

    assert.deepEqual(result.posts, [
      {
        slug: 'hello',
        resent: true,
        activity: null,
        webmentions: { pages: 2, told: 1, none: 1, failed: 0 },
      },
    ]);
  });

  it('refuses a payload that names neither slugs nor every post', () => {
    const job = resendJob(services({}));

    assert.throws(() => job.parse({ slugs: 'some', webmentions: false }));
    assert.throws(() => job.parse({ slugs: [1], webmentions: false }));
    assert.throws(() => job.parse(null));
  });

  it('stops between posts when the queue stops, and finishes in the next worker (AC #4)', async () => {
    const file = await jobsFile();
    const site = services({
      a: report('a', ['sent']),
      b: report('b', ['sent']),
      c: report('c', ['sent']),
    });
    const records = createFileRecords(file);
    let stop: () => void = () => undefined;
    const stopped = new Promise<void>((resolve) => (stop = resolve));
    const first = worker(site, {
      ...records,
      async transition(id, expected, next) {
        const changed = await records.transition(id, expected, next);
        if (next.state === 'running' && next.progress?.done === 1) {
          first.stop();
          stop();
        }
        return changed;
      },
    });
    const id = await first.enqueue(RESEND_JOB, { slugs: 'all', webmentions: false });

    await first.start();
    await stopped;
    await first.close();

    const handedBack = await createFileRecords(file).get(id);
    assert.equal(handedBack?.state, 'queued', 'the job went back to the queue');
    assert.deepEqual(site.resent, ['a'], 'it stopped after the post it was on');

    const next = worker(site, createFileRecords(file));
    await next.start();
    const status = await next.run(id);
    await next.close();

    const result = resultOf(status);
    assert.deepEqual(
      result.posts.map((post) => [post.slug, post.resent && post.activity?.reached]),
      [
        ['a', 1],
        ['b', 1],
        ['c', 1],
      ],
    );
  });

  it('runs again as a new attempt after its worker died part way, and finishes (AC #4)', async () => {
    const file = await jobsFile();
    const site = services({ a: report('a', ['sent']), b: report('b', ['sent']) });
    await createFileRecords(file).create({
      id: 'cut-off',
      name: RESEND_JOB.name,
      payload: { slugs: 'all', webmentions: false },
      queuedAt: '2026-10-14T09:00:00.000Z',
      state: 'running',
      attempt: 1,
      owner: 'a worker that died',
      startedAt: '2026-10-14T09:00:01.000Z',
      progress: { done: 1, total: 2 },
    });

    const next = worker(site, createFileRecords(file));
    await next.start();
    const status = await next.run('cut-off');
    await next.close();

    assert.equal(status.attempt, 2);
    assert.deepEqual(
      resultOf(status).posts.map((post) => post.slug),
      ['a', 'b'],
    );
  });
});
