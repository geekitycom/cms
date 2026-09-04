import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, beforeEach, describe, it } from 'node:test';

import { addComment } from '../comments/records.ts';
import { writeAkismetKey } from '../comments/akismet.ts';
import type { Cms, GeekityConfig } from '../index.ts';
import { csrfField, sandbox, signedIn } from './__testing__/harness.ts';
import type { Browser } from './__testing__/harness.ts';
import {
  AKISMET_FIELDS,
  AKISMET_PATH,
  AKISMET_REMOVE,
  DEFAULT_SITE_SETTINGS,
  SETTINGS_PATH,
  writeSiteJson,
} from './settings.ts';
import { COMMENT_ADMIN_FIELDS, COMMENTS_MODERATE_PATH, COMMENTS_PATH } from './comments.ts';

/**
 * The Akismet key on the settings screen, and the corrections the moderation
 * screen sends.
 *
 * Akismet is a stub here, as it is everywhere else: what is under test is that
 * the key is checked before it is stored, that it lands in `data/` at 0600 and
 * nowhere near `site.json`, and that the screen says which of the three states
 * the site is in.
 */

const box = sandbox();

/** Every call the stubbed Akismet saw. */
interface AkismetCall {
  method: string;
  fields: Record<string, string>;
}

let akismet: AkismetCall[] = [];
/** What the stub answers with, keyed by the method asked. */
let answers: Record<string, { body: string; status?: number }> = {};

const restoreFetch = stubAkismet();

after(async () => {
  restoreFetch();
  await box.cleanup();
});

beforeEach(() => {
  akismet = [];
  answers = {};
});

function stubAkismet(): () => void {
  const original = globalThis.fetch;

  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith('https://rest.akismet.com/')) {
      return Promise.resolve(new Response('missing', { status: 404 }));
    }

    const method = url.slice(url.lastIndexOf('/') + 1);
    const body = init?.body;
    const fields: Record<string, string> = {};
    for (const [name, value] of new URLSearchParams(
      typeof body === 'string' ? body : '',
    ).entries()) {
      fields[name] = value;
    }
    akismet.push({ method, fields });

    const answer = answers[method];
    // No answer registered is a machine that cannot reach Akismet at all.
    if (answer === undefined) return Promise.reject(new TypeError('fetch failed'));
    return Promise.resolve(new Response(answer.body, { status: answer.status ?? 200 }));
  }) as typeof fetch;

  return () => {
    globalThis.fetch = original;
  };
}

const POST = `---
title: Hello world
date: '2026-09-02T09:00:00Z'
permalink: /2026/09/hello-world/
---

Words.
`;

const NOW = new Date('2026-09-03T12:00:00.000Z');

/** A signed-in admin over a site with one post. */
async function admin(config: GeekityConfig = {}): Promise<{
  cms: Cms;
  agent: Browser;
  contentDir: string;
  dataDir: string;
}> {
  const contentDir = await box.dir('geekity-akismet-admin-content-');
  const dataDir = await box.dir('geekity-akismet-admin-data-');
  await mkdir(path.join(contentDir, 'posts'), { recursive: true });
  await writeFile(path.join(contentDir, 'posts/2026-09-02-hello-world.md'), POST, 'utf8');
  // So there is a settings file for the key to be provably absent from.
  await writeSiteJson({
    contentDir,
    settings: { ...DEFAULT_SITE_SETTINGS, baseUrl: 'https://blog.example' },
  });

  const cms = await box.open({
    contentDir,
    dataDir,
    baseUrl: 'https://blog.example',
    now: () => NOW,
    ...config,
  });
  return { cms, agent: await signedIn(cms), contentDir, dataDir };
}

/** Submit the Akismet form on the settings screen. */
async function saveKey(
  agent: Browser,
  fields: Record<string, string>,
): Promise<{ response: Response; screen: string }> {
  const token = csrfField(await (await agent.get(SETTINGS_PATH)).text());
  assert.ok(token !== undefined, 'the settings screen carried a CSRF token');

  const response = await agent.post(AKISMET_PATH, { csrf_token: token, ...fields });
  return { response, screen: await (await agent.get(SETTINGS_PATH)).text() };
}

/** `data/akismet.json` as it stands, or `undefined` when there is none. */
function keyFile(dataDir: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(readFileSync(path.join(dataDir, 'akismet.json'), 'utf8')) as Record<
      string,
      unknown
    >;
  } catch {
    return undefined;
  }
}

describe('the Akismet key on the settings screen', () => {
  it('says the site has no key until one is saved (AC #5)', async () => {
    const { agent } = await admin();

    const html = await (await agent.get(SETTINGS_PATH)).text();
    assert.match(html, /Akismet/);
    assert.match(html, /not connected|no key/i);
  });

  it('checks a key with verify-key and stores it under data/ (AC #5)', async () => {
    answers['verify-key'] = { body: 'valid' };
    const { agent, dataDir, contentDir } = await admin();

    const { response, screen } = await saveKey(agent, { [AKISMET_FIELDS.key]: ' the-key ' });

    assert.equal(response.status, 303);
    assert.equal(akismet.length, 1);
    assert.equal(akismet[0]?.method, 'verify-key');
    assert.equal(akismet[0]?.fields['api_key'], 'the-key', 'the key is trimmed before it is sent');
    assert.equal(akismet[0]?.fields['blog'], 'https://blog.example');

    const stored = keyFile(dataDir);
    assert.equal(stored?.['key'], 'the-key');
    assert.equal(stored?.['status'], 'valid');
    assert.equal(
      statSync(path.join(dataDir, 'akismet.json')).mode & 0o777,
      0o600,
      'the key is readable only by the account the site runs as',
    );

    const site = await readFile(path.join(contentDir, '_data', 'site.json'), 'utf8');
    assert.ok(!site.includes('the-key'), 'and it is nowhere in the public settings file');
    assert.ok(!site.toLowerCase().includes('akismet'));

    assert.match(screen, /Connected/);
    assert.ok(!screen.includes('the-key'), 'the screen never prints the key back');
  });

  it('stores a key Akismet refuses and says so (AC #5)', async () => {
    answers['verify-key'] = { body: 'invalid' };
    const { agent, dataDir } = await admin();

    const { screen } = await saveKey(agent, { [AKISMET_FIELDS.key]: 'wrong' });

    assert.equal(keyFile(dataDir)?.['status'], 'invalid');
    assert.match(screen, /Akismet does not recognise|not recognise/i);
  });

  it('keeps a key it could not check and says that instead (AC #4, #5)', async () => {
    // No answer registered, so the stub throws the way an offline machine does.
    const { agent, dataDir } = await admin();

    const { screen } = await saveKey(agent, { [AKISMET_FIELDS.key]: 'unknowable' });

    assert.equal(keyFile(dataDir)?.['status'], 'unchecked');
    assert.match(screen, /could not be reached/i);
  });

  it('takes the key away again when asked (AC #5)', async () => {
    answers['verify-key'] = { body: 'valid' };
    const { agent, dataDir } = await admin();

    await saveKey(agent, { [AKISMET_FIELDS.key]: 'the-key' });
    assert.ok(keyFile(dataDir) !== undefined);

    const { screen } = await saveKey(agent, { [AKISMET_FIELDS.action]: AKISMET_REMOVE });

    assert.equal(keyFile(dataDir), undefined, 'the file is gone');
    assert.match(screen, /not connected|no key/i);
  });

  it('refuses an empty key rather than storing one (AC #5)', async () => {
    const { agent, dataDir } = await admin();

    const { screen } = await saveKey(agent, { [AKISMET_FIELDS.key]: '   ' });

    assert.equal(keyFile(dataDir), undefined);
    assert.deepEqual(akismet, [], 'nothing was asked of Akismet');
    assert.match(screen, /key/i);
  });

  it('starts filtering the next comment without a restart (AC #5)', async () => {
    answers['verify-key'] = { body: 'valid' };
    answers['comment-check'] = { body: 'true' };
    const { cms, agent, contentDir } = await admin();

    await saveKey(agent, { [AKISMET_FIELDS.key]: 'the-key' });
    akismet = [];

    await addComment(
      { admin: cms.admin, contentDir },
      {
        slug: 'hello-world',
        permalink: '/2026/09/hello-world/',
        source: 'comment',
        kind: 'reply',
        status: 'pending',
        author: { name: 'Ada', url: null, email: 'ada@example.com', avatar: null },
        content: { markdown: 'Buy pills.', html: '<p>Buy pills.</p>' },
        submitted: '2026-09-03T10:00:00.000Z',
        addressHash: null,
        inReplyTo: null,
        url: null,
      },
    );

    // The checker the running CMS holds reads the key file per call, so the
    // key saved a moment ago is the one it uses.
    const verdict = await cms.config.commentChecker?.check({
      comment: {
        slug: 'hello-world',
        permalink: '/2026/09/hello-world/',
        source: 'comment',
        kind: 'reply',
        status: 'pending',
        author: { name: 'Ada', url: null, email: null, avatar: null },
        content: { markdown: 'Buy pills.', html: '<p>Buy pills.</p>' },
        submitted: '2026-09-03T10:00:00.000Z',
        addressHash: null,
        inReplyTo: null,
        url: null,
      },
      post: {
        slug: 'hello-world',
        title: 'Hello world',
        url: 'https://blog.example/2026/09/hello-world/',
      },
      address: '203.0.113.9',
      userAgent: 'a browser',
      referrer: undefined,
      baseUrl: 'https://blog.example',
    });

    assert.equal(verdict, 'spam');
    assert.equal(akismet[0]?.fields['api_key'], 'the-key');
  });
});

describe('the corrections the moderation screen sends', () => {
  /** One stored comment on the post, at `status`. */
  async function comment(cms: Cms, status: 'pending' | 'approved' | 'spam'): Promise<string> {
    const written = await addComment(
      { admin: cms.admin, contentDir: cms.config.contentDir },
      {
        slug: 'hello-world',
        permalink: '/2026/09/hello-world/',
        source: 'comment',
        kind: 'reply',
        status,
        author: { name: 'Ada Lovelace', url: null, email: 'ada@example.com', avatar: null },
        content: { markdown: 'Buy pills.', html: '<p>Buy pills.</p>' },
        submitted: '2026-09-03T10:00:00.000Z',
        addressHash: 'deadbeef',
        inReplyTo: null,
        url: null,
      },
    );
    return written.id;
  }

  /** Press one of the row's buttons. */
  async function moderate(agent: Browser, id: string, action: string): Promise<void> {
    const token = csrfField(await (await agent.get(COMMENTS_PATH)).text());
    assert.ok(token !== undefined);

    const response = await agent.post(COMMENTS_MODERATE_PATH, {
      csrf_token: token,
      [COMMENT_ADMIN_FIELDS.id]: id,
      [COMMENT_ADMIN_FIELDS.action]: action,
      [COMMENT_ADMIN_FIELDS.status]: 'pending',
    });
    assert.equal(response.status, 303);
  }

  it('tells Akismet about a comment a moderator files as spam (AC #3)', async () => {
    answers['submit-spam'] = { body: 'Thanks for making the web a better place.' };
    const { cms, agent, dataDir } = await admin();
    await writeAkismetKey(dataDir, {
      key: 'the-key',
      status: 'valid',
      checkedAt: '2026-09-01T00:00:00.000Z',
    });

    await moderate(agent, await comment(cms, 'pending'), 'spam');

    assert.equal(akismet.length, 1);
    assert.equal(akismet[0]?.method, 'submit-spam');
    assert.equal(akismet[0]?.fields['api_key'], 'the-key');
    assert.equal(akismet[0]?.fields['comment_author'], 'Ada Lovelace');
    assert.equal(akismet[0]?.fields['comment_content'], 'Buy pills.');
    assert.equal(akismet[0]?.fields['permalink'], 'https://blog.example/2026/09/hello-world/');
  });

  it('tells it about one let out of the spam list (AC #3)', async () => {
    answers['submit-ham'] = { body: 'Thanks for making the web a better place.' };
    const { cms, agent, dataDir } = await admin();
    await writeAkismetKey(dataDir, {
      key: 'the-key',
      status: 'valid',
      checkedAt: '2026-09-01T00:00:00.000Z',
    });

    await moderate(agent, await comment(cms, 'spam'), 'approve');

    assert.equal(akismet.length, 1);
    assert.equal(akismet[0]?.method, 'submit-ham');
    assert.equal(akismet[0]?.fields['comment_content'], 'Buy pills.');
  });

  it('says nothing when the site has no key (AC #3)', async () => {
    const { cms, agent } = await admin();

    await moderate(agent, await comment(cms, 'pending'), 'spam');

    assert.deepEqual(akismet, []);
  });
});
