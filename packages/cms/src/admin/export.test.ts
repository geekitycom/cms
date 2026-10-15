import assert from 'node:assert/strict';
import { readdir, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, describe, it } from 'node:test';

import { SqliteMessageQueue } from '@fedify/sqlite';

import { cleanupTemporaryDirs, exists, runCli, temporaryDir } from '../__testing__/cli.ts';
import { SITE_EXPORT_JOB } from '../export/export-job.ts';
import { CORE_DATA_FILES, dataFileFor } from '../files/data-files.ts';
import { readTar } from '../files/tar.ts';
import { createCms } from '../index.ts';
import type { Cms } from '../index.ts';
import { createFileRecords } from '../jobs/file-records.ts';
import type { JobState } from '../jobs/types.ts';
import { FEDERATION_QUEUE_TABLE } from '../store/queue-database.ts';
import { FIRST_ADMIN, browser, csrfField, sandbox, signedIn } from './__testing__/harness.ts';
import type { Browser } from './__testing__/harness.ts';
import { flashes } from './__testing__/flash.ts';

const box = sandbox();
after(() => box.cleanup());
after(cleanupTemporaryDirs);

const EXPORT_URL = '/admin/tools/export';
const DOWNLOAD_URL = '/admin/tools/export/download';
const HOUR = 60 * 60 * 1000;

interface Site {
  cms: Cms;
  agent: Browser;
  advance(ms: number): void;
}

async function site(): Promise<Site> {
  let now = new Date('2026-10-14T15:04:05.000Z');
  const cms = await box.site({ baseUrl: 'https://blog.example', now: () => now });
  return {
    cms,
    agent: await signedIn(cms),
    advance(ms) {
      now = new Date(now.getTime() + ms);
    },
  };
}

function section(html: string): string {
  const match = /<main[\s\S]*<\/main>/.exec(html);
  assert.ok(match, 'the screen has a main element');
  return match[0].replace(/\s+/g, ' ');
}

async function startExport(agent: Browser, fields: Record<string, string>): Promise<Response> {
  const token = csrfField(await (await agent.get(EXPORT_URL)).text());
  return agent.post(EXPORT_URL, { csrf_token: token ?? '', ...fields });
}

async function exportOnce(s: Site, fields: Record<string, string> = {}): Promise<void> {
  const response = await startExport(s.agent, { password: FIRST_ADMIN.password, ...fields });
  assert.equal(response.status, 303);
  const queued = await s.cms.jobs.latest(SITE_EXPORT_JOB.name);
  assert.equal(queued?.state, 'queued');
  const finished = await s.cms.jobs.run(queued.id);
  assert.equal(finished.state, 'finished', JSON.stringify(finished));
}

async function exportsFolder(cms: Cms): Promise<string[]> {
  return (await readdir(path.join(cms.config.dataDir, 'exports'))).sort();
}

describe('Tools > Export', () => {
  it('is a child of Tools', async () => {
    const { agent } = await site();
    const html = await (await agent.get(EXPORT_URL)).text();

    assert.match(html, /<a[^>]*href="\/admin\/tools\/export"[^>]*aria-current="page"[^>]*>/);
    assert.match(section(html), /<h1[^>]*>Export<\/h1>/);
  });

  it('shows the deliveries waiting in queue.sqlite before an export starts (AC #2)', async () => {
    const { cms, agent } = await site();
    const queue = new SqliteMessageQueue(
      new DatabaseSync(path.join(cms.config.dataDir, 'queue.sqlite')),
      { tableName: FEDERATION_QUEUE_TABLE },
    );
    await queue.enqueue({ deliver: 1 });
    await queue.enqueue({ deliver: 2 });
    queue[Symbol.dispose]();

    const html = section(await (await agent.get(EXPORT_URL)).text());

    assert.match(html, /2 deliveries are waiting in <code>data\/queue.sqlite<\/code>/);
  });

  it('queues nothing when the password is wrong or missing (AC #1)', async () => {
    const { cms, agent } = await site();

    for (const password of ['not the password', '']) {
      const response = await startExport(agent, { password, with_credentials: 'on' });

      assert.equal(response.status, 400);
      const html = section(await response.text());
      assert.match(html, /Your password was not right, so nothing was exported/);
      assert.match(html, /<input[^>]*name="with_credentials"[^>]*checked/);
    }
    assert.equal(await cms.jobs.latest(SITE_EXPORT_JOB.name), undefined);
  });

  it('queues the export with the right password and keeps the password out of the job (AC #1)', async () => {
    const { cms, agent } = await site();

    const response = await startExport(agent, {
      password: FIRST_ADMIN.password,
      with_credentials: 'on',
    });

    assert.equal(response.status, 303);
    assert.equal(response.headers.get('location'), EXPORT_URL);
    const queued = await cms.jobs.latest(SITE_EXPORT_JOB.name);
    assert.equal(queued?.state, 'queued');
    assert.deepEqual(queued.payload, { withCredentials: true });
    const html = await (await agent.get(EXPORT_URL)).text();
    assert.ok(flashes(html).some((flash) => /Queued the export/.test(flash.message)));
    assert.doesNotMatch(section(html), /<button type="submit"/, 'no second export while one waits');
  });

  it('queues an export without credentials when the box is not ticked', async () => {
    const { cms, agent } = await site();

    await startExport(agent, { password: FIRST_ADMIN.password });

    assert.deepEqual((await cms.jobs.latest(SITE_EXPORT_JOB.name))?.payload, {
      withCredentials: false,
    });
  });

  it('shows a running export with its files and bytes (AC #3)', async () => {
    const { cms, agent } = await site();
    const running: JobState = {
      state: 'running',
      attempt: 1,
      owner: 'elsewhere',
      startedAt: '2026-10-14T15:04:06.000Z',
      progress: { done: 2, total: 5, note: '1.5 MB of 3 MB.' },
    };
    await createFileRecords(path.join(cms.config.dataDir, 'jobs.json')).create({
      id: 'export-running',
      name: SITE_EXPORT_JOB.name,
      payload: { withCredentials: false },
      queuedAt: '2026-10-14T15:04:05.000Z',
      ...running,
    });

    const html = section(await (await agent.get(EXPORT_URL)).text());

    assert.match(html, />Running</);
    assert.match(html, /<progress[^>]*value="2"[^>]*max="5"/);
    assert.match(html, /Exported 2 of 5 files\. 1\.5 MB of 3 MB\./);
  });

  it('offers the finished archive as a download only a signed-in user can fetch (AC #3)', async () => {
    const s = await site();
    await exportOnce(s);

    const html = section(await (await s.agent.get(EXPORT_URL)).text());
    assert.match(html, /<a[^>]*href="\/admin\/tools\/export\/download"[^>]*>/);
    assert.match(html, /geekity-blog\.example-20261014T150405Z\.tar\.gz/);

    const download = await s.agent.get(DOWNLOAD_URL);
    assert.equal(download.status, 200);
    assert.equal(
      download.headers.get('content-disposition'),
      'attachment; filename="geekity-blog.example-20261014T150405Z.tar.gz"',
    );
    assert.equal(download.headers.get('cache-control'), 'no-store');
    const entries = await readTar(Buffer.from(await download.arrayBuffer()));
    assert.equal(entries[0]?.name, 'manifest.json');
    assert.ok(entries.some((entry) => entry.name === 'data/users.json'));

    const stranger = await browser(s.cms).get(DOWNLOAD_URL);
    assert.notEqual(stranger.status, 200);
    assert.equal(stranger.headers.get('content-disposition'), null);
    assert.doesNotMatch(await stranger.text(), /manifest\.json/);
  });

  it('names the files the finished export left out: undeclared data and content it cannot carry', async () => {
    const s = await site();
    const { contentDir, dataDir } = s.cms.config;
    await writeFile(path.join(dataDir, 'surprise.json'), '{}');
    await symlink(path.join(contentDir, '_data'), path.join(contentDir, 'linked'));
    await exportOnce(s);

    const html = section(await (await s.agent.get(EXPORT_URL)).text());
    assert.match(html, /<code[^>]*>data\/surprise\.json<\/code>/);
    assert.match(html, /<code[^>]*>content\/linked<\/code>[^<]*a symbolic link/);
  });

  it('archives jobs.json without the export job, so an import runs no export (TASK-413)', async () => {
    const s = await site();
    await exportOnce(s);
    const download = await s.agent.get(DOWNLOAD_URL);
    const archive = Buffer.from(await download.arrayBuffer());
    const jobs = (await readTar(archive)).find((entry) => entry.name === 'data/jobs.json');
    assert.ok(jobs, 'the archive holds jobs.json');
    const names = (JSON.parse(jobs.body.toString('utf8')) as { name: string }[]).map(
      (job) => job.name,
    );
    assert.ok(!names.includes(SITE_EXPORT_JOB.name), names.join(', '));

    const target = await temporaryDir('geekity-export-import-');
    await writeFile(path.join(target, 'site.tar.gz'), archive);
    const imported = await runCli(['import', 'site.tar.gz'], target, undefined, {
      GEEKITY_BASE_URL: 'https://blog.example',
    });
    assert.equal(imported.code, 0, imported.stderr);
    const restored = createCms({
      contentDir: path.join(target, 'content'),
      dataDir: path.join(target, 'data'),
      baseUrl: 'https://blog.example',
      watch: false,
    });
    try {
      assert.equal(await restored.jobs.latest(SITE_EXPORT_JOB.name), undefined);
      assert.equal(await exists(path.join(target, 'data', 'exports')), false);
    } finally {
      await restored.close();
    }
  });

  it('answers 404 for a download when there is no archive', async () => {
    const { agent } = await site();

    assert.equal((await agent.get(DOWNLOAD_URL)).status, 404);
  });

  it('keeps only the newest archive (AC #4)', async () => {
    const s = await site();
    await exportOnce(s);
    s.advance(60_000);
    await exportOnce(s, { with_credentials: 'on' });

    assert.deepEqual(await exportsFolder(s.cms), ['geekity-blog.example-20261014T150505Z.tar.gz']);
    const download = await s.agent.get(DOWNLOAD_URL);
    assert.match(download.headers.get('content-disposition') ?? '', /T150505Z/);
  });

  it('deletes the archive 24 hours after it was written (AC #4)', async () => {
    const s = await site();
    await exportOnce(s);

    s.advance(24 * HOUR - 1000);
    await s.cms.retention.sweep();
    assert.equal((await exportsFolder(s.cms)).length, 1, 'still there just before 24 hours');
    assert.equal((await s.agent.get(DOWNLOAD_URL)).status, 200);

    s.advance(1000);
    assert.equal((await s.agent.get(DOWNLOAD_URL)).status, 404);
    const html = section(await (await s.agent.get(EXPORT_URL)).text());
    assert.doesNotMatch(html, /href="\/admin\/tools\/export\/download"/);
    assert.match(html, /deleted 24 hours after it was written/);

    await s.cms.retention.sweep();
    assert.deepEqual(await exportsFolder(s.cms), []);
  });

  it('declares data/exports/ scratch (AC #4)', () => {
    const declared = dataFileFor(CORE_DATA_FILES, 'exports/geekity-blog.example-x.tar.gz');

    assert.equal(declared?.dataClass.kind, 'scratch');
  });
});
