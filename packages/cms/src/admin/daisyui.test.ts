import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { promisify } from 'node:util';

import themeOrder from 'daisyui/functions/themeOrder';

import { CLASSIC, DAISYUI } from '../../editor/look.ts';
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
      themes: string;
      stylesheet: { status: number; body: string };
      editor: { status: number; body: string };
      slug: { status: number; body: string };
    };
    const compiled = await readFile(COMPILED, 'utf8');
    const editor = await readFile(path.join(DAISYUI_ADMIN_DIR, 'static', 'editor.js'), 'utf8');
    const slug = await readFile(path.join(PACKAGED_ADMIN_DIR, 'static', 'slug.js'), 'utf8');

    for (const [screen, html] of [
      ['the login screen', served.login],
      ['the Themes screen', served.themes],
    ] as const) {
      it(`draws ${screen} in daisyui/layouts/base.njk, which links the compiled sheet alone`, () => {
        const sheets = [...html.matchAll(/<link\b[^>]*\brel="stylesheet"[^>]*>/g)].map(
          ([tag]) => tag,
        );
        assert.deepEqual(sheets, ['<link rel="stylesheet" href="/admin/_static/admin.css" />']);
      });
    }

    it('draws a screen from daisyui/ inside the DaisyUI shell, with no class of the old admin', () => {
      assert.match(served.themes, /<div class="drawer lg:drawer-open">/);
      const page = served.themes.replace(/<geekity-admin-bar\b[\s\S]*<\/geekity-admin-bar>/, '');
      assert.match(page, /<div class="card bg-base-100 shadow-sm/);
      const tokens = [...page.matchAll(/\bclass="([^"]*)"/g)].flatMap(([, value]) =>
        (value ?? '').split(/\s+/),
      );
      assert.deepEqual(
        tokens.filter((token) => token.startsWith('admin-')),
        [],
      );
    });

    it('serves the compiled DaisyUI sheet as /admin/_static/admin.css', () => {
      assert.equal(served.stylesheet.status, 200);
      assert.equal(served.stylesheet.body, compiled);
    });

    it('serves the DaisyUI editor bundle as /admin/_static/editor.js', () => {
      assert.equal(served.editor.status, 200);
      assert.equal(served.editor.body, editor);
    });

    it('falls through to admin/static/ for a file daisyui/static/ does not have', () => {
      assert.equal(served.slug.status, 200);
      assert.equal(served.slug.body, slug);
    });
  });
});

describe('the editor bundles', async () => {
  const bundle = (dir: string): Promise<string> =>
    readFile(path.join(dir, 'static', 'editor.js'), 'utf8');
  const [classic, daisyui] = await Promise.all([
    bundle(PACKAGED_ADMIN_DIR),
    bundle(DAISYUI_ADMIN_DIR),
  ]);

  it('give the old admin its own classes and the DaisyUI admin its own, from one source', () => {
    for (const name of [CLASSIC.tabs, CLASSIC.tab, CLASSIC.status]) {
      assert.ok(classic.includes(`"${name}"`), `the old bundle writes ${name}`);
      assert.ok(!daisyui.includes(`"${name}"`), `the DaisyUI bundle does not write ${name}`);
    }
    for (const name of [DAISYUI.tabs, DAISYUI.uploadButton, DAISYUI.status]) {
      assert.ok(daisyui.includes(`"${name}"`), `the DaisyUI bundle writes ${name}`);
      assert.ok(!classic.includes(`"${name}"`), `the old bundle does not write ${name}`);
    }
  });

  it('mark the Markdown for the stylesheet to colour in the DaisyUI admin alone', () => {
    assert.match(daisyui, /cm-md-heading/);
    assert.doesNotMatch(classic, /cm-md-/);
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

describe('the authored rules in the stylesheet source', async () => {
  const source = (await readFile(path.join(DAISYUI_ADMIN_DIR, 'src', 'admin.css'), 'utf8'))
    .replaceAll(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/@plugin[^{]*\{[^}]*\}/, ' ')
    .replaceAll(/@(?:import|source)[^;]*;/g, ' ');
  const rules = [...source.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, body]) => ({
    selectors: (selector ?? '').trim().split(/\s*,\s*/),
    body: body ?? '',
  }));

  it('are the bar’s offset and the CodeMirror surface, nothing else', () => {
    const selectors = rules.flatMap((rule) => rule.selectors);
    assert.deepEqual(
      selectors.filter(
        (selector) =>
          !selector.startsWith(':root:has(> body > geekity-admin-bar)') &&
          !/^#editor-surface \.cm-[\w-]+(?:\.cm-[\w-]+)?(?: \.cm-[\w-]+)?$/.test(selector),
      ),
      [],
    );
    assert.ok(selectors.includes('#editor-surface .cm-editor'));
  });

  it('colour the CodeMirror surface in the theme’s own colours, so it follows the theme', () => {
    for (const { selectors, body } of rules.filter((rule) => rule.selectors[0]?.startsWith('#'))) {
      for (const [, property, value] of body.matchAll(/([\w-]+)\s*:\s*([^;]+);/g)) {
        if (
          !/color|background|border|outline/.test(property ?? '') ||
          /radius/.test(property ?? '')
        )
          continue;
        const colours = (value ?? '').replaceAll(
          /var\(--color-[\w-]+\)|color-mix\(in oklab, |\d+%|transparent|\)|,|none|solid|\d+px|\s+/g,
          '',
        );
        assert.equal(colours, '', `${selectors.join(', ')} { ${property ?? ''}: ${value ?? ''} }`);
      }
    }
  });
});

describe('what Tailwind reads for the admin stylesheet', () => {
  it('finds a class in daisyui/ and in editor/look.ts, and nothing else', async () => {
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
        'editor/look.ts': "export const DAISYUI = { tab: 'swap-rotate' };",
        'editor/main.ts': "element.className = 'countdown';",
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
        'a file outside daisyui/ and editor/look.ts is not read',
      );
    } finally {
      await rm(tree, { recursive: true, force: true });
    }
  });
});
