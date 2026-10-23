/**
 * The fonts a page is set in (decision-61, TASK-492): the hosted stylesheet of
 * each Google family the site chose, linked from the head, and the role's
 * custom property set to the family before the theme's stack. Google is
 * stubbed.
 */
import assert from 'node:assert/strict';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, afterEach, before, describe, it } from 'node:test';

import { csrfField, sandbox, signedIn } from '../admin/__testing__/harness.ts';
import { BODY, BOLD, FAMILY, googleLookup, stubGoogle } from '../fonts/__testing__/google.ts';
import type { StubbedGoogle } from '../fonts/__testing__/google.ts';
import { FONT_FETCH_JOB } from '../fonts/index.ts';
import type { Cms } from '../index.ts';
import { nextEvent } from '../__testing__/wait.ts';
import { createInProcessTransport } from '../jobs/in-process.ts';
import type { MessageTransport } from '../jobs/types.ts';
import { readTheme, PACKAGED_THEME_DIR } from '../theme/themes.ts';

const box = sandbox();
let google: StubbedGoogle;

before(() => {
  google = stubGoogle();
});
after(async () => {
  google.restore();
  await box.cleanup();
});
afterEach(() => {
  google.reset();
});

const POST = [
  '---',
  'title: Hello',
  "date: '2026-09-02T09:00:00Z'",
  'permalink: /2026/09/hello/',
  '---',
  '',
  'Body.',
  '',
].join('\n');

async function site(settings: Record<string, unknown>): Promise<Cms> {
  const contentDir = await box.dir('geekity-page-fonts-content-');
  await mkdir(path.join(contentDir, '_data'), { recursive: true });
  await mkdir(path.join(contentDir, 'posts'), { recursive: true });
  await writeFile(path.join(contentDir, 'posts', 'hello.md'), POST);
  await writeFile(
    path.join(contentDir, '_data', 'site.json'),
    JSON.stringify({ title: 'A Site', ...settings }),
  );
  return await box.open({
    contentDir,
    dataDir: await box.dir('geekity-page-fonts-data-'),
    hostLookup: googleLookup,
    jobs: { transport: watchedTransport() },
  });
}

async function head(cms: Cms): Promise<string> {
  const response = await cms.app.request('/2026/09/hello/');
  assert.equal(response.status, 200);
  const html = await response.text();
  return /<head>([\s\S]*?)<\/head>/.exec(html)?.[1] ?? '';
}

function fallbackOf(role: string): string {
  const packaged = readTheme(PACKAGED_THEME_DIR);
  assert.ok(packaged.ok);
  const font = packaged.theme.fonts.find((each) => each.role === role);
  assert.ok(font !== undefined, `the packaged theme declares ${role}`);
  return font.fallback;
}

const HOSTED = /<link rel="stylesheet" href="(\/_geekity\/fonts\/[^"]+)">/g;

async function fontJobs(cms: Cms): Promise<number> {
  const waiting = await cms.jobs.list(['queued', 'running']);
  return waiting.filter((job) => job.name === FONT_FETCH_JOB.name).length;
}

/** Jobs sent to the transport, so a test can wait for the one a render queues. */
const sent = new Set<() => void>();

function nextJobSent(): Promise<void> {
  return nextEvent('a job sent to the transport', (done) => {
    sent.add(done);
    return () => sent.delete(done);
  });
}

function watchedTransport(): MessageTransport {
  const inner = createInProcessTransport();
  return {
    async enqueue(message) {
      await inner.enqueue(message);
      for (const done of [...sent]) done();
    },
    listen: (handler, options) => inner.listen(handler, options),
  };
}

describe('the head of a page with no font chosen', () => {
  it('links no font stylesheet and sets no font property', async () => {
    const cms = await site({});
    const html = await head(cms);
    assert.equal([...html.matchAll(HOSTED)].length, 0);
    assert.doesNotMatch(html, /--font-/);
    assert.equal(await fontJobs(cms), 0);
  });
});

describe('the head of a page with fonts chosen (AC #4)', () => {
  it('links the hosted stylesheet of each and prints the family before the theme stack', async () => {
    const cms = await site({ headingFont: 'Fraunces', bodyFont: FAMILY });
    google.serveFamily(BODY);
    google.serveFamily([BOLD], 'Fraunces');
    const body = await cms.fonts.ensure(FAMILY, BODY);
    const heading = await cms.fonts.ensure('Fraunces', [BOLD]);
    assert.ok(body.ok && heading.ok);

    const html = await head(cms);
    const links = [...html.matchAll(HOSTED)].map(([, href]) => href);
    assert.deepEqual(links.sort(), [heading.stylesheet.href, body.stylesheet.href].sort());
    for (const href of links) assert.match(href ?? '', /\?v=\w+$/);

    assert.ok(
      html.includes(`--font-heading: "Fraunces", ${fallbackOf('heading')};`),
      'the heading property names Fraunces first',
    );
    assert.ok(
      html.includes(`--font-body: "${FAMILY}", ${fallbackOf('body')};`),
      'the body property names the body family first',
    );
    // After the theme stylesheet, so its unlayered rule wins over the
    // stylesheet's layered default.
    assert.ok(html.indexOf('--font-body') > html.indexOf('style.css'));
  });

  it('ignores a font for a role the theme does not declare', async () => {
    const cms = await site({ bodyFont: FAMILY, captionFont: 'Lora' });
    google.serveFamily(BODY);
    assert.ok((await cms.fonts.ensure(FAMILY, BODY)).ok);
    const html = await head(cms);
    assert.doesNotMatch(html, /--font-caption/);
    assert.doesNotMatch(html, /--font-heading/);
  });

  it('prints nothing for a value that is not a family name', async () => {
    const cms = await site({ bodyFont: 'Lora"; } body { color: red' });
    const html = await head(cms);
    assert.doesNotMatch(html, /--font-/);
    assert.doesNotMatch(html, /color: red/);
  });
});

describe('a chosen font whose files are missing (AC #5)', () => {
  it('falls back to the stack and queues one fetch, which brings the font back', async () => {
    const cms = await site({ bodyFont: FAMILY });
    google.serveFamily(BODY);

    const queued = nextJobSent();
    const missing = await head(cms);
    assert.equal([...missing.matchAll(HOSTED)].length, 0);
    assert.doesNotMatch(missing, /--font-body/);
    await queued;
    await head(cms);
    await head(cms);
    assert.equal(await fontJobs(cms), 1);

    const [job] = await cms.jobs.list(['queued']);
    assert.ok(job !== undefined);
    const status = await cms.jobs.run(job.id);
    assert.equal(status.state, 'finished', JSON.stringify(status));

    const restored = await head(cms);
    assert.equal([...restored.matchAll(HOSTED)].length, 1);
    assert.match(restored, /--font-body: "Atkinson Hyperlegible"/);

    await rm(path.join(cms.config.dataDir, 'fonts'), { recursive: true });
    const queuedAgain = nextJobSent();
    const goneAgain = await head(cms);
    assert.doesNotMatch(goneAgain, /--font-body/);
    await queuedAgain;
    assert.equal(await fontJobs(cms), 1, 'a second loss queues a second fetch');
  });
});

describe('the editor preview of a site with a font', () => {
  it('carries the admin CSP nonce on the font style, so the admin policy lets it apply', async () => {
    const cms = await site({ bodyFont: FAMILY });
    google.serveFamily(BODY);
    assert.ok((await cms.fonts.ensure(FAMILY, BODY)).ok);
    const agent = await signedIn(cms);
    const token = csrfField(await (await agent.get('/admin/posts/new?kind=note')).text());
    assert.ok(token !== undefined);

    const response = await agent.post('/admin/preview', {
      csrf_token: token,
      type: 'post',
      title: 'Draft',
      body: 'Words.',
    });
    assert.equal(response.status, 200);
    const nonce = /'nonce-([^']+)'/.exec(
      response.headers.get('content-security-policy') ?? '',
    )?.[1];
    assert.ok(nonce !== undefined, 'the admin policy names a nonce');
    assert.ok((await response.text()).includes(`<style nonce="${nonce}">`));
  });
});
