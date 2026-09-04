import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import type { Cms } from '../index.ts';
import { csrfField, sandbox, signedIn } from './__testing__/harness.ts';
import type { Browser } from './__testing__/harness.ts';
import { applyTermChange } from './taxonomy.ts';

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
  draft?: boolean | undefined;
  extra?: string[] | undefined;
}

/** A site whose content directory holds exactly these documents. */
async function seeded(documents: Seed[]): Promise<Cms> {
  const contentDir = await box.dir('geekity-taxonomy-content-');

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
      ...(document.extra ?? []),
    ].filter((line) => line !== undefined);

    await writeFile(file, `---\n${frontMatter.join('\n')}\n---\n\nBody.\n`, 'utf8');
  }

  return box.site({ contentDir });
}

/** A small site: two published posts, a draft and a trashed one, all tagged. */
function corpus(): Seed[] {
  return [
    {
      file: 'posts/2026-01-01-oldest.md',
      title: 'Oldest',
      permalink: '/2026/01/oldest/',
      date: '2026-01-01T00:00:00Z',
      tags: ['eleventy', 'sqlite'],
      categories: ['general'],
    },
    {
      file: 'posts/2026-06-01-middle.md',
      title: 'Middle',
      permalink: '/2026/06/middle/',
      date: '2026-06-01T00:00:00Z',
      tags: ['eleventy'],
      categories: ['general', 'engineering'],
    },
    {
      file: 'posts/2026-09-01-a-draft.md',
      title: 'A Draft',
      permalink: '/2026/09/a-draft/',
      date: '2026-09-01T00:00:00Z',
      draft: true,
      tags: ['eleventy'],
      categories: ['general'],
    },
    {
      file: '_trash/posts/2026-09-02-thrown-away.md',
      title: 'Thrown Away',
      permalink: '/2026/09/thrown-away/',
      date: '2026-09-02T00:00:00Z',
      tags: ['eleventy'],
      categories: ['general'],
    },
  ];
}

/** One taxonomy screen's HTML, and the CSRF token that goes with it. */
async function screen(agent: Browser, url: string): Promise<{ html: string; token: string }> {
  const html = await (await agent.get(url)).text();
  const token = csrfField(html);
  assert.ok(token !== undefined, `the screen at ${url} carried a CSRF token`);
  return { html, token };
}

describe('applyTermChange', () => {
  it('renames a term where it stands', () => {
    assert.deepEqual(applyTermChange(['one', 'two', 'three'], 'two', 'ii'), ['one', 'ii', 'three']);
  });

  it('merges without duplicating a target the list already carried (AC #3)', () => {
    // The target keeps the place it already had rather than jumping to the
    // source's, so a merge reorders nothing.
    assert.deepEqual(applyTermChange(['one', 'two', 'three'], 'three', 'one'), ['one', 'two']);
    assert.deepEqual(applyTermChange(['one', 'two', 'three'], 'one', 'three'), ['two', 'three']);
  });

  it('deletes a term when there is nothing to rename it to (AC #4)', () => {
    assert.deepEqual(applyTermChange(['one', 'two', 'three'], 'two', undefined), ['one', 'three']);
  });

  it('leaves a list that does not carry the term exactly as it was', () => {
    const terms = ['one', 'two'];
    assert.deepEqual(applyTermChange(terms, 'three', 'iii'), terms);
    assert.deepEqual(applyTermChange(terms, 'three', undefined), terms);
  });

  it('is a no-op when a term is renamed to itself', () => {
    assert.deepEqual(applyTermChange(['one', 'two'], 'two', 'two'), ['one', 'two']);
  });
});

describe('the tags screen', () => {
  it('lists every term with its counts and a link to the archive (AC #1)', async () => {
    const cms = await seeded(corpus());
    const agent = await signedIn(cms);

    const { html } = await screen(agent, '/admin/tags');

    assert.match(html, /eleventy/, 'the tag in use is listed');
    assert.match(html, /sqlite/, 'so is the one only one post carries');
    assert.match(html, /href="\/tag\/eleventy\/"/, 'the term links to its archive');
    // Two published posts carry it; the draft and the trashed one carry it
    // too, and a rename would rewrite all four files.
    assert.match(html, /eleventy[\s\S]{0,400}>2</, 'the public count is the two published posts');
    assert.match(html, /eleventy[\s\S]{0,400}>4</, 'the file count is every file carrying it');
  });

  it('lists the categories on their own screen, at their own base (AC #1)', async () => {
    const cms = await seeded(corpus());
    const agent = await signedIn(cms);

    const { html } = await screen(agent, '/admin/categories');

    assert.match(html, /href="\/category\/general\/"/);
    assert.match(html, /engineering/);
    assert.doesNotMatch(html, /sqlite/, 'a tag is not a category');
  });
});

describe('renaming a term', () => {
  it('rewrites every file, announces each one, and reports the count (AC #2, #5)', async () => {
    const cms = await seeded(corpus());
    const agent = await signedIn(cms);
    const { token } = await screen(agent, '/admin/tags');

    const announced: string[] = [];
    cms.events.on('updated', (change) => announced.push(change.path));

    const response = await agent.post('/admin/tags/rename', {
      csrf_token: token,
      term: 'eleventy',
      to: '11ty',
    });

    assert.equal(response.status, 303);
    assert.equal(response.headers.get('location'), '/admin/tags');

    // Every file carrying it, the draft and the trashed one included.
    const files = [
      'posts/2026-01-01-oldest.md',
      'posts/2026-06-01-middle.md',
      'posts/2026-09-01-a-draft.md',
      '_trash/posts/2026-09-02-thrown-away.md',
    ];
    for (const file of files) {
      const source = await readFile(path.join(cms.config.contentDir, ...file.split('/')), 'utf8');
      assert.match(source, /11ty/, `${file} carries the new name`);
      assert.doesNotMatch(source, /eleventy/, `${file} no longer carries the old one`);
    }

    assert.deepEqual([...announced].sort(), [...files].sort(), 'every rewrite was announced');

    const after = await (await agent.get('/admin/tags')).text();
    assert.match(after, /Renamed “eleventy” to “11ty” in 4 files\./);
    assert.doesNotMatch(after, />eleventy</);
  });

  it('leaves the other taxonomy and the other terms alone', async () => {
    const cms = await seeded(corpus());
    const agent = await signedIn(cms);
    const { token } = await screen(agent, '/admin/tags');

    await agent.post('/admin/tags/rename', { csrf_token: token, term: 'eleventy', to: 'general' });

    const source = await readFile(
      path.join(cms.config.contentDir, 'posts', '2026-01-01-oldest.md'),
      'utf8',
    );
    // The post is now tagged `general` and still filed under the category of
    // the same name: the two taxonomies do not see each other.
    assert.match(source, /tags:\n\s+- general\n\s+- sqlite/);
    assert.match(source, /categories:\n\s+- general/);
  });
});

describe('deleting a term', () => {
  it('takes it out of every file and 404s the archive (AC #4, #5)', async () => {
    const cms = await seeded(corpus());
    const agent = await signedIn(cms);
    const { token } = await screen(agent, '/admin/categories');

    assert.equal((await cms.app.request('/category/engineering/')).status, 200);

    const response = await agent.post('/admin/categories/delete', {
      csrf_token: token,
      term: 'engineering',
    });

    assert.equal(response.status, 303);
    const source = await readFile(
      path.join(cms.config.contentDir, 'posts', '2026-06-01-middle.md'),
      'utf8',
    );
    assert.doesNotMatch(source, /engineering/, 'the file no longer carries it');
    assert.match(source, /categories:\n\s+- general/, 'the other category is untouched');

    assert.equal((await cms.app.request('/category/engineering/')).status, 404);

    const after = await (await agent.get('/admin/categories')).text();
    assert.match(after, /Deleted “engineering” from 1 file\./);
    assert.doesNotMatch(after, />engineering</);
  });

  it('takes the whole key out when it was the only term', async () => {
    const cms = await seeded(corpus());
    const agent = await signedIn(cms);
    const { token } = await screen(agent, '/admin/categories');

    await agent.post('/admin/categories/delete', { csrf_token: token, term: 'general' });

    const source = await readFile(
      path.join(cms.config.contentDir, 'posts', '2026-01-01-oldest.md'),
      'utf8',
    );
    assert.doesNotMatch(source, /categories/, 'an empty list is not written back as a key');
    assert.match(source, /tags:/, 'the tags are still there');
  });
});

describe('merging one term into another', () => {
  it('offers the merge rather than doing it, and does it once confirmed (AC #3)', async () => {
    const cms = await seeded(corpus());
    const agent = await signedIn(cms);
    const { token } = await screen(agent, '/admin/tags');

    const offered = await agent.post('/admin/tags/rename', {
      csrf_token: token,
      term: 'sqlite',
      to: 'eleventy',
    });

    assert.equal(offered.status, 200, 'a collision is a question, not a refusal');
    const question = await offered.text();
    assert.match(question, /Merge “sqlite” into “eleventy”\?/);
    assert.match(question, /on\s+4 files/, 'it says how big the target already is');

    // Nothing was written by the question.
    const before = await readFile(
      path.join(cms.config.contentDir, 'posts', '2026-01-01-oldest.md'),
      'utf8',
    );
    assert.match(before, /sqlite/);

    const done = await agent.post('/admin/tags/rename', {
      csrf_token: token,
      term: 'sqlite',
      to: 'eleventy',
      confirm: '1',
    });
    assert.equal(done.status, 303);

    // The one post carrying both keeps `eleventy` once, in the place it was
    // already in.
    const after = await readFile(
      path.join(cms.config.contentDir, 'posts', '2026-01-01-oldest.md'),
      'utf8',
    );
    assert.match(after, /tags:\n\s+- eleventy\ncategories:/);

    const screenAfter = await (await agent.get('/admin/tags')).text();
    assert.match(screenAfter, /Merged “sqlite” into “eleventy” in 1 file\./);
    assert.doesNotMatch(screenAfter, />sqlite</);
  });

  it('refuses a rename with nothing to rename, an empty name, or the same name', async () => {
    const cms = await seeded(corpus());
    const agent = await signedIn(cms);
    const { token } = await screen(agent, '/admin/tags');

    for (const [fields, message] of [
      [{ term: 'nothing-uses-this', to: 'x' }, /Nothing carries the tag/],
      [{ term: 'eleventy', to: '   ' }, /A tag needs a name\./],
      [{ term: 'eleventy', to: 'eleventy' }, /is what it is called already/],
    ] as const) {
      const response = await agent.post('/admin/tags/rename', { csrf_token: token, ...fields });
      assert.equal(response.status, 400, `${fields.term} → ${fields.to} was refused`);
      assert.match(await response.text(), message);
    }

    // Nothing was written by any of them.
    const source = await readFile(
      path.join(cms.config.contentDir, 'posts', '2026-01-01-oldest.md'),
      'utf8',
    );
    assert.match(
      source,
      /tags: \[eleventy, sqlite\]/,
      'the seeded file is byte-for-byte as it was',
    );
  });
});

describe('the archive of a renamed term', () => {
  it('redirects to the new one, feed and all, and is recorded in site.json (AC #2)', async () => {
    const cms = await seeded(corpus());
    const agent = await signedIn(cms);
    const { token } = await screen(agent, '/admin/tags');

    await agent.post('/admin/tags/rename', { csrf_token: token, term: 'eleventy', to: '11ty' });

    assert.equal((await cms.app.request('/tag/11ty/')).status, 200, 'the archive moved');

    const moved = await cms.app.request('/tag/eleventy/');
    assert.equal(moved.status, 301, 'the old archive URL redirects');
    assert.equal(moved.headers.get('location'), '/tag/11ty/');

    const feed = await cms.app.request('/tag/eleventy/feed/');
    assert.equal(feed.status, 301, 'so does its feed');
    assert.equal(feed.headers.get('location'), '/tag/11ty/feed/');

    // The rename is a fact about the site's URLs, so it lives in the file an
    // Eleventy build of the same content reads.
    const mirror: unknown = JSON.parse(
      await readFile(path.join(cms.config.contentDir, '_data', 'site.json'), 'utf8'),
    );
    assert.deepEqual((mirror as { taxonomyRedirects: unknown }).taxonomyRedirects, [
      { taxonomy: 'tag', from: 'eleventy', to: '11ty' },
    ]);
  });

  it('collapses a chain of renames rather than making the browser walk it', async () => {
    const cms = await seeded(corpus());
    const agent = await signedIn(cms);
    const { token } = await screen(agent, '/admin/tags');

    await agent.post('/admin/tags/rename', { csrf_token: token, term: 'eleventy', to: '11ty' });
    await agent.post('/admin/tags/rename', { csrf_token: token, term: '11ty', to: 'eleventy-2' });

    const first = await cms.app.request('/tag/eleventy/');
    assert.equal(first.headers.get('location'), '/tag/eleventy-2/', 'one hop, not two');
    assert.equal((await cms.app.request('/tag/11ty/')).headers.get('location'), '/tag/eleventy-2/');
  });

  it('stops redirecting once the archive answers again, and after a delete', async () => {
    const cms = await seeded(corpus());
    const agent = await signedIn(cms);
    const { token } = await screen(agent, '/admin/tags');

    await agent.post('/admin/tags/rename', { csrf_token: token, term: 'eleventy', to: '11ty' });
    await agent.post('/admin/tags/rename', { csrf_token: token, term: 'sqlite', to: 'eleventy' });

    // `eleventy` exists again, so it is served rather than redirected: an
    // archive that is there always wins over a record of what used to be.
    assert.equal((await cms.app.request('/tag/eleventy/')).status, 200);

    await agent.post('/admin/tags/delete', { csrf_token: token, term: '11ty' });

    // Nothing carries `11ty` now, and the term `eleventy` was renamed to it,
    // so the old archive URL 404s rather than pointing at a 404.
    assert.equal((await cms.app.request('/tag/11ty/')).status, 404);
  });
});
