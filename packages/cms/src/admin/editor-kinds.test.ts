import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { pngWithMetadata } from '../__testing__/metadata.ts';
import { remoteHostsDoNotExist } from '../__testing__/offline.ts';
import { fieldsOf } from './__testing__/editor-form.ts';
import { csrfField, sandbox, signedIn } from './__testing__/harness.ts';
import type { Browser } from './__testing__/harness.ts';
import { screenOf, text } from './__testing__/markup.ts';

const box = sandbox();
remoteHostsDoNotExist();
after(() => box.cleanup());

const REPLY_WITH_PHOTOS = [
  '---',
  'title: Mixed',
  "date: '2026-10-02T09:00:00Z'",
  'permalink: /2026/10/mixed/',
  'in-reply-to: https://example.com/a-post',
  'photo:',
  '  - url: /uploads/2026/10/harbor.png',
  '    alt: The harbor',
  'rsvp: maybe',
  'item:',
  '  kind: book',
  '  name: Piranesi',
  '  by: Susanna Clarke',
  'rating: 4',
  'start: 2026-11-05T18:30:00Z',
  'custom: kept',
  '---',
  '',
  'Sounds good.',
  '',
].join('\n');

async function site(): Promise<{ agent: Browser; contentDir: string }> {
  const contentDir = await box.dir('geekity-editor-kinds-');
  await mkdir(path.join(contentDir, 'uploads', '2026', '10'), { recursive: true });
  await writeFile(
    path.join(contentDir, 'uploads', '2026', '10', 'harbor.png'),
    await pngWithMetadata(),
  );
  await writeFile(
    path.join(contentDir, 'uploads', '2026', '10', 'garden.png'),
    await pngWithMetadata(),
  );
  await mkdir(path.join(contentDir, 'posts'), { recursive: true });
  await writeFile(path.join(contentDir, 'posts', '2026-10-02-mixed.md'), REPLY_WITH_PHOTOS);
  await writeFile(
    path.join(contentDir, 'posts', '2026-10-03-a-reply.md'),
    "---\ntitle: ''\ndate: '2026-10-03T09:00:00Z'\npermalink: /2026/10/a-reply/\nin-reply-to: https://example.com/other\n---\n\nYes.\n",
  );
  await writeFile(
    path.join(contentDir, 'posts', '2026-10-04-meetup.md'),
    "---\ntitle: Meetup\ndate: '2026-10-04T09:00:00Z'\npermalink: /2026/10/meetup/\nstart: 2026-11-05T18:30:00Z\n---\n\nCome along.\n",
  );
  const agent = await signedIn(await box.site({ contentDir }));
  return { agent, contentDir };
}

const { agent, contentDir } = await site();

async function html(url: string): Promise<string> {
  const response = await agent.get(url);
  assert.equal(response.status, 200, url);
  return response.text();
}

function names(page: string): string[] {
  return fieldsOf(page).map(([name]) => name);
}

/** The values of a form's hidden `kind` field. */
function kindOf(page: string): string | undefined {
  return /<input type="hidden" name="kind" value="([^"]*)"/.exec(page)?.[1];
}

describe('the kind chooser', () => {
  it('lists every kind with a line about it, each opening its own form', async () => {
    const page = screenOf(await html('/admin/posts/new'));
    assert.match(page, /What are you posting\?/);
    const cards = [
      ...page.matchAll(
        /<a\b[^>]*href="([^"]+)"[^>]*>[\s\S]*?<h2\b[^>]*>([^<]+)<\/h2>\s*<p\b[^>]*>([^<]+)<\/p>/g,
      ),
    ].map(([, href, name, blurb]) => [href, (name ?? '').trim(), (blurb ?? '').trim() !== '']);
    assert.deepEqual(cards, [
      ['/admin/posts/new?kind=note', 'Note', true],
      ['/admin/posts/new?kind=photo', 'Photo', true],
      ['/admin/posts/new?kind=link', 'Link', true],
      ['/admin/posts/new?kind=rsvp', 'RSVP', true],
      ['/admin/posts/new?kind=event', 'Event', true],
      ['/admin/posts/new?kind=checkin', 'Check-in', true],
      ['/admin/posts/new?kind=episode', 'Episode', true],
      ['/admin/posts/new?kind=review', 'Review', true],
      ['/admin/pages/new', 'Page', true],
    ]);
    assert.doesNotMatch(page, /name="title"/, 'no form until a kind is chosen');
  });

  it('opens the form of the kind chosen', async () => {
    const page = await html('/admin/posts/new?kind=photo');
    assert.equal(kindOf(page), 'photo');
    assert.match(screenOf(page), /<h1\b[^>]*>[\s\S]*New photo/);
  });

  it('opens the page form directly from Pages > Add new', async () => {
    const page = await html('/admin/pages/new');
    assert.ok(names(page).includes('title'));
    assert.match(screenOf(page), /New page/);
  });
});

describe('each kind’s form', () => {
  const OTHER_KINDS = [
    'photo-url-',
    'in-reply-to',
    'link-url',
    'rsvp',
    'event-start',
    'enclosure-url',
    'item-name',
    'location-checkin',
  ];

  it('shows a note only a title, the body and the shared fields', async () => {
    const fields = names(await html('/admin/posts/new?kind=note'));
    for (const name of ['title', 'body', 'tags', 'categories', 'slug', 'description', 'author']) {
      assert.ok(fields.includes(name), name);
    }
    for (const prefix of OTHER_KINDS) {
      assert.ok(!fields.some((name) => name.startsWith(prefix)), prefix);
    }
    assert.doesNotMatch(await html('/admin/posts/new?kind=note'), />\s*Read\s*</);
  });

  it('gives a photo a library picker, and alt text for each photo', async () => {
    const page = await html('/admin/posts/new?kind=photo');
    const picks = [
      ...page.matchAll(
        /<input\b[^>]*type="checkbox"[^>]*name="photo-url-\d+"[^>]*value="([^"]+)"/g,
      ),
    ].map(([, url]) => url);
    assert.deepEqual(picks.sort(), ['/uploads/2026/10/garden.png', '/uploads/2026/10/harbor.png']);
    assert.ok(names(page).some((name) => name.startsWith('photo-alt-')));
    assert.ok(!names(page).includes('item-name'));
  });

  it('gives a link one choice of what it does and one address', async () => {
    const page = await html('/admin/posts/new?kind=link');
    const verbs = [...page.matchAll(/<input\b[^>]*name="link-verb"[^>]*value="([^"]+)"/g)].map(
      ([, verb]) => verb,
    );
    assert.deepEqual(verbs, ['in-reply-to', 'like-of', 'repost-of', 'bookmark-of']);
    assert.ok(names(page).includes('link-url'));
    assert.ok(!names(page).includes('photo-url-0'));
  });

  it('gives a review its item kinds, a star rating and no other kind’s fields', async () => {
    const page = await html('/admin/posts/new?kind=review');
    const kinds = [...page.matchAll(/<input\b[^>]*name="item-kind"[^>]*value="([^"]+)"/g)].map(
      ([, kind]) => kind,
    );
    assert.deepEqual(kinds, ['book', 'movie', 'tv', 'album', 'place', 'other']);
    const stars = [...page.matchAll(/<input\b[^>]*name="rating"[^>]*value="([^"]*)"/g)].map(
      ([, value]) => value,
    );
    assert.deepEqual(stars, ['', '1', '2', '3', '4', '5']);
    assert.match(page, /Book cover/);
    assert.ok(!names(page).includes('in-reply-to'));
  });

  it('puts a check-in’s place in the form, not in the sidebar', async () => {
    const page = await html('/admin/posts/new?kind=checkin');
    assert.ok(names(page).includes('location-checkin'));
    assert.ok(!names(page).includes('title'), 'a check-in has no title box');
    assert.doesNotMatch(page, /<summary\b[^>]*>Location<\/summary>/);
  });
});

describe('the sidebar', () => {
  it('holds Publish, then the shared groups', async () => {
    const page = await html('/admin/posts/new?kind=note');
    const groups = [...page.matchAll(/<summary\b[^>]*>([^<]*)<\/summary>/g)].map(([, name]) =>
      name?.trim(),
    );
    assert.deepEqual(groups, [
      'Tags and categories',
      'Location',
      'Address',
      'Summary and language',
      'Display and discussion',
    ]);
    for (const name of ['action', 'draft', 'date', 'visibility', 'author', 'pinned', 'comments']) {
      assert.ok(page.includes(`name="${name}"`), name);
    }
  });

  it('leaves Location out of an event', async () => {
    assert.doesNotMatch(
      await html('/admin/posts/new?kind=event'),
      /<summary\b[^>]*>Location<\/summary>/,
    );
  });
});

describe('Change type', () => {
  it('switches the form and keeps what was typed, saving nothing', async () => {
    const page = await html('/admin/posts/new?kind=note');
    const response = await agent.post('/admin/posts/new', {
      csrf_token: csrfField(page) ?? '',
      kind: 'note',
      'switch-kind': 'photo',
      title: 'Harbor',
      body: 'Morning light.',
      tags: 'sea, boats',
      description: 'A harbor',
    });
    assert.equal(response.status, 200);
    const switched = await response.text();
    assert.equal(kindOf(switched), 'photo');
    const fields = Object.fromEntries(fieldsOf(switched));
    assert.equal(fields['title'], 'Harbor');
    assert.equal(fields['body'], 'Morning light.');
    assert.equal(fields['tags'], 'sea, boats');
    assert.equal(fields['description'], 'A harbor');
    assert.equal((await agent.get('/admin/posts/harbor')).status, 404, 'nothing was saved');
  });

  it('offers every post kind from the heading', async () => {
    const page = await html('/admin/posts/new?kind=note');
    const offered = [...page.matchAll(/<button\b[^>]*name="switch-kind" value="([^"]+)"/g)].map(
      ([, kind]) => kind,
    );
    assert.deepEqual(offered, [
      'note',
      'photo',
      'link',
      'rsvp',
      'event',
      'checkin',
      'episode',
      'review',
    ]);
  });
});

describe('an existing post', () => {
  it('opens on the kind post type discovery gives it', async () => {
    assert.equal(kindOf(await html('/admin/posts/a-reply')), 'link');
    assert.equal(kindOf(await html('/admin/posts/meetup')), 'event');
  });

  it('shows every property of a post from several kinds, and saves them all back', async () => {
    const file = path.join(contentDir, 'posts', '2026-10-02-mixed.md');
    const before = await readFile(file, 'utf8');
    const page = await html('/admin/posts/mixed');
    assert.equal(kindOf(page), 'event');
    const fields = Object.fromEntries(fieldsOf(page));
    assert.equal(fields['in-reply-to'], 'https://example.com/a-post');
    assert.equal(fields['photo-url-0'], '/uploads/2026/10/harbor.png');
    assert.equal(fields['rsvp'], 'maybe');
    assert.equal(fields['item-name'], 'Piranesi');
    assert.equal(fields['rating'], '4');
    assert.match(text(screenOf(page)), /Also on this post/);

    const saved = await agent.post('/admin/posts/mixed', [...fieldsOf(page), ['action', 'update']]);
    assert.equal(saved.status, 303, await saved.clone().text());
    const after = await readFile(file, 'utf8');
    const keys = (source: string): string[] =>
      source.split('\n').filter((line) => !/^(updated|hash):/.test(line));
    for (const line of [
      'in-reply-to: https://example.com/a-post',
      'rsvp: maybe',
      'custom: kept',
      'rating: 4',
    ]) {
      assert.ok(keys(after).includes(line), `${line} in\n${after}`);
    }
    assert.match(after, /photo:[\s\S]*harbor\.png/);
    assert.match(after, /item:[\s\S]*name: Piranesi[\s\S]*by: Susanna Clarke/);
    assert.match(after, /start:/);
    assert.ok(before.includes('Sounds good.') && after.includes('Sounds good.'));
  });
});
