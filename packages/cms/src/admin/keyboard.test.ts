import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { adminFile, adminTemplates } from './__testing__/admin-files.ts';
import { browser, sandbox, signedIn } from './__testing__/harness.ts';
import { adminMenu } from './menu.ts';
import {
  adminDirectories,
  createAdminTemplateEnvironment,
  DAISYUI_ADMIN_DIR,
  PACKAGED_ADMIN_DIR,
} from './templates.ts';

/**
 * The admin for someone on a keyboard (TASK-143): a way past the chrome on
 * every screen, a focus ring that can be seen on every surface, and a caption
 * on every table.
 *
 * The screens and tables are found by reading the templates, so one added
 * later is held to the same contract without anybody adding it here.
 */

const environment = createAdminTemplateEnvironment({ noCache: true });

const daisyui = createAdminTemplateEnvironment({
  noCache: true,
  roots: adminDirectories({ GEEKITY_ADMIN: 'daisyui' }),
});

/** The skip link's opening tag, as the base layout the admin serves writes it. */
const SKIP_LINK =
  /<a class="[^"]*" href="#main">/.exec(
    await readFile(adminFile('layouts/base.njk'), 'utf8'),
  )?.[0] ?? 'no skip link in layouts/base.njk';

/** The opening tag of the first element a Tab press can land on. */
function firstFocusable(html: string): string | undefined {
  const focusable =
    /<a\b[^>]*\shref=[^>]*>|<(?:button|select|textarea|summary|iframe)\b[^>]*>|<input\b(?![^>]*\btype="hidden")[^>]*>|<[a-z]+\b[^>]*\s(?:tabindex="(?!-)|contenteditable)[^>]*>/;
  return focusable.exec(html)?.[0];
}

function assertSkipsToMain(html: string, screen: string): void {
  assert.equal(firstFocusable(html), SKIP_LINK, `${screen} starts with the skip link`);
  assert.ok(html.includes(`${SKIP_LINK}Skip to main content</a>`), `${screen} says where it goes`);
  assert.equal(html.match(/\sid="main"/g)?.length, 1, `${screen} has one #main`);
  assert.match(html, /<main\b[^>]*\sid="main"/, `${screen}'s #main is its <main>`);
}

describe('the skip link', async () => {
  const pages = await adminTemplates('pages');

  it('is looked for on every screen', () => {
    assert.ok(pages.length >= 28, `the screens were found: ${pages.join(', ')}`);
  });

  for (const page of pages) {
    it(`is the first thing ${page} focuses, and leads to its <main>`, () => {
      assertSkipsToMain(environment.render(page, {}), page);
    });
  }

  describe('over HTTP', () => {
    const box = sandbox();
    after(() => box.cleanup());

    it('leads the login screen and the signed-in dashboard alike', async () => {
      const cms = await box.site();
      const agent = await signedIn(cms);
      assertSkipsToMain(await (await agent.get('/admin')).text(), '/admin');
      assertSkipsToMain(await (await browser(cms).get('/admin/login')).text(), '/admin/login');
    });
  });
});

describe('every admin table', async () => {
  const templates = [...(await adminTemplates('pages')), ...(await adminTemplates('components'))];
  const tables: { template: string; opening: string; rest: string }[] = [];
  for (const template of templates) {
    const source = await readFile(adminFile(template), 'utf8');
    for (const match of source.matchAll(/<table\b[^>]*>/g)) {
      tables.push({
        template,
        opening: match[0],
        rest: source.slice(match.index + match[0].length),
      });
    }
  }

  it('is found by reading the templates', () => {
    assert.ok(tables.length >= 11, `the tables were found in ${templates.length} templates`);
  });

  for (const { template, rest } of tables) {
    it(`in ${template} opens with a caption that names it`, () => {
      const caption = /^\s*<caption\b[^>]*>([\s\S]*?)<\/caption>/.exec(rest);
      assert.ok(caption, `the first thing in the table is its caption: ${rest.slice(0, 120)}`);
      assert.notEqual(caption[1]?.trim(), '', 'the caption says something');
    });
  }
});

/** The custom properties one of the old admin's stylesheets declares, by name. */
async function tokens(stylesheet: string): Promise<Map<string, string>> {
  const css = await readFile(path.join(PACKAGED_ADMIN_DIR, 'static', stylesheet), 'utf8');
  return new Map(
    [...css.matchAll(/(--admin-[a-z-]+):\s*(#[0-9a-f]{3}(?:[0-9a-f]{3})?)\s*;/gi)].map(
      ([, name, value]) => [name ?? '', value ?? ''],
    ),
  );
}

/** WCAG relative luminance of a #rgb or #rrggbb colour. */
function luminance(colour: string): number {
  const hex = colour.length === 4 ? colour.replaceAll(/[0-9a-f]/gi, '$&$&') : colour;
  const [r = 0, g = 0, b = 0] = [1, 3, 5].map((start) => {
    const channel = Number.parseInt(hex.slice(start, start + 2), 16) / 255;
    return channel <= 0.040_45 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(one: string, other: string): number {
  const [light, dark] = [luminance(one), luminance(other)].sort((a, b) => b - a);
  return ((light ?? 0) + 0.05) / ((dark ?? 0) + 0.05);
}

describe("the old admin's focus ring", () => {
  /** Each ring colour, and every background it is drawn against. */
  const SURFACES: Readonly<Record<string, readonly string[]>> = {
    '--admin-focus': ['--admin-field', '--admin-surface', '--admin-unread'],
    '--admin-focus-on-dark': [
      '--admin-bar',
      '--admin-nav',
      '--admin-nav-open',
      '--admin-nav-children',
      '--admin-nav-current',
    ],
  };

  for (const [ring, backgrounds] of Object.entries(SURFACES)) {
    for (const background of backgrounds) {
      it(`${ring} stands out 3:1 against ${background}`, async () => {
        const declared = new Map([
          ...(await tokens('admin-bar.css')),
          ...(await tokens('admin.css')),
        ]);
        const ringColour = declared.get(ring);
        const backgroundColour = declared.get(background);
        assert.ok(
          ringColour !== undefined && backgroundColour !== undefined,
          `${ring} and ${background} are declared`,
        );
        const ratio = contrast(ringColour, backgroundColour);
        assert.ok(ratio >= 3, `${ringColour} on ${backgroundColour} is ${ratio.toFixed(2)}:1`);
      });
    }
  }
});

describe("the DaisyUI shell's focus ring", () => {
  it('outlines every link in the section menu, the current one too, in the theme text colour', () => {
    const html = daisyui.renderString('{% extends "layouts/shell.njk" %}', {
      navigation: adminMenu({ section: 'posts', child: 'tags' }),
    });
    const nav = /<nav\b[^>]*\baria-label="Sections"[^>]*>[\s\S]*?<\/nav>/.exec(html)?.[0] ?? '';
    const links = [...nav.matchAll(/<a\b[^>]*>/g)].map(([tag]) => tag);
    assert.ok(
      links.some((tag) => tag.includes('aria-current')),
      'the current screen is among them',
    );

    for (const tag of links) {
      const classes = /class="([^"]*)"/.exec(tag)?.[1]?.split(/\s+/) ?? [];
      for (const ring of [
        'focus-visible:outline-solid',
        'focus-visible:outline-2',
        'focus-visible:outline-offset-2',
        'focus-visible:outline-base-content',
      ]) {
        assert.ok(classes.includes(ring), `${tag} carries ${ring}`);
      }
    }
  });
});

describe('the DaisyUI admin bar, in its light palette and its dark one', async () => {
  const css = await readFile(path.join(DAISYUI_ADMIN_DIR, 'static', 'admin-bar.css'), 'utf8');
  const declared =
    /(--admin-bar-[a-z-]+):\s*light-dark\(\s*(#[0-9a-f]{3,6})\s*,\s*(#[0-9a-f]{3,6})\s*\)\s*;/gi;
  const palettes = {
    light: new Map<string, string>(),
    dark: new Map<string, string>(),
  };
  for (const [, name = '', light = '', dark = ''] of css.matchAll(declared)) {
    palettes.light.set(name, light);
    palettes.dark.set(name, dark);
  }

  it('draws in no colour outside its two palettes, so every one is measured here', () => {
    const elsewhere = css.replaceAll(/\/\*[\s\S]*?\*\//g, '').replaceAll(declared, '');
    assert.deepEqual(elsewhere.match(/#[0-9a-f]{3,8}\b/gi) ?? [], []);
    assert.ok(
      palettes.light.size >= 5,
      `the palette was read: ${[...palettes.light.keys()].join(', ')}`,
    );
  });

  /** Each foreground, the ratio it is held to, and every background it is drawn on. */
  const PAIRS: readonly [string, number, readonly string[]][] = [
    ['--admin-bar-text', 4.5, ['--admin-bar-surface', '--admin-bar-menu']],
    ['--admin-bar-hover', 4.5, ['--admin-bar-surface']],
    ['--admin-bar-focus', 3, ['--admin-bar-surface', '--admin-bar-menu']],
  ];

  for (const [scheme, palette] of Object.entries(palettes)) {
    for (const [foreground, minimum, backgrounds] of PAIRS) {
      for (const background of backgrounds) {
        it(`${scheme}: ${foreground} stands out ${String(minimum)}:1 against ${background}`, () => {
          const one = palette.get(foreground);
          const other = palette.get(background);
          assert.ok(
            one !== undefined && other !== undefined,
            `${foreground} and ${background} are declared`,
          );
          const ratio = contrast(one, other);
          assert.ok(ratio >= minimum, `${one} on ${other} is ${ratio.toFixed(2)}:1`);
        });
      }
    }
  }

  it('leaves the skip link first on a screen, ahead of the bar, and draws it over the fixed bar', () => {
    const html = daisyui.render('pages/dashboard/home.njk', {});
    const skip = firstFocusable(html) ?? '';
    assert.match(skip, /^<a class="[^"]*" href="#main">$/, 'the first stop is the skip link');
    assert.ok(html.indexOf(skip) < html.indexOf('<geekity-admin-bar'), 'it comes before the bar');

    const classes = /class="([^"]*)"/.exec(skip)?.[1]?.split(/\s+/) ?? [];
    const above = Number(
      /^z-\[(\d+)\]$/.exec(classes.find((name) => name.startsWith('z-')) ?? '')?.[1],
    );
    const bar = Number(/:host\s*\{[^}]*z-index:\s*(\d+)/.exec(css)?.[1]);
    assert.ok(
      classes.includes('fixed') && classes.includes('top-0'),
      `it is pinned to the top: ${skip}`,
    );
    assert.ok(above > bar, `its z-index, ${String(above)}, is above the bar's, ${String(bar)}`);
    assert.ok(classes.includes('focus:translate-y-0'), 'and it comes into view when it has focus');
  });
});
