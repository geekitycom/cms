import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import sharp from 'sharp';

import { sandbox } from '../admin/__testing__/harness.ts';
import type { Cms, GeekityConfig } from '../index.ts';

const box = sandbox();
after(() => box.cleanup());

const ICON = '/uploads/2026/10/icon.png';
const LOGO = '/uploads/2026/10/logo.svg';

const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">' +
  '<rect width="64" height="64" fill="#0b5fff"/></svg>';

async function site(
  settings: Record<string, unknown>,
  uploads: Record<string, Buffer | string> = {},
  config: GeekityConfig = {},
): Promise<Cms> {
  const contentDir = await box.dir('geekity-header-icon-content-');
  const dataDir = await box.dir('geekity-header-icon-data-');

  const files: Record<string, Buffer | string> = {
    '_data/site.json': JSON.stringify({ title: 'A Site of Words', ...settings }),
    'pages/about.md': '---\ntitle: About\n---\n\nAbout me.\n',
  };
  for (const [at, contents] of Object.entries(uploads)) files[at.slice(1)] = contents;

  for (const [relative, contents] of Object.entries(files)) {
    const file = path.join(contentDir, ...relative.split('/'));
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, contents);
  }

  return box.open({ contentDir, dataDir, ...config });
}

async function png(): Promise<Buffer> {
  return sharp({ create: { width: 600, height: 600, channels: 3, background: '#b33900' } })
    .png()
    .toBuffer();
}

async function homeLink(cms: Cms, pathname: string): Promise<string> {
  const response = await cms.app.request(pathname);
  assert.equal(response.status, 200, `GET ${pathname}`);
  const html = await response.text();
  const link =
    pathname === '/'
      ? /<h1 class="main-heading">\s*(<a [\s\S]*?<\/a>)/.exec(html)
      : /(<a class="header-link-home"[\s\S]*?<\/a>)/.exec(html);
  assert.ok(link?.[1], `${pathname} has no header home link`);
  return link[1];
}

function headerIconAttributes(link: string): Record<string, string> | undefined {
  const img = /<img ([^>]*)>/.exec(link);
  if (img === null) return undefined;
  return Object.fromEntries(
    [...(img[1] ?? '').matchAll(/([a-z-]+)="([^"]*)"/g)].map((pair) => [
      pair[1] ?? '',
      pair[2] ?? '',
    ]),
  );
}

describe('the site icon before the title in the header (TASK-486)', () => {
  it('shows the derived 180px icon before the title on the homepage and an inner page', async () => {
    const cms = await site({ icon: ICON, headerIcon: true }, { [ICON]: await png() });

    for (const pathname of ['/', '/about/']) {
      const link = await homeLink(cms, pathname);
      const img = headerIconAttributes(link);
      assert.ok(img, `${pathname} shows no icon`);
      assert.equal(img['class'], 'site-icon');
      assert.equal(img['alt'], '', 'the title names the link, so the icon is decorative');
      assert.match(img['src'] ?? '', /^\/uploads\/_\/2026\/10\/icon\.png\/icon-180\.png\?v=/);
      assert.ok(
        link.indexOf('<img') < link.indexOf('A Site of Words'),
        `${pathname} puts the icon after the title`,
      );
      const served = await cms.app.request(img['src'] ?? '');
      assert.equal(served.status, 200, 'the icon is served');
    }
  });

  it('shows an SVG icon as the upload itself', async () => {
    const cms = await site({ icon: LOGO, headerIcon: true }, { [LOGO]: SVG });
    assert.equal(headerIconAttributes(await homeLink(cms, '/'))?.['src'], LOGO);
  });

  it('shows no icon while the setting is off', async () => {
    const cms = await site({ icon: ICON }, { [ICON]: await png() });
    for (const pathname of ['/', '/about/']) {
      assert.equal(headerIconAttributes(await homeLink(cms, pathname)), undefined, pathname);
    }
  });

  it('shows no icon when the site has none', async () => {
    const cms = await site({ headerIcon: true });
    for (const pathname of ['/', '/about/']) {
      assert.equal(headerIconAttributes(await homeLink(cms, pathname)), undefined, pathname);
    }
  });

  it('shows no icon while image optimization is off', async () => {
    const cms = await site(
      { icon: ICON, headerIcon: true },
      { [ICON]: await png() },
      { imageOptimization: false },
    );
    assert.equal(headerIconAttributes(await homeLink(cms, '/')), undefined);
  });
});
