import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { jpegWithMetadata, leakedSecrets } from '../__testing__/metadata.ts';
import { STRIP_METADATA_JOB } from '../content/metadata/strip-job.ts';
import type { Cms } from '../index.ts';
import { createFileRecords } from '../jobs/file-records.ts';
import type { JobState } from '../jobs/types.ts';
import { csrfField, sandbox, signedIn } from './__testing__/harness.ts';
import type { Browser } from './__testing__/harness.ts';
import { flashes } from './__testing__/flash.ts';

const box = sandbox();
after(() => box.cleanup());

const BROKEN = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0x40, 0x00, 0x45, 0x78]);

async function siteWith(uploads: Record<string, Uint8Array>): Promise<Cms> {
  const contentDir = await box.dir('geekity-strip-admin-');
  for (const [relative, bytes] of Object.entries(uploads)) {
    const file = path.join(contentDir, 'uploads', ...relative.split('/'));
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, bytes);
  }
  return box.site({ contentDir });
}

async function mediaScreen(agent: Browser): Promise<string> {
  return (await agent.get('/admin/media')).text();
}

function sweepSection(html: string): string {
  const match = /<section[^>]*id="strip-metadata"[\s\S]*?<\/section>/.exec(html);
  assert.ok(match, 'the media screen has a strip-metadata section');
  return match[0].replace(/\s+/g, ' ');
}

async function queueSweep(agent: Browser): Promise<Response> {
  const token = csrfField(await mediaScreen(agent));
  return agent.post('/admin/media/strip-metadata', { csrf_token: token ?? '' });
}

async function recordSweep(cms: Cms, state: JobState): Promise<void> {
  await createFileRecords(path.join(cms.config.dataDir, 'jobs.json')).create({
    id: `sweep-${state.state}`,
    name: STRIP_METADATA_JOB.name,
    payload: null,
    queuedAt: '2026-10-14T09:00:00.000Z',
    ...state,
  });
}

describe('Media > strip metadata from earlier uploads', () => {
  it('offers the sweep when none has run', async () => {
    const cms = await siteWith({});
    const section = sweepSection(await mediaScreen(await signedIn(cms)));

    assert.match(section, /<h2[^>]*>Location and camera metadata<\/h2>/);
    assert.match(section, /action="\/admin\/media\/strip-metadata"/);
    assert.match(section, /<button type="submit"[^>]*>Strip metadata from every upload<\/button>/);
  });

  it('queues the sweep and answers at once, without running it (AC #1)', async () => {
    const cms = await siteWith({ '2025/05/beach.jpg': await jpegWithMetadata(6) });
    const agent = await signedIn(cms);

    const response = await queueSweep(agent);

    assert.equal(response.status, 303);
    assert.equal(response.headers.get('location'), '/admin/media#strip-metadata');
    const queued = await cms.jobs.latest(STRIP_METADATA_JOB.name);
    assert.equal(queued?.state, 'queued', 'the request did not wait for the sweep');
    const file = path.join(cms.config.contentDir, 'uploads', '2025', '05', 'beach.jpg');
    assert.notDeepEqual(leakedSecrets(await readFile(file)), [], 'nothing was stripped yet');

    const html = await mediaScreen(agent);
    assert.ok(flashes(html).some((flash) => /Queued the sweep/.test(flash.message)));
    const section = sweepSection(html);
    assert.match(section, />Queued</);
    assert.doesNotMatch(
      section,
      /<button type="submit"/,
      'no second sweep is offered while one waits',
    );

    const finished = await cms.jobs.run(queued.id);
    assert.equal(finished.state, 'finished');
    assert.deepEqual(leakedSecrets(await readFile(file)), []);
  });

  it('queues no second sweep while one is queued or running (AC #1)', async () => {
    const cms = await siteWith({});
    const agent = await signedIn(cms);
    await queueSweep(agent);
    const first = await cms.jobs.latest(STRIP_METADATA_JOB.name);

    const again = await queueSweep(agent);

    assert.equal(again.status, 303);
    assert.equal((await cms.jobs.latest(STRIP_METADATA_JOB.name))?.id, first?.id);
    assert.ok(
      flashes(await mediaScreen(agent)).some((flash) =>
        /already queued or running/.test(flash.message),
      ),
    );
  });

  it('shows a running sweep with the files checked out of the total (AC #2)', async () => {
    const cms = await siteWith({});
    await recordSweep(cms, {
      state: 'running',
      attempt: 1,
      owner: 'elsewhere',
      startedAt: '2026-10-14T09:00:01.000Z',
      progress: { done: 2, total: 5 },
    });

    const section = sweepSection(await mediaScreen(await signedIn(cms)));

    assert.match(section, />Running</);
    assert.match(section, /Checked 2 of 5 files/);
    assert.match(section, /<progress[^>]*value="2"[^>]*max="5"/);
    assert.doesNotMatch(section, /<button type="submit"/);
  });

  it('shows a finished sweep with its counts and the files it stripped (AC #2)', async () => {
    const cms = await siteWith({
      '2025/05/beach.jpg': await jpegWithMetadata(6),
      '2025/05/broken.jpg': BROKEN,
    });
    const agent = await signedIn(cms);
    await queueSweep(agent);
    const queued = await cms.jobs.latest(STRIP_METADATA_JOB.name);
    assert.ok(queued);
    await cms.jobs.run(queued.id);
    await writeFile(
      path.join(cms.config.contentDir, 'uploads', '2025', '05', 'late.jpg'),
      await jpegWithMetadata(3),
    );
    await queueSweep(agent);
    const second = await cms.jobs.latest(STRIP_METADATA_JOB.name);
    assert.ok(second);
    await cms.jobs.run(second.id);

    const section = sweepSection(await mediaScreen(agent));

    assert.match(section, />Finished</);
    assert.match(section, /Checked 3 files: 1 stripped, 1 already clean, 1 unreadable/);
    assert.match(section, /2025\/05\/late\.jpg<\/code>: removed [^<]*EXIF/);
    assert.match(section, /2025\/05\/broken\.jpg<\/code>:/);
    assert.match(section, /<button type="submit"[^>]*>Run the sweep again<\/button>/);
  });

  it('shows a failed sweep with its error (AC #2)', async () => {
    const cms = await siteWith({});
    await recordSweep(cms, {
      state: 'failed',
      attempt: 1,
      finishedAt: '2026-10-14T09:00:02.000Z',
      error: 'EACCES: permission denied, open <uploads>',
    });

    const section = sweepSection(await mediaScreen(await signedIn(cms)));

    assert.match(section, />Failed</);
    assert.match(section, /EACCES: permission denied, open &lt;uploads&gt;/);
    assert.match(section, /<button type="submit"[^>]*>Run the sweep again<\/button>/);
  });

  it('shows an interrupted sweep (AC #2)', async () => {
    const cms = await siteWith({});
    await recordSweep(cms, {
      state: 'interrupted',
      attempt: 3,
      interruptedAt: '2026-10-14T09:00:03.000Z',
    });

    const section = sweepSection(await mediaScreen(await signedIn(cms)));

    assert.match(section, />Interrupted</);
    assert.match(section, /cut it off 3 times/);
    assert.match(section, /<button type="submit"[^>]*>Run the sweep again<\/button>/);
  });
});
