import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { promisify } from 'node:util';

import themeOrder from 'daisyui/functions/themeOrder';

import { LOOK } from '../../editor/look.ts';
import { PACKAGE_ROOT } from '../__testing__/cli.ts';
import { THEMES_PATH } from './appearance.ts';
import { sandbox, signedIn } from './__testing__/harness.ts';
import { PACKAGED_ADMIN_DIR } from './templates.ts';

const execFile = promisify(execFileCallback);

const COMPILED = path.join(PACKAGED_ADMIN_DIR, 'static', 'admin.css');

/** A stylesheet on one line, so a rule can be matched however it was printed. */
async function oneLine(file: string): Promise<string> {
  return (await readFile(file, 'utf8')).replace(/\s+/g, ' ');
}

/** The declarations of the first rule whose selector list ends in `selector`. */
function declarations(css: string, selector: RegExp): string | undefined {
  return new RegExp(`${selector.source}\\s*\\{([^{}]*)\\}`).exec(css)?.[1]?.trim();
}

describe('the admin, over HTTP', async () => {
  const box = sandbox();
  after(() => box.cleanup());

  const cms = await box.site();
  const agent = await signedIn(cms);
  const themes = await (await agent.get(THEMES_PATH)).text();
  const login = await (await cms.app.request('/admin/login')).text();
  const stylesheet = await cms.app.request('/admin/_static/admin.css');
  const editor = await cms.app.request('/admin/_static/editor.js');

  for (const [screen, html] of [
    ['the login screen', login],
    ['the Themes screen', themes],
  ] as const) {
    it(`draws ${screen} in layouts/base.njk, which links the compiled sheet alone`, () => {
      const sheets = [...html.matchAll(/<link\b[^>]*\brel="stylesheet"[^>]*>/g)].map(
        ([tag]) => tag,
      );
      assert.deepEqual(sheets, ['<link rel="stylesheet" href="/admin/_static/admin.css" />']);
    });
  }

  it('draws a screen inside the DaisyUI shell, with no admin-* class outside the bar', () => {
    assert.match(themes, /<div class="drawer lg:drawer-open">/);
    const page = themes.replace(/<geekity-admin-bar\b[\s\S]*<\/geekity-admin-bar>/, '');
    assert.match(page, /<div class="card bg-base-100 shadow-sm/);
    const tokens = [...page.matchAll(/\bclass="([^"]*)"/g)].flatMap(([, value]) =>
      (value ?? '').split(/\s+/),
    );
    assert.deepEqual(
      tokens.filter((token) => token.startsWith('admin-')),
      [],
    );
  });

  it('serves the compiled sheet as /admin/_static/admin.css', async () => {
    assert.equal(stylesheet.status, 200);
    assert.equal(await stylesheet.text(), await readFile(COMPILED, 'utf8'));
  });

  it('serves the editor bundle as /admin/_static/editor.js', async () => {
    assert.equal(editor.status, 200);
    assert.equal(
      await editor.text(),
      await readFile(path.join(PACKAGED_ADMIN_DIR, 'static', 'editor.js'), 'utf8'),
    );
  });
});

describe('the editor bundle', async () => {
  const bundle = await readFile(path.join(PACKAGED_ADMIN_DIR, 'static', 'editor.js'), 'utf8');

  it('writes the classes editor/look.ts names', () => {
    for (const name of [LOOK.tabs, LOOK.uploadButton, LOOK.status]) {
      assert.ok(bundle.includes(`"${name}"`), `the bundle writes ${name}`);
    }
  });

  it('marks the Markdown for the stylesheet to colour', () => {
    assert.match(bundle, /cm-md-heading/);
  });
});

describe('the compiled stylesheet', async () => {
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
  const source = (await readFile(path.join(PACKAGED_ADMIN_DIR, 'src', 'admin.css'), 'utf8'))
    .replaceAll(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/@plugin[^{]*\{[^}]*\}/, ' ')
    .replaceAll(/@(?:import|source)[^;]*;/g, ' ');
  const rules = [...source.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, body]) => ({
    selectors: (selector ?? '').trim().split(/\s*,\s*/),
    body: body ?? '',
  }));

  it('are the CodeMirror surface, nothing else', () => {
    const selectors = rules.flatMap((rule) => rule.selectors);
    assert.deepEqual(
      selectors.filter(
        (selector) =>
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
  it('finds a class in admin/ and in editor/look.ts, and nothing else', async () => {
    const tree = await mkdtemp(path.join(tmpdir(), 'geekity-admin-sources-'));
    try {
      await symlink(
        path.join(PACKAGE_ROOT, 'node_modules'),
        path.join(tree, 'node_modules'),
        'dir',
      );
      await cp(path.join(PACKAGED_ADMIN_DIR, 'src'), path.join(tree, 'admin', 'src'), {
        recursive: true,
      });
      const probes: Record<string, string> = {
        'admin/layouts/probe.njk': '<kbd class="kbd">K</kbd>',
        'admin/components/probe.njk': '<span class="loading">…</span>',
        'admin/pages/probe.njk': '<div class="skeleton"></div>',
        'editor/look.ts': "export const LOOK = { tab: 'swap-rotate' };",
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
        path.join(tree, 'admin', 'src', 'admin.css'),
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
        'a file outside admin/ and editor/look.ts is not read',
      );
    } finally {
      await rm(tree, { recursive: true, force: true });
    }
  });
});
