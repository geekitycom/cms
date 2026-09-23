import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, beforeEach, describe, it } from 'node:test';

import { csrfField, FIRST_ADMIN, resolveNothing, signedIn } from '../admin/__testing__/harness.ts';
import { DEFAULT_SITE_SETTINGS, writeSiteJson } from '../admin/settings.ts';
import type { Browser } from '../admin/__testing__/harness.ts';
import { seedActorKeys } from '../federation/__testing__/keys.ts';
import { createCms } from '../index.ts';
import type { Cms } from '../index.ts';

/** The site under test. */
const BASE_URL = 'https://blog.example';

/** A page that advertises an endpoint, and the endpoint it advertises. */
const FRIENDLY = 'https://them.example/post';
const FRIENDLY_ENDPOINT = 'https://them.example/wm';

/** A page that advertises nothing at all, which is most of the web. */
const QUIET = 'https://quiet.example/page';

/** A page whose endpoint is there and refuses. */
const BROKEN = 'https://broken.example/page';
const BROKEN_ENDPOINT = 'https://broken.example/wm';

/** One webmention this site sent. */
interface Sent {
  /** The endpoint it went to. */
  endpoint: string;
  /** The post it was about. */
  source: string;
  /** The page it was about. */
  target: string;
  /** What it was labelled as on the wire. */
  contentType: string | null;
}

const started: Cms[] = [];
const temporaryDirs: string[] = [];
const sent: Sent[] = [];

const restoreFetch = routeTheWeb();

after(async () => {
  restoreFetch();
  for (const instance of started) await instance.close();
  await Promise.all(temporaryDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

beforeEach(() => {
  sent.length = 0;
});

/** The make-believe web this test sends into. Nothing leaves the process. */
function routeTheWeb(): () => void {
  const original = globalThis.fetch;

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init);
    const url = request.url;

    if (request.method === 'POST') {
      if (url === BROKEN_ENDPOINT) return new Response('no', { status: 500 });
      if (url !== FRIENDLY_ENDPOINT) return new Response('missing', { status: 404 });

      const body = new URLSearchParams(await request.text());
      sent.push({
        endpoint: url,
        source: body.get('source') ?? '',
        target: body.get('target') ?? '',
        contentType: request.headers.get('content-type'),
      });
      return new Response('', { status: 202 });
    }

    if (url === FRIENDLY) {
      return html(`<link rel="webmention" href="${FRIENDLY_ENDPOINT}">`);
    }
    if (url === BROKEN) {
      return html(`<link rel="webmention" href="${BROKEN_ENDPOINT}">`);
    }
    if (url === QUIET) return html('<p>Just a page.</p>');

    return new Response('missing', { status: 404 });
  }) as typeof fetch;

  return () => {
    globalThis.fetch = original;
  };
}

function html(body: string): Response {
  return new Response(body, { headers: { 'content-type': 'text/html; charset=utf-8' } });
}

async function temporaryDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  temporaryDirs.push(dir);
  return dir;
}

/** A CMS over a content directory of its own. */
async function site(
  options: { files?: Record<string, string>; webmentionsSend?: boolean } = {},
): Promise<Cms> {
  const dataDir = await temporaryDir('geekity-wm-send-data-');
  const contentDir = await temporaryDir('geekity-wm-send-content-');
  // The admin these tests sign in as, with their actor key already on disk:
  // publishing a post federates, and minting a real key for it would cost a
  // quarter of a second per test to prove nothing about a webmention.
  seedActorKeys(dataDir, FIRST_ADMIN.username);

  for (const [relative, source] of Object.entries(options.files ?? {})) {
    const file = path.join(contentDir, ...relative.split('/'));
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, source, 'utf8');
  }

  await writeSiteJson({
    contentDir,
    settings: {
      ...DEFAULT_SITE_SETTINGS,
      baseUrl: BASE_URL,
      notifyServer: '',
      webmentionsSend: options.webmentionsSend ?? true,
    },
  });

  const cms = createCms({
    dataDir,
    contentDir,
    port: 0,
    watch: false,
    baseUrl: BASE_URL,
    hostLookup: resolveNothing,
  });
  started.push(cms);
  await cms.sync();
  return cms;
}

/** A post file linking at the three pages of the make-believe web. */
function linkingPost(): string {
  return [
    '---',
    'title: Hello world',
    "date: '2026-03-04T09:00:00Z'",
    'permalink: /2026/03/hello-world/',
    '---',
    '',
    `A friendly [one](${FRIENDLY}), a [quiet one](${QUIET}), a [broken one](${BROKEN}),`,
    'and [one of my own](/2026/09/other/).',
    '',
  ].join('\n');
}

/** Publish a post through the editor, the way a browser would. */
async function publish(
  agent: Browser,
  body: string,
  fields: Record<string, string> = {},
): Promise<Response> {
  const html = await (await agent.get('/admin/posts/new')).text();
  const token = csrfField(html);
  assert.ok(token !== undefined, 'the editor carried a CSRF token');

  return agent.post('/admin/posts/new', {
    csrf_token: token,
    title: 'Hello world',
    slug: 'hello-world',
    permalink: '',
    date: '2026-03-04T09:00:00.000Z',
    tags: '',
    categories: '',
    description: '',
    body,
    hash: '',
    action: 'publish',
    ...fields,
  });
}

describe('sending webmentions when a post is published', () => {
  it('tells every external page the post links to, and records what came of each', async () => {
    const cms = await site();
    const agent = await signedIn(cms);

    const response = await publish(
      agent,
      `A friendly [one](${FRIENDLY}), a [quiet one](${QUIET}), a [broken one](${BROKEN}), ` +
        'and [one of my own](/2026/09/other/).',
    );
    assert.equal(response.status, 303, 'the post was published');
    await cms.webmentions.settled();

    assert.deepEqual(
      sent,
      [
        {
          endpoint: FRIENDLY_ENDPOINT,
          source: `${BASE_URL}/2026/03/hello-world/`,
          target: FRIENDLY,
          contentType: 'application/x-www-form-urlencoded',
        },
      ],
      'only the page that advertised an endpoint was told',
    );

    const outcomes = cms.admin.listSentWebmentions('hello-world');
    assert.deepEqual(
      outcomes.map((one) => [one.target, one.status]),
      [
        [BROKEN, 'failed'],
        [QUIET, 'none'],
        [FRIENDLY, 'sent'],
      ],
      'each link has an outcome, and the site’s own is not one of them',
    );
    assert.equal(outcomes[0]?.endpoint, BROKEN_ENDPOINT, 'the endpoint that refused is recorded');
    assert.ok((outcomes[0]?.error ?? '').includes('500'), 'and why it refused');
  });

  it('sends nothing for a full scan, however many links the archive holds', async () => {
    const cms = await site({ files: { 'posts/hello-world.md': linkingPost() } });
    await cms.webmentions.settled();

    assert.deepEqual(sent, [], 'booting over an archive announced none of it');
    assert.deepEqual(cms.admin.listSentWebmentions('hello-world'), []);
  });

  it('sends none at all when the setting is off', async () => {
    const cms = await site({ webmentionsSend: false });
    const agent = await signedIn(cms);

    await publish(agent, `A friendly [one](${FRIENDLY}).`);
    await cms.webmentions.settled();

    assert.deepEqual(sent, []);
    assert.deepEqual(cms.admin.listSentWebmentions('hello-world'), []);
  });
});

describe('sending a webmention for a reply', () => {
  it('tells the post it replies to, though the body links nowhere', async () => {
    const cms = await site();
    const agent = await signedIn(cms);

    const response = await publish(agent, 'Completely agree with this.', {
      'in-reply-to': FRIENDLY,
    });
    assert.equal(response.status, 303, 'the reply was published');
    await cms.webmentions.settled();

    assert.deepEqual(
      sent.map((one) => [one.source, one.target]),
      [[`${BASE_URL}/2026/03/hello-world/`, FRIENDLY]],
    );
    assert.deepEqual(
      cms.admin.listSentWebmentions('hello-world').map((one) => [one.target, one.status]),
      [[FRIENDLY, 'sent']],
      'recorded like any other target',
    );
  });

  it('tells it once when the body links to it as well', async () => {
    const cms = await site();
    const agent = await signedIn(cms);

    await publish(agent, `Agree with [this](${FRIENDLY}).`, { 'in-reply-to': FRIENDLY });
    await cms.webmentions.settled();

    assert.deepEqual(
      sent.map((one) => one.target),
      [FRIENDLY],
    );
  });

  it('sends nothing for a reply when the setting is off', async () => {
    const cms = await site({ webmentionsSend: false });
    const agent = await signedIn(cms);

    await publish(agent, 'Completely agree with this.', { 'in-reply-to': FRIENDLY });
    await cms.webmentions.settled();

    assert.deepEqual(sent, []);
  });
});

describe('sending them again', () => {
  it('sends a post’s links again from the file as it now reads', async () => {
    const cms = await site({ files: { 'posts/hello-world.md': linkingPost() } });
    await cms.webmentions.settled();

    const report = await cms.webmentions.send('hello-world');

    assert.ok(report !== undefined, 'the post was found');
    assert.equal(report.source, `${BASE_URL}/2026/03/hello-world/`);
    assert.deepEqual(
      sent.map((one) => one.target),
      [FRIENDLY],
      'the friendly page was told',
    );
    assert.deepEqual(
      report.sent.map((one) => [one.target, one.status]),
      [
        [FRIENDLY, 'sent'],
        [QUIET, 'none'],
        [BROKEN, 'failed'],
      ],
      'one outcome per link, in the order the post links to them',
    );
  });

  it('answers with nothing for a post that does not exist', async () => {
    const cms = await site();

    assert.equal(await cms.webmentions.send('nothing-here'), undefined);
  });

  it('moves the outcome for a target rather than adding a second one', async () => {
    const cms = await site({ files: { 'posts/hello-world.md': linkingPost() } });

    await cms.webmentions.send('hello-world');
    await cms.webmentions.send('hello-world');

    assert.equal(
      cms.admin.listSentWebmentions('hello-world').length,
      3,
      'still one row per target',
    );
  });
});
