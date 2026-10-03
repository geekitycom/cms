import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { tiedErrors } from '../__testing__/form-errors.ts';
import { csrfField, sandbox, signedIn } from './__testing__/harness.ts';
import type { Browser } from './__testing__/harness.ts';
import { blankForm, POST_KIND } from './documents.ts';
import { openGroups } from './editor-layout.ts';

/**
 * TASK-245: every block of the editor and every group of its side column is a
 * native disclosure, open when something in it is filled in or refused and
 * closed when it is empty, so nothing typed is ever out of sight.
 */

const box = sandbox();
after(() => box.cleanup());

const MP3 = new Uint8Array([0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x09]);

async function site(): Promise<Browser> {
  const contentDir = await box.dir('geekity-editor-layout-');
  const uploads = path.join(contentDir, 'uploads', '2026', '10');
  await mkdir(uploads, { recursive: true });
  await writeFile(path.join(uploads, 'episode.mp3'), MP3);
  await writeFile(path.join(uploads, 'episode.mp4'), new Uint8Array(32));
  await mkdir(path.join(contentDir, '_data'), { recursive: true });
  await writeFile(
    path.join(contentDir, '_data', 'syndicationTargets.json'),
    JSON.stringify([{ id: 'mastodon', name: 'Mastodon', url: 'https://brid.gy/publish/mastodon' }]),
  );
  return signedIn(await box.site({ contentDir }));
}

interface Disclosure {
  name: string;
  open: boolean;
  start: number;
  end: number;
}

/** Every `<details>` on the page, in document order, with where it starts and ends. */
function disclosures(html: string): Disclosure[] {
  const found: Disclosure[] = [];
  const stack: Disclosure[] = [];
  for (const match of html.matchAll(/<details\b([^>]*)>|<\/details>/g)) {
    const at = match.index;
    if (match[0] === '</details>') {
      const closed = stack.pop();
      assert.ok(closed !== undefined, 'every </details> closes one that was opened');
      closed.end = at;
      continue;
    }
    const summary = /^\s*<summary\b[^>]*>([\s\S]*?)<\/summary>/.exec(
      html.slice(at + match[0].length),
    );
    assert.ok(
      summary !== undefined && summary !== null,
      `a summary leads each details: ${match[0]}`,
    );
    const disclosure = {
      name: (summary[1] ?? '').replaceAll(/<[^>]*>/g, '').trim(),
      open: /\sopen\b/.test(match[1] ?? ''),
      start: at,
      end: html.length,
    };
    found.push(disclosure);
    stack.push(disclosure);
  }
  assert.equal(stack.length, 0, 'every details is closed');
  return found;
}

function states(html: string): [string, boolean][] {
  return disclosures(html).map(({ name, open }) => [name, open]);
}

/** The disclosures around the element with this id, outermost first. */
function around(html: string, id: string): Disclosure[] {
  const at = html.indexOf(` id="${id}"`);
  assert.ok(at !== -1, `${id} is on the page`);
  return disclosures(html).filter(({ start, end }) => start < at && at < end);
}

async function editor(agent: Browser, url: string): Promise<string> {
  return (await agent.get(url)).text();
}

async function save(
  agent: Browser,
  url: string,
  fields: Record<string, string>,
): Promise<Response> {
  const token = csrfField(await editor(agent, url));
  assert.ok(token !== undefined, `${url} carried a CSRF token`);
  return agent.post(url, { csrf_token: token, action: 'publish', ...fields });
}

const FILLED = {
  title: 'Everything',
  slug: 'everything',
  date: '2026-10-02 09:00',
  tags: 'one',
  body: 'Every box.',
  'photo-url-0': 'https://example.com/a.jpg',
  'photo-alt-0': 'A photo',
  'location-name': 'The pier',
  'enclosure-url': '/uploads/2026/10/episode.mp3',
  'alternate-url-0': '/uploads/2026/10/episode.mp4',
  'in-reply-to': 'https://example.com/a-post/',
  'read-status': 'finished',
  'read-of-name': 'A book',
  lang: 'fr',
  'syndicate-to-mastodon': '1',
  comments: 'closed',
};

describe('the post editor’s disclosures (TASK-245)', () => {
  it('folds every empty block and group of a new post, leaving Publishing and Tags open', async () => {
    const agent = await site();

    assert.deepEqual(states(await editor(agent, '/admin/posts/new')), [
      ['Photos', false],
      ['Add a photo', false],
      ['Location', false],
      ['Recording', false],
      ['Other versions', false],
      ['Add a version', false],
      ['Publishing', true],
      ['Tags and categories', true],
      ['Address', false],
      ['Responding to', false],
      ['Read', false],
      ['Summary and language', false],
      ['Syndicate to', false],
      ['Display and discussion', false],
    ]);
  });

  it('shows a page only the groups that apply to it', async () => {
    const agent = await site();

    assert.deepEqual(states(await editor(agent, '/admin/pages/new')), [
      ['Publishing', true],
      ['Address', false],
      ['Summary and language', false],
      ['Display and discussion', false],
    ]);
  });

  it('opens every block and group a saved post fills in, and keeps the blank rows folded', async () => {
    const agent = await site();
    const saved = await save(agent, '/admin/posts/new', FILLED);
    assert.equal(saved.status, 303, 'the filled post saved');

    assert.deepEqual(states(await editor(agent, '/admin/posts/everything')), [
      ['Photos', true],
      ['Photo 1', true],
      ['Add a photo', false],
      ['Location', true],
      ['Recording', true],
      ['Other versions', true],
      ['Version 1', true],
      ['Add a version', false],
      ['Publishing', true],
      ['Tags and categories', true],
      ['Address', true],
      ['Responding to', true],
      ['Read', true],
      ['Summary and language', true],
      ['Syndicate to', true],
      ['Display and discussion', true],
    ]);
  });

  const REFUSALS: { what: string; fields: Record<string, string>; field: string }[] = [
    { what: 'a language', fields: { lang: 'not a tag!' }, field: 'editor-lang' },
    { what: 'a citation', fields: { 'like-of': 'nowhere' }, field: 'editor-like-of' },
    {
      what: 'an accuracy',
      fields: { 'location-accuracy': '-1' },
      field: 'editor-location-accuracy',
    },
    { what: 'a read', fields: { 'read-status': 'finished' }, field: 'editor-read-of-name' },
    { what: 'a photo', fields: { 'photo-url-0': 'nowhere' }, field: 'editor-photo-url-0' },
    {
      what: 'a duration',
      fields: { 'enclosure-url': '/uploads/2026/10/episode.mp3', 'enclosure-duration': 'long' },
      field: 'editor-enclosure-duration',
    },
    {
      what: 'a version',
      fields: {
        'enclosure-url': '/uploads/2026/10/episode.mp3',
        'alternate-url-0': '/uploads/2026/10/episode.mp4',
        'alternate-height-0': 'tall',
      },
      field: 'editor-alternate-height-0',
    },
    { what: 'a date', fields: { date: 'yesterday' }, field: 'editor-date' },
    {
      what: 'a described read',
      fields: { 'read-status': 'finished', 'read-of-name': 'A book', description: 'Read it.' },
      field: 'editor-description',
    },
  ];

  for (const refusal of REFUSALS) {
    it(`refuses ${refusal.what} with its box open and linked from the summary`, async () => {
      const agent = await site();

      const response = await save(agent, '/admin/posts/new', {
        title: 'Refused',
        body: 'Body.',
        ...refusal.fields,
      });

      assert.equal(response.status, 400);
      const html = await response.text();
      assert.deepEqual(tiedErrors(html).links, [refusal.field]);
      const enclosing = around(html, refusal.field);
      assert.ok(enclosing.length > 0, `${refusal.field} is in a disclosure`);
      assert.deepEqual(
        enclosing.filter(({ open }) => !open).map(({ name }) => name),
        [],
        `every disclosure around ${refusal.field} is open`,
      );
    });
  }

  it('links a page refused for its title to the title', async () => {
    const agent = await site();

    const response = await save(agent, '/admin/pages/new', { title: '', body: 'Body.' });

    assert.equal(response.status, 400);
    assert.deepEqual(tiedErrors(await response.text()).links, ['editor-title']);
  });

  it('names a post that is not a read a post that is not a read', async () => {
    const agent = await site();

    assert.match(
      await editor(agent, '/admin/posts/new'),
      /<option value="" selected>Not a read post<\/option>/,
    );
  });
});

describe('which groups start open (TASK-245)', () => {
  it('opens an empty group that holds the box a save was refused for, and only that one', () => {
    const blank = openGroups(blankForm(POST_KIND), undefined);
    const refused = openGroups(blankForm(POST_KIND), 'editor-like-of');

    assert.equal(blank.responding, false);
    assert.equal(refused.responding, true);
    assert.deepEqual({ ...refused, responding: false }, blank, 'no other group moves');
  });
});
