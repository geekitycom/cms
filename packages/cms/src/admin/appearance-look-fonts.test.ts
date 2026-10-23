/**
 * Appearance > Look, Fonts: a Google family for each font role the theme
 * declares, downloaded before it is saved (decision-61, TASK-492). Through
 * HTTP with Google stubbed, because the questions are what the screen offers,
 * what a save writes into `site.json`, and what the public site links next.
 */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, afterEach, before, describe, it } from 'node:test';

import { BODY, BOLD, FAMILY, googleLookup, stubGoogle } from '../fonts/__testing__/google.ts';
import type { StubbedGoogle } from '../fonts/__testing__/google.ts';
import { css2Url } from '../fonts/index.ts';
import type { Cms } from '../index.ts';
import { csrfField, sandbox, signedIn } from './__testing__/harness.ts';
import type { Browser } from './__testing__/harness.ts';
import { LOOK_FONTS_PATH, LOOK_PATH } from './look.ts';

const box = sandbox();
let google: StubbedGoogle;

before(() => {
  google = stubGoogle();
});
after(async () => {
  google.restore();
  await box.cleanup();
});
afterEach(() => {
  google.reset();
});

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

const BODY_CURATED = [
  'Atkinson Hyperlegible',
  'Source Serif 4',
  'Literata',
  'Merriweather',
  'Lora',
  'Source Sans 3',
  'IBM Plex Serif',
  'IBM Plex Sans',
];

async function writeTree(root: string, files: Record<string, string>): Promise<void> {
  for (const [relative, contents] of Object.entries(files)) {
    const file = path.join(root, ...relative.split('/'));
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, contents, 'utf8');
  }
}

async function site(
  options: { settings?: Record<string, unknown>; themes?: Record<string, string> } = {},
): Promise<{ cms: Cms; agent: Browser; siteJson: string }> {
  const contentDir = await box.dir('geekity-look-fonts-content-');
  const themesDir = await box.dir('geekity-look-fonts-themes-');
  if (options.themes !== undefined) await writeTree(path.join(themesDir, 'mine'), options.themes);
  await writeTree(contentDir, {
    'posts/2026-09-02-hello.md': POST,
    '_data/site.json': JSON.stringify({
      title: 'A Site',
      ...(options.themes === undefined ? {} : { theme: 'mine' }),
      ...options.settings,
    }),
  });
  const cms = await box.open({
    contentDir,
    dataDir: await box.dir('geekity-look-fonts-data-'),
    themesDir,
    hostLookup: googleLookup,
  });
  return {
    cms,
    agent: await signedIn(cms),
    siteJson: path.join(contentDir, '_data', 'site.json'),
  };
}

async function screen(agent: Browser): Promise<Response> {
  const response = await agent.get(LOOK_PATH);
  assert.equal(response.status, 200);
  return response;
}

async function save(agent: Browser, fields: Record<string, string>): Promise<Response> {
  const token = csrfField(await (await screen(agent)).text());
  assert.ok(token !== undefined);
  return agent.post(LOOK_FONTS_PATH, { csrf_token: token, ...fields });
}

async function written(siteJson: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(siteJson, 'utf8')) as Record<string, unknown>;
}

/** The fieldset of one role, by its data attribute. */
function roleFieldset(html: string, role: string): string {
  const found = new RegExp(`<fieldset\\b[^>]*data-font-role="${role}"[\\s\\S]*?</fieldset>`).exec(
    html,
  )?.[0];
  assert.ok(found !== undefined, `a fieldset for ${role}`);
  return found;
}

function options(fieldset: string): string[] {
  return [...fieldset.matchAll(/<option value="([^"]*)"/g)].map(([, value]) => value ?? '');
}

describe('the Fonts section of the Look screen (AC #2)', () => {
  it('offers the curated body list, the theme default and Custom', async () => {
    const { agent } = await site();
    const body = roleFieldset(await (await screen(agent)).text(), 'body');

    assert.deepEqual(options(body), ['', ...BODY_CURATED, 'custom']);
    assert.match(body, /<legend\b[^>]*>Body text<\/legend>/);
    assert.match(body, /<label\b[^>]*for="font-body"/);
    assert.match(body, /<label\b[^>]*for="font-body-custom"/);
    assert.match(body, /name="body_font_custom"/);
  });

  it('offers the heading list with Fraunces and Playfair Display added', async () => {
    const { agent } = await site();
    const heading = roleFieldset(await (await screen(agent)).text(), 'heading');
    assert.deepEqual(options(heading), [
      '',
      ...BODY_CURATED,
      'Fraunces',
      'Playfair Display',
      'custom',
    ]);
  });

  it('selects the saved curated family, or Custom with the family typed in', async () => {
    const { agent } = await site({ settings: { bodyFont: 'Lora', headingFont: 'Bitter' } });
    const html = await (await screen(agent)).text();
    assert.match(roleFieldset(html, 'body'), /<option value="Lora" selected>/);
    const heading = roleFieldset(html, 'heading');
    assert.match(heading, /<option value="custom" selected>/);
    assert.match(heading, /name="heading_font_custom"[^>]*value="Bitter"/);
  });

  it('shows no font control for a theme that declares no font roles', async () => {
    const { agent } = await site({
      themes: {
        'theme.json': JSON.stringify({ name: 'Mine', kind: 'site' }),
        'static/style.css': 'body { font-family: serif; }',
      },
    });
    const html = await (await screen(agent)).text();
    assert.doesNotMatch(html, /data-font-role=/);
    assert.match(html, /This theme declares no fonts to choose/);
  });

  it('sets a sample line in the saved font from the hosted files, with no Google host in the CSP (AC #6)', async () => {
    const { cms, agent } = await site({ settings: { bodyFont: FAMILY } });
    google.serveFamily(BODY);
    const fetched = await cms.fonts.ensure(FAMILY, BODY);
    assert.ok(fetched.ok);

    const response = await screen(agent);
    const policy = response.headers.get('content-security-policy') ?? '';
    const nonce = /'nonce-([^']+)'/.exec(policy)?.[1];
    assert.ok(nonce !== undefined);
    assert.doesNotMatch(policy, /googleapis|gstatic/);

    const html = await response.text();
    assert.ok(html.includes(`<link rel="stylesheet" href="${fetched.stylesheet.href}"`));
    const style = [
      ...html.matchAll(new RegExp(`<style nonce="${nonce}">([\\s\\S]*?)</style>`, 'g')),
    ]
      .map(([, css]) => css ?? '')
      .find((css) => css.includes('data-font-sample'));
    assert.ok(style !== undefined, 'a style block the nonce lets apply');
    assert.match(
      style,
      /\[data-font-sample="body"\]\s*\{\s*font-family: "Atkinson Hyperlegible", /,
    );
    assert.match(roleFieldset(html, 'body'), /data-font-sample="body"/);
  });
});

describe('saving the fonts (AC #3)', () => {
  it('downloads each family first, writes Google’s name, and the public site links it', async () => {
    const { cms, agent, siteJson } = await site();
    google.serveFamily(BODY);
    google.serveFamily([BOLD], 'Fraunces');

    const response = await save(agent, {
      body_font: FAMILY,
      body_font_custom: '',
      heading_font: 'Fraunces',
      heading_font_custom: '',
    });

    assert.equal(response.status, 303);
    assert.equal(response.headers.get('location'), LOOK_PATH);
    const file = await written(siteJson);
    assert.equal(file['bodyFont'], FAMILY);
    assert.equal(file['headingFont'], 'Fraunces');
    assert.ok(google.requested.some(({ url }) => url === css2Url('Fraunces', [BOLD])));

    const page = await (await cms.app.request('/2026/09/hello/')).text();
    assert.match(page, /--font-heading: "Fraunces", /);
    assert.match(page, /--font-body: "Atkinson Hyperlegible", /);
  });

  it('saves a custom family typed in when Custom is chosen', async () => {
    const { agent, siteJson } = await site();
    google.serveFamily(BODY, 'Lexend Deca');

    const response = await save(agent, {
      body_font: 'custom',
      body_font_custom: '  Lexend Deca ',
      heading_font: '',
    });

    assert.equal(response.status, 303);
    assert.equal((await written(siteJson))['bodyFont'], 'Lexend Deca');
  });

  it('saves the theme default as no font', async () => {
    const { agent, siteJson } = await site({ settings: { bodyFont: 'Lora' } });
    const response = await save(agent, { body_font: '', heading_font: '' });
    assert.equal(response.status, 303);
    assert.equal((await written(siteJson))['bodyFont'], undefined);
    assert.equal(google.requested.length, 0);
  });

  it('refuses an unknown family beside its field and writes nothing', async () => {
    const { agent, siteJson } = await site();
    google.serveFamily([BOLD], 'Fraunces');
    const before = await readFile(siteJson, 'utf8');

    const response = await save(agent, {
      body_font: 'custom',
      body_font_custom: 'Nosuch Family',
      heading_font: 'Fraunces',
    });

    assert.equal(response.status, 400);
    const html = await response.text();
    assert.match(roleFieldset(html, 'body'), /Google Fonts has no family called Nosuch Family/);
    assert.doesNotMatch(roleFieldset(html, 'heading'), /Google Fonts has no family/);
    assert.match(roleFieldset(html, 'body'), /name="body_font_custom"[^>]*value="Nosuch Family"/);
    assert.equal(await readFile(siteJson, 'utf8'), before);
  });

  it('refuses a body family without italic, naming the missing style', async () => {
    const { agent, siteJson } = await site();
    google.serveFamily([{ weight: 400, italic: false }, BOLD], 'Upright Only');
    const before = await readFile(siteJson, 'utf8');

    const response = await save(agent, {
      body_font: 'custom',
      body_font_custom: 'Upright Only',
      heading_font: '',
    });

    assert.equal(response.status, 400);
    assert.match(roleFieldset(await response.text(), 'body'), /Upright Only has no 400 italic/);
    assert.equal(await readFile(siteJson, 'utf8'), before);
  });

  it('refuses when Google cannot be reached', async () => {
    const { agent, siteJson } = await site();
    google.web[css2Url('Fraunces', [BOLD])] = () => new Response('down', { status: 503 });
    const before = await readFile(siteJson, 'utf8');

    const response = await save(agent, { body_font: '', heading_font: 'Fraunces' });

    assert.equal(response.status, 400);
    assert.match(
      roleFieldset(await response.text(), 'heading'),
      /Fraunces could not be fetched from Google Fonts/,
    );
    assert.equal(await readFile(siteJson, 'utf8'), before);
  });

  it('refuses a name that cannot be a family without asking Google', async () => {
    const { agent } = await site();
    const response = await save(agent, {
      body_font: 'custom',
      body_font_custom: 'Lora"; color: red',
      heading_font: '',
    });
    assert.equal(response.status, 400);
    assert.match(roleFieldset(await response.text(), 'body'), /is not a Google Fonts family name/);
    assert.equal(google.requested.length, 0);
  });

  it('needs the session’s CSRF token', async () => {
    const { agent, siteJson } = await site();
    const before = await readFile(siteJson, 'utf8');
    const response = await agent.post(LOOK_FONTS_PATH, { body_font: 'Lora' });
    assert.equal(response.status, 403);
    assert.equal(await readFile(siteJson, 'utf8'), before);
  });
});
