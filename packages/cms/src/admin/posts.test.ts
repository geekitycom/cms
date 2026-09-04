import assert from 'node:assert/strict';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { csrfField, sandbox, signedIn } from './__testing__/harness.ts';
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

  it('refuses a post with no title and writes nothing', async () => {
    const contentDir = await seeded([]);
    const cms = await box.site({ contentDir });
    const agent = await signedIn(cms);

    const response = await submit(agent, '/admin/posts/new', { title: '  ', action: 'publish' });

    assert.equal(response.status, 400);
    assert.match(await response.text(), /needs a title/);
    assert.equal(cms.store.counts().total, 0);
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

  it('renames the file when the slug changes, and takes the permalink with it', async () => {
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

    const response = await submit(agent, '/admin/posts/published', {
      slug: 'out-in-the-world',
      action: 'update',
    });

    assert.equal(response.headers.get('location'), '/admin/posts/out-in-the-world');
    assert.deepEqual(await readdir(path.join(contentDir, 'posts')), [
      '2026-01-02-out-in-the-world.md',
    ]);

    const written = await readFile(
      path.join(contentDir, 'posts', '2026-01-02-out-in-the-world.md'),
      'utf8',
    );
    assert.match(written, /^permalink: \/2026\/01\/out-in-the-world\/$/m);

    assert.equal((await cms.app.request('/2026/01/out-in-the-world/')).status, 200);
    assert.equal((await cms.app.request('/2026/01/published/')).status, 404, 'the old URL is gone');
  });

  it('renames the file when the date changes', async () => {
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

    assert.deepEqual(await readdir(path.join(contentDir, 'posts')), ['2026-05-06-published.md']);
    assert.equal((await cms.app.request('/2026/05/published/')).status, 200);
  });

  it('leaves a permalink somebody chose alone when the slug moves', async () => {
    const contentDir = await seeded([
      {
        file: 'posts/2026-01-02-published.md',
        title: 'Out in the world',
        date: '2026-01-02',
        permalink: '/a-url-i-picked/',
      },
    ]);
    const cms = await box.site({ contentDir });
    const agent = await signedIn(cms);

    await submit(agent, '/admin/posts/a-url-i-picked', {
      slug: 'renamed',
      action: 'update',
    });

    assert.deepEqual(await readdir(path.join(contentDir, 'posts')), ['2026-01-02-renamed.md']);
    assert.equal(
      (await cms.app.request('/a-url-i-picked/')).status,
      200,
      'the URL people already have still works',
    );
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
