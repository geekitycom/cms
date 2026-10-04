import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { pngWithMetadata } from '../__testing__/metadata.ts';
import type { Cms } from '../index.ts';
import type { HostLookup } from '../webmention/public-address.ts';
import { csrfField, sandbox, signedIn } from './__testing__/harness.ts';
import type { Browser } from './__testing__/harness.ts';

const box = sandbox();

const IMAGE = 'https://edu.example/files/fx-991cw-calculator.png?itok=Xq3rT9vA';
const GONE = 'https://gone.example/calculator.png';

let png: Uint8Array;

const lookup: HostLookup = () => Promise.resolve(['203.0.113.7']);

const original = globalThis.fetch;
globalThis.fetch = ((input: string | URL | Request) => {
  const url = new Request(input).url;
  if (url === IMAGE) {
    return Promise.resolve(new Response(png, { headers: { 'content-type': 'image/png' } }));
  }
  return Promise.resolve(new Response('gone', { status: 404 }));
}) as typeof fetch;

const warn = console.warn;

before(async () => {
  png = await pngWithMetadata();
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

async function site(
  files: Record<string, string>,
  requireAltText = false,
): Promise<{ cms: Cms; contentDir: string; agent: Browser }> {
  const contentDir = await box.dir('geekity-cited-alt-content-');
  for (const [relative, contents] of Object.entries(files)) {
    const file = path.join(contentDir, ...relative.split('/'));
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, contents, 'utf8');
  }
  const cms = await box.open({
    contentDir,
    dataDir: await box.dir('geekity-cited-alt-data-'),
    hostLookup: lookup,
    requireAltText,
  });
  await cms.replyContexts.settled();
  return { cms, contentDir, agent: await signedIn(cms) };
}

function card(editor: string): string | undefined {
  return /<div class="admin-cited-card">[\s\S]*?<\/div>/.exec(editor)?.[0];
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

function withField(fields: [string, string][], name: string, value: string): [string, string][] {
  return [...fields.filter(([each]) => each !== name), [name, value]];
}

async function update(
  agent: Browser,
  slug: string,
  change: (fields: [string, string][]) => [string, string][],
): Promise<Response> {
  const editor = await (await agent.get(`/admin/posts/${slug}`)).text();
  return agent.post(`/admin/posts/${slug}`, change([...fieldsOf(editor), ['action', 'update']]));
}

async function file(contentDir: string, name: string): Promise<string> {
  return readFile(path.join(contentDir, 'posts', `2026-09-10-${name}.md`), 'utf8');
}

describe('the editor’s card for a reposted image', () => {
  it('names the image by its host and offers an alt text field that starts as the post’s title', async () => {
    const { agent } = await site({
      'posts/2026-09-10-titled.md': post('titled', [
        'title: My new calculator',
        `repost-of: ${IMAGE}`,
      ]),
    });

    const found = card(await (await agent.get('/admin/posts/titled')).text()) ?? '';

    assert.match(found, /<p class="admin-cited-title">An image from edu\.example<\/p>/);
    assert.match(found, /<label for="editor-cited-alt">Alt text of the reposted image<\/label>/);
    assert.match(
      found,
      /<input id="editor-cited-alt" name="cited-alt" type="text" value="My new calculator"/,
    );
    assert.match(found, /Remove the preview of An image from edu\.example/);
    assert.doesNotMatch(found, /itok/);
  });

  it('carries one alt text field, so the form posts one value', async () => {
    const { agent } = await site({
      'posts/2026-09-10-described.md': post('described', [
        `repost-of: ${IMAGE}`,
        'cited-alt: A Casio calculator, face on',
      ]),
    });

    const editor = await (await agent.get('/admin/posts/described')).text();
    assert.equal(fieldsOf(editor).filter(([name]) => name === 'cited-alt').length, 1);
  });

  it('shows the alt text the post already has', async () => {
    const { agent } = await site({
      'posts/2026-09-10-described.md': post('described', [
        'title: My new calculator',
        `repost-of: ${IMAGE}`,
        'cited-alt: A Casio calculator, face on',
      ]),
    });

    assert.match(
      card(await (await agent.get('/admin/posts/described')).text()) ?? '',
      /name="cited-alt" type="text" value="A Casio calculator, face on"/,
    );
  });

  it('offers no alt text field where the image is a decorative thumbnail', async () => {
    const { agent } = await site({
      'posts/2026-09-10-liked.md': post('liked', [`like-of: ${IMAGE}`]),
    });

    const found = card(await (await agent.get('/admin/posts/liked')).text()) ?? '';
    assert.match(found, /An image from edu\.example/);
    assert.doesNotMatch(found, /cited-alt/);
  });

  it('writes the alt text to the post, and the page describes the image with it', async () => {
    const { cms, contentDir, agent } = await site({
      'posts/2026-09-10-untitled.md': post('untitled', [`repost-of: ${IMAGE}`]),
    });

    const response = await update(agent, 'untitled', (fields) =>
      withField(fields, 'cited-alt', 'A Casio calculator, face on'),
    );
    assert.equal(response.status, 303, await response.clone().text());

    assert.match(await file(contentDir, 'untitled'), /^cited-alt: A Casio calculator, face on$/m);
    const page = await (await cms.app.request('/2026/09/untitled/')).text();
    assert.match(
      page,
      /<img class="u-photo" src="\/uploads\/cited\/[^"]+" alt="A Casio calculator, face on"/,
    );
  });

  it('keeps the alt text when the editor shows no card for the image', async () => {
    const { contentDir, agent } = await site({
      'posts/2026-09-10-gone.md': post('gone', [`repost-of: ${GONE}`, 'cited-alt: Kept words']),
    });

    const response = await update(agent, 'gone', (fields) => fields);
    assert.equal(response.status, 303, await response.clone().text());

    assert.match(await file(contentDir, 'gone'), /^cited-alt: Kept words$/m);
  });
});

describe('requireAltText and a reposted image', () => {
  it('refuses to publish an edit that leaves the image with no alt text, pointing at the field', async () => {
    const { contentDir, agent } = await site(
      { 'posts/2026-09-10-untitled.md': post('untitled', [`repost-of: ${IMAGE}`]) },
      true,
    );
    const before = await file(contentDir, 'untitled');

    const response = await update(agent, 'untitled', (fields) =>
      withField(fields, 'cited-alt', ''),
    );

    assert.equal(response.status, 400);
    const editor = await response.text();
    assert.match(editor, /This site publishes no image without alt text/);
    assert.match(editor, /<p class="admin-field-error" id="editor-cited-alt-error">/);
    assert.match(
      editor,
      /id="editor-cited-alt"[^>]* aria-invalid="true" aria-describedby="editor-cited-alt-error editor-cited-alt-hint"/,
    );
    assert.equal(await file(contentDir, 'untitled'), before);
  });

  it('saves it once the image is described', async () => {
    const { contentDir, agent } = await site(
      { 'posts/2026-09-10-untitled.md': post('untitled', [`repost-of: ${IMAGE}`]) },
      true,
    );

    const response = await update(agent, 'untitled', (fields) =>
      withField(fields, 'cited-alt', 'A calculator'),
    );

    assert.equal(response.status, 303, await response.clone().text());
    assert.match(await file(contentDir, 'untitled'), /^cited-alt: A calculator$/m);
  });

  it('refuses a new untitled repost of an image, and shows the card to describe it on', async () => {
    const { agent } = await site({}, true);
    const csrf = csrfField(await (await agent.get('/admin/posts/new')).text());
    assert.ok(csrf !== undefined);

    const response = await agent.post('/admin/posts/new', {
      csrf_token: csrf,
      action: 'publish',
      'repost-of': IMAGE,
    });

    assert.equal(response.status, 400);
    const editor = await response.text();
    assert.match(editor, /This site publishes no image without alt text/);
    assert.match(
      card(editor) ?? '',
      /<input id="editor-cited-alt" name="cited-alt" type="text" value=""/,
    );
  });

  it('publishes a new repost of an image that has a title to describe it with, and a draft that has none', async () => {
    const { agent } = await site({}, true);
    for (const [fields, name] of [
      [{ action: 'publish', title: 'My new calculator' }, 'titled'],
      [{ action: 'save-draft' }, 'draft'],
    ] as const) {
      const csrf = csrfField(await (await agent.get('/admin/posts/new')).text());
      assert.ok(csrf !== undefined);
      const response = await agent.post('/admin/posts/new', {
        csrf_token: csrf,
        'repost-of': IMAGE,
        ...fields,
      });
      assert.equal(response.status, 303, `${name}: ${await response.clone().text()}`);
    }
  });
});
