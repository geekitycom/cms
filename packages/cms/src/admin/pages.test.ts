import assert from 'node:assert/strict';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { csrfField, sandbox, signedIn } from './__testing__/harness.ts';
import type { Browser } from './__testing__/harness.ts';

const box = sandbox();
after(() => box.cleanup());

/** One page file in a content directory, written the way a site's would be. */
interface Seed {
  file: string;
  title: string;
  permalink: string;
  updated?: string | undefined;
  author?: string | undefined;
  description?: string | undefined;
  draft?: boolean | undefined;
  body?: string | undefined;
  extra?: string[] | undefined;
}

/** A content directory holding exactly these pages. */
async function seeded(documents: Seed[]): Promise<string> {
  const contentDir = await box.dir('geekity-pages-content-');

  for (const document of documents) {
    const file = path.join(contentDir, ...document.file.split('/'));
    await mkdir(path.dirname(file), { recursive: true });

    const frontMatter = [
      `title: ${document.title}`,
      `permalink: ${document.permalink}`,
      document.updated === undefined ? undefined : `updated: ${document.updated}`,
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

/** Whether the editor's checkbox of this name was rendered ticked. */
function checked(html: string, name: string): boolean {
  const match = new RegExp(`name="${name}" type="checkbox"[^>]*>`).exec(html);
  assert.ok(match !== null, `the editor carried a ${name} checkbox`);
  return match[0].includes(' checked');
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
    description: field(html, 'description') ?? '',
    body: /<textarea[^>]*name="body"[^>]*>([\s\S]*?)<\/textarea>/.exec(html)?.[1] ?? '',
    ...(checked(html, 'exclude') ? { exclude: '1' } : {}),
    ...(checked(html, 'navigation') ? { navigation: '1' } : {}),
    navigation_order: field(html, 'navigation_order') ?? '',
    action: 'update',
    ...changes,
  };

  // A browser leaves an unticked checkbox out of the body altogether, so a
  // test that clears one says so with an empty value and it goes the same way.
  if (fields['exclude'] === '') delete fields['exclude'];
  if (fields['navigation'] === '') delete fields['navigation'];

  const saveUrl = /<form class="admin-editor" method="post" action="([^"]+)"/.exec(html)?.[1];
  assert.ok(saveUrl !== undefined, 'the editor knew where to post');

  return agent.post(saveUrl, fields);
}

describe('the pages listing', () => {
  it('shows every live page with its author, updated date and status', async () => {
    const contentDir = await seeded([
      {
        file: 'pages/about.md',
        title: 'About this site',
        permalink: '/about/',
        updated: '2026-01-02T09:00:00Z',
        author: 'ada',
      },
      {
        file: 'pages/colophon.md',
        title: 'Still writing it',
        permalink: '/colophon/',
        draft: true,
      },
    ]);
    const cms = await box.site({ contentDir });
    const agent = await signedIn(cms);

    const response = await agent.get('/admin/pages');
    assert.equal(response.status, 200);

    const html = await response.text();
    assert.match(html, /<a href="\/admin\/pages\/about">About this site<\/a>/);
    assert.match(html, /<a href="\/admin\/pages\/colophon">Still writing it<\/a>/);
    assert.match(html, />ada</, 'the author column');
    assert.match(html, /<th scope="col">Updated<\/th>/, 'the updated column');
    assert.match(html, /2026-01-02/, 'and the date in it');
    assert.match(html, /admin-status-draft">Draft</, 'and which of them is a draft');
    assert.ok(!/<th scope="col">Tags<\/th>/.test(html), 'a page carries no tags');
    assert.ok(!/<th scope="col">Date<\/th>/.test(html), 'and no publish date');
  });
});

describe('the page editor', () => {
  it('offers the fields a page has, and none of the ones only a post has', async () => {
    const cms = await box.site({ contentDir: await seeded([]) });
    const agent = await signedIn(cms);

    const response = await agent.get('/admin/pages/new');
    assert.equal(response.status, 200);

    const html = await response.text();
    for (const name of ['title', 'slug', 'permalink', 'description', 'body']) {
      assert.match(html, new RegExp(`name="${name}"`), name);
    }
    assert.match(html, /name="draft" type="checkbox"/, 'the draft checkbox');
    assert.match(html, /name="exclude" type="checkbox"/, 'and the collections checkbox');
    assert.ok(!/name="date"/.test(html), 'a page has no publish date');
    assert.ok(!/name="tags"/.test(html), 'and no tags');

    assert.match(html, /name="action" value="save-draft">Save draft</);
    assert.match(html, /name="action" value="publish">Publish</);
  });

  it('fills itself in from the page, and offers Update, trash and View', async () => {
    const contentDir = await seeded([
      {
        file: 'pages/about.md',
        title: 'About this site',
        permalink: '/about/',
        description: 'Who writes it.',
        body: 'The body of the thing.',
      },
    ]);
    const cms = await box.site({ contentDir });
    const agent = await signedIn(cms);

    const html = await (await agent.get('/admin/pages/about')).text();
    const document = cms.store.getBySlug('about');
    assert.ok(document !== undefined);

    assert.match(html, /name="title" type="text" value="About this site"/);
    assert.match(html, /name="slug" type="text" value="about"/);
    assert.match(html, /name="permalink" type="text" value="\/about\/"/);
    assert.match(html, /The body of the thing\./);
    assert.match(html, new RegExp(`name="hash" value="${document.hash}"`));

    assert.match(html, /name="action" value="update">Update</);
    assert.match(html, /name="action" value="trash">Move to trash</);
    assert.match(html, /<a[^>]+href="\/about\/"[^>]*>View<\/a>/);
  });

  it('is a 404 for a page that is not there', async () => {
    const cms = await box.site({ contentDir: await seeded([]) });
    const agent = await signedIn(cms);

    assert.equal((await agent.get('/admin/pages/never-written')).status, 404);
  });
});

describe('writing a page', () => {
  it('writes content/pages/{slug}.md and the public site serves it at its permalink', async () => {
    const contentDir = await seeded([]);
    const cms = await box.site({ contentDir });
    const agent = await signedIn(cms);

    const response = await submit(agent, '/admin/pages/new', {
      title: 'About this site',
      description: 'Who writes it.',
      body: 'Written in a textarea.',
      action: 'publish',
    });

    assert.equal(response.status, 303);
    assert.equal(response.headers.get('location'), '/admin/pages/about-this-site');

    assert.deepEqual(
      await readdir(path.join(contentDir, 'pages')),
      ['about-this-site.md'],
      'no date prefix on a page filename',
    );

    const written = await readFile(path.join(contentDir, 'pages', 'about-this-site.md'), 'utf8');
    assert.match(written, /^title: About this site$/m);
    assert.match(written, /^permalink: \/about-this-site\/$/m);
    assert.ok(!/^date:/m.test(written), 'a page carries no publish date');
    assert.ok(!/^tags:/m.test(written), 'and no tags');

    const live = await cms.app.request('/about-this-site/');
    assert.equal(live.status, 200, 'the public site is serving it without a restart');
    assert.match(await live.text(), /Written in a textarea\./);
  });

  it('edits the file and the public page without a restart', async () => {
    const contentDir = await seeded([
      { file: 'pages/about.md', title: 'About', permalink: '/about/', body: 'The first draft.' },
    ]);
    const cms = await box.site({ contentDir });
    const agent = await signedIn(cms);

    const response = await submit(agent, '/admin/pages/about', {
      body: 'The second draft.',
      action: 'update',
    });
    assert.equal(response.status, 303);

    const written = await readFile(path.join(contentDir, 'pages', 'about.md'), 'utf8');
    assert.match(written, /The second draft\./);
    assert.match(written, /^updated: /m, 'doc-2 asks for an updated stamp on every save');

    const live = await cms.app.request('/about/');
    assert.equal(live.status, 200);
    assert.match(await live.text(), /The second draft\./);
  });
});

describe('a page and its collections', () => {
  it('writes eleventyExcludeFromCollections when the box is ticked, and nothing when it is not', async () => {
    const contentDir = await seeded([]);
    const cms = await box.site({ contentDir });
    const agent = await signedIn(cms);

    await submit(agent, '/admin/pages/new', { title: 'Listed', action: 'publish' });
    const listed = await readFile(path.join(contentDir, 'pages', 'listed.md'), 'utf8');
    assert.ok(
      !/eleventyExcludeFromCollections/.test(listed),
      'an untouched box leaves the key out of the file altogether',
    );

    await submit(agent, '/admin/pages/new', {
      title: 'Unlisted',
      exclude: '1',
      action: 'publish',
    });
    const unlisted = await readFile(path.join(contentDir, 'pages', 'unlisted.md'), 'utf8');
    assert.match(unlisted, /^eleventyExcludeFromCollections: true$/m);
    assert.equal(cms.store.getBySlug('unlisted')?.extra['eleventyExcludeFromCollections'], true);

    assert.ok(
      checked(await (await agent.get('/admin/pages/unlisted')).text(), 'exclude'),
      'and the editor comes back with the box ticked',
    );
  });

  it('keeps the key when the file already carried it, and turns it off rather than dropping it', async () => {
    const contentDir = await seeded([
      {
        file: 'pages/about.md',
        title: 'About',
        permalink: '/about/',
        extra: ['eleventyExcludeFromCollections: true', 'hero: /uploads/hero.jpg'],
      },
    ]);
    const cms = await box.site({ contentDir });
    const agent = await signedIn(cms);

    const html = await (await agent.get('/admin/pages/about')).text();
    assert.ok(checked(html, 'exclude'), 'the file said so, so the box is ticked');

    await submit(agent, '/admin/pages/about', { exclude: '', action: 'update' });

    const written = await readFile(path.join(contentDir, 'pages', 'about.md'), 'utf8');
    assert.match(written, /^eleventyExcludeFromCollections: false$/m);
    assert.match(written, /^hero: \/uploads\/hero\.jpg$/m, 'other hand-added keys survive too');
    assert.equal(cms.store.getBySlug('about')?.extra['eleventyExcludeFromCollections'], false);
  });

  it('never writes the key onto a post', async () => {
    const contentDir = await seeded([]);
    await mkdir(path.join(contentDir, 'posts'), { recursive: true });
    await writeFile(
      path.join(contentDir, 'posts', '2026-01-02-published.md'),
      '---\ntitle: Out in the world\ndate: 2026-01-02\npermalink: /2026/01/published/\n---\n\nBody.\n',
      'utf8',
    );
    const cms = await box.site({ contentDir });
    const agent = await signedIn(cms);

    const html = await (await agent.get('/admin/posts/published')).text();
    assert.ok(!/name="exclude"/.test(html), 'a post editor has no such checkbox');

    const token = csrfField(html);
    assert.ok(token !== undefined);
    await agent.post('/admin/posts/published', {
      csrf_token: token,
      hash: field(html, 'hash') ?? '',
      title: 'Out in the world',
      slug: 'published',
      permalink: '/2026/01/published/',
      date: '2026-01-02',
      tags: '',
      description: '',
      body: 'Body.',
      // A hand-crafted post of the field the page form carries.
      exclude: '1',
      action: 'update',
    });

    const written = await readFile(
      path.join(contentDir, 'posts', '2026-01-02-published.md'),
      'utf8',
    );
    assert.ok(!/eleventyExcludeFromCollections/.test(written));
  });
});

describe('the page trash', () => {
  it('moves the file under content/_trash, takes it off the public site, and puts it back', async () => {
    const contentDir = await seeded([
      { file: 'pages/about.md', title: 'About', permalink: '/about/' },
    ]);
    const cms = await box.site({ contentDir });
    const agent = await signedIn(cms);

    const trashed = await submit(agent, '/admin/pages/about', { action: 'trash' });
    assert.equal(trashed.status, 303);
    assert.equal(trashed.headers.get('location'), '/admin/pages');

    assert.deepEqual(await readdir(path.join(contentDir, 'pages')), []);
    assert.deepEqual(await readdir(path.join(contentDir, '_trash', 'pages')), ['about.md']);
    assert.equal((await cms.app.request('/about/')).status, 404);
    assert.equal(cms.store.counts().trashed, 1);

    const restored = await submit(agent, '/admin/pages/about', { action: 'restore' });
    assert.equal(restored.status, 303);

    assert.deepEqual(await readdir(path.join(contentDir, 'pages')), ['about.md']);
    assert.deepEqual(await readdir(path.join(contentDir, '_trash', 'pages')), []);
    assert.equal((await cms.app.request('/about/')).status, 200);
    assert.equal(cms.store.counts().trashed, 0);
  });

  it('filters to published, drafts and the trash', async () => {
    const contentDir = await seeded([
      { file: 'pages/about.md', title: 'About this site', permalink: '/about/' },
      {
        file: 'pages/colophon.md',
        title: 'Still writing it',
        permalink: '/colophon/',
        draft: true,
      },
      { file: '_trash/pages/old.md', title: 'Thrown away', permalink: '/old/' },
    ]);
    const cms = await box.site({ contentDir });
    const agent = await signedIn(cms);

    // Sorted, because undated pages all tie on the listing's sort key and the
    // filter is what is under test, not the order the rows come back in.
    const titles = async (query: string): Promise<string[]> => {
      const html = await (await agent.get(`/admin/pages${query}`)).text();
      return [...html.matchAll(/<td><a href="\/admin\/pages\/[^"]+">([^<]+)<\/a><\/td>/g)]
        .map((match) => match[1] ?? '')
        .sort();
    };

    assert.deepEqual(
      await titles(''),
      ['About this site', 'Still writing it'],
      'all, minus the bin',
    );
    assert.deepEqual(await titles('?status=published'), ['About this site']);
    assert.deepEqual(await titles('?status=draft'), ['Still writing it']);
    assert.deepEqual(await titles('?status=trash'), ['Thrown away']);
  });
});

describe('a page in the site menu', () => {
  it('writes navigation when the box is ticked, and brings it back ticked (AC #2)', async () => {
    const contentDir = await seeded([]);
    const cms = await box.site({ contentDir });
    const agent = await signedIn(cms);

    await submit(agent, '/admin/pages/new', { title: 'Hidden', action: 'publish' });
    const hidden = await readFile(path.join(contentDir, 'pages', 'hidden.md'), 'utf8');
    assert.ok(!/navigation/.test(hidden), 'an untouched box leaves the key out of the file');

    await submit(agent, '/admin/pages/new', {
      title: 'About',
      navigation: '1',
      navigation_order: '2',
      action: 'publish',
    });

    const written = await readFile(path.join(contentDir, 'pages', 'about.md'), 'utf8');
    assert.match(written, /^navigation: true$/m);
    assert.match(written, /^navigationOrder: 2$/m);
    assert.equal(cms.store.getBySlug('about')?.extra['navigation'], true);
    assert.equal(cms.store.getBySlug('about')?.extra['navigationOrder'], 2);

    const back = await (await agent.get('/admin/pages/about')).text();
    assert.ok(checked(back, 'navigation'), 'the editor comes back with the box ticked');
    assert.equal(field(back, 'navigation_order'), '2');

    const home = await (await cms.app.request('/')).text();
    assert.match(home, /<nav class="site-nav"[\s\S]*?>About</, 'and the page is on the menu');
  });

  it('takes the keys back out when the box is cleared', async () => {
    const contentDir = await seeded([
      {
        file: 'pages/about.md',
        title: 'About',
        permalink: '/about/',
        extra: ['navigation: true', 'navigationOrder: 3', 'hero: /uploads/hero.jpg'],
      },
    ]);
    const cms = await box.site({ contentDir });
    const agent = await signedIn(cms);

    const html = await (await agent.get('/admin/pages/about')).text();
    assert.ok(checked(html, 'navigation'), 'the file said so, so the box is ticked');
    assert.equal(field(html, 'navigation_order'), '3');

    await submit(agent, '/admin/pages/about', { navigation: '', action: 'update' });

    const written = await readFile(path.join(contentDir, 'pages', 'about.md'), 'utf8');
    assert.ok(!/^navigation:/m.test(written), 'a page off the menu carries no navigation key');
    assert.ok(!/^navigationOrder:/m.test(written), 'nor an order it no longer uses');
    assert.match(written, /^hero: \/uploads\/hero\.jpg$/m, 'other hand-added keys survive');

    const home = await (await cms.app.request('/')).text();
    assert.ok(!/site-nav/.test(home), 'and the menu is empty again');
  });

  it('never writes the keys onto a post', async () => {
    const contentDir = await seeded([]);
    await mkdir(path.join(contentDir, 'posts'), { recursive: true });
    await writeFile(
      path.join(contentDir, 'posts', '2026-01-02-published.md'),
      '---\ntitle: Out in the world\ndate: 2026-01-02\npermalink: /2026/01/published/\n---\n\nBody.\n',
      'utf8',
    );
    const cms = await box.site({ contentDir });
    const agent = await signedIn(cms);

    const html = await (await agent.get('/admin/posts/published')).text();
    assert.ok(!/name="navigation"/.test(html), 'a post editor has no such checkbox');

    const token = csrfField(html);
    assert.ok(token !== undefined);
    await agent.post('/admin/posts/published', {
      csrf_token: token,
      hash: field(html, 'hash') ?? '',
      title: 'Out in the world',
      slug: 'published',
      permalink: '/2026/01/published/',
      date: '2026-01-02',
      tags: '',
      description: '',
      body: 'Body.',
      navigation: '1',
      navigation_order: '1',
      action: 'update',
    });

    const written = await readFile(
      path.join(contentDir, 'posts', '2026-01-02-published.md'),
      'utf8',
    );
    assert.ok(!/navigation/.test(written));
  });
});
