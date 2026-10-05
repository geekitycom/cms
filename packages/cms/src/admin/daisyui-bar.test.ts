import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, it } from 'node:test';
import { promisify } from 'node:util';

import { adminContentSecurityPolicy } from './headers.ts';
import { DAISYUI_ADMIN_DIR } from './templates.ts';

/**
 * The admin bar of the DaisyUI admin (decision-30, TASK-268): one template in
 * one declarative shadow root, drawn on an admin screen and on a public page
 * alike, in a light or a dark palette chosen by the signed-in user's theme.
 */

const execFile = promisify(execFileCallback);

const STATIC = path.join(DAISYUI_ADMIN_DIR, 'static');

interface Drawn {
  admin: string;
  csp: string;
  public: string;
}

interface Served {
  drawn: Record<'system' | 'dracula' | 'cupcake', Drawn>;
  editor: string;
  script: { status: number; type: string; body: string };
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

describe('the admin bar with GEEKITY_ADMIN=daisyui', async () => {
  const { stdout } = await execFile(
    process.execPath,
    [
      '--import',
      import.meta.resolve('tsx'),
      path.join(import.meta.dirname, '__testing__', 'bar-probe.ts'),
    ],
    { env: { ...process.env, GEEKITY_ADMIN: 'daisyui' }, maxBuffer: 64 * 1024 * 1024 },
  );
  const served = JSON.parse(stdout) as Served;
  const { system, dracula, cupcake } = served.drawn;
  const stylesheet = (await readFile(path.join(STATIC, 'admin-bar.css'), 'utf8')).trim();
  const script = await readFile(path.join(STATIC, 'admin-bar.js'), 'utf8');
  const compiled = await readFile(path.join(STATIC, 'admin.css'), 'utf8');

  it('is one template in daisyui/, the only one with a shadow root (AC #1)', async () => {
    const templates = (await readdir(DAISYUI_ADMIN_DIR, { recursive: true })).filter((file) =>
      file.endsWith('.njk'),
    );
    const rooted: string[] = [];
    for (const template of templates) {
      const source = await readFile(path.join(DAISYUI_ADMIN_DIR, template), 'utf8');
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
      assert.equal(root[1]?.trim(), stylesheet, 'the stylesheet is static/admin-bar.css, whole');
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

  it('pushes the admin page down by the height the bar script measures (AC #1)', () => {
    const offset = /([^{}]*:has\([^{}]*geekity-admin-bar[^{}]*)\{([^{}]*)\}/.exec(
      compiled.replace(/\s+/g, ' '),
    );
    assert.ok(offset, 'admin.css has a rule for a page that carries the bar, and only for one');
    assert.match(offset[2] ?? '', /margin-top:\s*var\(--geekity-admin-bar-height\)/);
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

  it('serves the bar script as a static file (AC #3)', () => {
    assert.equal(served.script.status, 200);
    assert.match(served.script.type, /javascript/);
    assert.equal(served.script.body, script);
  });

  it("puts the response's nonce on the admin bar's stylesheet and leaves the admin's CSP as it was (AC #4)", () => {
    for (const drawn of [system, dracula, cupcake]) {
      const nonce = nonceOf(drawn.csp);
      assert.equal(drawn.csp, adminContentSecurityPolicy(nonce));
      const styles = [...drawn.admin.matchAll(/<style\b[^>]*>/g)].map(([tag]) => tag);
      assert.deepEqual(
        styles,
        [`<style nonce="${nonce}">`],
        "the bar's is the one inline stylesheet",
      );
    }
  });

  it('places the admin bar by its :host rule, with no style attribute the CSP would refuse (AC #4)', () => {
    assert.doesNotMatch(barIn(system.admin), /\sstyle="/);
    assert.match(
      stylesheet.replace(/\s+/g, ' '),
      /:host \{ all: initial; display: block; position: fixed; top: 0; left: 0; right: 0; z-index: 99999; \}/,
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
    assert.deepEqual(barLinks(barIn(served.editor)).slice(0, 4), [
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
