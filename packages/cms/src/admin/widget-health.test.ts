import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { SqliteMessageQueue } from '@fedify/sqlite';

import { dataPath, JOBS } from '../files/data-files.ts';
import type { Cms } from '../index.ts';
import { createFileRecords } from '../jobs/file-records.ts';
import type { JobState } from '../jobs/types.ts';
import type { NewDelivery } from '../store/deliveries.ts';
import { FEDERATION_QUEUE_TABLE, openQueueDatabase } from '../store/queue-database.ts';
import type { NewSentWebmention } from '../store/webmentions.ts';
import { TEN_AM_20_OCTOBER_IN_CHICAGO } from './__testing__/chicago-clock.ts';
import { sandbox, signedIn } from './__testing__/harness.ts';
import type { Browser } from './__testing__/harness.ts';
import { screenOf, text } from './__testing__/markup.ts';

const box = sandbox();
after(() => box.cleanup());

function ago(hours: number): string {
  return new Date(TEN_AM_20_OCTOBER_IN_CHICAGO.getTime() - hours * 3600 * 1000).toISOString();
}

async function site(): Promise<{ cms: Cms; agent: Browser }> {
  const contentDir = await box.dir('geekity-health-widget-content-');
  await mkdir(path.join(contentDir, '_data'), { recursive: true });
  await writeFile(
    path.join(contentDir, '_data', 'site.json'),
    JSON.stringify({ title: 'A Site' }),
    'utf8',
  );
  const cms = await box.site({
    contentDir,
    baseUrl: 'https://blog.example',
    now: () => TEN_AM_20_OCTOBER_IN_CHICAGO,
  });
  return { cms, agent: await signedIn(cms) };
}

let sequence = 0;

async function job(cms: Cms, name: string, state: JobState): Promise<void> {
  sequence += 1;
  await createFileRecords(dataPath(cms.config.dataDir, JOBS)).create({
    id: `job-${String(sequence)}`,
    name,
    payload: null,
    queuedAt: ago(200 - sequence),
    ...state,
  });
}

function failed(hours: number): JobState {
  return { state: 'failed', attempt: 1, finishedAt: ago(hours), error: 'It broke.' };
}

function finished(hours: number): JobState {
  return { state: 'finished', attempt: 1, finishedAt: ago(hours), result: null };
}

function running(hours: number): JobState {
  return { state: 'running', attempt: 1, owner: 'elsewhere', startedAt: ago(hours) };
}

function delivery(fields: Partial<NewDelivery>): NewDelivery {
  return {
    activityId: 'https://blog.example/activities/1',
    activityType: 'Create',
    objectId: 'https://blog.example/2026/10/hello/',
    slug: 'hello',
    actorId: 'https://remote.example/users/ada',
    inboxId: 'https://remote.example/inbox',
    status: 'sent',
    error: null,
    attemptedAt: ago(1),
    ...fields,
  };
}

function webmention(fields: Partial<NewSentWebmention>): NewSentWebmention {
  return {
    slug: 'hello',
    source: 'https://blog.example/2026/10/hello/',
    target: 'https://other.example/page',
    endpoint: 'https://other.example/webmention',
    status: 'sent',
    error: null,
    attemptedAt: ago(1),
    ...fields,
  };
}

async function seedFedifyOutbox(
  cms: Cms,
  messages: readonly { attempt: number; started: string }[],
) {
  using queue = new SqliteMessageQueue(openQueueDatabase(cms.config.dataDir), {
    tableName: FEDERATION_QUEUE_TABLE,
  });
  for (const [index, message] of messages.entries()) {
    await queue.enqueue({
      type: 'outbox',
      id: `message-${String(index)}`,
      activityType: 'https://www.w3.org/ns/activitystreams#Create',
      inbox: `https://remote${String(index)}.example/inbox`,
      ...message,
    });
  }
}

async function dashboard(agent: Browser): Promise<string> {
  const response = await agent.get('/admin');
  assert.equal(response.status, 200);
  return screenOf(await response.text());
}

function card(html: string): string {
  const [, after = ''] = html.split('<h2 class="card-title">Needs attention</h2>');
  return after.split('<h2')[0] ?? '';
}

function rows(html: string): [string, string, string][] {
  return [
    ...card(html).matchAll(
      /<td class="wrap-anywhere"><a class="link" href="([^"]*)">([^<]*)<\/a><\/td>\s*<td class="wrap-anywhere">([^<]*)<\/td>/g,
    ),
  ].map(([, href = '', problem = '', count = '']) => [problem, href, count]);
}

describe('the health widget (TASK-450)', () => {
  it('draws nothing while nothing is failing (AC #1)', async () => {
    const { cms, agent } = await site();
    await job(cms, 'resend', failed(24 * 8));
    await job(cms, 'site.export', finished(2));
    await job(cms, 'strip-metadata', running(0.5));
    cms.admin.recordDelivery(delivery({ status: 'sent' }));
    cms.admin.recordDelivery(delivery({ actorId: 'https://remote.example/b', status: 'queued' }));
    cms.admin.recordDelivery(
      delivery({ actorId: 'https://old.example/c', status: 'failed', attemptedAt: ago(24 * 8) }),
    );
    cms.admin.recordSentWebmention(webmention({ status: 'none', endpoint: null }));
    cms.admin.recordSentWebmention(
      webmention({ target: 'https://old.example/', status: 'failed', attemptedAt: ago(24 * 8) }),
    );
    await seedFedifyOutbox(cms, [{ attempt: 0, started: ago(1) }]);

    const html = await dashboard(agent);

    assert.doesNotMatch(html, /Needs attention/);
  });

  it('counts each kind of failure of the last seven days and links to where it is handled (AC #2)', async () => {
    const { cms, agent } = await site();
    await job(cms, 'resend', failed(30));
    await job(cms, 'resend', {
      state: 'interrupted',
      attempt: 3,
      interruptedAt: ago(5),
    });
    await job(cms, 'strip-metadata', failed(2));
    await job(cms, 'site.export', running(3));
    cms.admin.recordDelivery(delivery({ status: 'failed', error: '502' }));
    cms.admin.recordDelivery(
      delivery({ actorId: 'https://remote.example/b', status: 'failed', error: '502' }),
    );
    cms.admin.recordSentWebmention(webmention({ status: 'failed', error: '400' }));
    await seedFedifyOutbox(cms, [
      { attempt: 2, started: ago(3) },
      { attempt: 0, started: ago(1) },
    ]);

    const html = await dashboard(agent);

    assert.deepEqual(rows(html), [
      ['Resend failed', '/admin/federation#resend', '2'],
      ['Metadata sweep failed', '/admin/tools/maintenance#strip-metadata', '1'],
      ['Site export running for over an hour', '/admin/tools/export', '1'],
      ['Failed federation deliveries', '/admin/federation#delivery', '2'],
      ['Federation deliveries being retried', '/admin/federation#delivery', '1'],
      ['Failed webmentions', '/admin/federation#delivery', '1'],
    ]);
    const words = text(html);
    assert.ok(words.indexOf('At a glance') < words.indexOf('Needs attention'), words);
    assert.ok(words.indexOf('Needs attention') < words.indexOf('Activity'), words);
  });

  it('leaves out what a later retry or run put right (AC #3)', async () => {
    const { cms, agent } = await site();
    await job(cms, 'resend', failed(30));
    await job(cms, 'resend', finished(20));
    cms.admin.recordDelivery(delivery({ status: 'failed', error: '502', attemptedAt: ago(3) }));
    cms.admin.recordDelivery(delivery({ status: 'sent', attemptedAt: ago(2) }));
    cms.admin.recordSentWebmention(webmention({ status: 'failed', attemptedAt: ago(3) }));
    cms.admin.recordSentWebmention(webmention({ status: 'sent', attemptedAt: ago(2) }));

    const html = await dashboard(agent);

    assert.doesNotMatch(html, /Needs attention/);
  });
});
