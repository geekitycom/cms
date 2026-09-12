import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { csrfField, sandbox, signedIn, signIn } from './__testing__/harness.ts';
import type { Browser } from './__testing__/harness.ts';

const box = sandbox();
after(() => box.cleanup());

/** One Markdown file in a content directory, written the way a site's would be. */
interface Seed {
  file: string;
  title: string;
  permalink: string;
  date?: string | undefined;
  draft?: boolean | undefined;
}

/** A content directory holding exactly these documents. */
async function seeded(documents: Seed[]): Promise<string> {
  const contentDir = await box.dir('geekity-dashboard-content-');

  for (const document of documents) {
    const file = path.join(contentDir, ...document.file.split('/'));
    await mkdir(path.dirname(file), { recursive: true });

    const frontMatter = [
      `title: ${document.title}`,
      document.date === undefined ? undefined : `date: ${document.date}`,
      `permalink: ${document.permalink}`,
      document.draft === true ? 'draft: true' : undefined,
    ].filter((line) => line !== undefined);

    await writeFile(file, `---\n${frontMatter.join('\n')}\n---\n\nBody.\n`, 'utf8');
  }

  return contentDir;
}

/**
 * Save a new draft post through the editor, the way a browser would: load the
 * form for its CSRF token and post the fields back with the save-draft action.
 * The tests below only need a post to exist and a flash to have been queued.
 */
async function newDraft(agent: Browser, title: string): Promise<Response> {
  const html = await (await agent.get('/admin/posts/new')).text();
  const token = csrfField(html);
  assert.ok(token !== undefined, 'the editor carries a form with a CSRF token');

  const saveUrl = /<form class="admin-editor" method="post" action="([^"]+)"/.exec(html)?.[1];
  assert.ok(saveUrl !== undefined, 'the editor knew where to post');

  return agent.post(saveUrl, {
    csrf_token: token,
    hash: '',
    title,
    slug: '',
    permalink: '',
    date: '',
    tags: '',
    description: '',
    body: '',
    action: 'save-draft',
  });
}

describe('the admin shell', () => {
  it('links to every section doc-5 lists, and marks the one being shown', async () => {
    const cms = await box.site();
    const agent = await signedIn(cms);

    const html = await (await agent.get('/admin')).text();

    for (const [label, url] of [
      ['Dashboard', '/admin'],
      ['Posts', '/admin/posts'],
      ['Pages', '/admin/pages'],
      ['Settings', '/admin/settings'],
      ['Users', '/admin/users'],
      ['Federation', '/admin/federation'],
    ] as const) {
      assert.match(html, new RegExp(`<a href="${url}"[^>]*>${label}</a>`), url);
    }

    assert.match(
      html,
      /<a href="\/admin" aria-current="page">Dashboard<\/a>/,
      'the dashboard link is the current one',
    );
  });

  it('answers every section it links to, and marks that one instead', async () => {
    const cms = await box.site();
    const agent = await signedIn(cms);

    const sections: [url: string, label: string][] = [
      ['/admin/posts', 'Posts'],
      ['/admin/pages', 'Pages'],
      ['/admin/settings', 'Settings'],
      ['/admin/users', 'Users'],
      ['/admin/federation', 'Federation'],
    ];

    for (const [url, label] of sections) {
      const response = await agent.get(url);
      assert.equal(response.status, 200, url);
      assert.match(
        await response.text(),
        new RegExp(`<a href="${url}" aria-current="page">${label}</a>`),
        url,
      );
    }
  });

  it('carries the site name, a link to the public site, the user and a logout form', async () => {
    const cms = await box.site();
    const agent = await signedIn(cms);

    const html = await (await agent.get('/admin')).text();

    assert.match(html, /class="admin-bar-site"[^>]*>Geekity</);
    assert.match(html, /<a href="\/">View site<\/a>/);
    assert.match(html, /Signed in as ada/);
    assert.match(html, /<form method="post" action="\/admin\/logout">/);
  });

  it('leaves the login page without navigation', async () => {
    const cms = await box.site();
    await signedIn(cms);

    const html = await (await cms.app.request('/admin/login')).text();

    assert.match(html, /<h1>Log in<\/h1>/);
    assert.ok(!/admin-nav/.test(html), 'nowhere to navigate until you are in');
  });
});

describe('the dashboard', () => {
  it('counts what the index holds', async () => {
    const contentDir = await seeded([
      { file: 'posts/2026-01-01-one.md', title: 'One', date: '2026-01-01', permalink: '/one/' },
      { file: 'posts/2026-01-02-two.md', title: 'Two', date: '2026-01-02', permalink: '/two/' },
      {
        file: 'posts/2026-01-03-three.md',
        title: 'Three',
        date: '2026-01-03',
        permalink: '/three/',
        draft: true,
      },
      { file: 'pages/about.md', title: 'About', permalink: '/about/' },
    ]);
    const cms = await box.site({ contentDir });
    const agent = await signedIn(cms);

    const html = await (await agent.get('/admin')).text();

    assert.deepEqual(cms.store.counts(), {
      total: 4,
      posts: 2,
      pages: 1,
      drafts: 1,
      scheduled: 0,
      trashed: 0,
    });
    assert.match(html, /Published posts<\/dt>\s*<dd>2<\/dd>/);
    assert.match(html, /Drafts<\/dt>\s*<dd>1<\/dd>/);
    assert.match(html, /Pages<\/dt>\s*<dd>1<\/dd>/);
  });

  it('lists the five most recent posts, newest first, with their status', async () => {
    const contentDir = await seeded(
      Array.from({ length: 7 }, (_, index) => {
        const day = String(index + 1).padStart(2, '0');
        return {
          file: `posts/2026-02-${day}-post-${String(index + 1)}.md`,
          title: `Post ${String(index + 1)}`,
          date: `2026-02-${day}`,
          permalink: `/2026/02/post-${String(index + 1)}/`,
          draft: index === 6,
        };
      }),
    );
    const cms = await box.site({ contentDir });
    const agent = await signedIn(cms);

    const html = await (await agent.get('/admin')).text();
    const listed = [...html.matchAll(/<a href="\/admin\/posts\/([^"]+)">([^<]+)<\/a>/g)];

    assert.deepEqual(
      listed.map((match) => match[2]),
      ['Post 7', 'Post 6', 'Post 5', 'Post 4', 'Post 3'],
      'the five newest, newest first',
    );
    assert.deepEqual(
      listed.map((match) => match[1]),
      ['post-7', 'post-6', 'post-5', 'post-4', 'post-3'],
      'each linking to its editor',
    );
    assert.match(html, /2026-02-07/, 'and carrying its date');
    assert.match(html, /admin-status-draft">Draft</, 'and saying which one is a draft');
  });

  it('says so when there is nothing written yet', async () => {
    const cms = await box.site();
    const agent = await signedIn(cms);

    assert.match(await (await agent.get('/admin')).text(), /Nothing written yet/);
  });
});

describe('flash messages', () => {
  it('survive one redirect and then clear', async () => {
    const cms = await box.site({ contentDir: await seeded([]) });
    const agent = await signedIn(cms);

    const created = await newDraft(agent, 'Kept for one page');
    const editor = created.headers.get('location');
    assert.ok(editor !== null);

    const first = await (await agent.get(editor)).text();
    assert.match(first, /Draft saved: Kept for one page/);
    assert.match(first, /class="admin-flash/);

    const second = await (await agent.get(editor)).text();
    assert.ok(!/Draft saved/.test(second), 'a flash is shown once and then gone');
  });

  it('are not shown to a different session', async () => {
    const cms = await box.site({ contentDir: await seeded([]) });
    const agent = await signedIn(cms);
    await newDraft(agent, 'Mine alone');

    const stranger = await signIn(cms);
    const html = await (await stranger.get('/admin')).text();

    assert.match(html, /Mine alone/, 'the stranger sees the draft in the listing');
    assert.ok(!/admin-flash/.test(html), 'but not the message queued for someone else');
  });
});
