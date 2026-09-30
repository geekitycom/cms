import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { browser, sandbox, signedIn } from './__testing__/harness.ts';
import { createAdminTemplateEnvironment, PACKAGED_ADMIN_DIR } from './templates.ts';

/**
 * The admin for someone on a keyboard (TASK-143): a way past the chrome on
 * every screen, a focus ring that can be seen on every surface, and a caption
 * on every table.
 *
 * The screens and tables are found by reading the templates, so one added
 * later is held to the same contract without anybody adding it here.
 */

const environment = createAdminTemplateEnvironment({ noCache: true });

async function adminTemplates(directory: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(path.join(PACKAGED_ADMIN_DIR, directory), {
    recursive: true,
  })) {
    if (entry.endsWith('.njk')) found.push(`${directory}/${entry}`);
  }
  return found.sort();
}

/** The opening tag of the first element a Tab press can land on. */
function firstFocusable(html: string): string | undefined {
  const focusable =
    /<a\b[^>]*\shref=[^>]*>|<(?:button|select|textarea|summary|iframe)\b[^>]*>|<input\b(?![^>]*\btype="hidden")[^>]*>|<[a-z]+\b[^>]*\s(?:tabindex="(?!-)|contenteditable)[^>]*>/;
  return focusable.exec(html)?.[0];
}

function assertSkipsToMain(html: string, screen: string): void {
  assert.equal(
    firstFocusable(html),
    '<a class="admin-skip-link" href="#main">',
    `${screen} starts with the skip link`,
  );
  assert.match(html, /<a class="admin-skip-link" href="#main">Skip to main content<\/a>/);
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
    const source = await readFile(path.join(PACKAGED_ADMIN_DIR, template), 'utf8');
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

/** The custom properties a stylesheet declares, by name. */
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

describe('the focus ring', () => {
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
