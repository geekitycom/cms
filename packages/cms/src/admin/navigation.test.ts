/**
 * Navigation: every menu this site holds, and what renders it (TASK-108).
 *
 * Almost everything here goes through HTTP, because the question is not what
 * `navigationScreen` returned but what the screen shows, what pressing a
 * button writes into `content/_data/site.json`, and what the public site
 * serves on the very next request.
 */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import type { Cms } from '../index.ts';
import type { NavigationMenus } from '../web/navigation.ts';
import { csrfField, sandbox, signedIn } from './__testing__/harness.ts';
import type { Browser } from './__testing__/harness.ts';
import {
  ADD_MENU_PATH,
  DELETE_MENU_PATH,
  NAVIGATION_FIELDS,
  NAVIGATION_PATH,
} from './navigation.ts';

const box = sandbox();
after(() => box.cleanup());

/** Write a tree of files, relative paths to contents, under `root`. */
async function writeTree(root: string, files: Record<string, string>): Promise<void> {
  for (const [relative, contents] of Object.entries(files)) {
    const file = path.join(root, ...relative.split('/'));
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, contents, 'utf8');
  }
}

/** A signed-in site holding these menus, optionally wearing a theme of its own. */
async function site(
  options: {
    menus?: NavigationMenus;
    /** A theme directory to write and wear, with the areas it declares. */
    theme?: { id: string; name: string; areas?: { name: string; label?: string }[] };
  } = {},
): Promise<{ cms: Cms; agent: Browser; contentDir: string }> {
  const contentDir = await box.dir('geekity-navigation-content-');
  const dataDir = await box.dir('geekity-navigation-data-');
  const themesDir = await box.dir('geekity-navigation-themes-');

  if (options.theme !== undefined) {
    await writeTree(path.join(themesDir, options.theme.id), {
      'theme.json': JSON.stringify({
        name: options.theme.name,
        kind: 'site',
        ...(options.theme.areas === undefined ? {} : { areas: options.theme.areas }),
      }),
    });
  }

  await writeTree(contentDir, {
    '_data/site.json': JSON.stringify({
      title: 'A Site',
      ...(options.theme === undefined ? {} : { theme: options.theme.id }),
      ...(options.menus === undefined ? {} : { menus: options.menus }),
    }),
  });

  const cms = await box.open({ contentDir, dataDir, themesDir });
  return { cms, agent: await signedIn(cms), contentDir };
}

/** The screen, as HTML. */
async function screen(agent: Browser): Promise<string> {
  const response = await agent.get(NAVIGATION_PATH);
  assert.equal(response.status, 200, 'the Navigation screen is there');
  return await response.text();
}

/** The CSRF token the screen carries. */
async function token(agent: Browser): Promise<string> {
  const found = csrfField(await screen(agent));
  assert.ok(found !== undefined, 'the screen carried a CSRF token');
  return found;
}

/** `content/_data/site.json` as it stands. */
async function siteJson(contentDir: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path.join(contentDir, '_data', 'site.json'), 'utf8')) as Record<
    string,
    unknown
  >;
}

/** The menus the file holds. */
async function storedMenus(contentDir: string): Promise<unknown> {
  return (await siteJson(contentDir))['menus'];
}

/** The contents of the textarea one menu's box is typed into. */
function boxItems(html: string, name: string): string | undefined {
  const match = new RegExp(`<textarea[^>]*id="menu-${name}"[^>]*>([\\s\\S]*?)</textarea>`).exec(
    html,
  );
  return match?.[1];
}

/** The headings on the screen, in the order it draws them. */
function headings(html: string): string[] {
  return [...html.matchAll(/<h[23]>([^<]*)<\/h[23]>/g)].map((match) => match[1] ?? '');
}

describe('the areas the active theme declares (AC #2)', () => {
  it('lists them in the theme order, under the theme labels, filled in or not', async () => {
    const { agent } = await site({
      menus: { primary: [{ label: 'About', url: '/about/' }] },
      theme: {
        id: 'midnight',
        name: 'Midnight',
        areas: [
          { name: 'utility', label: 'Utility bar' },
          { name: 'primary', label: 'The big menu' },
          { name: 'footer', label: 'Down the bottom' },
        ],
      },
    });

    const html = await screen(agent);

    assert.deepEqual(
      headings(html).filter((heading) =>
        ['Utility bar', 'The big menu', 'Down the bottom'].includes(heading),
      ),
      ['Utility bar', 'The big menu', 'Down the bottom'],
      "the theme's own order, under the theme's own labels",
    );
    assert.equal(boxItems(html, 'primary'), 'About | /about/', 'the stored menu is in its box');
    assert.equal(
      boxItems(html, 'utility'),
      '',
      'an area the site has never filled in is an empty box, not a missing one',
    );
    assert.match(html, /nothing has been typed here yet/);
  });

  it('offers the packaged theme areas to a site that has chosen no theme', async () => {
    const { agent } = await site();
    const html = await screen(agent);

    // The packaged theme declares these two, and a site on it renders them.
    assert.deepEqual(
      headings(html).filter((heading) => ['Site menu', 'Footer links'].includes(heading)),
      ['Site menu', 'Footer links'],
    );
    assert.match(html, /<code>menus\.primary<\/code>/);
    assert.match(html, /<code>menus\.footer<\/code>/);
  });
});

describe('a menu the active theme renders nowhere (AC #3)', () => {
  it('is listed apart, says so, and Delete is the only thing that removes it', async () => {
    const { agent, contentDir } = await site({
      menus: {
        primary: [{ label: 'About', url: '/about/' }],
        sidebar: [{ label: 'Blogroll', url: '/blogroll/' }],
      },
      theme: { id: 'midnight', name: 'Midnight', areas: [{ name: 'primary', label: 'Site menu' }] },
    });

    const html = await screen(agent);

    assert.match(html, /<h2>Kept, rendered nowhere<\/h2>/);
    assert.match(html, /Midnight renders none of them/, 'it says so in so many words');
    assert.equal(
      boxItems(html, 'sidebar'),
      'Blogroll | /blogroll/',
      'and it is still editable, because that is what it is kept for',
    );
    assert.match(
      html,
      new RegExp(`<form class="admin-menu-delete"[\\s\\S]*?value="sidebar"`),
      'with a Delete of its own',
    );
    assert.doesNotMatch(
      html.slice(0, html.indexOf('Kept, rendered nowhere')),
      /admin-menu-delete/,
      'and no Delete on the areas the theme does render',
    );

    const response = await agent.post(DELETE_MENU_PATH, {
      csrf_token: await token(agent),
      [NAVIGATION_FIELDS.menu]: 'sidebar',
    });

    assert.equal(response.status, 303);
    assert.deepEqual(
      await storedMenus(contentDir),
      { primary: [{ label: 'About', url: '/about/' }] },
      'the menu is gone from the file, and nothing else with it',
    );
    assert.match(await screen(agent), /The “sidebar” menu is gone/);
  });

  it('refuses to delete an area the theme declares, because that one is emptied instead', async () => {
    const { agent, contentDir } = await site({
      menus: { primary: [{ label: 'About', url: '/about/' }] },
      theme: { id: 'midnight', name: 'Midnight', areas: [{ name: 'primary', label: 'Site menu' }] },
    });

    const response = await agent.post(DELETE_MENU_PATH, {
      csrf_token: await token(agent),
      [NAVIGATION_FIELDS.menu]: 'primary',
    });

    assert.equal(response.status, 303);
    assert.deepEqual(await storedMenus(contentDir), {
      primary: [{ label: 'About', url: '/about/' }],
    });
    assert.match(await screen(agent), /it is emptied rather than removed/);
  });
});

describe('adding a menu by name (AC #4)', () => {
  it('stores an empty menu, and says where it will and will not be rendered', async () => {
    const { agent, contentDir } = await site({
      theme: { id: 'midnight', name: 'Midnight', areas: [{ name: 'primary', label: 'Site menu' }] },
    });

    // A name the theme does not declare: a block waiting for the theme that
    // will use it, which is what somebody writing one before switching wants.
    const waiting = await agent.post(ADD_MENU_PATH, {
      csrf_token: await token(agent),
      [NAVIGATION_FIELDS.name]: 'footer',
    });
    assert.equal(waiting.status, 303);
    assert.deepEqual(await storedMenus(contentDir), { footer: [] }, 'stored, and empty');

    const afterWaiting = await screen(agent);
    assert.match(afterWaiting, /This theme renders nothing under that name/);
    assert.match(afterWaiting, /<h2>Kept, rendered nowhere<\/h2>/);
    assert.equal(boxItems(afterWaiting, 'footer'), '', 'with a box of its own to fill in');

    // A name it does declare: the box moves up into place.
    const placed = await agent.post(ADD_MENU_PATH, {
      csrf_token: await token(agent),
      [NAVIGATION_FIELDS.name]: 'primary',
    });
    assert.equal(placed.status, 303);
    assert.deepEqual(await storedMenus(contentDir), { footer: [], primary: [] });
    assert.match(await screen(agent), /and this theme renders it/);
  });

  it('refuses a malformed name with a message saying why, keeping what was typed', async () => {
    const { agent, contentDir } = await site();

    for (const [name, says] of [
      ['top-bar', /a dash would be a minus sign/],
      ['2nd', /has to start with a letter/],
      ['Footer', /A menu name is lower case/],
      ['', /A menu needs a name/],
      ['a'.repeat(33), /at most 32 characters/],
    ] as const) {
      const response = await agent.post(ADD_MENU_PATH, {
        csrf_token: await token(agent),
        [NAVIGATION_FIELDS.name]: name,
      });

      assert.equal(response.status, 400, JSON.stringify(name));
      const html = await response.text();
      assert.match(html, says, JSON.stringify(name));
      if (name !== '') {
        assert.match(
          html,
          new RegExp(`name="${NAVIGATION_FIELDS.name}"[^>]*value="${name}"`),
          `the box still holds ${JSON.stringify(name)}`,
        );
      }
    }

    assert.equal(await storedMenus(contentDir), undefined, 'and nothing was written');
  });

  it('refuses a name the site already holds, and says where its box is', async () => {
    const { agent, contentDir } = await site({
      menus: { sidebar: [{ label: 'Blogroll', url: '/blogroll/' }] },
    });

    const response = await agent.post(ADD_MENU_PATH, {
      csrf_token: await token(agent),
      [NAVIGATION_FIELDS.name]: 'sidebar',
    });

    assert.equal(response.status, 400);
    assert.match(
      await response.text(),
      /already has a menu called “sidebar”\. Its box is on this page/,
    );
    assert.deepEqual(
      await storedMenus(contentDir),
      { sidebar: [{ label: 'Blogroll', url: '/blogroll/' }] },
      'and the menu it names was left exactly as it was',
    );
  });
});

describe('editing a menu (AC #5)', () => {
  it('saves its items to site.json, and the public site renders them at once', async () => {
    const { cms, agent, contentDir } = await site();

    const response = await agent.post(NAVIGATION_PATH, {
      csrf_token: await token(agent),
      [NAVIGATION_FIELDS.menu]: 'primary',
      [NAVIGATION_FIELDS.items]:
        'Home | /\n\n  About | /about/  \nMastodon | https://example.social/@me | me',
    });

    assert.equal(response.status, 303);
    assert.deepEqual(await storedMenus(contentDir), {
      primary: [
        { label: 'Home', url: '/' },
        { label: 'About', url: '/about/' },
        { label: 'Mastodon', url: 'https://example.social/@me', me: true },
      ],
    });

    const page = await (await cms.app.request('/')).text();
    assert.match(page, /href="\/about\/"/, 'the menu is on the public site on the next request');
    assert.match(page, /rel="me"/, 'with the flag the line carried');
  });

  it('refuses a malformed item without losing the rest of the box', async () => {
    const { agent, contentDir } = await site({
      menus: { primary: [{ label: 'Home', url: '/' }] },
    });
    const typed = 'Home | /\nAbout | not a url\nElsewhere | https://example.org/';

    const response = await agent.post(NAVIGATION_PATH, {
      csrf_token: await token(agent),
      [NAVIGATION_FIELDS.menu]: 'primary',
      [NAVIGATION_FIELDS.items]: typed,
    });

    assert.equal(response.status, 400);
    const html = await response.text();
    // The message is escaped into the page, quotation marks and all.
    assert.match(html, /&quot;About \| not a url&quot; is not one/, 'it names the line to fix');
    assert.equal(boxItems(html, 'primary'), typed, 'and the box still holds every line of it');
    assert.deepEqual(
      await storedMenus(contentDir),
      { primary: [{ label: 'Home', url: '/' }] },
      'nothing was written',
    );
  });

  it('will not invent a menu a save names and the screen does not show', async () => {
    const { agent, contentDir } = await site();

    const response = await agent.post(NAVIGATION_PATH, {
      csrf_token: await token(agent),
      [NAVIGATION_FIELDS.menu]: 'typo',
      [NAVIGATION_FIELDS.items]: 'Home | /',
    });

    assert.equal(response.status, 303);
    assert.equal(await storedMenus(contentDir), undefined);
    assert.match(await screen(agent), /This site has no menu called “typo”/);
  });
});

describe('the me flag (AC #6)', () => {
  it('is offered on every box with a label saying what it is for', async () => {
    const { agent } = await site();
    const html = await screen(agent);

    assert.match(html, /a profile that is you/, 'the flag has a label a person can read');
    assert.match(html, /rel="me"/, 'and says what it writes');
    assert.match(html, /Mastodon and the rest of the\s+IndieWeb verify/, 'and what that is for');
    assert.match(html, /End a line\s+<code>\| me<\/code>/, 'and how to set it');
  });
});
