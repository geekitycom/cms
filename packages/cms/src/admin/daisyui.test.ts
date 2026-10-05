import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { promisify } from 'node:util';

import themeOrder from 'daisyui/functions/themeOrder';

import { PACKAGE_ROOT } from '../__testing__/cli.ts';
import { adminDirectories, DAISYUI_ADMIN_DIR, PACKAGED_ADMIN_DIR } from './templates.ts';

/**
 * The DaisyUI admin (decision-30) is built in `daisyui/` behind
 * `GEEKITY_ADMIN=daisyui`, laid over `admin/` so that anything not yet
 * converted falls through to the old admin.
 */

const execFile = promisify(execFileCallback);

const COMPILED = path.join(DAISYUI_ADMIN_DIR, 'static', 'admin.css');

/** A stylesheet on one line, so a rule can be matched however it was printed. */
async function oneLine(file: string): Promise<string> {
  return (await readFile(file, 'utf8')).replace(/\s+/g, ' ');
}

/** The declarations of the first rule whose selector list ends in `selector`. */
function declarations(css: string, selector: RegExp): string | undefined {
  return new RegExp(`${selector.source}\\s*\\{([^{}]*)\\}`).exec(css)?.[1]?.trim();
}

describe('GEEKITY_ADMIN', () => {
  it('serves the old admin alone when it is unset or empty', () => {
    assert.deepEqual(adminDirectories({}), [PACKAGED_ADMIN_DIR]);
    assert.deepEqual(adminDirectories({ GEEKITY_ADMIN: '' }), [PACKAGED_ADMIN_DIR]);
  });

  it('lays daisyui/ over admin/ when it is daisyui', () => {
    assert.deepEqual(adminDirectories({ GEEKITY_ADMIN: 'daisyui' }), [
      DAISYUI_ADMIN_DIR,
      PACKAGED_ADMIN_DIR,
    ]);
  });

  it('refuses a value it does not know rather than quietly serving the old admin', () => {
    assert.throws(() => adminDirectories({ GEEKITY_ADMIN: 'daisyUI' }), /GEEKITY_ADMIN/);
  });

  describe('set to daisyui, over HTTP', async () => {
    const { stdout } = await execFile(
      process.execPath,
      [
        '--import',
        import.meta.resolve('tsx'),
        path.join(import.meta.dirname, '__testing__', 'overlay-probe.ts'),
      ],
      { env: { ...process.env, GEEKITY_ADMIN: 'daisyui' }, maxBuffer: 64 * 1024 * 1024 },
    );
    const served = JSON.parse(stdout) as {
      login: string;
      unconverted: string;
      stylesheet: { status: number; body: string };
      editor: { status: number; body: string };
    };
    const compiled = await readFile(COMPILED, 'utf8');
    const editor = await readFile(path.join(PACKAGED_ADMIN_DIR, 'static', 'editor.js'), 'utf8');

    for (const [screen, html] of [
      ['the login screen', served.login],
      ['the unconverted Themes screen', served.unconverted],
    ] as const) {
      it(`draws ${screen} in daisyui/layouts/base.njk, which links the compiled sheet alone`, () => {
        const sheets = [...html.matchAll(/<link\b[^>]*\brel="stylesheet"[^>]*>/g)].map(
          ([tag]) => tag,
        );
        assert.deepEqual(sheets, ['<link rel="stylesheet" href="/admin/_static/admin.css" />']);
      });
    }

    it('still draws an unconverted screen from admin/ inside the DaisyUI shell', () => {
      assert.match(served.unconverted, /<div class="drawer lg:drawer-open">/);
      assert.match(served.unconverted, /<ul class="admin-themes">/);
    });

    it('serves the compiled DaisyUI sheet as /admin/_static/admin.css', () => {
      assert.equal(served.stylesheet.status, 200);
      assert.equal(served.stylesheet.body, compiled);
    });

    it('falls through to admin/static/ for a file daisyui/static/ does not have', () => {
      assert.equal(served.editor.status, 200);
      assert.equal(served.editor.body, editor);
    });
  });
});

describe('the compiled DaisyUI stylesheet', async () => {
  const css = await oneLine(COMPILED);

  it('carries every built-in DaisyUI theme', () => {
    const missing = themeOrder.filter((name) => !css.includes(`[data-theme="${name}"]`));
    assert.deepEqual(missing, []);
  });

  it('draws in the light theme when nothing names one', () => {
    const light = declarations(css, /:where\(:root\), [^{}]*\[data-theme="light"\]/);
    assert.match(light ?? '', /^color-scheme: light;/);
  });

  it('follows a system that prefers dark into the dark theme', () => {
    const preferred = declarations(
      css,
      /@media \(prefers-color-scheme: dark\) \{ :root:not\(\[data-theme\]\)/,
    );
    const dark = declarations(css, /\[data-theme="dark"\]/);
    assert.match(dark ?? '', /^color-scheme: dark;/);
    assert.equal(preferred, dark);
  });

  it('starts from Preflight, so no browser default reaches a screen', () => {
    assert.match(
      css,
      /::file-selector-button \{ box-sizing: border-box; border: 0 solid; margin: 0; padding: 0; \}/,
    );
  });
});

describe('what Tailwind reads for the admin stylesheet', () => {
  it('finds a class in daisyui/ and in editor/main.ts, and nothing else', async () => {
    const tree = await mkdtemp(path.join(tmpdir(), 'geekity-admin-sources-'));
    try {
      await symlink(
        path.join(PACKAGE_ROOT, 'node_modules'),
        path.join(tree, 'node_modules'),
        'dir',
      );
      await cp(path.join(DAISYUI_ADMIN_DIR, 'src'), path.join(tree, 'daisyui', 'src'), {
        recursive: true,
      });
      const probes: Record<string, string> = {
        'daisyui/layouts/probe.njk': '<kbd class="kbd">K</kbd>',
        'daisyui/components/probe.njk': '<span class="loading">…</span>',
        'daisyui/pages/probe.njk': '<div class="skeleton"></div>',
        'editor/main.ts': "element.className = 'swap-rotate';",
        'elsewhere/probe.njk': '<div class="countdown"></div>',
      };
      for (const [file, source] of Object.entries(probes)) {
        await mkdir(path.dirname(path.join(tree, file)), { recursive: true });
        await writeFile(path.join(tree, file), source);
      }

      const output = path.join(tree, 'out.css');
      await execFile(path.join(PACKAGE_ROOT, 'node_modules', '.bin', 'tailwindcss'), [
        '-i',
        path.join(tree, 'daisyui', 'src', 'admin.css'),
        '-o',
        output,
      ]);
      const css = await readFile(output, 'utf8');

      for (const found of ['kbd', 'loading', 'skeleton', 'swap-rotate']) {
        assert.match(css, new RegExp(`\\.${found}\\b`), `.${found} was compiled`);
      }
      assert.doesNotMatch(
        css,
        /\.countdown\b/,
        'a file outside daisyui/ and the editor is not read',
      );
    } finally {
      await rm(tree, { recursive: true, force: true });
    }
  });
});
