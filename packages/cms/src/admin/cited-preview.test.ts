import assert from 'node:assert/strict';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { gifWithMetadata } from '../__testing__/metadata.ts';
import type { Cms } from '../index.ts';
import type { HostLookup } from '../webmention/public-address.ts';
import { csrfField, sandbox, signedIn } from './__testing__/harness.ts';
import type { Browser } from './__testing__/harness.ts';

const box = sandbox();

const GIPHY = 'https://giphy.com/gifs/theinnernette-happy-dance-3o7TKSjRrfIPjeiVyM';
const GIF = 'https://media.giphy.com/media/3o7TKSjRrfIPjeiVyM/giphy.gif';
const WORDS = 'https://words.example/post';

let gif: Uint8Array;

const lookup: HostLookup = () => Promise.resolve(['203.0.113.7']);

const original = globalThis.fetch;
globalThis.fetch = ((input: string | URL | Request) => {
  const url = new URL(new Request(input).url);
  if (url.origin + url.pathname === 'https://giphy.com/services/oembed') {
    return Promise.resolve(
      new Response(
        JSON.stringify({
          type: 'photo',
          title: 'Happy Dance GIF - Find & Share on GIPHY',
          author_name: 'Nette',
          url: GIF,
          width: 40,
          height: 20,
        }),
        { headers: { 'content-type': 'application/json' } },
      ),
    );
  }
  if (url.href === GIF) {
    return Promise.resolve(new Response(gif, { headers: { 'content-type': 'image/gif' } }));
  }
  if (url.href === WORDS) {
    return Promise.resolve(
      new Response('<title>Only words</title>', { headers: { 'content-type': 'text/html' } }),
    );
  }
  return Promise.reject(new TypeError('fetch failed'));
}) as typeof fetch;

const warn = console.warn;

before(async () => {
  gif = await gifWithMetadata();
  console.warn = () => undefined;
});

after(async () => {
  await box.cleanup();
  globalThis.fetch = original;
  console.warn = warn;
});

function post(name: string, lines: string[]): string {
  return [
    '---',
    "date: '2026-09-10T09:00:00Z'",
    `permalink: /2026/09/${name}/`,
    ...lines,
    '---',
    '',
    `The post called ${name}.`,
    '',
  ].join('\n');
}

async function site(files: Record<string, string>): Promise<{ cms: Cms; contentDir: string }> {
  const contentDir = await box.dir('geekity-cited-preview-content-');
  for (const [relative, contents] of Object.entries(files)) {
    const file = path.join(contentDir, ...relative.split('/'));
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, contents, 'utf8');
  }
  const cms = await box.open({
    contentDir,
    dataDir: await box.dir('geekity-cited-preview-data-'),
    hostLookup: lookup,
  });
  await cms.replyContexts.settled();
  return { cms, contentDir };
}

function respondingGroup(editor: string): string {
  const found = /<summary>Responding to<\/summary>[\s\S]*?<\/details>/.exec(editor)?.[0];
  assert.ok(found !== undefined, 'the editor has a Responding to group');
  return found;
}

function fieldsOf(editor: string): [string, string][] {
  const fields: [string, string][] = [];
  for (const match of editor.matchAll(/<input\b[^>]*>/g)) {
    const tag = match[0];
    const name = /\sname="([^"]*)"/.exec(tag)?.[1];
    if (name === undefined) continue;
    const type = /\stype="([^"]*)"/.exec(tag)?.[1] ?? 'text';
    if ((type === 'checkbox' || type === 'radio') && !/\schecked\b/.test(tag)) continue;
    if (type === 'file' || type === 'submit') continue;
    fields.push([name, decode(/\svalue="([^"]*)"/.exec(tag)?.[1] ?? '')]);
  }
  for (const match of editor.matchAll(
    /<textarea\b[^>]*name="([^"]*)"[^>]*>([\s\S]*?)<\/textarea>/g,
  )) {
    fields.push([match[1] ?? '', decode(match[2] ?? '')]);
  }
  for (const match of editor.matchAll(/<select\b[^>]*name="([^"]*)"[^>]*>([\s\S]*?)<\/select>/g)) {
    const selected = /<option value="([^"]*)"[^>]*\sselected/.exec(match[2] ?? '')?.[1] ?? '';
    fields.push([match[1] ?? '', decode(selected)]);
  }
  return fields;
}

function decode(value: string): string {
  return value
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
}

async function save(
  agent: Browser,
  slug: string,
  change: (fields: [string, string][]) => [string, string][],
): Promise<void> {
  const editor = await (await agent.get(`/admin/posts/${slug}`)).text();
  const response = await agent.post(
    `/admin/posts/${slug}`,
    change([...fieldsOf(editor), ['action', 'update']]),
  );
  assert.equal(response.status, 303, await response.clone().text());
}

async function frontMatter(contentDir: string, name: string): Promise<string> {
  return readFile(path.join(contentDir, 'posts', `2026-09-10-${name}.md`), 'utf8');
}

describe('the editor’s preview of a cited page', () => {
  let cms: Cms;
  let contentDir: string;
  let agent: Browser;

  before(async () => {
    ({ cms, contentDir } = await site({
      'posts/2026-09-10-gif.md': post('gif', [`repost-of: ${GIPHY}`]),
      'posts/2026-09-10-words.md': post('words', [`like-of: ${WORDS}`]),
      'posts/2026-09-10-hidden.md': post('hidden', [`like-of: ${WORDS}`, 'preview: false']),
    }));
    agent = await signedIn(cms);
  });

  it('shows the stored card under the cited URL, with a named remove control', async () => {
    const group = respondingGroup(await (await agent.get('/admin/posts/gif')).text());

    const afterInput = group.slice(group.indexOf('id="editor-repost-of"'));
    const card = /<div class="admin-cited-card">[\s\S]*?<\/div>/.exec(afterInput)?.[0] ?? '';
    assert.ok(group.indexOf('id="editor-repost-of"') < group.indexOf('admin-cited-card'));
    assert.match(
      card,
      /<img src="\/uploads\/cited\/[0-9a-f]{16}\.gif" alt="" width="40" height="20"/,
    );
    assert.match(card, /Happy Dance GIF/);
    assert.match(
      card,
      /<input type="checkbox" id="editor-preview-repost-of" name="preview" value="hide">/,
    );
    assert.match(
      card,
      /<label class="admin-cited-remove" for="editor-preview-repost-of"><span aria-hidden="true">×<\/span><span class="admin-visually-hidden">Remove the preview of Happy Dance GIF<\/span><\/label>/,
    );
  });

  it('shows no card for a cited page with no picture', async () => {
    const group = respondingGroup(await (await agent.get('/admin/posts/words')).text());

    assert.doesNotMatch(group, /admin-cited-card|name="preview"/);
  });

  it('writes preview: false when the preview is removed, and the page shows the plain citation', async () => {
    await save(agent, 'gif', (fields) => [...fields, ['preview', 'hide']]);

    assert.match(await frontMatter(contentDir, 'gif'), /^preview: false$/m);
    const page = await (await cms.app.request('/2026/09/gif/')).text();
    assert.doesNotMatch(page, /uploads\/cited|cite-photo|cite-thumb/);
    const feed = await (await cms.app.request('/feed/json/')).text();
    assert.doesNotMatch(feed, /uploads\/cited/);

    const group = respondingGroup(await (await agent.get('/admin/posts/gif')).text());
    assert.match(group, /name="preview" value="hide" checked>/);
  });

  it('shows it again when the box is cleared, and takes the key out', async () => {
    await save(agent, 'gif', (fields) => fields.filter(([name]) => name !== 'preview'));

    assert.doesNotMatch(await frontMatter(contentDir, 'gif'), /preview:/);
    const page = await (await cms.app.request('/2026/09/gif/')).text();
    assert.match(
      page,
      /<a class="cite-photo" href="[^"]+"><img class="u-photo" src="\/uploads\/cited\//,
    );
  });

  it('keeps a removed preview removed when the editor shows no card for it', async () => {
    await save(agent, 'hidden', (fields) => fields);

    assert.match(await frontMatter(contentDir, 'hidden'), /^preview: false$/m);
  });

  it('opens the Responding to group whenever it shows a card', async () => {
    const editor = await (await agent.get('/admin/posts/gif')).text();

    assert.match(
      editor,
      /<details class="admin-editor-group" open>\s*<summary>Responding to<\/summary>/,
    );
  });
});

describe('a new post that reposts a GIF', () => {
  it('gets its picture after the save names it, and shows it until the author removes it', async () => {
    const { cms, contentDir } = await site({});
    const agent = await signedIn(cms);
    const csrf = csrfField(await (await agent.get('/admin/posts/new')).text());
    assert.ok(csrf !== undefined);

    const response = await agent.post('/admin/posts/new', {
      csrf_token: csrf,
      action: 'publish',
      'repost-of': GIPHY,
    });
    assert.equal(response.status, 303, await response.clone().text());
    await cms.replyContexts.settled();

    const slug = (response.headers.get('location') ?? '').replace('/admin/posts/', '');
    assert.equal(slug, 'reposted-happy-dance-gif');
    assert.equal((await readdir(path.join(contentDir, 'uploads', 'cited'))).length, 1);
    const editor = await (await agent.get(`/admin/posts/${slug}`)).text();
    assert.match(respondingGroup(editor), /admin-cited-card/);
  });
});
