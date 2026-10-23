import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import type { Cms } from '../index.ts';
import { findThemeFile, readTheme, PACKAGED_THEME_DIR, themeSearchPath } from '../theme/themes.ts';
import { schemeTokens } from '../theme/scheme-tokens.ts';
import { LOOK_COLOURS_PATH, LOOK_PATH } from './look.ts';
import { csrfField, sandbox, signedIn } from './__testing__/harness.ts';
import type { Browser } from './__testing__/harness.ts';
import { ADMIN_SECTIONS } from './menu.ts';
import { siteSettingsIn } from '../__testing__/site-settings.ts';

const box = sandbox();
after(() => box.cleanup());

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

async function writeTree(root: string, files: Record<string, string>): Promise<void> {
  for (const [relative, contents] of Object.entries(files)) {
    const file = path.join(root, ...relative.split('/'));
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, contents, 'utf8');
  }
}

const ONE_PALETTE: Record<string, string> = {
  'theme.json': JSON.stringify({ name: 'Plain', kind: 'site' }),
  'static/style.css': ':root { --color-body: #ffffff; --color-text: #000000; }',
};

async function site(
  options: { settings?: Record<string, unknown>; plain?: boolean } = {},
): Promise<{ cms: Cms; agent: Browser; contentDir: string }> {
  const contentDir = await box.dir('geekity-look-content-');
  const dataDir = await box.dir('geekity-look-data-');
  const themesDir = await box.dir('geekity-look-themes-');
  if (options.plain === true) await writeTree(path.join(themesDir, 'plain'), ONE_PALETTE);

  await writeTree(contentDir, {
    'posts/2026-09-02-hello.md': POST,
    '_data/site.json': JSON.stringify({
      title: 'A Site',
      ...(options.plain === true ? { theme: 'plain' } : {}),
      ...options.settings,
    }),
  });

  const cms = await box.open({ contentDir, dataDir, themesDir });
  return { cms, agent: await signedIn(cms), contentDir };
}

async function screen(agent: Browser): Promise<string> {
  const response = await agent.get(LOOK_PATH);
  assert.equal(response.status, 200, `GET ${LOOK_PATH} answered ${String(response.status)}`);
  return response.text();
}

function schemeCards(html: string): Map<string, string> {
  const cards = new Map<string, string>();
  for (const [card] of html.matchAll(/<label\b[^>]*data-scheme-card[\s\S]*?<\/label>/g)) {
    const value = /name="color_scheme" value="([^"]*)"/.exec(card)?.[1];
    if (value !== undefined) cards.set(value, card);
  }
  return cards;
}

function fieldset(html: string, legend: string): string | undefined {
  return [...html.matchAll(/<fieldset\b[\s\S]*?<\/fieldset>/g)]
    .map(([match]) => match)
    .find((one) => new RegExp(`<legend\\b[^>]*>${legend}</legend>`).test(one));
}

async function save(agent: Browser, fields: Record<string, string>): Promise<Response> {
  const token = csrfField(await screen(agent));
  assert.ok(token !== undefined, 'the screen carried a CSRF token');
  return agent.post(LOOK_COLOURS_PATH, { csrf_token: token, ...fields });
}

async function publicPost(cms: Cms): Promise<string> {
  const response = await cms.app.request('/2026/09/hello/');
  assert.equal(response.status, 200);
  return response.text();
}

function packagedTokens(scheme: string): ReturnType<typeof schemeTokens> {
  const stylesheet = findThemeFile(themeSearchPath(), 'static/style.css');
  assert.ok(stylesheet !== undefined, 'the packaged theme has a compiled stylesheet');
  return schemeTokens(stylesheet, scheme);
}

describe('the Look screen in the Appearance section', () => {
  it('is the second child of Appearance, after Themes', () => {
    const appearance = ADMIN_SECTIONS.find((section) => section.section === 'appearance');
    assert.deepEqual(
      appearance?.children.map((child) => [child.child, child.label, child.url]),
      [
        ['themes', 'Themes', '/admin/appearance/themes'],
        ['look', 'Look', LOOK_PATH],
      ],
    );
  });

  it('marks Look as the child being looked at', async () => {
    const { agent } = await site();
    assert.match(
      await screen(agent),
      /<a\b[^>]*href="\/admin\/appearance\/look" aria-current="page">Look<\/a>/,
    );
  });
});

describe('the schemes on the Look screen (AC #1, #4)', () => {
  it('lists every scheme of the theme as a radio card with its label, in the theme’s order', async () => {
    const { agent } = await site();
    const html = await screen(agent);

    const packaged = readTheme(PACKAGED_THEME_DIR);
    assert.ok(packaged.ok);
    const cards = schemeCards(html);
    assert.deepEqual(
      [...cards.keys()],
      packaged.theme.schemes.map((scheme) => scheme.name),
    );
    for (const scheme of packaged.theme.schemes) {
      assert.match(cards.get(scheme.name) ?? '', new RegExp(`>${scheme.label}<`), scheme.name);
    }
  });

  it('draws page, text, accent and secondary swatches in the scheme’s light and dark colours', async () => {
    const { agent } = await site();
    const slate = schemeCards(await screen(agent)).get('slate') ?? '';

    const tokens = packagedTokens('slate');
    assert.equal(tokens.light.get('body'), '#f4f7fb', 'the stylesheet is read as the page is');
    for (const mode of ['light', 'dark'] as const) {
      const drawn = new RegExp(`<svg\\b[^>]*data-mode="${mode}"[\\s\\S]*?</svg>`).exec(slate)?.[0];
      assert.ok(drawn !== undefined, `slate has a ${mode} swatch`);
      for (const token of ['body', 'text', 'primary', 'secondary']) {
        const colour = tokens[mode].get(token);
        assert.ok(colour !== undefined, `${mode} ${token} token`);
        assert.ok(drawn.includes(`fill="${colour}"`), `${mode} ${token} ${colour} is drawn`);
      }
    }
  });

  it('draws the swatches without a style attribute, which the admin CSP refuses', async () => {
    const { agent } = await site();
    const scheme = fieldset(await screen(agent), 'Colour scheme') ?? '';
    assert.doesNotMatch(scheme, /\sstyle="/);
  });

  it('groups native radios in fieldsets with legends', async () => {
    const { agent } = await site();
    const html = await screen(agent);

    const scheme = fieldset(html, 'Colour scheme');
    const mode = fieldset(html, 'Mode');
    assert.ok(scheme !== undefined, 'a Colour scheme fieldset');
    assert.ok(mode !== undefined, 'a Mode fieldset');
    assert.equal([...scheme.matchAll(/<input type="radio" [^>]*name="color_scheme"/g)].length, 6);
    assert.equal([...mode.matchAll(/<input type="radio" [^>]*name="color_mode"/g)].length, 3);
  });

  it('checks the first scheme and marks it in words when the site has chosen none', async () => {
    const { agent } = await site();
    const cards = schemeCards(await screen(agent));

    assert.match(cards.get('paper') ?? '', /value="paper" checked/);
    assert.match(cards.get('paper') ?? '', />In use</);
    assert.doesNotMatch(cards.get('slate') ?? '', /value="slate" checked|>In use</);
  });

  it('checks the chosen scheme and mode', async () => {
    const { agent } = await site({ settings: { colorScheme: 'forest', colorMode: 'dark' } });
    const html = await screen(agent);

    assert.match(schemeCards(html).get('forest') ?? '', /value="forest" checked/);
    assert.match(fieldset(html, 'Mode') ?? '', /value="dark" checked/);
  });
});

describe('the mode control (AC #2)', () => {
  it('offers Follow the system, Always light and Always dark, system checked by default', async () => {
    const { agent } = await site();
    const mode = fieldset(await screen(agent), 'Mode') ?? '';

    const labels = [...mode.matchAll(/value="(\w+)"[^>]*\/>\s*<span[^>]*>([^<]+)<\/span>/g)].map(
      ([, value, label]) => [value, label],
    );
    assert.deepEqual(labels, [
      ['system', 'Follow the system'],
      ['light', 'Always light'],
      ['dark', 'Always dark'],
    ]);
    assert.match(mode, /value="system" checked/);
  });
});

describe('saving the look (AC #2)', () => {
  it('writes colorScheme and colorMode and nothing else, and the public site follows', async () => {
    const { cms, agent, contentDir } = await site();
    const before = await siteSettingsIn(contentDir);
    assert.match(await publicPost(cms), /data-scheme="paper" data-mode="system"/);

    const response = await save(agent, { color_scheme: 'plum', color_mode: 'dark' });

    assert.equal(response.status, 303);
    assert.equal(response.headers.get('location'), LOOK_PATH);
    assert.deepEqual(await siteSettingsIn(contentDir), {
      ...before,
      color_scheme: 'plum',
      color_mode: 'dark',
    });
    const written = JSON.parse(
      await readFile(path.join(contentDir, '_data', 'site.json'), 'utf8'),
    ) as Record<string, unknown>;
    assert.equal(written['colorScheme'], 'plum');
    assert.equal(written['colorMode'], 'dark');
    assert.match(await publicPost(cms), /data-scheme="plum" data-mode="dark"/);
    assert.match(await screen(agent), /value="plum" checked/);
  });

  it('refuses a scheme the theme does not declare and writes nothing', async () => {
    const { agent, contentDir } = await site();

    const token = csrfField(await screen(agent));
    const response = await agent.post(LOOK_COLOURS_PATH, {
      csrf_token: token ?? '',
      color_scheme: 'neon',
      color_mode: 'dark',
    });

    assert.equal(response.status, 400);
    assert.match(await response.text(), /&quot;neon&quot; is not a colour scheme/);
    const settings = await siteSettingsIn(contentDir);
    assert.equal(settings.color_scheme, '');
    assert.equal(settings.color_mode, 'system');
  });

  it('refuses a mode that is not one of the three', async () => {
    const { agent, contentDir } = await site();

    const response = await save(agent, { color_scheme: 'slate', color_mode: 'sepia' });

    assert.equal(response.status, 400);
    const settings = await siteSettingsIn(contentDir);
    assert.equal(settings.color_scheme, '');
    assert.equal(settings.color_mode, 'system');
  });

  it('needs the session’s CSRF token', async () => {
    const { agent, contentDir } = await site();

    const response = await agent.post(LOOK_COLOURS_PATH, {
      color_scheme: 'slate',
      color_mode: 'dark',
    });

    assert.equal(response.status, 403);
    assert.equal((await siteSettingsIn(contentDir)).color_scheme, '');
  });
});

describe('a theme with no schemes (AC #3)', () => {
  it('shows the mode control and says the theme has one palette', async () => {
    const { agent } = await site({ plain: true });
    const html = await screen(agent);

    assert.equal(schemeCards(html).size, 0, 'no scheme cards');
    assert.ok(fieldset(html, 'Mode') !== undefined, 'the mode control');
    assert.match(html, /This theme has one palette/);
  });

  it('saves the mode alone', async () => {
    const { agent, contentDir } = await site({ plain: true });

    const response = await save(agent, { color_mode: 'light' });

    assert.equal(response.status, 303);
    const settings = await siteSettingsIn(contentDir);
    assert.equal(settings.color_mode, 'light');
    assert.equal(settings.color_scheme, '');
  });
});
