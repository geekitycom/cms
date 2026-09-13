/**
 * Appearance > Themes: what the site is wearing, what else it could wear, and
 * the one button that changes it (decision-15, TASK-77).
 *
 * Almost everything here goes through HTTP, because the question is not what
 * `listSiteThemes` returned — that is `web/themes.test.ts` — but what the
 * screen shows, what pressing Activate writes into `content/_data/site.json`,
 * and what the public site serves on the very next request.
 */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import type { Cms } from '../index.ts';
import { THEMES_PATH } from './appearance.ts';
import { csrfField, sandbox, signedIn } from './__testing__/harness.ts';
import type { Browser } from './__testing__/harness.ts';
import { ADMIN_SECTIONS } from './menu.ts';
import { readSiteSettings } from './settings.ts';

const box = sandbox();
after(() => box.cleanup());

/** A post both the packaged theme and an overriding one draw. */
const POST = [
  '---',
  'title: Hello',
  "date: '2026-09-02T09:00:00Z'",
  'permalink: /2026/09/hello/',
  '---',
  '',
  'Body.',
  '',
].join('\n');

/** Write a tree of files, relative paths to contents, under `root`. */
async function writeTree(root: string, files: Record<string, string>): Promise<void> {
  for (const [relative, contents] of Object.entries(files)) {
    const file = path.join(root, ...relative.split('/'));
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, contents, 'utf8');
  }
}

/** One theme that says its own name in the post layout, so a page names it. */
function themeFiles(name: string, description?: string): Record<string, string> {
  return {
    'theme.json': JSON.stringify({
      name,
      kind: 'site',
      ...(description === undefined ? {} : { description }),
    }),
    'layouts/post.njk': `<!doctype html><h1>${name}: {{ title }}</h1>{{ content | safe }}`,
  };
}

/** A signed-in site with a themes directory and whatever it has chosen. */
async function site(
  options: {
    themes?: Record<string, string | undefined>;
    broken?: Record<string, string>;
    chosen?: string;
  } = {},
): Promise<{ cms: Cms; agent: Browser; contentDir: string; themesDir: string }> {
  const contentDir = await box.dir('geekity-appearance-content-');
  const dataDir = await box.dir('geekity-appearance-data-');
  const themesDir = await box.dir('geekity-appearance-themes-');

  for (const [id, description] of Object.entries(options.themes ?? {})) {
    await writeTree(path.join(themesDir, id), themeFiles(titleCase(id), description));
  }
  for (const [relative, contents] of Object.entries(options.broken ?? {})) {
    await writeTree(themesDir, { [relative]: contents });
  }

  await writeTree(contentDir, {
    'posts/2026-09-02-hello.md': POST,
    '_data/site.json': JSON.stringify({
      title: 'A Site',
      ...(options.chosen === undefined ? {} : { theme: options.chosen }),
    }),
  });

  const cms = await box.open({ contentDir, dataDir, themesDir });
  return { cms, agent: await signedIn(cms), contentDir, themesDir };
}

/** `midnight` as a display name would be written. */
function titleCase(id: string): string {
  return id.charAt(0).toUpperCase() + id.slice(1);
}

/** The screen, as HTML. */
async function screen(agent: Browser): Promise<string> {
  const response = await agent.get(THEMES_PATH);
  assert.equal(response.status, 200, `GET ${THEMES_PATH} answered ${String(response.status)}`);
  return response.text();
}

/** The theme cards on the screen, in the order they are drawn. */
function cards(html: string): string[] {
  return html.split('<li class="admin-theme').slice(1);
}

/** The display name on one card. */
function cardName(card: string): string {
  return /<h2[^>]*>([^<]*)<\/h2>/.exec(card)?.[1]?.trim() ?? '';
}

/** Press Activate for one theme, the way the button on its card does. */
async function activate(agent: Browser, value: string): Promise<Response> {
  const token = csrfField(await screen(agent));
  assert.ok(token !== undefined, 'the screen carried a CSRF token');
  return agent.post(THEMES_PATH, { csrf_token: token, theme: value });
}

/** What the public site serves for the one post, which names its theme. */
async function post(cms: Cms): Promise<string> {
  const response = await cms.app.request('/2026/09/hello/');
  assert.equal(response.status, 200);
  return response.text();
}

describe('the Appearance section', () => {
  it('is one section with one child, Themes, landing on it (AC #1)', () => {
    const appearance = ADMIN_SECTIONS.find((section) => section.section === 'appearance');

    assert.ok(appearance !== undefined, 'the admin menu has an Appearance section');
    assert.equal(appearance.label, 'Appearance');
    assert.deepEqual(
      appearance.children.map((child) => [child.child, child.label, child.url]),
      [['themes', 'Themes', '/admin/appearance/themes']],
    );
    assert.equal(appearance.url, THEMES_PATH, 'the heading lands on Themes');
  });

  it('expands and marks its child when the screen is the one being looked at (AC #1)', async () => {
    const { agent } = await site();

    const html = await screen(agent);

    assert.match(
      html,
      /<li class="admin-nav-section admin-nav-open">\s*<a class="admin-nav-heading" href="\/admin\/appearance\/themes">Appearance<\/a>/,
      'the Appearance section is the open one',
    );
    assert.match(
      html,
      /<a href="\/admin\/appearance\/themes" aria-current="page">Themes<\/a>/,
      'and Themes is the child being looked at',
    );
  });
});

describe('the themes the screen lists', () => {
  it('is the packaged default first and every valid folder after it (AC #2)', async () => {
    const { agent } = await site({
      themes: { midnight: 'Dark, quiet, and mostly type.', daylight: undefined },
    });

    const html = await screen(agent);

    assert.deepEqual(cards(html).map(cardName), ['Default', 'Daylight', 'Midnight']);
    assert.match(html, /Dark, quiet, and mostly type\./, 'the description off the manifest');
    assert.match(html, /<code>midnight<\/code>/, 'and the folder name it is chosen by');
    assert.match(html, /<code>daylight<\/code>/);
  });

  it('marks the packaged default active when the site has chosen nothing (AC #2)', async () => {
    const { agent } = await site({ themes: { midnight: undefined } });

    const [packaged, midnight] = cards(await screen(agent));

    assert.match(packaged ?? '', /Active/, 'the packaged theme is the one in use');
    assert.doesNotMatch(midnight ?? '', /Active/);
    assert.doesNotMatch(packaged ?? '', /Activate/, 'and has no button to activate it again');
    assert.match(midnight ?? '', /Activate/, 'while the other one does');
  });

  it('marks the chosen theme active instead, when there is one (AC #2)', async () => {
    const { agent } = await site({ themes: { midnight: undefined }, chosen: 'midnight' });

    const [packaged, midnight] = cards(await screen(agent));

    assert.match(midnight ?? '', /Active/);
    assert.doesNotMatch(packaged ?? '', /Active/);
    assert.match(packaged ?? '', /Activate/, 'and the packaged theme can be gone back to');
  });
});

describe('activating a theme', () => {
  it('writes it into site.json and renders through it next request (AC #3)', async () => {
    const { cms, agent, contentDir } = await site({ themes: { midnight: undefined } });
    assert.match(
      await post(cms),
      /<article class="blog-post h-entry">/,
      'the packaged theme, first',
    );

    const response = await activate(agent, 'midnight');

    assert.equal(response.status, 303);
    assert.equal(response.headers.get('location'), THEMES_PATH, 'back to the screen');
    assert.equal(readSiteSettings(contentDir).theme, 'midnight');
    assert.match(await post(cms), /<h1>Midnight: Hello<\/h1>/, 'and the site is wearing it');
    assert.match(await screen(agent), /Midnight/, 'and says so on the way back');
  });

  it('takes the setting out again when the packaged default is chosen (AC #3)', async () => {
    const { cms, agent, contentDir } = await site({
      themes: { midnight: undefined },
      chosen: 'midnight',
    });
    assert.match(await post(cms), /<h1>Midnight: Hello<\/h1>/);

    const response = await activate(agent, '');

    assert.equal(response.status, 303);
    assert.equal(readSiteSettings(contentDir).theme, '');
    const written = JSON.parse(
      await readFile(path.join(contentDir, '_data', 'site.json'), 'utf8'),
    ) as Record<string, unknown>;
    assert.ok(!('theme' in written), 'the key is gone rather than empty');
    assert.match(await post(cms), /<article class="blog-post h-entry">/);
  });

  it('needs the session’s CSRF token like every other admin form (AC #3)', async () => {
    const { agent, contentDir } = await site({ themes: { midnight: undefined } });

    const response = await agent.post(THEMES_PATH, { theme: 'midnight' });

    assert.equal(response.status, 403);
    assert.equal(readSiteSettings(contentDir).theme, '', 'nothing was written');
  });
});

describe('a folder that is not a theme', () => {
  it('is listed with the reason, and has no Activate (AC #4)', async () => {
    const { agent } = await site({
      themes: { midnight: undefined },
      broken: { 'halfway/theme.json': '{ "name": ', 'bare/layouts/post.njk': 'no manifest' },
    });

    const html = await screen(agent);

    assert.deepEqual(cards(html).map(cardName), ['Default', 'Midnight'], 'not one of the themes');
    for (const id of ['bare', 'halfway']) {
      const broken = /<li class="admin-broken-theme">([\s\S]*?)<\/li>/g;
      const listed = [...html.matchAll(broken)].map((match) => match[1] ?? '');
      const entry = listed.find((one) => one.includes(id));
      assert.ok(entry !== undefined, `${id} is listed as unreadable`);
      assert.doesNotMatch(entry, /Activate/, `${id} cannot be activated`);
    }
    assert.match(html, /theme\.json/, 'and the reason says what to go and look at');
  });

  it('is refused with a message when a forged form names it (AC #4)', async () => {
    const { cms, agent, contentDir } = await site({
      themes: { midnight: undefined },
      broken: { 'halfway/theme.json': '{ "name": ' },
    });

    const response = await activate(agent, 'halfway');

    assert.equal(response.status, 303);
    assert.equal(readSiteSettings(contentDir).theme, '', 'nothing was written');
    assert.match(await screen(agent), /halfway/, 'and the screen says why not');
    assert.match(await post(cms), /<article class="blog-post h-entry">/, 'the site is untouched');
  });

  it('refuses a name that is a path rather than a theme in the directory (AC #4)', async () => {
    const { agent, contentDir } = await site({ themes: { midnight: undefined } });

    for (const name of ['../midnight', 'a/b', '..']) {
      const response = await activate(agent, name);

      assert.equal(response.status, 303, name);
      assert.equal(readSiteSettings(contentDir).theme, '', `${name} was taken as a theme`);
    }
  });

  it('refuses a theme deleted between drawing the list and pressing the button (AC #4)', async () => {
    const { agent, contentDir } = await site({ themes: { midnight: undefined } });

    const response = await activate(agent, 'daylight');

    assert.equal(response.status, 303);
    assert.equal(readSiteSettings(contentDir).theme, '');
    assert.match(await screen(agent), /daylight/, 'and says which one is not there');
  });
});
