import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { fieldsOf, saveUrlOf } from './__testing__/editor-form.ts';
import { sandbox, signedIn } from './__testing__/harness.ts';
import type { Browser } from './__testing__/harness.ts';

const box = sandbox();
after(() => box.cleanup());

const CONTENT: Record<string, string> = {
  '_data/site.json': JSON.stringify({ title: 'A Site' }),
  'wiki/garden-tools.md': '---\ntitle: Garden tools\naliases: [Tools, Shed]\n---\n\nA spade.\n',
  'wiki/unfinished.md':
    '---\ntitle: Unfinished\naliases: [Not done]\ndraft: true\n---\n\nNot yet.\n',
  '_trash/wiki/binned.md': '---\ntitle: Binned\naliases: [Rubbish]\n---\n\nGone.\n',
  'posts/2026-09-01-hello.md':
    "---\ntitle: Hello\ndate: '2026-09-01T09:00:00Z'\n---\n\nSee [[Garden tools]].\n",
  'pages/about.md': '---\ntitle: About\npermalink: /about/\n---\n\nAbout.\n',
};

async function site(): Promise<Browser> {
  const contentDir = await box.dir('geekity-editor-wiki-slugs-content-');
  for (const [relative, contents] of Object.entries(CONTENT)) {
    const file = path.join(contentDir, ...relative.split('/'));
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, contents, 'utf8');
  }
  const cms = await box.open({
    contentDir,
    dataDir: await box.dir('geekity-editor-wiki-slugs-data-'),
    baseUrl: 'https://blog.example',
  });
  return await signedIn(cms);
}

async function wikiSlugs(agent: Browser, url: string): Promise<unknown> {
  const response = await agent.get(url);
  assert.equal(response.status, 200, url);
  const tag = /<div[^>]*id="editor-enhance"[^>]*>/.exec(await response.text())?.[0] ?? '';
  const value = /data-wiki-slugs="([^"]*)"/.exec(tag)?.[1];
  assert.ok(value !== undefined, `${url} carries data-wiki-slugs`);
  return JSON.parse(value.replaceAll('&quot;', '"').replaceAll('&amp;', '&'));
}

describe('the editor’s wiki pages', () => {
  it('are on the post, page and wiki editors, with the alias slugs of all but the trash', async () => {
    const agent = await site();
    for (const url of [
      '/admin/posts/new?kind=note',
      '/admin/posts/hello',
      '/admin/pages/new',
      '/admin/wiki/new',
      '/admin/wiki/garden-tools',
    ]) {
      assert.deepEqual(
        await wikiSlugs(agent, url),
        ['garden-tools', 'not-done', 'shed', 'tools', 'unfinished'],
        url,
      );
    }
  });

  it('take in a page written since the last load', async () => {
    const agent = await site();
    const before = await wikiSlugs(agent, '/admin/pages/new');
    assert.deepEqual(before, ['garden-tools', 'not-done', 'shed', 'tools', 'unfinished']);

    const form = await (await agent.get('/admin/wiki/new')).text();
    const saved = await agent.post(saveUrlOf(form) ?? '', {
      ...Object.fromEntries(fieldsOf(form)),
      title: 'Compost',
      slug: 'compost',
      body: 'Heaps.',
    });
    assert.ok(saved.status < 400, `saving answered ${String(saved.status)}`);

    assert.deepEqual(await wikiSlugs(agent, '/admin/pages/new'), [
      'compost',
      'garden-tools',
      'not-done',
      'shed',
      'tools',
      'unfinished',
    ]);
  });
});
