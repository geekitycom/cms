import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import type { Cms } from '../index.ts';
import { BASE, fixtureSite } from '../mcp/inspect/__testing__/fixture.ts';
import { fieldsOf, saveUrlOf } from './__testing__/editor-form.ts';
import { flashes } from './__testing__/flash.ts';
import { csrfField, FIRST_ADMIN, sandbox, signedIn, signIn } from './__testing__/harness.ts';
import type { Browser } from './__testing__/harness.ts';
import { writeUsers } from './__testing__/users.ts';

const box = sandbox();
after(() => box.cleanup());

const SCENE_ONE =
  "---\ntitle: Scene one\ndate: '2026-09-04T09:00:00Z'\npermalink: /2026/09/scene-one/\n---\n\nAnd then Gabe fell in the well.  \nGabe climbed out, `gabe` said.\n";

const CONTENT: Record<string, string> = {
  '_data/site.json': JSON.stringify({ title: 'A Site' }),
  'wiki/gabe-newport.md':
    '---\ntitle: Gabe Newport\naliases: [Gabe, The Captain]\n---\n\nGabe is the hero.\n',
  'wiki/rosa.md': '---\ntitle: Rosa\n---\n\nRosa knows Gabe Newport well.\n',
  'posts/2026-09-04-scene-one.md': SCENE_ONE,
  'posts/2026-09-05-scene-two.md':
    "---\ntitle: Scene two\ndate: '2026-09-05T09:00:00Z'\ndraft: true\n---\n\nGabe's hat was gone.\n",
  'posts/2099-01-01-scene-three.md':
    "---\ntitle: Scene three\ndate: '2099-01-01T09:00:00Z'\n---\n\nthe captain sailed.\n",
  'pages/cast.md': '---\ntitle: Cast\npermalink: /cast/\n---\n\nThe Captain, mostly.\n',
  'posts/2026-09-06-linked.md':
    "---\ntitle: Linked\ndate: '2026-09-06T09:00:00Z'\n---\n\n[[Gabe]] and Gabe again.\n",
  'posts/2026-09-07-coded.md':
    "---\ntitle: Coded\ndate: '2026-09-07T09:00:00Z'\n---\n\nRun `gabe` and see [Gabe](https://example.com/).\n",
  'posts/2026-09-08-elsewhere.md':
    "---\ntitle: Elsewhere\ndate: '2026-09-08T09:00:00Z'\n---\n\nNobody here.\n",
  '_trash/posts/2026-09-09-binned.md':
    "---\ntitle: Binned\ndate: '2026-09-09T09:00:00Z'\n---\n\nGabe was here.\n",
};

async function site(): Promise<{ cms: Cms; agent: Browser }> {
  const contentDir = await box.dir('geekity-wiki-mentions-content-');
  for (const [relative, contents] of Object.entries(CONTENT)) {
    const file = path.join(contentDir, ...relative.split('/'));
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, contents, 'utf8');
  }
  const cms = await box.open({
    contentDir,
    dataDir: await box.dir('geekity-wiki-mentions-data-'),
    baseUrl: 'https://blog.example',
  });
  return { cms, agent: await signedIn(cms) };
}

async function html(agent: Browser, url: string): Promise<string> {
  const response = await agent.get(url);
  assert.equal(response.status, 200, `GET ${url} answered ${String(response.status)}`);
  return await response.text();
}

function panelOf(page: string): string | undefined {
  return /<section[^>]*id="wiki-mentions"[\s\S]*?<\/section>/.exec(page)?.[0];
}

function entries(panel: string): Map<string, string> {
  return new Map(
    [...panel.matchAll(/<li[^>]*data-mention="([^"]+)"[^>]*>([\s\S]*?)<\/li>/g)].map(
      ([, file = '', entry = '']) => [file, entry],
    ),
  );
}

function text(markup: string): string {
  return markup
    .replace(/<[^>]*>/g, ' ')
    .replaceAll('&#39;', "'")
    .replaceAll('&quot;', '"')
    .replace(/\s+/g, ' ')
    .trim();
}

async function link(agent: Browser, fields: Record<string, string>): Promise<string> {
  const editor = await html(agent, '/admin/wiki/gabe-newport');
  const panel = panelOf(editor) ?? '';
  const action = /<form[^>]*action="([^"]+)"/.exec(panel)?.[1];
  assert.ok(action !== undefined, 'the panel has a form');
  const response = await agent.post(action, {
    csrf_token: csrfField(editor) ?? '',
    ...fields,
  });
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('location'), '/admin/wiki/gabe-newport');
  return await html(agent, '/admin/wiki/gabe-newport');
}

async function file(cms: Cms, relative: string): Promise<string> {
  return await readFile(path.join(cms.config.contentDir, ...relative.split('/')), 'utf8');
}

describe('the unlinked mentions panel', () => {
  it('lists each live post, page and wiki page that mentions the page without linking it', async () => {
    const { agent } = await site();
    const panel = panelOf(await html(agent, '/admin/wiki/gabe-newport'));
    assert.ok(panel !== undefined, 'the wiki editor has the panel');
    assert.deepEqual([...entries(panel).keys()].sort(), [
      'pages/cast.md',
      'posts/2026-09-04-scene-one.md',
      'posts/2026-09-05-scene-two.md',
      'posts/2099-01-01-scene-three.md',
      'wiki/rosa.md',
    ]);
  });

  it('shows each title, its status, the text around the first mention, and a Link button', async () => {
    const { agent } = await site();
    const listed = entries(panelOf(await html(agent, '/admin/wiki/gabe-newport')) ?? '');

    const one = listed.get('posts/2026-09-04-scene-one.md') ?? '';
    assert.match(text(one), /Scene one/);
    assert.match(text(one), /Published/);
    assert.match(one, /And then <mark>Gabe<\/mark> fell in the well/);
    assert.match(one, /<button[^>]*name="link"[^>]*value="posts\/2026-09-04-scene-one\.md"/);
    assert.match(text(one), /Followers get an update/);

    const two = listed.get('posts/2026-09-05-scene-two.md') ?? '';
    assert.match(text(two), /Draft/);
    assert.match(two, /<mark>Gabe<\/mark>&#39;s hat/);
    assert.doesNotMatch(text(two), /Followers get an update/);

    assert.match(text(listed.get('posts/2099-01-01-scene-three.md') ?? ''), /Scheduled/);
    assert.doesNotMatch(text(listed.get('pages/cast.md') ?? ''), /Followers get an update/);
    assert.match(listed.get('wiki/rosa.md') ?? '', /<mark>Gabe Newport<\/mark>/);
  });

  it('has a Link all button', async () => {
    const { agent } = await site();
    const panel = panelOf(await html(agent, '/admin/wiki/gabe-newport')) ?? '';
    assert.match(panel, /<button[^>]*name="link-all"/);
  });

  it('is not on a new wiki page or on the post and page editors', async () => {
    const { agent } = await site();
    for (const url of ['/admin/wiki/new', '/admin/posts/scene-one', '/admin/pages/cast']) {
      assert.equal(panelOf(await html(agent, url)), undefined, url);
    }
  });

  it('says so when nothing mentions the page', async () => {
    const { agent } = await site();
    const panel = panelOf(await html(agent, '/admin/wiki/rosa')) ?? '';
    assert.match(text(panel), /Nothing else mentions this page without linking to it\./);
    assert.doesNotMatch(panel, /name="link-all"/);
  });
});

describe('Link', () => {
  it('wraps the first mention and leaves the rest of the file as it was', async () => {
    const { cms, agent } = await site();
    const after = await link(agent, { link: 'posts/2026-09-04-scene-one.md' });

    const saved = await file(cms, 'posts/2026-09-04-scene-one.md');
    assert.ok(
      saved.endsWith('\n\nAnd then [[Gabe]] fell in the well.  \nGabe climbed out, `gabe` said.\n'),
      saved,
    );
    assert.deepEqual(flashes(after), [{ kind: 'notice', message: 'Linked 1 document: Scene one' }]);
    assert.ok(!entries(panelOf(after) ?? '').has('posts/2026-09-04-scene-one.md'));
  });

  it('saves through the normal save path, so the page gets a backlink', async () => {
    const { cms, agent } = await site();
    await link(agent, { link: 'posts/2026-09-04-scene-one.md' });
    assert.match(
      cms.store.getByPath('posts/2026-09-04-scene-one.md')?.html ?? '',
      /<a class="wiki-link" href="\/wiki\/gabe\/">Gabe<\/a>/,
    );
    const page = await (await cms.app.request('/wiki/gabe-newport/')).text();
    assert.match(page, /<section class="backlinks"[\s\S]*Scene one[\s\S]*<\/section>/);
  });

  it('keeps a draft a draft', async () => {
    const { cms, agent } = await site();
    await link(agent, { link: 'posts/2026-09-05-scene-two.md' });
    const saved = await file(cms, 'posts/2026-09-05-scene-two.md');
    assert.match(saved, /draft: true/);
    assert.ok(saved.endsWith("\n\n[[Gabe]]'s hat was gone.\n"), saved);
  });

  it('finds the mention again when the document changed after the panel was shown', async () => {
    const { cms, agent } = await site();
    const panelPage = await html(agent, '/admin/wiki/gabe-newport');

    const editor = await html(agent, '/admin/posts/scene-one');
    const fields = Object.fromEntries(fieldsOf(editor));
    const body = `Gabe Newport arrived.\n\n${fields['body'] ?? ''}`;
    const saved = await agent.post(saveUrlOf(editor) ?? '', {
      ...fields,
      body,
      action: 'update',
    });
    assert.equal(saved.status, 303);

    const action = /<form[^>]*action="([^"]+)"/.exec(panelOf(panelPage) ?? '')?.[1] ?? '';
    const response = await agent.post(action, {
      csrf_token: csrfField(panelPage) ?? '',
      link: 'posts/2026-09-04-scene-one.md',
    });
    assert.equal(response.status, 303);
    assert.match(
      await file(cms, 'posts/2026-09-04-scene-one.md'),
      /\n\n\[\[Gabe Newport\]\] arrived\.\n\nAnd then Gabe fell in the well\./,
    );
  });

  it('refuses when the file changed on disk behind the index, and writes nothing', async () => {
    const { cms, agent } = await site();
    const changed = SCENE_ONE.replace('the well', 'the pond');
    await writeFile(
      path.join(cms.config.contentDir, 'posts', '2026-09-04-scene-one.md'),
      changed,
      'utf8',
    );

    const after = await link(agent, { link: 'posts/2026-09-04-scene-one.md' });
    assert.equal(await file(cms, 'posts/2026-09-04-scene-one.md'), changed);
    assert.equal(flashes(after)[0]?.kind, 'error');
    assert.match(flashes(after)[0]?.message ?? '', /Scene one changed on disk/);
  });

  it('says so when the document no longer mentions the page', async () => {
    const { cms, agent } = await site();
    const after = await link(agent, { link: 'posts/2026-09-08-elsewhere.md' });
    assert.match(await file(cms, 'posts/2026-09-08-elsewhere.md'), /Nobody here\./);
    assert.deepEqual(flashes(after), [
      { kind: 'warning', message: 'Elsewhere no longer mentions this page without linking to it.' },
    ]);
  });

  it('will not touch the trash or the page itself', async () => {
    const { cms, agent } = await site();
    await link(agent, { link: '_trash/posts/2026-09-09-binned.md' });
    await link(agent, { link: 'wiki/gabe-newport.md' });
    assert.equal(
      await file(cms, '_trash/posts/2026-09-09-binned.md'),
      CONTENT['_trash/posts/2026-09-09-binned.md'],
    );
    assert.match(await file(cms, 'wiki/gabe-newport.md'), /\n\nGabe is the hero\.\n$/);
  });
});

describe('Link all', () => {
  it('links every listed document', async () => {
    const { cms, agent } = await site();
    const after = await link(agent, { 'link-all': '1' });

    assert.match(await file(cms, 'posts/2026-09-04-scene-one.md'), /And then \[\[Gabe\]\] fell/);
    assert.match(await file(cms, 'posts/2026-09-05-scene-two.md'), /\[\[Gabe\]\]'s hat/);
    assert.match(await file(cms, 'posts/2099-01-01-scene-three.md'), /\[\[the captain\]\] sailed/);
    assert.match(await file(cms, 'pages/cast.md'), /\[\[The Captain\]\], mostly/);
    assert.match(await file(cms, 'wiki/rosa.md'), /Rosa knows \[\[Gabe Newport\]\] well/);
    assert.match(await file(cms, 'posts/2026-09-06-linked.md'), /\[\[Gabe\]\] and Gabe again/);
    assert.match(await file(cms, 'posts/2026-09-07-coded.md'), /Run `gabe` and see \[Gabe\]/);

    assert.equal(flashes(after)[0]?.message.startsWith('Linked 5 documents:'), true);
    assert.match(text(panelOf(after) ?? ''), /Nothing else mentions this page/);
  });
});

describe('linking a published post', () => {
  const original = globalThis.fetch;
  const delivered: unknown[] = [];
  before(() => {
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const request = new Request(input, init);
      if (request.url.startsWith(`${BASE}/`)) return await original(input, init);
      if (request.method !== 'POST') return new Response('not here', { status: 404 });
      const body = await request.text();
      if (body.startsWith('{'))
        delivered.push((JSON.parse(body) as Record<string, unknown>)['type']);
      return new Response(null, { status: 202 });
    }) as typeof fetch;
  });
  after(() => {
    globalThis.fetch = original;
  });

  it('sends its followers an Update, as a save in its editor does', async () => {
    const cms = await fixtureSite(box, {
      federation: { queue: null, allowPrivateAddress: true },
    });
    writeUsers(cms.config.dataDir, [{ ...FIRST_ADMIN, createdAt: cms.config.now().toISOString() }]);
    const agent = await signIn(cms);

    const blank = await html(agent, '/admin/wiki/new');
    const created = await agent.post(saveUrlOf(blank) ?? '', {
      ...Object.fromEntries(fieldsOf(blank)),
      title: 'Fediverse',
      slug: 'fediverse',
      body: 'Servers that talk to each other.',
      action: 'publish',
    });
    assert.equal(created.status, 303);

    const editor = await html(agent, '/admin/wiki/fediverse');
    const panel = panelOf(editor) ?? '';
    assert.match(panel, /Hello, <mark>fediverse<\/mark>\./);
    assert.match(text(panel), /Followers get an update/);

    const action = /<form[^>]*action="([^"]+)"/.exec(panel)?.[1] ?? '';
    const response = await agent.post(action, {
      csrf_token: csrfField(editor) ?? '',
      link: 'posts/2026-03-01-hello.md',
    });
    assert.equal(response.status, 303);
    await cms.delivery.settled();

    assert.equal(
      cms.store.getByPath('posts/2026-03-01-hello.md')?.body.trim(),
      'Hello, [[fediverse]].',
    );
    assert.equal(cms.admin.lastDeliveryToObject(`${BASE}/2026/03/hello/`)?.activityType, 'Update');
    assert.ok(delivered.includes('Update'), JSON.stringify(delivered));
  });
});
