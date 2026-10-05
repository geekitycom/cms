import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { flashes } from './__testing__/flash.ts';
import { csrfField, sandbox, signedIn, signIn } from './__testing__/harness.ts';
import { findUser, setUserProfile } from './accounts.ts';
import type { Browser } from './__testing__/harness.ts';
import { classesOutsideTheBar, screenOf, text } from './__testing__/markup.ts';
import { saveUrlOf } from './__testing__/editor-form.ts';

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

  const saveUrl = saveUrlOf(html);
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

/** One count under At a glance: its label, its number, and where it leads. */
interface Count {
  label: string;
  value: string;
  href: string | undefined;
}

/** The counts: a stat each, the whole stat a link when it leads somewhere. */
function counts(html: string): Count[] {
  return [
    ...html.matchAll(
      /<(?:div|a) class="stat\b[^"]*"(?: href="([^"]*)")?>\s*<div class="stat-title">([^<]*)<\/div>\s*<div class="stat-value\b[^"]*">([^<]*)<\/div>/g,
    ),
  ].map(([, href, label, value]) => ({ label: label ?? '', value: value ?? '', href }));
}

/** The rows of the screen's tables as text, one string a row, the head first. */
function rowTexts(html: string): string[] {
  return [...screenOf(html).matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)].map(([, row]) =>
    text(row ?? ''),
  );
}

const COUNTED: Seed[] = [
  { file: 'posts/2026-01-01-one.md', title: 'One', date: '2026-01-01', permalink: '/one/' },
  { file: 'posts/2026-01-02-two.md', title: 'Two', date: '2026-01-02', permalink: '/two/' },
  { file: 'posts/2026-01-03-three.md', title: 'Three', date: '2026-01-03', permalink: '/three/' },
  {
    file: 'posts/2026-01-04-four.md',
    title: 'Four',
    date: '2026-01-04',
    permalink: '/four/',
    draft: true,
  },
  { file: 'pages/about.md', title: 'About', permalink: '/about/' },
  { file: 'pages/now.md', title: 'Now', permalink: '/now/' },
];

const RECENT: Seed[] = Array.from({ length: 7 }, (_, index) => {
  const day = String(index + 1).padStart(2, '0');
  return {
    file: `posts/2026-02-${day}-post-${String(index + 1)}.md`,
    title: `Post ${String(index + 1)}`,
    date: `2026-02-${day}`,
    permalink: `/2026/02/post-${String(index + 1)}/`,
    draft: index === 6,
  };
});

/** The dashboard a signed-in user is served over `contentDir`. */
async function dashboardOver(contentDir: string): Promise<string> {
  const agent = await signedIn(await box.site({ contentDir }));
  return await (await agent.get('/admin')).text();
}

describe('the dashboard', async () => {
  const dashboards = await Promise.all(
    [COUNTED, RECENT, []].map(async (seeds) => dashboardOver(await seeded(seeds))),
  );
  const [counted = '', recent = '', empty = ''] = dashboards;

  it('counts what the index holds, each number under its label', () => {
    assert.deepEqual(counts(counted), [
      { label: 'Published posts', value: '3', href: undefined },
      { label: 'Drafts', value: '1', href: undefined },
      { label: 'Pages', value: '2', href: undefined },
      { label: 'Followers', value: '0', href: '/admin/federation' },
      { label: 'Comments waiting', value: '0', href: '/admin/comments?status=pending' },
      { label: 'Messages unread', value: '0', href: '/admin/messages' },
    ]);
  });

  it('lists the five most recent posts, newest first, with their date and status', () => {
    const screen = recent.slice(recent.indexOf('<main'));
    const listed = [
      ...screen.matchAll(/<a\b[^>]*\bhref="\/admin\/posts\/([^"]+)"[^>]*>([^<]+)<\/a>/g),
    ];

    assert.deepEqual(
      listed.map((match) => match[1]),
      ['post-7', 'post-6', 'post-5', 'post-4', 'post-3'],
      'each linking to its editor',
    );
    assert.deepEqual(rowTexts(recent), [
      'Title Date Status',
      'Post 7 2026-02-07 Draft',
      'Post 6 2026-02-06 Published',
      'Post 5 2026-02-05 Published',
      'Post 4 2026-02-04 Published',
      'Post 3 2026-02-03 Published',
    ]);
  });

  it('says so when there is nothing written yet', () => {
    assert.match(empty, /Nothing written yet/);
    assert.deepEqual(rowTexts(empty), [], 'and draws no empty table');
  });

  it('draws Recent posts as a card around its table, and no second surface inside it (TASK-276 AC #1)', () => {
    const card =
      /<div class="card bg-base-100 shadow-sm">\s*<div class="card-body">\s*<h2 class="card-title">Recent posts<\/h2>([\s\S]*?)<\/div>\s*<\/div>\s*<\/main>/;

    assert.match(
      card.exec(recent)?.[1] ?? '',
      /<div class="max-w-full overflow-x-auto contain-inline-size">\s*<table class="table table-sm">/,
    );
    assert.match(card.exec(empty)?.[1] ?? '', /Nothing written yet/);
  });

  it('carries no admin-* class outside the bar', () => {
    for (const html of dashboards) {
      assert.deepEqual(
        classesOutsideTheBar(html).filter((token) => token.startsWith('admin-')),
        [],
      );
    }
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
