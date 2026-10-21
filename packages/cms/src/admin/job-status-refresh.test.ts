import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { STRIP_METADATA_JOB } from '../content/metadata/strip-job.ts';
import { SITE_EXPORT_JOB } from '../export/export-job.ts';
import { RESEND_JOB } from '../federation/resend-job.ts';
import type { Cms } from '../index.ts';
import { createFileRecords } from '../jobs/file-records.ts';
import type { JobState } from '../jobs/types.ts';
import { PACKAGED_ADMIN_DIR } from './templates.ts';
import { sandbox, signedIn } from './__testing__/harness.ts';

const box = sandbox();
after(() => box.cleanup());

const RUNNING: JobState = {
  state: 'running',
  attempt: 1,
  owner: 'elsewhere',
  startedAt: '2026-10-20T09:00:01.000Z',
  progress: { done: 2, total: 5 },
};

const FINISHED: JobState = {
  state: 'finished',
  attempt: 1,
  finishedAt: '2026-10-20T09:00:02.000Z',
  result: null,
};

async function record(cms: Cms, name: string, state: JobState): Promise<void> {
  await createFileRecords(path.join(cms.config.dataDir, 'jobs.json')).create({
    id: `${name}-${state.state}`,
    name,
    payload: null,
    queuedAt: '2026-10-20T09:00:00.000Z',
    ...state,
  });
}

function boxTag(html: string, name: string): string | undefined {
  return new RegExp(`<[a-z]+[^>]*data-job-status="${name}"[^>]*>`).exec(html)?.[0];
}

const SCREENS = [
  {
    screen: 'Tools > Maintenance',
    url: '/admin/tools/maintenance',
    job: STRIP_METADATA_JOB.name,
    refresh: '/admin/tools/maintenance#strip-metadata',
  },
  {
    screen: 'Tools > Export',
    url: '/admin/tools/export',
    job: SITE_EXPORT_JOB.name,
    refresh: '/admin/tools/export',
  },
  {
    screen: 'Federation',
    url: '/admin/federation',
    job: RESEND_JOB.name,
    refresh: '/admin/federation#resend',
  },
  {
    screen: 'the media library notice',
    url: '/admin/media',
    job: STRIP_METADATA_JOB.name,
    refresh: '/admin/tools/maintenance#strip-metadata',
    redraw: '/admin/media',
  },
];

describe('a job status box that refreshes itself', () => {
  for (const { screen, url, job, refresh, redraw } of SCREENS) {
    it(`on ${screen}, names the page to fetch while the job runs, and loads the script (AC #1, #3)`, async () => {
      const cms = await box.site();
      await record(cms, job, RUNNING);

      const html = await (await (await signedIn(cms)).get(url)).text();

      const tag = boxTag(html, job);
      assert.ok(tag, `${screen} marks the job's box`);
      assert.match(tag, /data-job-state="running"/);
      assert.ok(tag.includes(`data-job-refresh="${refresh}"`), tag);
      if (redraw === undefined) assert.doesNotMatch(tag, /data-job-redraw/);
      else assert.ok(tag.includes(`data-job-redraw="${redraw}"`), tag);
      assert.match(
        html,
        /<script defer src="\/admin\/_static\/job-status\.js\?v=[^"]+"><\/script>/,
      );
    });
  }

  it('names nothing to fetch once the job has finished (AC #2)', async () => {
    const cms = await box.site();
    await record(cms, STRIP_METADATA_JOB.name, FINISHED);

    const html = await (await (await signedIn(cms)).get('/admin/tools/maintenance')).text();

    const tag = boxTag(html, STRIP_METADATA_JOB.name);
    assert.ok(tag);
    assert.match(tag, /data-job-state="finished"/);
    assert.doesNotMatch(tag, /data-job-refresh/);
  });

  it('keeps the Check again link for a browser without JavaScript (AC #5)', async () => {
    const cms = await box.site();
    await record(cms, STRIP_METADATA_JOB.name, RUNNING);

    const html = await (await (await signedIn(cms)).get('/admin/tools/maintenance')).text();

    assert.match(
      html,
      /<div data-job-check-again>\s*<a[^>]*href="\/admin\/tools\/maintenance#strip-metadata"[^>]*>Check again<\/a>/,
    );
  });

  it('serves the script from the admin folder under a policy that allows only same-origin scripts (AC #4)', async () => {
    const cms = await box.site();
    const agent = await signedIn(cms);

    const script = await agent.get('/admin/_static/job-status.js');
    assert.equal(script.status, 200);
    assert.match(script.headers.get('content-type') ?? '', /javascript/);
    assert.equal(
      await script.text(),
      await readFile(path.join(PACKAGED_ADMIN_DIR, 'static', 'job-status.js'), 'utf8'),
    );

    const page = await agent.get('/admin/tools/maintenance');
    assert.match(page.headers.get('content-security-policy') ?? '', /script-src 'self'(;|$)/);
    assert.doesNotMatch(await page.text(), /<script(?![^>]*\ssrc=)[^>]*>/);
  });
});
