import assert from 'node:assert/strict';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { findUser, setUserAdminTheme } from './accounts.ts';
import type { AdminTheme } from './admin-theme.ts';
import { FIRST_ADMIN, sandbox, signedIn } from './__testing__/harness.ts';
import { adminContentSecurityPolicy } from './headers.ts';
import { PACKAGED_ADMIN_DIR } from './templates.ts';

const STATIC = path.join(PACKAGED_ADMIN_DIR, 'static');

const HOST_RULE =
  ':host { all: initial; display: block; position: fixed; top: 0; left: 0; right: 0; z-index: 99999; }';

interface Drawn {
  admin: string;
  csp: string;
  public: string;
}

/** The bar in a page, its host and shadow root included. */
function barIn(html: string): string {
  const bars = html.match(/<geekity-admin-bar\b[\s\S]*?<\/geekity-admin-bar>/g) ?? [];
  assert.equal(bars.length, 1, 'the page carries the bar once');
  return bars[0] ?? '';
}

/** The bar's host element's opening tag. */
function hostTag(bar: string): string {
  return /^<geekity-admin-bar\b[^>]*>/.exec(bar)?.[0] ?? '';
}

/** The bar's links, as label and href, in order. */
function barLinks(bar: string): { label: string; href: string }[] {
  return [...bar.matchAll(/<a\b[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/g)].map((match) => ({
    label: (match[2] ?? '').trim(),
    href: match[1] ?? '',
  }));
}

/** The nonce an admin response's policy names. */
function nonceOf(csp: string): string {
  const nonce = /'nonce-([^']+)'/.exec(csp)?.[1];
  assert.ok(nonce !== undefined, `the policy names a nonce: ${csp}`);
  return nonce;
}

describe('the admin bar', async () => {
  const box = sandbox();
  after(() => box.cleanup());

  const contentDir = await box.dir('geekity-bar-content-');
  const post = path.join(contentDir, 'posts', '2026-01-02-published.md');
  await mkdir(path.dirname(post), { recursive: true });
  await writeFile(
    post,
    '---\ntitle: Published\ndate: 2026-01-02T09:00:00Z\npermalink: /2026/01/published/\n---\n\nBody.\n',
  );

  const cms = await box.site({ contentDir });
  const agent = await signedIn(cms);
  const userId = findUser(cms.config.dataDir, FIRST_ADMIN.username)?.id ?? 0;

  async function drawnFor(theme: AdminTheme | undefined): Promise<Drawn> {
    await setUserAdminTheme({ dataDir: cms.config.dataDir, userId, theme });
    const admin = await agent.get('/admin');
    return {
      admin: await admin.text(),
      csp: admin.headers.get('content-security-policy') ?? '',
      public: await (await agent.get('/2026/01/published/')).text(),
    };
  }

  const system = await drawnFor(undefined);
  const dracula = await drawnFor('dracula');
  const cupcake = await drawnFor('cupcake');
  const editor = await (await agent.get('/admin/posts/published')).text();
  const scriptResponse = await cms.app.request('/admin/_static/admin-bar.js');
  const stylesheet = (await readFile(path.join(STATIC, 'admin-bar.css'), 'utf8')).trim();
  const script = await readFile(path.join(STATIC, 'admin-bar.js'), 'utf8');
  const compiled = await readFile(path.join(STATIC, 'admin.css'), 'utf8');

  it('is one template, the only one with a shadow root (AC #1)', async () => {
    const templates = (await readdir(PACKAGED_ADMIN_DIR, { recursive: true })).filter((file) =>
      file.endsWith('.njk'),
    );
    const rooted: string[] = [];
    for (const template of templates) {
      const source = await readFile(path.join(PACKAGED_ADMIN_DIR, template), 'utf8');
      if (source.includes('shadowrootmode')) rooted.push(template);
    }
    assert.deepEqual(rooted, ['components/admin-bar.njk']);
  });

  for (const [side, html] of [
    ['an admin screen', system.admin],
    ['a public page', system.public],
  ] as const) {
    it(`draws ${side}'s bar in a declarative shadow root with the bar's own stylesheet inlined (AC #1)`, () => {
      const bar = barIn(html);
      const root =
        /^<geekity-admin-bar\b[^>]*><template shadowrootmode="open"><style\b[^>]*>([\s\S]*?)<\/style>/.exec(
          bar,
        );
      assert.ok(
        root,
        `the host opens straight into its shadow root and stylesheet: ${bar.slice(0, 300)}`,
      );
      assert.equal(
        root[1]?.trim(),
        `${HOST_RULE}\n${stylesheet}`,
        'the stylesheet is the :host rule, then static/admin-bar.css whole',
      );
      assert.match(bar, /<nav class="admin-bar" aria-label="Admin bar">/);
    });
  }

  it('links admin.css alone on the admin, and the compiled sheet neither imports nor reads the bar sheet (AC #1)', () => {
    const sheets = [...system.admin.matchAll(/<link\b[^>]*\brel="stylesheet"[^>]*>/g)].map(
      ([tag]) => tag,
    );
    assert.deepEqual(sheets, ['<link rel="stylesheet" href="/admin/_static/admin.css" />']);
    assert.doesNotMatch(compiled, /admin-bar\.css/);
    assert.doesNotMatch(compiled, /var\(--admin-/, 'no token of the bar is read from admin.css');
  });

  it('pushes the page down by the height the bar script measures, from one stylesheet on both sides (AC #1)', () => {
    const offset = (html: string): string | undefined =>
      /<style id="geekity-admin-bar-offset"[^>]*>([^<]*)<\/style><geekity-admin-bar\b/.exec(
        html,
      )?.[1];
    const admin = offset(system.admin);
    assert.ok(admin !== undefined, 'the offset stylesheet sits right before the admin bar');
    assert.equal(offset(system.public), admin, 'the public page carries the same one');
    assert.match(admin, /html \{ margin-top: var\(--geekity-admin-bar-height\) !important; \}/);
    assert.doesNotMatch(compiled, /--geekity-admin-bar-height:/, 'admin.css sets no height');
    assert.match(
      script,
      /setProperty\('--geekity-admin-bar-height'/,
      'the script measures the bar',
    );
  });

  it('carries the user\'s dark theme as data-scheme="dark" on both sides (AC #2)', () => {
    assert.match(hostTag(barIn(dracula.admin)), /\sdata-scheme="dark"/);
    assert.match(hostTag(barIn(dracula.public)), /\sdata-scheme="dark"/);
  });

  it('carries the user\'s light theme as data-scheme="light" on both sides (AC #2)', () => {
    assert.match(hostTag(barIn(cupcake.admin)), /\sdata-scheme="light"/);
    assert.match(hostTag(barIn(cupcake.public)), /\sdata-scheme="light"/);
  });

  it('carries no data-scheme for a user who follows the system, on either side (AC #2)', () => {
    assert.doesNotMatch(hostTag(barIn(system.admin)), /data-scheme/);
    assert.doesNotMatch(hostTag(barIn(system.public)), /data-scheme/);
  });

  it('draws light, dark, or whatever the system prefers, by data-scheme (AC #2)', () => {
    const rules = stylesheet.replaceAll(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ');
    const scheme = (selector: string): string | undefined =>
      new RegExp(`(?:^|\\})\\s*${selector}\\s*\\{[^{}]*color-scheme:\\s*([^;}]+)`)
        .exec(rules)?.[1]
        ?.trim();
    assert.equal(scheme('\\.admin-bar'), 'light dark', 'with no attribute, the system decides');
    assert.equal(scheme(":host\\(\\[data-scheme='light'\\]\\) \\.admin-bar"), 'light');
    assert.equal(scheme(":host\\(\\[data-scheme='dark'\\]\\) \\.admin-bar"), 'dark');
  });

  for (const [side, html] of [
    ['an admin screen', system.admin],
    ['a public page', system.public],
  ] as const) {
    it(`loads ${side}'s bar script from admin/static/ and inlines none (AC #3)`, () => {
      const scripts = [...barIn(html).matchAll(/<script\b[^>]*>/g)].map(([tag]) => tag);
      assert.deepEqual(scripts, ['<script src="/admin/_static/admin-bar.js" defer>']);
      assert.doesNotMatch(barIn(html), /<script\b[^>]*>[^<]/, 'no script has a body');
    });
  }

  it('serves the bar script as a static file (AC #3)', async () => {
    assert.equal(scriptResponse.status, 200);
    assert.match(scriptResponse.headers.get('content-type') ?? '', /javascript/);
    assert.equal(await scriptResponse.text(), script);
  });

  it("puts the response's nonce on the admin bar's stylesheet and leaves the admin's CSP as it was (AC #4)", () => {
    for (const drawn of [system, dracula, cupcake]) {
      const nonce = nonceOf(drawn.csp);
      assert.equal(drawn.csp, adminContentSecurityPolicy(nonce));
      const styles = [...drawn.admin.matchAll(/<style\b[^>]*>/g)].map(([tag]) => tag);
      assert.deepEqual(
        styles,
        [`<style id="geekity-admin-bar-offset" nonce="${nonce}">`, `<style nonce="${nonce}">`],
        "the bar's offset and shadow-root stylesheets are the only inline ones",
      );
    }
  });

  it('places the admin bar by its :host rule, with no style attribute the CSP would refuse (AC #4)', () => {
    assert.doesNotMatch(barIn(system.admin), /\sstyle="/);
    assert.ok(
      barIn(system.admin).includes(
        `<template shadowrootmode="open"><style nonce="${nonceOf(system.csp)}">${HOST_RULE}\n`,
      ),
      'the shadow root opens with the :host rule',
    );
  });

  it('keeps the inline host style on the public page, where it holds off the theme, and no nonce (AC #4)', () => {
    const bar = barIn(system.public);
    assert.match(
      hostTag(bar),
      /style="all: initial; display: block; position: fixed; top: 0; left: 0; right: 0; z-index: 99999"/,
    );
    assert.match(bar, /<template shadowrootmode="open"><style>/);
  });

  it('offers View site and + New on an admin screen, and View Post on the editor of a published post (AC #6)', () => {
    assert.deepEqual(barLinks(barIn(system.admin)).slice(0, 3), [
      { label: 'Geekity', href: '/admin' },
      { label: 'View site', href: '/' },
      { label: '+ New', href: '/admin/posts/new' },
    ]);
    assert.deepEqual(barLinks(barIn(editor)).slice(0, 4), [
      { label: 'Geekity', href: '/admin' },
      { label: 'View site', href: '/' },
      { label: '+ New', href: '/admin/posts/new' },
      { label: 'View Post', href: '/2026/01/published/' },
    ]);
  });

  it('offers View admin, + New and Edit Post on the public page of a post (AC #6)', () => {
    assert.deepEqual(barLinks(barIn(system.public)).slice(0, 4), [
      { label: 'Geekity', href: '/' },
      { label: 'View admin', href: '/admin' },
      { label: '+ New', href: '/admin/posts/new' },
      { label: 'Edit Post', href: '/admin/posts/published' },
    ]);
  });
});
