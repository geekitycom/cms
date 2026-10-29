/**
 * The admin's Wiki screens: the listing, the editor with only what a wiki page
 * carries, and the shared paths (autosave, preview, the comments and media
 * screens) that have to know a third type of document.
 */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { autosaveCopies, mintAutosaveId } from '../autosave/index.ts';
import { addComment } from '../comments/records.ts';
import { findUser } from '../site/users.ts';
import type { Cms } from '../index.ts';
import { fieldsOf, saveUrlOf } from './__testing__/editor-form.ts';
import { sandbox, signedIn } from './__testing__/harness.ts';
import { saveSettings } from './__testing__/settings.ts';
import type { Browser } from './__testing__/harness.ts';
import { statuses } from './__testing__/statuses.ts';

const box = sandbox();
after(() => box.cleanup());

const NOW = '2026-09-13T12:00:00Z';

const CONTENT: Record<string, string> = {
  '_data/site.json': JSON.stringify({ title: 'A Site' }),
  'wiki/garden-tools.md':
    "---\ntitle: Garden tools\nupdated: '2026-09-10T09:00:00Z'\n---\n\nA spade and a fork. ![A spade](/uploads/2026/09/spade.png)\n",
  'wiki/unfinished.md': '---\ntitle: Unfinished\ndraft: true\n---\n\nNot yet.\n',
  '_trash/wiki/binned.md': '---\ntitle: Binned\n---\n\nGone.\n',
  'pages/about.md': '---\ntitle: About\npermalink: /about/\n---\n\nAbout.\n',
  'uploads/2026/09/spade.png': 'not really a png',
};

async function site(): Promise<{ cms: Cms; agent: Browser }> {
  const contentDir = await box.dir('geekity-admin-wiki-content-');
  for (const [relative, contents] of Object.entries(CONTENT)) {
    const file = path.join(contentDir, ...relative.split('/'));
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, contents, 'utf8');
  }
  const cms = await box.open({
    contentDir,
    dataDir: await box.dir('geekity-admin-wiki-data-'),
    baseUrl: 'https://blog.example',
    now: () => new Date(NOW),
  });
  return { cms, agent: await signedIn(cms) };
}

async function html(agent: Browser, url: string): Promise<string> {
  const response = await agent.get(url);
  assert.equal(response.status, 200, `GET ${url} answered ${String(response.status)}`);
  return await response.text();
}

/** The editor's fields as a browser would post them, with some changed. */
async function editorFields(
  agent: Browser,
  url: string,
  changes: Record<string, string> = {},
): Promise<{ fields: Record<string, string>; saveUrl: string }> {
  const page = await html(agent, url);
  const saveUrl = saveUrlOf(page);
  assert.ok(saveUrl !== undefined, `the editor at ${url} knew where to post`);
  return { fields: { ...Object.fromEntries(fieldsOf(page)), ...changes }, saveUrl };
}

function userId(cms: Cms): number {
  const user = findUser(cms.config.dataDir, 'ada');
  assert.ok(user !== undefined);
  return user.id;
}

describe('the Wiki screens', () => {
  it('are in the admin menu, after Pages', async () => {
    const { agent } = await site();
    const page = await html(agent, '/admin');

    assert.match(page, /<a[^>]*href="\/admin\/wiki"[^>]*>Wiki<\/a>/);
    assert.ok(
      page.indexOf('href="/admin/pages"') < page.indexOf('href="/admin/wiki"'),
      'Wiki follows Pages',
    );
  });

  it('list the wiki pages, with drafts and trash', async () => {
    const { agent } = await site();

    const all = await html(agent, '/admin/wiki');
    assert.match(all, /<h1 class="text-2xl font-bold">Wiki<\/h1>/);
    assert.match(all, /<a\b[^>]*href="\/admin\/wiki\/garden-tools">Garden tools<\/a>/);
    assert.match(all, /<a\b[^>]*href="\/admin\/wiki\/unfinished">Unfinished<\/a>/);
    assert.ok(statuses(all).includes('Draft'), 'the draft says so');
    assert.doesNotMatch(all, /About/, 'and no page is among them');
    assert.doesNotMatch(all, /Binned/, 'nor anything in the trash');
    assert.match(all, /href="\/admin\/wiki\/new"/, 'with a way to write a new one');

    const drafts = await html(agent, '/admin/wiki?status=draft');
    assert.match(drafts, /Unfinished/);
    assert.doesNotMatch(drafts, /Garden tools/);

    const trash = await html(agent, '/admin/wiki?status=trash');
    assert.match(trash, /Binned/);
    assert.doesNotMatch(trash, /Garden tools/);
  });

  it('write a new wiki page with a title, slug and body only', async () => {
    const { agent } = await site();
    const editor = await html(agent, '/admin/wiki/new');

    for (const id of ['editor-title', 'editor-slug', 'editor-body']) {
      assert.match(editor, new RegExp(`id="${id}"`), `the editor has ${id}`);
    }
    for (const id of [
      'editor-date',
      'editor-tags',
      'editor-categories',
      'editor-in-reply-to',
      'editor-location',
      'editor-permalink',
      'editor-exclude',
      'editor-contact',
    ]) {
      assert.doesNotMatch(editor, new RegExp(`id="${id}`), `and no ${id}`);
    }
    assert.match(editor, /<h1\b[^>]*>\s*<span class="min-w-0">New wiki page<\/span>/);
    assert.match(
      editor,
      /<option value=""[^>]* selected>Follow the site settings \(closed for wiki pages\)<\/option>/,
    );
  });

  it('save a new wiki page under wiki/ and serve it at the wiki base', async () => {
    const { cms, agent } = await site();
    const { fields, saveUrl } = await editorFields(agent, '/admin/wiki/new', {
      title: 'Compost heap',
      body: 'Turn it monthly.',
      action: 'publish',
    });

    const response = await agent.post(saveUrl, fields);
    assert.equal(response.status, 303);
    assert.equal(response.headers.get('location'), '/admin/wiki/compost-heap');

    const file = await readFile(
      path.join(cms.config.contentDir, 'wiki', 'compost-heap.md'),
      'utf8',
    );
    assert.match(file, /title: Compost heap/);
    assert.doesNotMatch(file, /permalink:/, 'the URL is not written into the file');
    assert.match(file, /Turn it monthly\./);

    const served = await cms.app.request('/wiki/compost-heap/');
    assert.equal(served.status, 200);
    assert.match(await served.text(), /Turn it monthly\./);
  });

  it('edit a wiki page and move it to the trash', async () => {
    const { cms, agent } = await site();
    const editor = await html(agent, '/admin/wiki/garden-tools');
    assert.match(editor, /Edit wiki page: Garden tools/);

    const { fields, saveUrl } = await editorFields(agent, '/admin/wiki/garden-tools', {
      body: 'A spade, a fork and a rake.',
      action: 'update',
    });
    const saved = await agent.post(saveUrl, fields);
    assert.equal(saved.status, 303);
    assert.match(
      await readFile(path.join(cms.config.contentDir, 'wiki', 'garden-tools.md'), 'utf8'),
      /a rake/,
    );

    const trashed = await agent.post(saveUrl, { ...fields, action: 'trash' });
    assert.equal(trashed.status, 303);
    assert.equal(trashed.headers.get('location'), '/admin/wiki');
    assert.equal(cms.store.getByPath('wiki/garden-tools.md'), undefined);
    assert.equal(cms.store.getByPath('_trash/wiki/garden-tools.md')?.type, 'wiki');
  });

  it('open the new editor with the slug and title a link asked for', async () => {
    const { agent } = await site();
    const editor = await html(agent, '/admin/wiki/new?slug=rain-barrel&title=Rain+barrel');

    assert.match(editor, /id="editor-title"[^>]*value="Rain barrel"/);
    assert.match(editor, /id="editor-slug"[^>]*value="rain-barrel"/);
  });
});

describe('the shared editor paths for a wiki page', () => {
  it('autosave a new wiki page as a wiki copy, listed under the Wiki screens', async () => {
    const { cms, agent } = await site();
    const id = mintAutosaveId();
    const { fields } = await editorFields(agent, '/admin/wiki/new', {
      title: 'Seed list',
      body: 'Beans.',
      autosave: id,
    });

    const response = await agent.post('/admin/autosave', fields);
    assert.equal(response.status, 200);
    const copy = autosaveCopies(cms.config.dataDir).read(userId(cms), id);
    assert.equal(copy?.type, 'wiki');
    assert.equal(copy?.path, undefined);

    const unsaved = await html(agent, '/admin/wiki?status=unsaved');
    assert.match(unsaved, /Seed list/);
    assert.match(unsaved, /Wiki page/);
    assert.match(unsaved, /New wiki page/);
    assert.match(unsaved, new RegExp(`href="/admin/wiki/new\\?autosave=${id}[^"]*"`));
    assert.doesNotMatch(
      await html(agent, '/admin/pages?status=unsaved'),
      /Seed list/,
      'and not under Pages',
    );
  });

  it('autosave an existing wiki page against its file', async () => {
    const { cms, agent } = await site();
    const { fields } = await editorFields(agent, '/admin/wiki/garden-tools', {
      body: 'Edited, unsaved.',
    });

    const response = await agent.post('/admin/autosave', fields);
    assert.equal(response.status, 200);
    const copy = autosaveCopies(cms.config.dataDir).read(userId(cms), 'wiki/garden-tools.md');
    assert.equal(copy?.type, 'wiki');
    assert.equal(copy?.path, 'wiki/garden-tools.md');
  });

  it('preview a wiki page through the wiki layout', async () => {
    const { agent } = await site();
    const { fields } = await editorFields(agent, '/admin/wiki/new', {
      title: 'Previewed',
      body: 'Shown before saving.',
    });

    const response = await agent.post('/admin/preview', fields);
    assert.equal(response.status, 200);
    const page = await response.text();
    assert.match(page, /<article class="blog-post wiki-page h-entry"/);
    assert.match(page, /Shown before saving\./);
  });

  it("preview wiki links under the site's wiki base", async () => {
    const { agent } = await site();
    await saveSettings(agent, 'permalinks', { wiki_base: 'notes' });
    const { fields } = await editorFields(agent, '/admin/pages/new', {
      title: 'Previewed',
      body: 'See [[Garden tools#The shed|the shed]].',
    });

    const response = await agent.post('/admin/preview', fields);
    assert.equal(response.status, 200);
    assert.match(
      await response.text(),
      /<a class="wiki-link" href="\/notes\/garden-tools\/#the-shed">the shed<\/a>/,
    );
  });

  it('link a comment on a wiki page to the wiki editor', async () => {
    const { cms, agent } = await site();
    await addComment(
      { admin: cms.admin, contentDir: cms.config.contentDir, dataDir: cms.config.dataDir },
      {
        slug: 'garden-tools',
        permalink: '/wiki/garden-tools/',
        source: 'comment',
        kind: 'reply',
        status: 'pending',
        author: { name: 'Grace', url: null, email: 'grace@example.com', avatar: null },
        content: { markdown: 'Nice shed.', html: '<p>Nice shed.</p>\n' },
        submitted: '2026-09-12T10:00:00.000Z',
        addressHash: 'deadbeefcafe',
        notify: false,
        inReplyTo: null,
        url: null,
      },
    );

    const page = await html(agent, '/admin/comments');
    assert.match(page, /<a class="link" href="\/admin\/wiki\/garden-tools">Garden tools<\/a>/);
  });

  it('link a file a wiki page uses to the wiki editor', async () => {
    const { agent } = await site();
    const page = await html(agent, '/admin/media/file?path=2026%2F09%2Fspade.png');

    assert.match(page, /<a\b[^>]*href="\/admin\/wiki\/garden-tools">Garden tools<\/a>/);
  });
});
