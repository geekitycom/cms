import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { flashes } from './__testing__/flash.ts';
import { csrfField, sandbox, signedIn, signIn } from './__testing__/harness.ts';
import { findUser, setUserProfile } from './accounts.ts';
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
  it('lists every section doc-5 lists, each landing on its first child', async () => {
    const cms = await box.site();
    const agent = await signedIn(cms);

    const html = await (await agent.get('/admin')).text();

    for (const [label, url] of [
      ['Dashboard', '/admin'],
      ['Posts', '/admin/posts'],
      ['Pages', '/admin/pages'],
      ['Media', '/admin/media'],
      ['Comments', '/admin/comments'],
      ['Messages', '/admin/messages'],
      ['Users', '/admin/users'],
      ['Settings', '/admin/settings'],
      ['Federation', '/admin/federation'],
    ] as const) {
      assert.match(html, new RegExp(`<a[^>]*href="${url}"[^>]*>${label}</a>`), url);
    }

    assert.match(
      html,
      /<a\b[^>]*href="\/admin" aria-current="page">Home<\/a>/,
      'the dashboard is open on its own first child',
    );
  });

  it('carries the site name, a link to the public site and the account menu', async () => {
    const cms = await box.site();
    const agent = await signedIn(cms);

    const html = await (await agent.get('/admin')).text();

    assert.match(html, /class="admin-bar-site"[^>]*>Geekity</);
    assert.match(html, /<a href="\/">View site<\/a>/);
    assert.doesNotMatch(html, /Signed in as/);
  });

  it('leaves the login page without navigation', async () => {
    const cms = await box.site();
    await signedIn(cms);

    const html = await (await cms.app.request('/admin/login')).text();

    assert.match(html, /<h1\b[^>]*>Log in<\/h1>/);
    assert.ok(!/aria-label="Sections"/.test(html), 'nowhere to navigate until you are in');
  });
});

/** The account menu's button and the popover it controls, out of a page. */
function accountMenu(html: string): { button: string; menu: string } {
  const button = /<button[^>]*popovertarget="admin-account-menu"[^>]*>([^<]*)<\/button>/.exec(html);
  assert.ok(button, 'the bar has a button that controls the account menu');
  const menu = /<div id="admin-account-menu"[^>]*\bpopover\b[^>]*>([\s\S]*?)<\/div>/.exec(html);
  assert.ok(menu, 'and the menu is a popover');
  return { button: (button[1] ?? '').trim(), menu: menu[1] ?? '' };
}

describe('the admin bar inside the admin (TASK-183)', () => {
  /** The links in the admin bar, as label and href, in order. */
  function barLinks(html: string): { label: string; href: string }[] {
    const bar = /<nav class="admin-bar"[\s\S]*?<\/nav>/.exec(html)?.[0] ?? '';
    const menuless = bar.replace(/<div id="admin-account-menu"[\s\S]*?<\/div>/, '');
    return [...menuless.matchAll(/<a\b[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/g)].map((match) => ({
      label: (match[2] ?? '').trim(),
      href: match[1] ?? '',
    }));
  }

  it('keeps View site and gains + New, which opens the new-post editor (AC #3, #4)', async () => {
    const cms = await box.site();
    const agent = await signedIn(cms);

    const html = await (await agent.get('/admin')).text();
    assert.match(html, /<nav class="admin-bar" aria-label="Admin bar">/);
    assert.deepEqual(barLinks(html), [
      { label: 'Geekity', href: '/admin' },
      { label: 'View site', href: '/' },
      { label: '+ New', href: '/admin/posts/new' },
    ]);

    const editor = await agent.get('/admin/posts/new');
    assert.equal(editor.status, 200);
    assert.match(await editor.text(), /Add post/);
  });

  it('offers View Post or View Page on the editor of a published document, and not of a draft (AC #3)', async () => {
    const contentDir = await seeded([
      {
        file: 'posts/2026-01-02-published.md',
        title: 'Published',
        date: '2026-01-02T09:00:00Z',
        permalink: '/2026/01/published/',
      },
      {
        file: 'posts/2026-01-03-unfinished.md',
        title: 'Unfinished',
        date: '2026-01-03T09:00:00Z',
        permalink: '/2026/01/unfinished/',
        draft: true,
      },
      { file: 'pages/about.md', title: 'About', permalink: '/about/' },
    ]);
    const cms = await box.site({ contentDir });
    const agent = await signedIn(cms);

    const views = async (url: string): Promise<{ label: string; href: string }[]> =>
      barLinks(await (await agent.get(url)).text()).filter((link) =>
        link.label.startsWith('View '),
      );

    assert.deepEqual(await views('/admin/posts/published'), [
      { label: 'View site', href: '/' },
      { label: 'View Post', href: '/2026/01/published/' },
    ]);
    assert.deepEqual(await views('/admin/pages/about'), [
      { label: 'View site', href: '/' },
      { label: 'View Page', href: '/about/' },
    ]);
    assert.deepEqual(await views('/admin/posts/unfinished'), [{ label: 'View site', href: '/' }]);
    assert.deepEqual(await views('/admin/posts'), [{ label: 'View site', href: '/' }]);
  });
});

describe('the account menu (TASK-126)', () => {
  it('greets a user without a display name by their username', async () => {
    const cms = await box.site();
    const agent = await signedIn(cms);

    const { button } = accountMenu(await (await agent.get('/admin')).text());

    assert.equal(button, 'Hoopla! ada');
  });

  it('greets a user with a display name by that name', async () => {
    const cms = await box.site();
    const agent = await signedIn(cms);
    const ada = findUser(cms.config.dataDir, 'ada');
    assert.ok(ada);
    await setUserProfile({
      dataDir: cms.config.dataDir,
      userId: ada.id,
      profile: { displayName: 'Ada Lovelace' },
    });

    const { button } = accountMenu(await (await agent.get('/admin')).text());

    assert.equal(button, 'Hoopla! Ada Lovelace');
  });

  it("holds a link to the signed-in user's own edit screen and the logout form", async () => {
    const cms = await box.site();
    const agent = await signedIn(cms);
    const ada = findUser(cms.config.dataDir, 'ada');
    assert.ok(ada);

    const { menu } = accountMenu(await (await agent.get('/admin')).text());

    assert.match(menu, new RegExp(`<a href="/admin/users/${String(ada.id)}">Edit profile</a>`));
    assert.match(menu, /<form method="post" action="\/admin\/logout">/);
    assert.match(menu, /<button type="submit">Log out<\/button>/);
  });

  it("signs out through the menu's form, with its CSRF token", async () => {
    const cms = await box.site();
    const agent = await signedIn(cms);
    const sessionId = agent.session();
    assert.ok(sessionId !== undefined);

    const { menu } = accountMenu(await (await agent.get('/admin')).text());
    const action = /<form method="post" action="([^"]+)">/.exec(menu)?.[1];
    const token = csrfField(menu);
    assert.ok(action !== undefined && token !== undefined, 'the menu carries the logout form');

    const refused = await agent.post(action, { csrf_token: 'not-the-token' });
    assert.equal(refused.status, 403, 'a wrong token is still refused');
    assert.ok(cms.admin.getSession(sessionId), 'and signs nobody out');

    const response = await agent.post(action, { csrf_token: token });
    assert.equal(response.status, 303);
    assert.equal(response.headers.get('location'), '/admin/login');
    assert.equal(cms.admin.getSession(sessionId), undefined, 'the session is gone');
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
    // The screen's own list, not the bar's + New, which is a posts link too.
    const screen = html.slice(html.indexOf('<main'));
    const listed = [...screen.matchAll(/<a href="\/admin\/posts\/([^"]+)">([^<]+)<\/a>/g)];

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
    assert.deepEqual(
      flashes(first).map(({ kind }) => kind),
      ['notice'],
    );
    assert.match(first, /Draft saved: Kept for one page/);

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
    assert.deepEqual(flashes(html), [], 'but not the message queued for someone else');
  });
});
