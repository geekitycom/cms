import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { fieldsOf, saveUrlOf } from '../admin/__testing__/editor-form.ts';
import { sandbox, signedIn } from '../admin/__testing__/harness.ts';
import type { Browser } from '../admin/__testing__/harness.ts';
import { saveSettings } from '../admin/__testing__/settings.ts';
import type { Cms } from '../index.ts';
import { shared } from './__testing__/shared.ts';

const box = sandbox();
after(() => box.cleanup());

const BASE = 'https://blog.example';

const CONTENT: Record<string, string> = {
  '_data/site.json': JSON.stringify({ title: 'A Site' }),
  'wiki/gabe-newport.md':
    '---\ntitle: Gabe Newport\naliases:\n  - Gabe\n  - The Captain\n  - Gabe Newport\n---\n\nThe hero.\n',
  'wiki/rosa.md': '---\ntitle: Rosa\naliases: [Ro]\ndraft: true\n---\n\nNot yet.\n',
  '_trash/wiki/binned.md': '---\ntitle: Binned\naliases: [Old name]\n---\n\nGone.\n',
  'wiki/marigold.md': '---\ntitle: Marigold\naliases: [Goldie]\n---\n\nA flower.\n',
  'wiki/goldie.md': '---\ntitle: Goldie\n---\n\nA dog, who owns this URL.\n',
  'posts/scene-one.md':
    "---\ntitle: Scene one\ndate: '2026-09-04T09:00:00Z'\npermalink: /2026/09/scene-one/\n---\n\n[[Gabe]] walked in.\n",
};

async function site(): Promise<Cms> {
  const contentDir = await box.dir('geekity-wiki-aliases-content-');
  for (const [relative, contents] of Object.entries(CONTENT)) {
    const file = path.join(contentDir, ...relative.split('/'));
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, contents, 'utf8');
  }
  return await box.open({
    contentDir,
    dataDir: await box.dir('geekity-wiki-aliases-data-'),
    baseUrl: BASE,
  });
}

const sharedSite = shared(site);

async function redirect(cms: Cms, pathname: string): Promise<string | null> {
  const response = await cms.app.request(pathname);
  assert.equal(response.status, 301, `GET ${pathname} answered ${String(response.status)}`);
  return response.headers.get('location');
}

async function html(agent: Browser, url: string): Promise<string> {
  const response = await agent.get(url);
  assert.equal(response.status, 200, `GET ${url} answered ${String(response.status)}`);
  return await response.text();
}

async function save(
  agent: Browser,
  url: string,
  changes: Record<string, string>,
): Promise<Response> {
  const page = await html(agent, url);
  const saveUrl = saveUrlOf(page);
  assert.ok(saveUrl !== undefined, `the editor at ${url} knew where to post`);
  return await agent.post(saveUrl, { ...Object.fromEntries(fieldsOf(page)), ...changes });
}

describe('a wiki page alias', () => {
  it('answers with a 301 to its page in every representation', async () => {
    const cms = await sharedSite();
    assert.equal(await redirect(cms, '/wiki/gabe/'), '/wiki/gabe-newport/');
    assert.equal(await redirect(cms, '/wiki/the-captain/'), '/wiki/gabe-newport/');
    assert.equal(await redirect(cms, '/wiki/gabe/index.md'), '/wiki/gabe-newport/index.md');
    assert.equal(await redirect(cms, '/wiki/gabe/index.gmi'), '/wiki/gabe-newport/index.gmi');
    assert.equal(await redirect(cms, '/wiki/gabe/index.json'), '/wiki/gabe-newport/index.json');
  });

  it('does not answer for a draft page or a trashed one', async () => {
    const cms = await sharedSite();
    assert.equal((await cms.app.request('/wiki/ro/')).status, 404);
    assert.equal((await cms.app.request('/wiki/old-name/')).status, 404);
  });

  it('gives way to a published wiki page whose own slug it is', async () => {
    const cms = await sharedSite();
    const response = await cms.app.request('/wiki/goldie/');
    assert.equal(response.status, 200);
    assert.match(await response.text(), /A dog, who owns this URL\./);
  });

  it('leaves [[Alias]] rendered at the alias slug, and counts it as a backlink', async () => {
    const cms = await sharedSite();
    const scene = await (await cms.app.request('/2026/09/scene-one/')).text();
    assert.match(scene, /<a class="wiki-link" href="\/wiki\/gabe\/">Gabe<\/a>/);
    assert.equal(
      cms.store.getByPath('posts/scene-one.md')?.html,
      '<p><a class="wiki-link" href="/wiki/gabe/">Gabe</a> walked in.</p>\n',
    );

    const page = await (await cms.app.request('/wiki/gabe-newport/')).text();
    assert.match(page, /<section class="backlinks"[\s\S]*Scene one[\s\S]*<\/section>/);
  });

  it('follows a change of wiki base', async () => {
    const cms = await site();
    const agent = await signedIn(cms);
    await saveSettings(agent, 'permalinks', { wiki_base: 'cast' });

    assert.equal(await redirect(cms, '/cast/gabe/'), '/cast/gabe-newport/');
    assert.equal(await redirect(cms, '/cast/gabe/index.md'), '/cast/gabe-newport/index.md');
  });
});

describe('aliases in the wiki editor', () => {
  it('are shown and saved, the page’s own slug and repeats dropped', async () => {
    const cms = await site();
    const agent = await signedIn(cms);
    const editor = await html(agent, '/admin/wiki/gabe-newport');
    assert.match(editor, /id="editor-aliases"[^>]*value="Gabe, The Captain"/);

    const saved = await save(agent, '/admin/wiki/gabe-newport', {
      aliases: 'Gabe, gabe newport, The Captain, Cap, Gabe',
      action: 'update',
    });
    assert.equal(saved.status, 303);
    const file = await readFile(
      path.join(cms.config.contentDir, 'wiki', 'gabe-newport.md'),
      'utf8',
    );
    assert.match(file, /aliases:\n {2}- Gabe\n {2}- The Captain\n {2}- Cap\n/);
    assert.equal(await redirect(cms, '/wiki/cap/'), '/wiki/gabe-newport/');
  });

  it('remove the key when emptied', async () => {
    const cms = await site();
    const agent = await signedIn(cms);
    const saved = await save(agent, '/admin/wiki/gabe-newport', {
      aliases: '',
      action: 'update',
    });
    assert.equal(saved.status, 303);
    const file = await readFile(
      path.join(cms.config.contentDir, 'wiki', 'gabe-newport.md'),
      'utf8',
    );
    assert.doesNotMatch(file, /aliases/);
    assert.equal((await cms.app.request('/wiki/gabe/')).status, 404);
  });

  it('refuse an alias another wiki page holds as its slug or an alias, naming it', async () => {
    const cms = await site();
    const agent = await signedIn(cms);

    for (const [alias, owner] of [
      ['Rosa', 'Rosa'],
      ['RO', 'Rosa'],
      ['marigold', 'Marigold'],
      ['Goldie', 'Goldie'],
    ] as const) {
      const refused = await save(agent, '/admin/wiki/gabe-newport', {
        aliases: `Gabe, ${alias}`,
        action: 'update',
      });
      assert.equal(refused.status, 400, alias);
      assert.match(await refused.text(), new RegExp(`wiki page ${owner}\\b`), alias);
    }
    assert.match(
      await readFile(path.join(cms.config.contentDir, 'wiki', 'gabe-newport.md'), 'utf8'),
      /- The Captain/,
      'nothing was written',
    );
  });

  it('may take an alias a trashed page held', async () => {
    const cms = await site();
    const agent = await signedIn(cms);
    const saved = await save(agent, '/admin/wiki/gabe-newport', {
      aliases: 'Gabe, Old name',
      action: 'update',
    });
    assert.equal(saved.status, 303);
  });
});
