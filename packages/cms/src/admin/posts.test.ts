import assert from 'node:assert/strict';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import matter from 'gray-matter';

import { csrfField, sandbox, signedIn } from './__testing__/harness.ts';
import { readSiteSettings, writeSiteJson } from './settings.ts';
import type { Browser } from './__testing__/harness.ts';

const box = sandbox();
after(() => box.cleanup());

/** One Markdown file in a content directory, written the way a site's would be. */
interface Seed {
  file: string;
  title: string;
  permalink: string;
  date?: string | undefined;
  tags?: string[] | undefined;
  categories?: string[] | undefined;
  author?: string | undefined;
  description?: string | undefined;
  draft?: boolean | undefined;
  body?: string | undefined;
  extra?: string[] | undefined;
}

/** A content directory holding exactly these documents. */
async function seeded(documents: Seed[]): Promise<string> {
  const contentDir = await box.dir('geekity-posts-content-');

  for (const document of documents) {
    const file = path.join(contentDir, ...document.file.split('/'));
    await mkdir(path.dirname(file), { recursive: true });

    const frontMatter = [
      `title: ${document.title}`,
      document.date === undefined ? undefined : `date: ${document.date}`,
      `permalink: ${document.permalink}`,
      document.tags === undefined ? undefined : `tags: [${document.tags.join(', ')}]`,
      document.categories === undefined
        ? undefined
        : `categories: [${document.categories.join(', ')}]`,
      document.draft === true ? 'draft: true' : undefined,
      document.author === undefined ? undefined : `author: ${document.author}`,
      document.description === undefined ? undefined : `description: ${document.description}`,
      ...(document.extra ?? []),
    ].filter((line) => line !== undefined);

    await writeFile(
      file,
      `---\n${frontMatter.join('\n')}\n---\n\n${document.body ?? 'Body.'}\n`,
      'utf8',
    );
  }

  return contentDir;
}

/** The value of a form field in a rendered editor. */
function field(html: string, name: string): string | undefined {
  const match = new RegExp(`name="${name}"[^>]*value="([^"]*)"`).exec(html);
  return match?.[1];
}

function recordingFields(html: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const [, name = '', value = ''] of html.matchAll(
    /<input[^>]*name="((?:enclosure|alternate)-[^"]+)"[^>]*value="([^"]*)"/g,
  )) {
    fields[name] = value;
  }
  for (const [, name = '', options = ''] of html.matchAll(
    /<select[^>]*name="(enclosure-[^"]+)"[^>]*>([\s\S]*?)<\/select>/g,
  )) {
    fields[name] = /<option value="([^"]*)" selected>/.exec(options)?.[1] ?? '';
  }
  return fields;
}

/**
 * Fill in the editor at `url` and submit it, the way a browser would: load the
 * form, keep every value it came with, change the ones the test cares about,
 * and post the whole thing back with the CSRF token and the hash it carried.
 */
async function submit(
  agent: Browser,
  url: string,
  changes: Record<string, string>,
): Promise<Response> {
  const html = await (await agent.get(url)).text();
  const token = csrfField(html);
  assert.ok(token !== undefined, `the editor at ${url} carried a CSRF token`);

  const fields: Record<string, string> = {
    csrf_token: token,
    hash: field(html, 'hash') ?? '',
    title: field(html, 'title') ?? '',
    slug: field(html, 'slug') ?? '',
    permalink: field(html, 'permalink') ?? '',
    date: field(html, 'date') ?? '',
    tags: field(html, 'tags') ?? '',
    categories: field(html, 'categories') ?? '',
    description: field(html, 'description') ?? '',
    'in-reply-to': field(html, 'in-reply-to') ?? '',
    lang: field(html, 'lang') ?? '',
    ...recordingFields(html),
    body: /<textarea[^>]*name="body"[^>]*>([\s\S]*?)<\/textarea>/.exec(html)?.[1] ?? '',
    action: 'update',
    ...changes,
  };

  const saveUrl = /<form class="admin-editor" method="post" action="([^"]+)"/.exec(html)?.[1];
  assert.ok(saveUrl !== undefined, 'the editor knew where to post');

  return agent.post(saveUrl, fields);
}

describe('the posts listing', () => {
  it('shows every live post with its author, tags, categories, date and status', async () => {
    const contentDir = await seeded([
      {
        file: 'posts/2026-01-02-published.md',
        title: 'Out in the world',
        date: '2026-01-02',
        permalink: '/2026/01/published/',
        tags: ['essays', 'notes'],
        categories: ['general', 'meta'],
        author: 'ada',
      },
      {
        file: 'posts/2026-01-01-hidden.md',
        title: 'Still cooking',
        date: '2026-01-01',
        permalink: '/2026/01/hidden/',
        draft: true,
      },
    ]);
    const cms = await box.site({ contentDir });
    const agent = await signedIn(cms);

    const response = await agent.get('/admin/posts');
    assert.equal(response.status, 200);

    const html = await response.text();
    assert.match(html, /<a href="\/admin\/posts\/published">Out in the world<\/a>/);
    assert.match(html, /<a href="\/admin\/posts\/hidden">Still cooking<\/a>/);
    assert.match(html, />ada</, 'the author column');
    assert.match(html, />essays, notes</, 'the tag column');
    assert.match(html, />general, meta</, 'the category column');
    assert.match(html, /2026-01-02/, 'the date column');
    assert.match(html, /admin-status-draft">Draft</, 'and which of them is a draft');
  });

  it('filters to published, drafts and the trash', async () => {
    const contentDir = await seeded([
      {
        file: 'posts/2026-01-02-published.md',
        title: 'Out in the world',
        date: '2026-01-02',
        permalink: '/2026/01/published/',
      },
      {
        file: 'posts/2026-01-01-hidden.md',
        title: 'Still cooking',
        date: '2026-01-01',
        permalink: '/2026/01/hidden/',
        draft: true,
      },
      {
        file: '_trash/posts/2025-12-31-gone.md',
        title: 'Thrown away',
        date: '2025-12-31',
        permalink: '/2025/12/gone/',
      },
    ]);
    const cms = await box.site({ contentDir });
    const agent = await signedIn(cms);

    const titles = async (query: string): Promise<string[]> => {
      const html = await (await agent.get(`/admin/posts${query}`)).text();
      return [...html.matchAll(/<td><a href="\/admin\/posts\/[^"]+">([^<]+)<\/a><\/td>/g)].map(
        (match) => match[1] ?? '',
      );
    };

    assert.deepEqual(await titles(''), ['Out in the world', 'Still cooking'], 'all, minus the bin');
    assert.deepEqual(await titles('?status=published'), ['Out in the world']);
    assert.deepEqual(await titles('?status=draft'), ['Still cooking']);
    assert.deepEqual(await titles('?status=trash'), ['Thrown away']);
    assert.deepEqual(await titles('?status=nonsense'), ['Out in the world', 'Still cooking']);
  });

  it('offers Edit, a View link only for what the public can see, and the right bin action', async () => {
    const contentDir = await seeded([
      {
        file: 'posts/2026-01-02-published.md',
        title: 'Out in the world',
        date: '2026-01-02',
        permalink: '/2026/01/published/',
      },
      {
        file: 'posts/2026-01-01-hidden.md',
        title: 'Still cooking',
        date: '2026-01-01',
        permalink: '/2026/01/hidden/',
        draft: true,
      },
    ]);
    const cms = await box.site({ contentDir });
    const agent = await signedIn(cms);

    const live = await (await agent.get('/admin/posts')).text();
    assert.match(live, /<a href="\/2026\/01\/published\/">View<\/a>/);
    assert.ok(
      !/<a href="\/2026\/01\/hidden\/">View<\/a>/.test(live),
      'a draft has nothing to view',
    );
    assert.match(live, /name="action" value="trash">Move to trash</);
    assert.ok(!/value="restore"/.test(live), 'nothing here is in the bin');

    const trashed = await (await agent.get('/admin/posts?status=trash')).text();
    assert.ok(!/value="trash"/.test(trashed), 'and nothing there can be binned twice');
  });
});

describe('a scheduled post in the admin', () => {
  /** Two posts, one due and one not, under a clock this test can move. */
  async function scheduled(): Promise<{ agent: Browser; set: (instant: string) => void }> {
    const contentDir = await seeded([
      {
        file: 'posts/2026-09-03-live.md',
        title: 'Out in the world',
        date: "'2026-09-03T09:00:00Z'",
        permalink: '/2026/09/live/',
      },
      {
        file: 'posts/2026-09-04-tomorrow.md',
        title: 'Waiting its turn',
        date: "'2026-09-04T09:00:00-05:00'",
        permalink: '/2026/09/tomorrow/',
      },
    ]);
    let now = new Date('2026-09-03T12:00:00Z');
    const cms = await box.site({ contentDir, now: () => now });
    return {
      agent: await signedIn(cms),
      set: (instant: string) => {
        now = new Date(instant);
      },
    };
  }

  it('is listed as Scheduled, has its own filter, and is not counted as published', async () => {
    const { agent } = await scheduled();

    const titles = async (query: string): Promise<string[]> => {
      const html = await (await agent.get(`/admin/posts${query}`)).text();
      return [...html.matchAll(/<td><a href="\/admin\/posts\/[^"]+">([^<]+)<\/a><\/td>/g)].map(
        (match) => match[1] ?? '',
      );
    };

    const all = await (await agent.get('/admin/posts')).text();
    assert.match(all, /admin-status-scheduled">Scheduled</, 'the status badge');
    assert.match(all, /href="\/admin\/posts\?status=scheduled"/, 'the filter');
    assert.ok(
      !/<a href="\/2026\/09\/tomorrow\/">View<\/a>/.test(all),
      'there is nothing public to view yet',
    );

    assert.deepEqual(await titles('?status=scheduled'), ['Waiting its turn']);
    assert.deepEqual(await titles('?status=published'), ['Out in the world']);
    assert.deepEqual(await titles(''), ['Waiting its turn', 'Out in the world']);
  });

  it('tells the editor when it goes out, in the site’s own time zone', async () => {
    const { agent, set } = await scheduled();

    const html = await (await agent.get('/admin/posts/tomorrow')).text();

    assert.match(html, /Scheduled/, 'the editor says so');
    assert.match(
      html,
      /Scheduled for 4 September 2026 at 14:00 UTC/,
      'the 09:00 the file wrote at -05:00, in the UTC the site is set to',
    );
    assert.ok(!/href="\/2026\/09\/tomorrow\/"/.test(html), 'and offers no View link');

    set('2026-09-04T14:00:00Z');

    const after = await (await agent.get('/admin/posts/tomorrow')).text();
    assert.ok(!/Scheduled/.test(after), 'once it is out the note has gone');
    assert.match(after, /href="\/2026\/09\/tomorrow\/"/, 'and the View link is there');
  });

  it('says a save was scheduled rather than published', async () => {
    const cms = await box.site({
      contentDir: await seeded([]),
      now: () => new Date('2026-09-03T12:00:00Z'),
    });
    const agent = await signedIn(cms);

    await submit(agent, '/admin/posts/new', {
      title: 'Waiting its turn',
      slug: 'waiting',
      date: '2026-09-04T09:00:00Z',
      action: 'publish',
    });
    const html = await (await agent.get('/admin/posts/waiting')).text();

    assert.match(html, /Scheduled: Waiting its turn/, 'the flash names what happened');
  });
});

describe('the post editor', () => {
  it('offers every field doc-5 lists, and the buttons for something not written yet', async () => {
    const cms = await box.site({ contentDir: await seeded([]) });
    const agent = await signedIn(cms);

    const response = await agent.get('/admin/posts/new');
    assert.equal(response.status, 200);

    const html = await response.text();
    for (const field of [
      'title',
      'slug',
      'permalink',
      'date',
      'tags',
      'categories',
      'description',
      'body',
    ]) {
      assert.match(html, new RegExp(`name="${field}"`), field);
    }
    assert.match(html, /name="draft" type="checkbox"/, 'the draft checkbox');
    assert.match(html, /name="hash" value=""/, 'and the hash it loaded with, which is none');

    assert.match(html, /name="action" value="save-draft">Save draft</);
    assert.match(html, /name="action" value="publish">Publish</);
    assert.ok(!/value="trash"/.test(html), 'there is nothing to throw away yet');
  });

  it('fills itself in from the document, and offers Update, trash and View', async () => {
    const contentDir = await seeded([
      {
        file: 'posts/2026-01-02-published.md',
        title: 'Out in the world',
        date: '2026-01-02T09:00:00-05:00',
        permalink: '/2026/01/published/',
        tags: ['essays', 'notes'],
        categories: ['general'],
        description: 'What it is about.',
        body: 'The body of the thing.',
      },
    ]);
    const cms = await box.site({ contentDir });
    const agent = await signedIn(cms);

    const html = await (await agent.get('/admin/posts/published')).text();
    const document = cms.store.getBySlug('published');
    assert.ok(document !== undefined);

    assert.match(html, /name="title" type="text" value="Out in the world"/);
    assert.match(html, /name="slug" type="text" value="published"/);
    assert.match(html, /name="permalink" type="text" value="\/2026\/01\/published\/"/);
    assert.match(html, /name="tags" type="text" value="essays, notes"/);
    assert.match(html, /name="categories" type="text" value="general"/);
    assert.match(html, /The body of the thing\./);
    assert.match(html, new RegExp(`name="hash" value="${document.hash}"`));

    assert.match(html, /name="action" value="update">Update</);
    assert.match(html, /name="action" value="trash">Move to trash</);
    assert.match(html, /<a[^>]+href="\/2026\/01\/published\/"[^>]*>View<\/a>/);
  });

  it('is a 404 for a post that is not there', async () => {
    const cms = await box.site({ contentDir: await seeded([]) });
    const agent = await signedIn(cms);

    assert.equal((await agent.get('/admin/posts/never-written')).status, 404);
  });

  it('saves categories, shows them on reload and serves the archive', async () => {
    const contentDir = await seeded([]);
    const cms = await box.site({ contentDir });
    const agent = await signedIn(cms);

    const response = await submit(agent, '/admin/posts/new', {
      title: 'Filed away',
      date: '2026-03-04T10:00:00Z',
      tags: 'essays',
      categories: 'general, meta, general',
      body: 'Written in a textarea.',
      action: 'publish',
    });
    assert.equal(response.status, 303);

    const written = await readFile(
      path.join(contentDir, 'posts', '2026-03-04-filed-away.md'),
      'utf8',
    );
    assert.match(written, /^categories:\n {2}- general\n {2}- meta$/m, 'and no repeat');

    const reloaded = await (await agent.get('/admin/posts/filed-away')).text();
    assert.match(reloaded, /name="categories" type="text" value="general, meta"/);

    const archive = await cms.app.request('/category/general/');
    assert.equal(archive.status, 200);
    assert.match(await archive.text(), /Filed away/);
  });

  it('takes categories back off a post that had them', async () => {
    const contentDir = await seeded([
      {
        file: 'posts/2026-01-02-published.md',
        title: 'Out in the world',
        date: '2026-01-02',
        permalink: '/2026/01/published/',
        categories: ['general'],
      },
    ]);
    const cms = await box.site({ contentDir });
    const agent = await signedIn(cms);

    await submit(agent, '/admin/posts/published', { categories: '' });

    const written = await readFile(
      path.join(contentDir, 'posts', '2026-01-02-published.md'),
      'utf8',
    );
    assert.ok(!/^categories:/m.test(written), 'the key is gone, not left empty');
    assert.equal((await cms.app.request('/category/general/')).status, 404);
  });
});

describe('the reply target in the editor', () => {
  const TARGET = 'https://them.example/2026/09/their-post/';
  const FILE = ['posts', '2026-01-02-published.md'];

  async function published(): Promise<{ contentDir: string; agent: Browser }> {
    const contentDir = await seeded([
      {
        file: 'posts/2026-01-02-published.md',
        title: 'Out in the world',
        date: '2026-01-02',
        permalink: '/2026/01/published/',
      },
    ]);
    const cms = await box.site({ contentDir });
    return { contentDir, agent: await signedIn(cms) };
  }

  it('sets in-reply-to, shows it on reload, and clears it again', async () => {
    const { contentDir, agent } = await published();

    assert.equal(
      (await submit(agent, '/admin/posts/published', { 'in-reply-to': TARGET })).status,
      303,
    );
    let written = await readFile(path.join(contentDir, ...FILE), 'utf8');
    assert.match(written, new RegExp(`^in-reply-to: ${TARGET}$`, 'm'));
    const reloaded = await (await agent.get('/admin/posts/published')).text();
    assert.equal(field(reloaded, 'in-reply-to'), TARGET);

    assert.equal(
      (await submit(agent, '/admin/posts/published', { 'in-reply-to': '' })).status,
      303,
    );
    written = await readFile(path.join(contentDir, ...FILE), 'utf8');
    assert.doesNotMatch(written, /in-reply-to/, 'the key is gone, not left empty');
  });

  it('refuses a reply target that is not a web address, and writes nothing', async () => {
    const { contentDir, agent } = await published();
    const before = await readFile(path.join(contentDir, ...FILE), 'utf8');

    const response = await submit(agent, '/admin/posts/published', {
      'in-reply-to': 'their post',
    });

    assert.equal(response.status, 400);
    assert.match(await response.text(), /In reply to has to be a web address/);
    assert.equal(await readFile(path.join(contentDir, ...FILE), 'utf8'), before);
  });
});

describe('the post language in the editor (TASK-154 AC #1)', () => {
  const FILE = ['posts', '2026-01-02-published.md'];

  async function published(extra: string[] = []): Promise<{ contentDir: string; agent: Browser }> {
    const contentDir = await seeded([
      {
        file: 'posts/2026-01-02-published.md',
        title: 'Out in the world',
        date: '2026-01-02',
        permalink: '/2026/01/published/',
        extra,
      },
    ]);
    const cms = await box.site({ contentDir });
    return { contentDir, agent: await signedIn(cms) };
  }

  it('is offered, empty, on a new post, naming the site’s language as the default', async () => {
    const { agent } = await published();

    const html = await (await agent.get('/admin/posts/new')).text();

    assert.equal(field(html, 'lang'), '');
    assert.match(html, /<label for="editor-lang">Language<\/label>/);
    assert.match(html, /Leave it empty for the site’s language, en\./);
  });

  it('sets lang, shows it on reload, and clears it again', async () => {
    const { contentDir, agent } = await published();

    assert.equal((await submit(agent, '/admin/posts/published', { lang: ' fr-CA ' })).status, 303);
    let written = await readFile(path.join(contentDir, ...FILE), 'utf8');
    assert.match(written, /^lang: fr-CA$/m);
    const reloaded = await (await agent.get('/admin/posts/published')).text();
    assert.equal(field(reloaded, 'lang'), 'fr-CA');

    assert.equal((await submit(agent, '/admin/posts/published', { lang: '' })).status, 303);
    written = await readFile(path.join(contentDir, ...FILE), 'utf8');
    assert.doesNotMatch(written, /^lang:/m, 'the key is gone, not left empty');
  });

  it('keeps a lang the file already has through a save that does not touch it', async () => {
    const { contentDir, agent } = await published(['lang: de']);

    assert.equal((await submit(agent, '/admin/posts/published', { title: 'Renamed' })).status, 303);

    const written = await readFile(path.join(contentDir, ...FILE), 'utf8');
    assert.match(written, /^lang: de$/m);
  });

  it('refuses a value that is not a language tag, and writes nothing', async () => {
    const { contentDir, agent } = await published();
    const before = await readFile(path.join(contentDir, ...FILE), 'utf8');

    const response = await submit(agent, '/admin/posts/published', { lang: 'French' });

    assert.equal(response.status, 400);
    assert.match(await response.text(), /That is not a language tag, such as en, fr or pt-BR\./);
    assert.equal(await readFile(path.join(contentDir, ...FILE), 'utf8'), before);
  });
});

describe('pinning a post in the editor (TASK-207 AC #1)', () => {
  const PINNED_AT = '2026-05-01T12:00:00.000Z';

  /** Six published posts by ada, the first `pinned` of them already pinned. */
  async function posts(pinned = 0): Promise<{ contentDir: string; agent: Browser }> {
    const contentDir = await seeded(
      Array.from({ length: 6 }, (_, index) => ({
        file: `posts/2026-01-0${String(index + 1)}-post-${String(index + 1)}.md`,
        title: `Post ${String(index + 1)}`,
        date: `2026-01-0${String(index + 1)}`,
        permalink: `/2026/01/post-${String(index + 1)}/`,
        author: 'ada',
        extra: index < pinned ? [`pinned: 2026-02-0${String(index + 1)}T00:00:00Z`] : [],
      })),
    );
    const cms = await box.site({ contentDir, now: () => new Date(PINNED_AT) });
    return { contentDir, agent: await signedIn(cms) };
  }

  async function file(contentDir: string, n: number): Promise<string> {
    return await readFile(
      path.join(contentDir, 'posts', `2026-01-0${String(n)}-post-${String(n)}.md`),
      'utf8',
    );
  }

  it('offers an unticked Pinned box on a post', async () => {
    const { agent } = await posts();

    const html = await (await agent.get('/admin/posts/post-1')).text();

    assert.match(html, /<input id="editor-pinned" name="pinned" type="checkbox" value="1" \/>/);
    assert.match(html, /<label for="editor-pinned">Pinned<\/label>/);
  });

  it('pins with the moment it was pinned, and unpins', async () => {
    const { contentDir, agent } = await posts();

    assert.equal((await submit(agent, '/admin/posts/post-1', { pinned: '1' })).status, 303);
    assert.match(await file(contentDir, 1), /^pinned: '2026-05-01T12:00:00Z'$/m);
    const reloaded = await (await agent.get('/admin/posts/post-1')).text();
    assert.match(reloaded, /name="pinned" type="checkbox" value="1" checked/);

    assert.equal((await submit(agent, '/admin/posts/post-1', {})).status, 303);
    assert.doesNotMatch(await file(contentDir, 1), /^pinned:/m, 'the key is gone, not false');
  });

  it('refuses a sixth pin for the same author, and writes nothing', async () => {
    const { contentDir, agent } = await posts(5);
    const before = await file(contentDir, 6);

    const response = await submit(agent, '/admin/posts/post-6', { pinned: '1' });

    assert.equal(response.status, 400);
    assert.match(await response.text(), /You can pin up to 5 posts\. Unpin one first\./);
    assert.equal(await file(contentDir, 6), before);
  });

  it('lets an already pinned post be saved when the author has five pins', async () => {
    const { contentDir, agent } = await posts(5);

    const response = await submit(agent, '/admin/posts/post-1', { pinned: '1', title: 'Again' });

    assert.equal(response.status, 303);
    const written = await file(contentDir, 1);
    assert.match(written, /^title: Again$/m);
    assert.match(
      written,
      /^pinned: '?2026-02-01T00:00:00(\.000)?Z'?$/m,
      'a save keeps the moment the post was first pinned',
    );
  });
});

describe('the recording in the post editor (TASK-213 AC #1, #2)', () => {
  const FILE = ['posts', '2026-01-02-episode.md'];
  const MONTH = ['uploads', '2026', '10'];
  const MP3 = new Uint8Array([0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x09]);

  async function episode(extra: string[] = []): Promise<{ contentDir: string; agent: Browser }> {
    const contentDir = await seeded([
      {
        file: 'posts/2026-01-02-episode.md',
        title: 'Episode twelve',
        date: '2026-01-02',
        permalink: '/2026/01/episode/',
        extra,
      },
    ]);
    const uploads = path.join(contentDir, ...MONTH);
    await mkdir(uploads, { recursive: true });
    await writeFile(path.join(uploads, 'episode.mp3'), MP3);
    await writeFile(path.join(uploads, 'episode.mp4'), new Uint8Array(32));
    await writeFile(path.join(uploads, 'episode.vtt'), 'WEBVTT\n');
    await writeFile(path.join(uploads, 'cover.png'), new Uint8Array(8));
    const cms = await box.site({ contentDir });
    return { contentDir, agent: await signedIn(cms) };
  }

  async function frontMatter(contentDir: string): Promise<Record<string, unknown>> {
    return matter(await readFile(path.join(contentDir, ...FILE), 'utf8')).data;
  }

  it('offers the audio and video in the media library, and nothing else', async () => {
    const { agent } = await episode();

    const html = await (await agent.get('/admin/posts/episode')).text();

    assert.match(html, /<legend>Recording<\/legend>/);
    assert.match(html, /<option value="" selected>None<\/option>/);
    assert.match(html, /<option value="\/uploads\/2026\/10\/episode\.mp3">2026\/10\/episode\.mp3</);
    assert.match(html, /<option value="\/uploads\/2026\/10\/episode\.mp4">2026\/10\/episode\.mp4</);
    assert.doesNotMatch(html, /<option value="\/uploads\/2026\/10\/cover\.png"/);
  });

  it('offers no recording on a page', async () => {
    const { agent } = await episode();

    const html = await (await agent.get('/admin/pages/new')).text();

    assert.doesNotMatch(html, /Recording|enclosure-url/);
  });

  it('attaches an upload with the type and size of the file on disk, and shows it on reload', async () => {
    const { contentDir, agent } = await episode();

    const response = await submit(agent, '/admin/posts/episode', {
      'enclosure-url': '/uploads/2026/10/episode.mp3',
      'enclosure-duration': '30:34',
      'enclosure-transcript-url': '/uploads/2026/10/episode.vtt',
    });

    assert.equal(response.status, 303);
    assert.deepEqual((await frontMatter(contentDir))['enclosure'], {
      url: '/uploads/2026/10/episode.mp3',
      type: 'audio/mpeg',
      length: MP3.byteLength,
      duration: 1834,
      transcript: { url: '/uploads/2026/10/episode.vtt', type: 'text/vtt' },
    });
    const reloaded = await (await agent.get('/admin/posts/episode')).text();
    assert.match(reloaded, /<option value="\/uploads\/2026\/10\/episode\.mp3" selected>/);
    assert.equal(field(reloaded, 'enclosure-duration'), '30:34');
  });

  it('adds, edits and removes alternate versions through the blank row', async () => {
    const { contentDir, agent } = await episode();

    await submit(agent, '/admin/posts/episode', {
      'enclosure-url': '/uploads/2026/10/episode.mp3',
      'alternate-url-0': '/uploads/2026/10/episode.mp4',
      'alternate-title-0': 'Video',
      'alternate-height-0': '720',
    });
    let reloaded = await (await agent.get('/admin/posts/episode')).text();
    assert.equal(field(reloaded, 'alternate-url-0'), '/uploads/2026/10/episode.mp4');
    assert.equal(field(reloaded, 'alternate-url-1'), '', 'a blank row to add another');

    await submit(agent, '/admin/posts/episode', {
      'alternate-url-1': 'https://cdn.example.com/episode-low.mp3',
      'alternate-type-1': 'audio/mpeg',
      'alternate-title-1': 'Low bandwidth',
      'alternate-lang-1': 'en',
    });
    assert.deepEqual(
      ((await frontMatter(contentDir))['enclosure'] as Record<string, unknown>)['alternates'],
      [
        {
          url: '/uploads/2026/10/episode.mp4',
          type: 'video/mp4',
          length: 32,
          title: 'Video',
          height: 720,
        },
        {
          url: 'https://cdn.example.com/episode-low.mp3',
          type: 'audio/mpeg',
          title: 'Low bandwidth',
          lang: 'en',
        },
      ],
    );

    reloaded = await (await agent.get('/admin/posts/episode')).text();
    assert.equal(field(reloaded, 'alternate-url-2'), '');
    await submit(agent, '/admin/posts/episode', { 'alternate-url-0': '' });
    assert.deepEqual(
      ((await frontMatter(contentDir))['enclosure'] as Record<string, unknown>)['alternates'],
      [
        {
          url: 'https://cdn.example.com/episode-low.mp3',
          type: 'audio/mpeg',
          title: 'Low bandwidth',
          lang: 'en',
        },
      ],
    );
  });

  it('removes the whole recording with the main file, and keeps the keys around it', async () => {
    const { contentDir, agent } = await episode(['license: cc-by', 'mood: calm']);
    await submit(agent, '/admin/posts/episode', {
      'enclosure-url': '/uploads/2026/10/episode.mp3',
      'alternate-url-0': 'https://cdn.example.com/episode.mp4',
      'alternate-type-0': 'video/mp4',
    });

    assert.equal(
      (await submit(agent, '/admin/posts/episode', { 'enclosure-url': '' })).status,
      303,
    );

    const data = await frontMatter(contentDir);
    assert.equal('enclosure' in data, false);
    assert.equal(data['license'], 'cc-by');
    assert.equal(data['mood'], 'calm');
  });

  it('will not quietly drop a hand-written recording it cannot use', async () => {
    const { contentDir, agent } = await episode([
      'enclosure:',
      '  url: https://cdn.example.com/episode.mp3',
      '  type: audio/mpeg',
      '  length: 1234',
    ]);
    const before = await readFile(path.join(contentDir, ...FILE), 'utf8');

    const html = await (await agent.get('/admin/posts/episode')).text();
    assert.match(
      html,
      /<option value="https:\/\/cdn\.example\.com\/episode\.mp3" selected>https:\/\/cdn\.example\.com\/episode\.mp3 \(not in the media library\)<\/option>/,
    );

    const response = await submit(agent, '/admin/posts/episode', { title: 'Renamed' });
    assert.equal(response.status, 400);
    assert.equal(await readFile(path.join(contentDir, ...FILE), 'utf8'), before);

    assert.equal(
      (await submit(agent, '/admin/posts/episode', { 'enclosure-url': '' })).status,
      303,
    );
    assert.equal('enclosure' in (await frontMatter(contentDir)), false, 'None removes it');
  });

  const refusals: { name: string; changes: Record<string, string>; message: RegExp }[] = [
    {
      name: 'a main file that is not audio or video',
      changes: { 'enclosure-url': '/uploads/2026/10/cover.png' },
      message: /The recording has to be an audio or video file in the media library\./,
    },
    {
      name: 'a main file that is not there',
      changes: { 'enclosure-url': '/uploads/2026/10/gone.mp3' },
      message: /The recording has to be an audio or video file in the media library\./,
    },
    {
      name: 'a linked version without an http(s) address',
      changes: {
        'alternate-url-0': 'cdn.example.com/episode.mp4',
        'alternate-type-0': 'video/mp4',
      },
      message:
        /An alternate version is a file in the media library or an address starting https:\/\//,
    },
    {
      name: 'a linked version without a media type',
      changes: { 'alternate-url-0': 'https://cdn.example.com/episode.mp4' },
      message: /Say what type of file https:\/\/cdn\.example\.com\/episode\.mp4 is/,
    },
    {
      name: 'a version title over 32 characters',
      changes: {
        'alternate-url-0': '/uploads/2026/10/episode.mp4',
        'alternate-title-0': 'A title far longer than any player would show',
      },
      message: /title is at most 32 characters/,
    },
    {
      name: 'a linked transcript without its type',
      changes: { 'enclosure-transcript-url': 'https://example.com/transcript' },
      message: /Say what kind of file a linked transcript is\./,
    },
    {
      name: 'a duration nobody can read',
      changes: { 'enclosure-duration': 'half an hour' },
      message: /A duration is seconds/,
    },
  ];

  for (const refusal of refusals) {
    it(`refuses ${refusal.name}, and writes nothing`, async () => {
      const { contentDir, agent } = await episode();
      const before = await readFile(path.join(contentDir, ...FILE), 'utf8');

      const response = await submit(agent, '/admin/posts/episode', {
        'enclosure-url': '/uploads/2026/10/episode.mp3',
        ...refusal.changes,
      });

      assert.equal(response.status, 400);
      const html = await response.text();
      assert.match(html, refusal.message);
      assert.equal(await readFile(path.join(contentDir, ...FILE), 'utf8'), before);
    });
  }
});

describe('writing a post', () => {
  it('names the file for its date and slug, writes an explicit permalink, and is public at once', async () => {
    const contentDir = await seeded([]);
    const cms = await box.site({ contentDir });
    const agent = await signedIn(cms);

    const response = await submit(agent, '/admin/posts/new', {
      title: 'Hello from the editor',
      date: '2026-03-04T10:00:00Z',
      tags: 'essays, notes',
      description: 'The first one.',
      body: 'Written in a textarea.',
      action: 'publish',
    });

    assert.equal(response.status, 303);
    assert.equal(response.headers.get('location'), '/admin/posts/hello-from-the-editor');

    const files = await readdir(path.join(contentDir, 'posts'));
    assert.deepEqual(files, ['2026-03-04-hello-from-the-editor.md']);

    const written = await readFile(path.join(contentDir, 'posts', files[0] ?? ''), 'utf8');
    assert.match(written, /^title: Hello from the editor$/m);
    assert.match(written, /^permalink: \/2026\/03\/hello-from-the-editor\/$/m);
    assert.match(written, /^ {2}- essays$/m);
    assert.ok(!/^draft:/m.test(written), 'published, so no draft key at all');
    assert.match(written, /Written in a textarea\./);

    const live = await cms.app.request('/2026/03/hello-from-the-editor/');
    assert.equal(live.status, 200, 'the public site is serving it without a restart');
    assert.match(await live.text(), /Written in a textarea\./);
  });

  it('derives the slug from the title when the form leaves it empty', async () => {
    const cms = await box.site({ contentDir: await seeded([]) });
    const agent = await signedIn(cms);

    const response = await submit(agent, '/admin/posts/new', {
      title: 'Ada & Charles: a note',
      slug: '',
      action: 'save-draft',
    });

    assert.equal(response.headers.get('location'), '/admin/posts/ada-charles-a-note');
    assert.equal(cms.store.getBySlug('ada-charles-a-note')?.draft, true);
  });

  it('saves a post with no title as a note, named after its first words', async () => {
    const contentDir = await seeded([]);
    const cms = await box.site({ contentDir });
    const agent = await signedIn(cms);

    const editor = await (await agent.get('/admin/posts/new')).text();
    assert.doesNotMatch(
      /<input id="editor-title"[^>]*>/.exec(editor)?.[0] ?? '',
      /required/,
      'the browser refuses an empty title before the server sees it',
    );

    const response = await submit(agent, '/admin/posts/new', {
      title: '  ',
      slug: '',
      date: '2026-03-04T10:00:00Z',
      body: 'Coffee *first*, then the inbox and after that a walk.',
      action: 'publish',
    });

    assert.equal(response.status, 303);
    assert.equal(response.headers.get('location'), '/admin/posts/coffee-first-then-the-inbox');
    assert.deepEqual(await readdir(path.join(contentDir, 'posts')), [
      '2026-03-04-coffee-first-then-the-inbox.md',
    ]);

    const written = await readFile(
      path.join(contentDir, 'posts', '2026-03-04-coffee-first-then-the-inbox.md'),
      'utf8',
    );
    assert.doesNotMatch(written, /^title:/m, 'a note’s file carries no title');
    assert.match(written, /^permalink: \/2026\/03\/coffee-first-then-the-inbox\/$/m);

    const live = await cms.app.request('/2026/03/coffee-first-then-the-inbox/');
    assert.equal(live.status, 200, 'the note is served at its permalink');

    const listing = await (await agent.get('/admin/posts')).text();
    assert.match(
      listing,
      /<a href="\/admin\/posts\/coffee-first-then-the-inbox">Coffee first, then the inbox and after that a walk\.<\/a>/,
      'the posts list links a note by its first words',
    );

    const again = await submit(agent, '/admin/posts/coffee-first-then-the-inbox', {
      body: 'Tea, as it turned out.',
      action: 'update',
    });
    assert.equal(again.status, 303, 'an edited note keeps the slug it was given');
  });

  it('names a note with no words at all as untitled', async () => {
    const cms = await box.site({ contentDir: await seeded([]) });
    const agent = await signedIn(cms);

    const response = await submit(agent, '/admin/posts/new', {
      title: '',
      slug: '',
      body: '',
      action: 'save-draft',
    });

    assert.equal(response.headers.get('location'), '/admin/posts/untitled');
  });
});

describe('editing a post', () => {
  it('updates the file and the public page without a restart', async () => {
    const contentDir = await seeded([
      {
        file: 'posts/2026-01-02-published.md',
        title: 'Out in the world',
        date: '2026-01-02',
        permalink: '/2026/01/published/',
        body: 'The first draft of it.',
      },
    ]);
    const cms = await box.site({ contentDir });
    const agent = await signedIn(cms);

    const response = await submit(agent, '/admin/posts/published', {
      body: 'The second draft of it.',
      action: 'update',
    });

    assert.equal(response.status, 303);
    assert.equal(response.headers.get('location'), '/admin/posts/published');

    const written = await readFile(
      path.join(contentDir, 'posts', '2026-01-02-published.md'),
      'utf8',
    );
    assert.match(written, /The second draft of it\./);
    assert.ok(!/The first draft of it\./.test(written));
    assert.match(written, /^updated: /m, 'and doc-2 asks for an updated stamp on every save');

    const live = await cms.app.request('/2026/01/published/');
    assert.equal(live.status, 200);
    assert.match(await live.text(), /The second draft of it\./);
  });

  it('keeps front matter it does not model', async () => {
    const contentDir = await seeded([
      {
        file: 'posts/2026-01-02-published.md',
        title: 'Out in the world',
        date: '2026-01-02',
        permalink: '/2026/01/published/',
        extra: ['hero: /uploads/2026/01/hero.jpg', 'syndication:', '  - https://example.com/x'],
      },
    ]);
    const cms = await box.site({ contentDir });
    const agent = await signedIn(cms);

    await submit(agent, '/admin/posts/published', { body: 'Edited.', action: 'update' });

    const written = await readFile(
      path.join(contentDir, 'posts', '2026-01-02-published.md'),
      'utf8',
    );
    assert.match(written, /^hero: \/uploads\/2026\/01\/hero\.jpg$/m);
    assert.match(written, /^ {2}- https:\/\/example\.com\/x$/m);
    assert.deepEqual(cms.store.getBySlug('published')?.extra, {
      hero: '/uploads/2026/01/hero.jpg',
      syndication: ['https://example.com/x'],
    });
  });

  it('still renames a draft, and takes the permalink with it', async () => {
    const contentDir = await seeded([
      {
        file: 'posts/2026-01-02-waiting.md',
        title: 'Still writing',
        date: '2026-01-02',
        permalink: '/2026/01/waiting/',
        draft: true,
      },
    ]);
    const cms = await box.site({ contentDir });
    const agent = await signedIn(cms);

    const response = await submit(agent, '/admin/posts/waiting', {
      slug: 'still-writing',
      action: 'save-draft',
    });

    assert.equal(response.headers.get('location'), '/admin/posts/still-writing');
    assert.deepEqual(await readdir(path.join(contentDir, 'posts')), [
      '2026-01-02-still-writing.md',
    ]);

    const written = await readFile(
      path.join(contentDir, 'posts', '2026-01-02-still-writing.md'),
      'utf8',
    );
    assert.match(written, /^permalink: \/2026\/01\/still-writing\/$/m);
  });

  it('still moves a draft\u2019s permalink where the author puts it', async () => {
    const contentDir = await seeded([
      {
        file: 'posts/2026-01-02-waiting.md',
        title: 'Still writing',
        date: '2026-01-02',
        permalink: '/2026/01/waiting/',
        draft: true,
      },
    ]);
    const cms = await box.site({ contentDir });
    const agent = await signedIn(cms);

    await submit(agent, '/admin/posts/waiting', {
      permalink: '/somewhere-else/',
      action: 'save-draft',
    });

    const written = await readFile(path.join(contentDir, 'posts', '2026-01-02-waiting.md'), 'utf8');
    assert.match(written, /^permalink: \/somewhere-else\/$/m);
  });

  it('refiles a published post when the date changes, and leaves its URL where it was', async () => {
    const contentDir = await seeded([
      {
        file: 'posts/2026-01-02-published.md',
        title: 'Out in the world',
        date: '2026-01-02',
        permalink: '/2026/01/published/',
      },
    ]);
    const cms = await box.site({ contentDir });
    const agent = await signedIn(cms);

    await submit(agent, '/admin/posts/published', { date: '2026-05-06', action: 'update' });

    // The file follows the date, because that is how the archive is filed. The
    // permalink does not: it was promised to the fediverse under decision-13,
    // and correcting a date is not asking to break that.
    assert.deepEqual(await readdir(path.join(contentDir, 'posts')), ['2026-05-06-published.md']);
    assert.equal((await cms.app.request('/2026/01/published/')).status, 200);
    assert.equal((await cms.app.request('/2026/05/published/')).status, 404);
  });

  it('leaves a permalink somebody chose alone when a draft\u2019s slug moves', async () => {
    const contentDir = await seeded([
      {
        file: 'posts/2026-01-02-published.md',
        title: 'Out in the world',
        date: '2026-01-02',
        permalink: '/a-url-i-picked/',
        draft: true,
      },
    ]);
    const cms = await box.site({ contentDir });
    const agent = await signedIn(cms);

    await submit(agent, '/admin/posts/a-url-i-picked', {
      slug: 'renamed',
      action: 'save-draft',
    });

    assert.deepEqual(await readdir(path.join(contentDir, 'posts')), ['2026-01-02-renamed.md']);
    const written = await readFile(path.join(contentDir, 'posts', '2026-01-02-renamed.md'), 'utf8');
    assert.match(written, /^permalink: \/a-url-i-picked\/$/m);
  });
});

/** Where a response redirects to, asserting that the redirect is permanent. */
function movedTo(response: Response): string | null {
  assert.equal(response.status, 301, `expected a permanent redirect, got ${response.status}`);
  return response.headers.get('location');
}

describe('moving a published document (TASK-127)', () => {
  const PUBLISHED: Seed = {
    file: 'posts/2026-01-02-published.md',
    title: 'Out in the world',
    date: '2026-01-02',
    permalink: '/2026/01/published/',
  };

  it('redirects a renamed post’s old URL to the new one', async () => {
    const contentDir = await seeded([PUBLISHED]);
    const cms = await box.site({ contentDir });
    const agent = await signedIn(cms);

    const response = await submit(agent, '/admin/posts/published', {
      slug: 'out-in-the-world',
      action: 'update',
    });
    assert.equal(response.headers.get('location'), '/admin/posts/out-in-the-world');

    assert.equal(
      movedTo(await cms.app.request('/2026/01/published/')),
      '/2026/01/out-in-the-world/',
    );
    assert.equal((await cms.app.request('/2026/01/out-in-the-world/')).status, 200);
  });

  it('redirects a renamed page’s old URL to the new one', async () => {
    const contentDir = await seeded([
      { file: 'pages/about.md', title: 'About', permalink: '/about/' },
    ]);
    const cms = await box.site({ contentDir });
    const agent = await signedIn(cms);

    await submit(agent, '/admin/pages/about', { slug: 'about-me', action: 'update' });

    assert.equal(movedTo(await cms.app.request('/about/')), '/about-me/');
    assert.equal((await cms.app.request('/about-me/')).status, 200);
  });

  it('redirects when the permalink field itself is changed', async () => {
    const contentDir = await seeded([PUBLISHED]);
    const cms = await box.site({ contentDir });
    const agent = await signedIn(cms);

    await submit(agent, '/admin/posts/published', {
      permalink: '/a-url-i-picked/',
      action: 'update',
    });

    assert.equal(movedTo(await cms.app.request('/2026/01/published/')), '/a-url-i-picked/');
    assert.equal((await cms.app.request('/a-url-i-picked/')).status, 200);
  });

  it('collapses a chain: every earlier URL goes straight to the current one', async () => {
    const contentDir = await seeded([PUBLISHED]);
    const cms = await box.site({ contentDir });
    const agent = await signedIn(cms);

    await submit(agent, '/admin/posts/published', { slug: 'second', action: 'update' });
    await submit(agent, '/admin/posts/second', { slug: 'third', action: 'update' });

    assert.equal(movedTo(await cms.app.request('/2026/01/published/')), '/2026/01/third/');
    assert.equal(movedTo(await cms.app.request('/2026/01/second/')), '/2026/01/third/');
    assert.equal((await cms.app.request('/2026/01/third/')).status, 200);
  });

  it('records the old URLs in the file, so a deleted database keeps them working', async () => {
    const contentDir = await seeded([PUBLISHED]);
    const cms = await box.site({ contentDir });
    const agent = await signedIn(cms);

    await submit(agent, '/admin/posts/published', { slug: 'second', action: 'update' });
    await submit(agent, '/admin/posts/second', { slug: 'third', action: 'update' });

    const written = await readFile(path.join(contentDir, 'posts', '2026-01-02-third.md'), 'utf8');
    assert.match(
      written,
      /^redirect_from:\n {2}- \/2026\/01\/published\/\n {2}- \/2026\/01\/second\/$/m,
    );

    // A second site over the same content and an empty data directory: the
    // index is built from the files alone.
    const rebuilt = await box.open({ contentDir, dataDir: await box.dir('geekity-fresh-data-') });
    assert.equal(movedTo(await rebuilt.app.request('/2026/01/published/')), '/2026/01/third/');
    assert.equal(movedTo(await rebuilt.app.request('/2026/01/second/')), '/2026/01/third/');
  });

  it('lets a new document take an old URL over, and stops redirecting it', async () => {
    const contentDir = await seeded([PUBLISHED]);
    const cms = await box.site({ contentDir });
    const agent = await signedIn(cms);
    await submit(agent, '/admin/posts/published', { slug: 'renamed', action: 'update' });
    assert.equal(movedTo(await cms.app.request('/2026/01/published/')), '/2026/01/renamed/');

    await writeFile(
      path.join(contentDir, 'posts', '2026-01-09-published.md'),
      '---\ntitle: A new one\ndate: 2026-01-09\npermalink: /2026/01/published/\n---\n\nIt lives here now.\n',
      'utf8',
    );
    await cms.sync();

    const taken = await cms.app.request('/2026/01/published/');
    assert.equal(taken.status, 200);
    assert.match(await taken.text(), /It lives here now\./);
    assert.equal(
      (await cms.app.request('/2026/01/published/index.md')).status,
      200,
      'and so do its other representations',
    );
  });

  it('forgets the URL a document moves back to', async () => {
    const contentDir = await seeded([PUBLISHED]);
    const cms = await box.site({ contentDir });
    const agent = await signedIn(cms);

    await submit(agent, '/admin/posts/published', { slug: 'renamed', action: 'update' });
    await submit(agent, '/admin/posts/renamed', { slug: 'published', action: 'update' });

    assert.equal((await cms.app.request('/2026/01/published/')).status, 200);
    assert.equal(movedTo(await cms.app.request('/2026/01/renamed/')), '/2026/01/published/');
    const written = await readFile(
      path.join(contentDir, 'posts', '2026-01-02-published.md'),
      'utf8',
    );
    assert.match(written, /^redirect_from:\n {2}- \/2026\/01\/renamed\/$/m);
  });

  it('redirects the .md and .json of an old URL to the same representation', async () => {
    const contentDir = await seeded([PUBLISHED]);
    const cms = await box.site({ contentDir });
    const agent = await signedIn(cms);

    await submit(agent, '/admin/posts/published', { slug: 'renamed', action: 'update' });

    assert.equal(
      movedTo(await cms.app.request('/2026/01/published/index.md')),
      '/2026/01/renamed/index.md',
    );
    assert.equal(
      movedTo(await cms.app.request('/2026/01/published/index.json')),
      '/2026/01/renamed/index.json',
    );
    assert.equal(
      movedTo(await cms.app.request('/2026/01/published.json')),
      '/2026/01/renamed/index.json',
    );
    assert.equal(
      movedTo(await cms.app.request('/2026/01/published')),
      '/2026/01/renamed/',
      'and the old URL without its slash reaches the new one in one hop',
    );
  });

  it('records nothing for a draft, which promised no URL to anybody', async () => {
    const contentDir = await seeded([{ ...PUBLISHED, draft: true }]);
    const cms = await box.site({ contentDir });
    const agent = await signedIn(cms);

    await submit(agent, '/admin/posts/published', { slug: 'renamed', action: 'save-draft' });

    const written = await readFile(path.join(contentDir, 'posts', '2026-01-02-renamed.md'), 'utf8');
    assert.doesNotMatch(written, /redirect_from/);
    assert.doesNotMatch(written, /activitypub/);
  });
});

describe('a post migrated from somewhere else', () => {
  it('keeps the activitypub.id its file names through a save (decision-13)', async () => {
    const contentDir = await seeded([
      {
        file: 'posts/2011-06-06-old-news.md',
        title: 'Old news',
        date: '2011-06-06',
        permalink: '/2011/06/old-news/',
        extra: ['activitypub:', "  id: 'https://example.com/?p=813'", "  published: '2011-06-06'"],
      },
    ]);
    const cms = await box.site({ contentDir });
    const agent = await signedIn(cms);

    await submit(agent, '/admin/posts/old-news', {
      body: 'Rewritten, years later.',
      action: 'update',
    });

    const written = await readFile(
      path.join(contentDir, 'posts', '2011-06-06-old-news.md'),
      'utf8',
    );
    // The name its followers, its replies and its RSS subscribers hold.
    assert.match(written, /^ {2}id: https:\/\/example\.com\/\?p=813$/m);
    assert.equal(cms.store.getBySlug('old-news')?.activitypub?.id, 'https://example.com/?p=813');
  });
});

describe('the draft toggle', () => {
  it('hides a published post and shows it again', async () => {
    const contentDir = await seeded([
      {
        file: 'posts/2026-01-02-published.md',
        title: 'Out in the world',
        date: '2026-01-02',
        permalink: '/2026/01/published/',
      },
    ]);
    const cms = await box.site({ contentDir });
    const agent = await signedIn(cms);
    const file = path.join(contentDir, 'posts', '2026-01-02-published.md');

    await submit(agent, '/admin/posts/published', { draft: '1', action: 'update' });

    assert.match(await readFile(file, 'utf8'), /^draft: true$/m);
    assert.equal((await cms.app.request('/2026/01/published/')).status, 404);

    await submit(agent, '/admin/posts/published', { action: 'publish' });

    const republished = await readFile(file, 'utf8');
    assert.ok(!/^draft:/m.test(republished), 'a published post carries no draft key');
    assert.equal((await cms.app.request('/2026/01/published/')).status, 200);
  });
});

describe('the trash', () => {
  it('moves the file under content/_trash, takes it off the public site, and puts it back', async () => {
    const contentDir = await seeded([
      {
        file: 'posts/2026-01-02-published.md',
        title: 'Out in the world',
        date: '2026-01-02',
        permalink: '/2026/01/published/',
      },
    ]);
    const cms = await box.site({ contentDir });
    const agent = await signedIn(cms);

    const trashed = await submit(agent, '/admin/posts/published', { action: 'trash' });
    assert.equal(trashed.status, 303);
    assert.equal(trashed.headers.get('location'), '/admin/posts');

    assert.deepEqual(await readdir(path.join(contentDir, 'posts')), []);
    assert.deepEqual(await readdir(path.join(contentDir, '_trash', 'posts')), [
      '2026-01-02-published.md',
    ]);
    assert.equal((await cms.app.request('/2026/01/published/')).status, 404);
    assert.equal(cms.store.counts().trashed, 1);

    const restored = await submit(agent, '/admin/posts/published', { action: 'restore' });
    assert.equal(restored.status, 303);

    assert.deepEqual(await readdir(path.join(contentDir, 'posts')), ['2026-01-02-published.md']);
    assert.deepEqual(await readdir(path.join(contentDir, '_trash', 'posts')), []);
    assert.equal((await cms.app.request('/2026/01/published/')).status, 200);
    assert.equal(cms.store.counts().trashed, 0);
  });

  it('goes back to the listing the row was clicked in', async () => {
    const contentDir = await seeded([
      {
        file: 'posts/2026-01-01-hidden.md',
        title: 'Still cooking',
        date: '2026-01-01',
        permalink: '/2026/01/hidden/',
        draft: true,
      },
    ]);
    const cms = await box.site({ contentDir });
    const agent = await signedIn(cms);

    const listing = await (await agent.get('/admin/posts?status=draft')).text();
    const token = csrfField(listing);
    assert.ok(token !== undefined);
    assert.match(listing, /name="return" value="\/admin\/posts\?status=draft"/);

    const response = await agent.post('/admin/posts/hidden', {
      csrf_token: token,
      action: 'trash',
      return: '/admin/posts?status=draft',
    });

    assert.equal(response.headers.get('location'), '/admin/posts?status=draft');
    assert.match(
      await (await agent.get('/admin/posts?status=trash')).text(),
      /Moved to the trash: Still cooking/,
    );
  });

  it('refuses a return path that leads off the admin', async () => {
    const contentDir = await seeded([
      {
        file: 'posts/2026-01-02-published.md',
        title: 'Out in the world',
        date: '2026-01-02',
        permalink: '/2026/01/published/',
      },
    ]);
    const cms = await box.site({ contentDir });
    const agent = await signedIn(cms);

    const token = csrfField(await (await agent.get('/admin/posts')).text());
    assert.ok(token !== undefined);

    const response = await agent.post('/admin/posts/published', {
      csrf_token: token,
      action: 'trash',
      return: 'https://example.com/',
    });

    assert.equal(response.headers.get('location'), '/admin/posts');
  });
});

describe('a conflicting save', () => {
  it('shows both versions, writes nothing, and goes through once the fresh hash is carried', async () => {
    const contentDir = await seeded([
      {
        file: 'posts/2026-01-02-published.md',
        title: 'Out in the world',
        date: '2026-01-02',
        permalink: '/2026/01/published/',
        body: 'What the editor loaded.',
      },
    ]);
    const cms = await box.site({ contentDir });
    const agent = await signedIn(cms);
    const file = path.join(contentDir, 'posts', '2026-01-02-published.md');

    // The form is loaded, and then the file changes underneath it.
    const form = await (await agent.get('/admin/posts/published')).text();
    const token = csrfField(form);
    const staleHash = field(form, 'hash');
    assert.ok(token !== undefined && staleHash !== undefined);

    await writeFile(
      file,
      '---\ntitle: Out in the world\ndate: 2026-01-02\npermalink: /2026/01/published/\n---\n\nWhat somebody else wrote.\n',
      'utf8',
    );

    const refused = await agent.post('/admin/posts/published', {
      csrf_token: token,
      hash: staleHash,
      title: 'Out in the world',
      slug: 'published',
      permalink: '/2026/01/published/',
      date: '2026-01-02',
      tags: '',
      description: '',
      body: 'What I wrote in the editor.',
      action: 'update',
    });

    assert.equal(refused.status, 409);
    const html = await refused.text();
    assert.match(html, /What I wrote in the editor\./, 'the version that was submitted');
    assert.match(html, /What somebody else wrote\./, 'and the version on disk');

    assert.equal(
      await readFile(file, 'utf8'),
      '---\ntitle: Out in the world\ndate: 2026-01-02\npermalink: /2026/01/published/\n---\n\nWhat somebody else wrote.\n',
      'and the file is untouched',
    );

    // The conflict screen offers the same form back with the hash the file has
    // now, so a deliberate overwrite is one more click.
    const freshHash = field(html, 'hash');
    assert.ok(freshHash !== undefined && freshHash !== staleHash);

    const accepted = await agent.post('/admin/posts/published', {
      csrf_token: token,
      hash: freshHash,
      title: 'Out in the world',
      slug: 'published',
      permalink: '/2026/01/published/',
      date: '2026-01-02',
      tags: '',
      description: '',
      body: 'What I wrote in the editor.',
      action: 'update',
    });

    assert.equal(accepted.status, 303);
    assert.match(await readFile(file, 'utf8'), /What I wrote in the editor\./);
  });
});

/** Put a site in one zone, the way the settings screen would. */
async function setTimezone(contentDir: string, timezone: string): Promise<void> {
  await writeSiteJson({ contentDir, settings: { ...readSiteSettings(contentDir), timezone } });
}

describe('dates in the editor', () => {
  /** A site whose `timezone` setting is `zone`, over the given content. */
  async function siteIn(zone: string, documents: Seed[] = []) {
    const contentDir = await seeded(documents);
    const cms = await box.site({ contentDir });
    await setTimezone(contentDir, zone);
    return { cms, contentDir, agent: await signedIn(cms) };
  }

  it('reads an offset-less date as the wall clock in the site timezone and writes the instant', async () => {
    const { agent, contentDir } = await siteIn('America/Chicago');

    await submit(agent, '/admin/posts/new', {
      title: 'Hello from the editor',
      date: '2026-09-04 09:00:00',
      action: 'publish',
    });

    const written = await readFile(
      path.join(contentDir, 'posts', '2026-09-04-hello-from-the-editor.md'),
      'utf8',
    );
    assert.match(written, /^date: '2026-09-04T14:00:00Z'$/m);
    assert.match(
      written,
      /^updated: '\d{4}-\d{2}-\d{2}T[\d:.]+Z'$/m,
      'and updated is an instant too',
    );
  });

  it('files a new post under the calendar day the site zone was on, not the one UTC was', async () => {
    // Half past midnight on 1 October in Berlin is still 30 September in UTC.
    const { agent, contentDir } = await siteIn('Europe/Berlin');

    const response = await submit(agent, '/admin/posts/new', {
      title: 'Just after midnight',
      date: '2026-10-01 00:30:00',
      action: 'publish',
    });

    assert.equal(response.status, 303);
    const files = await readdir(path.join(contentDir, 'posts'));
    assert.deepEqual(files, ['2026-10-01-just-after-midnight.md']);

    const written = await readFile(path.join(contentDir, 'posts', files[0] ?? ''), 'utf8');
    assert.match(written, /^date: '2026-09-30T22:30:00Z'$/m);
    assert.match(written, /^permalink: \/2026\/10\/just-after-midnight\/$/m);
  });

  it('shows a stored instant as the wall clock in the site zone, with the zone named', async () => {
    const { agent } = await siteIn('America/Chicago', [
      {
        file: 'posts/2026-06-02-reading-the-index.md',
        title: 'Reading the index',
        date: "'2026-06-02T12:30:00Z'",
        permalink: '/2026/06/reading-the-index/',
      },
    ]);

    const html = await (await agent.get('/admin/posts/reading-the-index')).text();
    assert.equal(field(html, 'date'), '2026-06-02 07:30:00');
    assert.match(html, /America\/Chicago \(CDT\)/);
  });

  it('round-trips the instant unchanged when the date field is left alone', async () => {
    const { agent, contentDir } = await siteIn('America/Chicago', [
      {
        file: 'posts/2026-06-02-reading-the-index.md',
        title: 'Reading the index',
        date: "'2026-06-02T12:30:00Z'",
        permalink: '/2026/06/reading-the-index/',
      },
    ]);

    await submit(agent, '/admin/posts/reading-the-index', { action: 'update' });

    const written = await readFile(
      path.join(contentDir, 'posts', '2026-06-02-reading-the-index.md'),
      'utf8',
    );
    assert.match(written, /^date: '2026-06-02T12:30:00Z'$/m);
  });

  it('rewrites a hand-written offset as UTC the next time it is saved', async () => {
    const { agent, contentDir } = await siteIn('America/Chicago', [
      {
        file: 'posts/2026-06-02-reading-the-index.md',
        title: 'Reading the index',
        date: "'2026-06-02T07:30:00-05:00'",
        permalink: '/reading-the-index/',
      },
    ]);

    await submit(agent, '/admin/posts/reading-the-index', { action: 'update' });

    const written = await readFile(
      path.join(contentDir, 'posts', '2026-06-02-reading-the-index.md'),
      'utf8',
    );
    assert.match(written, /^date: '2026-06-02T12:30:00Z'$/m);
    assert.match(
      written,
      /^permalink: \/reading-the-index\/$/m,
      'and the URL it chose is untouched',
    );
  });

  it('keeps an existing URL where it is when the timezone setting moves', async () => {
    const { cms, agent, contentDir } = await siteIn('America/Chicago', [
      {
        file: 'posts/2026-10-01-just-after-midnight.md',
        title: 'Just after midnight',
        date: "'2026-10-01T04:30:00Z'",
        permalink: '/2026/10/just-after-midnight/',
      },
    ]);

    // 04:30 UTC on 1 October is still 30 September in Chicago but 1 October in
    // Berlin, so a zone-derived month would move this post to /2026/09/.
    await setTimezone(contentDir, 'America/Chicago');
    await submit(agent, '/admin/posts/just-after-midnight', { action: 'update' });

    const files = await readdir(path.join(contentDir, 'posts'));
    assert.deepEqual(files, ['2026-10-01-just-after-midnight.md']);
    const written = await readFile(path.join(contentDir, 'posts', files[0] ?? ''), 'utf8');
    assert.match(written, /^permalink: \/2026\/10\/just-after-midnight\/$/m);
    assert.equal(
      cms.store.getByPermalink('/2026/10/just-after-midnight/')?.title,
      'Just after midnight',
    );
  });
});
