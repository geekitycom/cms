import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { sandbox } from '../admin/__testing__/harness.ts';
import type { Cms } from '../index.ts';

const box = sandbox();
after(() => box.cleanup());

const FILES: Record<string, string> = {
  'posts/2026-09-01-one.md':
    "---\ntitle: One\ndate: '2026-09-01T09:00:00Z'\npermalink: /2026/09/one/\ntags: [notes]\n---\n\nThe first.\n",
  'pages/about.md': '---\ntitle: About\npermalink: /about/\n---\n\nWho writes this.\n',
};

async function site(siteJson: Record<string, unknown>, config: { geminiPort?: number } = {}) {
  const contentDir = await box.dir('geekity-capsule-content-');
  const files = {
    ...FILES,
    '_data/site.json': JSON.stringify({ title: 'Field Notes', ...siteJson }),
  };
  for (const [relative, contents] of Object.entries(files)) {
    const file = path.join(contentDir, ...relative.split('/'));
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, contents, 'utf8');
  }
  return await box.open({
    contentDir,
    dataDir: await box.dir('geekity-capsule-data-'),
    baseUrl: 'https://example.com',
    ...config,
  });
}

async function text(cms: Cms, url: string, status = 200): Promise<string> {
  const response = await cms.app.request(url);
  assert.equal(response.status, status, url);
  return await response.text();
}

function geminiAlternate(html: string): string | undefined {
  return /<link rel="alternate" type="text\/gemini" href="([^"]*)">/.exec(html)?.[1];
}

describe('capsule links', () => {
  it('link each public HTML page to its gemini:// URL while Gemini is on', async () => {
    const cms = await site({ gemini: true });
    const expected: [string, string][] = [
      ['/', 'gemini://example.com/index.gmi'],
      ['/2026/09/one/', 'gemini://example.com/2026/09/one/index.gmi'],
      ['/about/', 'gemini://example.com/about/index.gmi'],
      ['/tag/notes/', 'gemini://example.com/tag/notes/index.gmi'],
      ['/search/?q=first', 'gemini://example.com/search/index.gmi?q=first'],
    ];
    for (const [url, capsule] of expected) {
      assert.equal(geminiAlternate(await text(cms, url)), capsule, url);
    }
    assert.equal(geminiAlternate(await text(cms, '/nowhere/', 404)), undefined, 'a 404 has none');
  });

  it('name the port when Gemini is not on 1965', async () => {
    const cms = await site({ gemini: true }, { geminiPort: 1966 });
    assert.equal(
      geminiAlternate(await text(cms, '/about/')),
      'gemini://example.com:1966/about/index.gmi',
    );
  });

  it('offer the page over Gemini in its Markdown footer, but not in its gemtext', async () => {
    const cms = await site({ gemini: true });
    const markdown = await text(cms, '/2026/09/one/index.md');
    assert.match(
      markdown,
      /\n## Gemini\n\n\[Read this page over Gemini\]\(gemini:\/\/example\.com\/2026\/09\/one\/index\.gmi\)\n/,
    );
    assert.ok(!(await text(cms, '/2026/09/one/index.gmi')).includes('over Gemini'));
    assert.ok(!(await text(cms, '/nowhere/index.md', 404)).includes('gemini://'));
  });

  it('name the capsule in llms.txt', async () => {
    const cms = await site({ gemini: true });
    assert.match(
      await text(cms, '/llms.txt'),
      /^# Field Notes\n\nThis site is also a Gemini capsule at <gemini:\/\/example\.com\/>\.\n/,
    );
  });

  it('say nothing of Gemini while it is off', async () => {
    const cms = await site({});
    assert.equal(geminiAlternate(await text(cms, '/2026/09/one/')), undefined);
    assert.ok(!(await text(cms, '/2026/09/one/index.md')).includes('gemini://'));
    assert.ok(!(await text(cms, '/llms.txt')).includes('gemini://'));
  });
});
