import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { sandbox, signedIn } from '../admin/__testing__/harness.ts';
import type { Browser } from '../admin/__testing__/harness.ts';
import type { Cms } from '../index.ts';

const box = sandbox();
after(() => box.cleanup());

const CONTENT: Record<string, string> = {
  '_data/site.json': JSON.stringify({ title: 'A Site' }),
  'wiki/garden-tools.md': '---\ntitle: Garden tools\n---\n\nA spade and a fork.\n',
  'wiki/unfinished.md': '---\ntitle: Unfinished\ndraft: true\n---\n\nNot yet.\n',
  '_trash/wiki/dropped.md': '---\ntitle: Dropped\ndraft: true\n---\n\nNever was.\n',
};

const CREATE_SHED = `/admin/wiki/new?slug=potting-shed&amp;title=Potting+shed`;

async function site(): Promise<{ cms: Cms; agent: Browser }> {
  const contentDir = await box.dir('geekity-wiki-create-content-');
  for (const [relative, contents] of Object.entries(CONTENT)) {
    const file = path.join(contentDir, ...relative.split('/'));
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, contents, 'utf8');
  }
  const cms = await box.open({
    contentDir,
    dataDir: await box.dir('geekity-wiki-create-data-'),
    baseUrl: 'https://blog.example',
    now: () => new Date('2026-09-13T12:00:00Z'),
  });
  return { cms, agent: await signedIn(cms) };
}

async function missing(response: Response): Promise<string> {
  assert.equal(response.status, 404);
  return await response.text();
}

describe('a missing wiki page', () => {
  it('is a plain 404 for a visitor, in every representation', async () => {
    const { cms } = await site();
    for (const pathname of [
      '/wiki/potting-shed/',
      '/wiki/potting-shed/index.md',
      '/wiki/potting-shed/index.gmi',
    ]) {
      const text = await missing(await cms.app.request(pathname));
      assert.doesNotMatch(text, /Create|\/admin\/wiki/, pathname);
    }
  });

  it('offers a signed-in writer the editor, with the slug and a title made from it', async () => {
    const { agent } = await site();
    const response = await agent.get('/wiki/potting-shed/');
    const html = await missing(response);

    assert.ok(html.includes(`href="${CREATE_SHED}"`), html);
    assert.match(html, />Create Potting shed</);
    assert.match(response.headers.get('cache-control') ?? '', /private/);
    assert.match(response.headers.get('cache-control') ?? '', /no-store/);

    const editor = await agent.get(CREATE_SHED.replaceAll('&amp;', '&'));
    assert.equal(editor.status, 200);
    const form = await editor.text();
    assert.match(form, /id="editor-title"[^>]*value="Potting shed"/);
    assert.match(form, /id="editor-slug"[^>]*value="potting-shed"/);
  });

  it('counts a trashed draft as missing', async () => {
    const { agent } = await site();
    const html = await missing(await agent.get('/wiki/dropped/'));
    assert.ok(html.includes('href="/admin/wiki/new?slug=dropped&amp;title=Dropped"'), html);
  });

  it('is not missing while it is a draft: the writer sees the draft and its editor link', async () => {
    const { agent } = await site();
    const response = await agent.get('/wiki/unfinished/');
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.ok(html.includes('href="/admin/wiki/unfinished"'), html);
    assert.doesNotMatch(html, /Create Unfinished/);
  });

  it('carries no button in the Markdown and Gemini 404s, even for a writer', async () => {
    const { agent } = await site();
    for (const pathname of ['/wiki/potting-shed/index.md', '/wiki/potting-shed/index.gmi']) {
      const text = await missing(await agent.get(pathname));
      assert.doesNotMatch(text, /Create|\/admin\/wiki/, pathname);
    }
  });

  it('is offered only at a wiki page’s own address', async () => {
    const { agent } = await site();
    for (const pathname of ['/potting-shed/', '/wiki/Potting_Shed/', '/wiki/a/b/']) {
      const html = await missing(await agent.get(pathname));
      assert.doesNotMatch(html, /\/admin\/wiki\/new/, pathname);
    }
  });
});
