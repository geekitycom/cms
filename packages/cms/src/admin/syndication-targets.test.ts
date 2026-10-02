/**
 * Posts > Syndication (TASK-218): the admin screen that reads and writes
 * `content/_data/syndicationTargets.json`.
 *
 * Everything goes through HTTP, because the questions are what the screen
 * shows, what a button writes into the file, and what the editor and Micropub
 * offer on the very next request.
 */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { issueTokens } from '../indieauth/tokens.ts';
import type { Cms } from '../index.ts';
import { findUser } from './accounts.ts';
import { browser, csrfField, FIRST_ADMIN, sandbox, signedIn } from './__testing__/harness.ts';
import type { Browser } from './__testing__/harness.ts';
import {
  ADD_SYNDICATION_TARGET_PATH,
  DELETE_SYNDICATION_TARGET_PATH,
  SYNDICATION_TARGET_FIELDS as FIELDS,
  SYNDICATION_TARGETS_PATH,
} from './syndication-targets.ts';

const box = sandbox();
after(() => box.cleanup());

const BASE = 'https://blog.example';
const NOW = new Date('2026-09-20T12:00:00.000Z');

const INDIENEWS = {
  id: 'indienews',
  name: 'IndieNews',
  url: 'https://news.indieweb.org/{lang}',
  tag: 'indienews',
  languages: ['en', 'de'],
};
const MASTODON = { id: 'mastodon', name: 'Mastodon', url: 'https://brid.gy/publish/mastodon' };

interface Site {
  cms: Cms;
  agent: Browser;
  contentDir: string;
}

/** A signed-in site whose targets file holds `targets` verbatim, or no file at all. */
async function site(targets?: string): Promise<Site> {
  const contentDir = await box.dir('geekity-syndication-admin-content-');
  await mkdir(path.join(contentDir, 'posts'), { recursive: true });
  await writeFile(
    path.join(contentDir, 'posts', '2026-01-01-post.md'),
    '---\ntitle: Post\ndate: 2026-01-01\npermalink: /2026/01/post/\n---\nHello.\n',
    'utf8',
  );
  if (targets !== undefined) {
    await mkdir(path.join(contentDir, '_data'), { recursive: true });
    await writeFile(path.join(contentDir, '_data', 'syndicationTargets.json'), targets, 'utf8');
  }
  const cms = await box.open({
    contentDir,
    dataDir: await box.dir('geekity-syndication-admin-data-'),
    baseUrl: BASE,
    now: () => NOW,
  });
  return { cms, agent: await signedIn(cms), contentDir };
}

function targetsFile(contentDir: string): string {
  return path.join(contentDir, '_data', 'syndicationTargets.json');
}

async function stored(contentDir: string): Promise<unknown> {
  return JSON.parse(await readFile(targetsFile(contentDir), 'utf8')) as unknown;
}

async function screen(agent: Browser): Promise<string> {
  const response = await agent.get(SYNDICATION_TARGETS_PATH);
  assert.equal(response.status, 200, 'the Syndication screen is there');
  return await response.text();
}

function unescape(value: string): string {
  return value
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
}

/** The hidden fields each entry's panel carries, in the order the screen draws them. */
function panels(html: string): { entry: string; was: string }[] {
  const entries = [...html.matchAll(/name="entry" value="([^"]*)"/g)].map((m) => m[1] ?? '');
  const was = [...html.matchAll(/name="was" value="([^"]*)"/g)].map((m) => unescape(m[1] ?? ''));
  // Each panel's Save and Remove forms both carry the pair, so keep one per entry.
  const pairs = new Map(entries.map((entry, index) => [entry, was[index] ?? '']));
  return [...pairs].map(([entry, held]) => ({ entry, was: held }));
}

/** The value of one text box on the screen, by its id. */
function boxValue(html: string, id: string): string | undefined {
  const match = new RegExp(`<input id="${id}"[^>]*value="([^"]*)"`).exec(html);
  return match?.[1] === undefined ? undefined : unescape(match[1]);
}

/** The error the form shows under one box, by the box's id. */
function fieldError(html: string, id: string): string | undefined {
  const match = new RegExp(`id="${id}-error">([^<]*)<`).exec(html);
  return match?.[1] === undefined ? undefined : unescape(match[1]);
}

/** Submit a form on the screen with its CSRF token. */
async function submit(
  agent: Browser,
  url: string,
  fields: Record<string, string>,
): Promise<Response> {
  const token = csrfField(await screen(agent));
  assert.ok(token !== undefined, 'the screen carried a CSRF token');
  return await agent.post(url, { csrf_token: token, ...fields });
}

/** What Micropub offers a client as `syndicate-to`, by uid. */
async function micropubOffers(cms: Cms): Promise<string[]> {
  const ada = findUser(cms.config.dataDir, FIRST_ADMIN.username);
  assert.ok(ada !== undefined, 'the first admin exists');
  const { accessToken } = await issueTokens(
    cms.config.dataDir,
    {
      clientId: 'https://app.example/',
      redirectUri: 'https://app.example/callback',
      codeChallenge: 'unused',
      userId: ada.id,
      me: `${BASE}/author/${ada.username}/`,
      scopes: ['create'],
    },
    NOW,
  );
  const response = await cms.app.request('/_geekity/micropub?q=syndicate-to', {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  assert.equal(response.status, 200);
  const body = (await response.json()) as { 'syndicate-to': { uid: string }[] };
  return body['syndicate-to'].map((target) => target.uid);
}

/** The ids the post editor offers a checkbox for. */
async function editorOffers(agent: Browser): Promise<string[]> {
  const response = await agent.get('/admin/posts/post');
  assert.equal(response.status, 200, 'the editor is there');
  const html = await response.text();
  return [...html.matchAll(/name="syndicate-to-([^"]+)" type="checkbox"/g)].map((m) => m[1] ?? '');
}

describe('the declared targets, listed and edited (AC #1)', () => {
  it('draws one panel per target, every field filled in as the file holds it', async () => {
    const { agent } = await site(JSON.stringify([INDIENEWS, MASTODON]));

    const html = await screen(agent);

    assert.equal(panels(html).length, 2, 'one panel per target');
    assert.equal(boxValue(html, 'target-0-id'), 'indienews');
    assert.equal(boxValue(html, 'target-0-name'), 'IndieNews');
    assert.equal(boxValue(html, 'target-0-url'), 'https://news.indieweb.org/{lang}');
    assert.equal(boxValue(html, 'target-0-tag'), 'indienews');
    assert.equal(boxValue(html, 'target-0-languages'), 'en, de');
    assert.equal(boxValue(html, 'target-1-id'), 'mastodon');
    assert.equal(boxValue(html, 'target-1-tag'), '', 'an absent tag is an empty box');
    assert.equal(boxValue(html, 'target-1-languages'), '');
  });

  it('adds a target, creating the file when the site had none', async () => {
    const { agent, contentDir } = await site();

    const response = await submit(agent, ADD_SYNDICATION_TARGET_PATH, {
      [FIELDS.id]: 'indienews',
      [FIELDS.name]: 'IndieNews',
      [FIELDS.url]: 'https://news.indieweb.org/{lang}',
      [FIELDS.tag]: 'indienews',
      [FIELDS.languages]: 'en, DE',
    });

    assert.equal(response.status, 303);
    assert.equal(response.headers.get('location'), SYNDICATION_TARGETS_PATH);
    assert.deepEqual(await stored(contentDir), [INDIENEWS]);
    assert.match(await screen(agent), /IndieNews/, 'the screen says what was added');
  });

  it('edits one target in place, renaming its id, and leaves the others and unknown keys alone', async () => {
    const { agent, contentDir } = await site(
      JSON.stringify([{ ...MASTODON, note: 'kept' }, INDIENEWS]),
    );
    const [first] = panels(await screen(agent));
    assert.ok(first !== undefined);

    const response = await submit(agent, SYNDICATION_TARGETS_PATH, {
      [FIELDS.entry]: first.entry,
      [FIELDS.was]: first.was,
      [FIELDS.id]: 'bluesky',
      [FIELDS.name]: 'Bluesky',
      [FIELDS.url]: 'https://brid.gy/publish/bluesky',
      [FIELDS.tag]: '',
      [FIELDS.languages]: '',
    });

    assert.equal(response.status, 303);
    assert.deepEqual(await stored(contentDir), [
      { id: 'bluesky', name: 'Bluesky', url: 'https://brid.gy/publish/bluesky', note: 'kept' },
      INDIENEWS,
    ]);
  });

  it('removes one target and keeps the rest', async () => {
    const { agent, contentDir } = await site(JSON.stringify([INDIENEWS, MASTODON]));
    const [first] = panels(await screen(agent));
    assert.ok(first !== undefined);

    const response = await submit(agent, DELETE_SYNDICATION_TARGET_PATH, {
      [FIELDS.entry]: first.entry,
      [FIELDS.was]: first.was,
    });

    assert.equal(response.status, 303);
    assert.deepEqual(await stored(contentDir), [MASTODON]);
  });

  it('refuses a save or a delete against an entry that changed since the page was drawn', async () => {
    const { agent, contentDir } = await site(JSON.stringify([INDIENEWS, MASTODON]));
    const [first] = panels(await screen(agent));
    assert.ok(first !== undefined);
    const changed = JSON.stringify([MASTODON, INDIENEWS]);
    await writeFile(targetsFile(contentDir), changed, 'utf8');

    const remove = await submit(agent, DELETE_SYNDICATION_TARGET_PATH, {
      [FIELDS.entry]: first.entry,
      [FIELDS.was]: first.was,
    });
    const save = await submit(agent, SYNDICATION_TARGETS_PATH, {
      [FIELDS.entry]: first.entry,
      [FIELDS.was]: first.was,
      [FIELDS.id]: 'indienews',
      [FIELDS.name]: 'Renamed',
      [FIELDS.url]: 'https://news.indieweb.org/en',
    });

    assert.equal(remove.status, 303);
    assert.equal(save.status, 303);
    assert.equal(
      await readFile(targetsFile(contentDir), 'utf8'),
      changed,
      'neither touched the file',
    );
    assert.match(await screen(agent), /changed since/, 'the screen says why');
  });
});

describe('a save checked by the rules the file is read by (AC #2)', () => {
  it('marks every bad field on the form and leaves the file as it was', async () => {
    const original = JSON.stringify([MASTODON]);
    const { agent, contentDir } = await site(original);

    const response = await submit(agent, ADD_SYNDICATION_TARGET_PATH, {
      [FIELDS.id]: 'has space',
      [FIELDS.name]: ' ',
      [FIELDS.url]: 'ftp://news.example/',
      [FIELDS.tag]: '',
      [FIELDS.languages]: 'de, not a tag!',
    });

    assert.equal(response.status, 400);
    const html = await response.text();
    assert.match(fieldError(html, 'target-new-id') ?? '', /letters, digits/);
    assert.match(fieldError(html, 'target-new-name') ?? '', /name/);
    assert.match(fieldError(html, 'target-new-url') ?? '', /http or https/);
    assert.match(fieldError(html, 'target-new-languages') ?? '', /language tags/);
    assert.equal(boxValue(html, 'target-new-url'), 'ftp://news.example/', 'what was typed stays');
    assert.equal(
      await readFile(targetsFile(contentDir), 'utf8'),
      original,
      'the file is unchanged',
    );
  });

  it('refuses an id another target already has, on add and on edit', async () => {
    const original = JSON.stringify([INDIENEWS, MASTODON]);
    const { agent, contentDir } = await site(original);
    const [, second] = panels(await screen(agent));
    assert.ok(second !== undefined);

    const add = await submit(agent, ADD_SYNDICATION_TARGET_PATH, {
      [FIELDS.id]: 'mastodon',
      [FIELDS.name]: 'Again',
      [FIELDS.url]: 'https://a.example/',
    });
    const edit = await submit(agent, SYNDICATION_TARGETS_PATH, {
      [FIELDS.entry]: second.entry,
      [FIELDS.was]: second.was,
      [FIELDS.id]: 'indienews',
      [FIELDS.name]: 'Mastodon',
      [FIELDS.url]: 'https://brid.gy/publish/mastodon',
    });

    assert.equal(add.status, 400);
    assert.match(fieldError(await add.text(), 'target-new-id') ?? '', /already has the id/);
    assert.equal(edit.status, 400);
    assert.match(fieldError(await edit.text(), 'target-1-id') ?? '', /already has the id/);
    assert.equal(await readFile(targetsFile(contentDir), 'utf8'), original);
  });

  it('keeps a target its own id on edit', async () => {
    const { agent, contentDir } = await site(JSON.stringify([MASTODON]));
    const [first] = panels(await screen(agent));
    assert.ok(first !== undefined);

    const response = await submit(agent, SYNDICATION_TARGETS_PATH, {
      [FIELDS.entry]: first.entry,
      [FIELDS.was]: first.was,
      [FIELDS.id]: 'mastodon',
      [FIELDS.name]: 'Mastodon via Bridgy',
      [FIELDS.url]: MASTODON.url,
    });

    assert.equal(response.status, 303);
    assert.deepEqual(await stored(contentDir), [{ ...MASTODON, name: 'Mastodon via Bridgy' }]);
  });
});

describe('a save offered at once (AC #3)', () => {
  it('shows a new target in the editor and in Micropub q=syndicate-to on the next request', async () => {
    const { cms, agent } = await site(JSON.stringify([MASTODON]));
    assert.deepEqual(await editorOffers(agent), ['mastodon']);
    assert.deepEqual(await micropubOffers(cms), ['mastodon']);

    await submit(agent, ADD_SYNDICATION_TARGET_PATH, {
      [FIELDS.id]: 'indienews',
      [FIELDS.name]: 'IndieNews',
      [FIELDS.url]: 'https://news.indieweb.org/en',
    });

    assert.deepEqual(await editorOffers(agent), ['mastodon', 'indienews']);
    assert.deepEqual(await micropubOffers(cms), ['mastodon', 'indienews']);
  });

  it('writes a JSON list a person can read, ending in a newline', async () => {
    const { agent, contentDir } = await site();

    await submit(agent, ADD_SYNDICATION_TARGET_PATH, {
      [FIELDS.id]: 'mastodon',
      [FIELDS.name]: 'Mastodon',
      [FIELDS.url]: MASTODON.url,
    });

    assert.equal(
      await readFile(targetsFile(contentDir), 'utf8'),
      `${JSON.stringify([MASTODON], null, 2)}\n`,
    );
  });
});

describe('what is wrong with the file, shown on the screen (AC #4)', () => {
  it('draws an entry that does not parse with its problem, and lets it be fixed or removed', async () => {
    const { agent, contentDir } = await site(
      JSON.stringify([
        { id: 'broken', name: 'Broken', url: 'ftp://x.example/' },
        MASTODON,
        MASTODON,
      ]),
    );

    const html = await screen(agent);
    assert.match(html, /http or https/, 'the bad url is explained');
    assert.match(html, /already has the id/, 'the repeated id is explained');
    assert.equal(
      boxValue(html, 'target-0-url'),
      'ftp://x.example/',
      'what the file holds is shown',
    );

    const [first] = panels(html);
    assert.ok(first !== undefined);
    const response = await submit(agent, SYNDICATION_TARGETS_PATH, {
      [FIELDS.entry]: first.entry,
      [FIELDS.was]: first.was,
      [FIELDS.id]: 'broken',
      [FIELDS.name]: 'Broken',
      [FIELDS.url]: 'https://x.example/',
    });
    assert.equal(response.status, 303);
    assert.deepEqual(await stored(contentDir), [
      { id: 'broken', name: 'Broken', url: 'https://x.example/' },
      MASTODON,
      MASTODON,
    ]);

    const third = panels(await screen(agent))[2];
    assert.ok(third !== undefined);
    await submit(agent, DELETE_SYNDICATION_TARGET_PATH, {
      [FIELDS.entry]: third.entry,
      [FIELDS.was]: third.was,
    });
    assert.deepEqual(await stored(contentDir), [
      { id: 'broken', name: 'Broken', url: 'https://x.example/' },
      MASTODON,
    ]);
  });

  it('shows a file that is not a JSON list and never overwrites it', async () => {
    const original = '{"targets": [';
    const { agent, contentDir } = await site(original);

    assert.match(await screen(agent), /is not valid JSON/);

    const response = await submit(agent, ADD_SYNDICATION_TARGET_PATH, {
      [FIELDS.id]: 'mastodon',
      [FIELDS.name]: 'Mastodon',
      [FIELDS.url]: MASTODON.url,
    });
    assert.equal(response.status, 303);
    assert.equal(await readFile(targetsFile(contentDir), 'utf8'), original);
  });
});

describe('who may reach the screen (AC #5)', () => {
  it('sends somebody who is not signed in to the login form, and writes nothing for them', async () => {
    const original = JSON.stringify([MASTODON]);
    const { cms, contentDir } = await site(original);
    const stranger = browser(cms);

    const page = await stranger.get(SYNDICATION_TARGETS_PATH);
    assert.equal(page.status, 302);
    assert.match(page.headers.get('location') ?? '', /^\/admin\/login/);

    const post = await stranger.post(ADD_SYNDICATION_TARGET_PATH, {
      [FIELDS.id]: 'indienews',
      [FIELDS.name]: 'IndieNews',
      [FIELDS.url]: 'https://news.indieweb.org/en',
    });
    assert.equal(post.status, 302);
    assert.match(post.headers.get('location') ?? '', /^\/admin\/login/);
    assert.equal(await readFile(targetsFile(contentDir), 'utf8'), original);
  });

  it('refuses a signed-in save that carries no CSRF token, as every admin form does', async () => {
    const original = JSON.stringify([MASTODON]);
    const { agent, contentDir } = await site(original);

    const post = await agent.post(ADD_SYNDICATION_TARGET_PATH, {
      [FIELDS.id]: 'indienews',
      [FIELDS.name]: 'IndieNews',
      [FIELDS.url]: 'https://news.indieweb.org/en',
    });

    assert.equal(post.status, 403);
    assert.equal(await readFile(targetsFile(contentDir), 'utf8'), original);
  });
});

describe('where the screen is (AC #6)', () => {
  it('is a child of Posts in the admin menu, marked current on its own page', async () => {
    const { agent } = await site();

    const posts = await (await agent.get('/admin/posts')).text();
    assert.match(posts, new RegExp(`href="${SYNDICATION_TARGETS_PATH}">Syndication<`));
    assert.match(
      await screen(agent),
      new RegExp(`href="${SYNDICATION_TARGETS_PATH}"[^>]*aria-current="page"`),
    );
  });
});
