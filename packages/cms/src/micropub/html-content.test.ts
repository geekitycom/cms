/**
 * Micropub content through the endpoint (TASK-258): what a client sends is
 * stored as clean Markdown, served back by `q=source` as stored, and nothing
 * it carried runs on the page. The owner's own files are not cleaned.
 */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import matter from 'gray-matter';

import { FIRST_ADMIN, sandbox, signedIn } from '../admin/__testing__/harness.ts';
import { findUser } from '../admin/accounts.ts';
import { issueTokens } from '../indieauth/tokens.ts';
import type { Cms } from '../index.ts';

const box = sandbox();
after(() => box.cleanup());

const BASE = 'https://blog.example';
const ENDPOINT = '/_geekity/micropub';
const NOW = new Date('2026-09-20T12:00:00.000Z');

async function site(
  files: Readonly<Record<string, string>> = {},
): Promise<{ cms: Cms; token: string }> {
  const contentDir = await box.dir('geekity-micropub-html-content-');
  for (const [relative, contents] of Object.entries(files)) {
    const file = path.join(contentDir, ...relative.split('/'));
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, contents, 'utf8');
  }
  const cms = await box.open({
    contentDir,
    dataDir: await box.dir('geekity-micropub-html-data-'),
    baseUrl: BASE,
    now: () => NOW,
  });
  await signedIn(cms);
  const ada = findUser(cms.config.dataDir, FIRST_ADMIN.username);
  assert.ok(ada !== undefined, 'the first admin exists');
  const { accessToken } = await issueTokens(
    cms.config.dataDir,
    {
      clientId: 'https://app.example/',
      redirectUri: 'https://app.example/callback',
      codeChallenge: { method: 'S256', value: 'unused' },
      userId: ada.id,
      me: `${BASE}/author/${ada.username}/`,
      scopes: ['create', 'update'],
    },
    NOW,
  );
  return { cms, token: accessToken };
}

async function post(cms: Cms, token: string, body: unknown): Promise<Response> {
  return await cms.app.request(ENDPOINT, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function created(cms: Cms, token: string, properties: object): Promise<string> {
  const response = await post(cms, token, { type: ['h-entry'], properties });
  assert.equal(response.status, 201, await response.clone().text());
  const location = response.headers.get('location');
  assert.ok(location !== null);
  return location;
}

async function storedBody(cms: Cms, url: string): Promise<string> {
  const document = cms.store.getByPermalink(new URL(url).pathname);
  assert.ok(document !== undefined, `${url} is in the index`);
  const file = await readFile(
    path.join(cms.config.contentDir, ...document.path.split('/')),
    'utf8',
  );
  return matter(file).content.trim();
}

async function page(cms: Cms, url: string): Promise<string> {
  const response = await cms.app.request(new URL(url).pathname);
  assert.equal(response.status, 200);
  return await response.text();
}

async function sourceContent(cms: Cms, token: string, url: string): Promise<unknown> {
  const response = await cms.app.request(`${ENDPOINT}?q=source&url=${encodeURIComponent(url)}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const body = (await response.json()) as { properties: Record<string, unknown[]> };
  return body.properties['content'];
}

const HOSTILE_HTML =
  '<div>\n    <h2>Heading</h2>\n\n    <p>A <em>post</em> <img src="x" onerror="alert(1)"></p>\n\n' +
  '    <p><a href="javascript:alert(2)">click</a></p>\n    <script>alert(3)</script>\n</div>';

describe('HTML content over Micropub (AC #1, #2, #3)', () => {
  it('stores clean Markdown and serves it to q=source as stored', async () => {
    const { cms, token } = await site();
    const url = await created(cms, token, { name: ['Hostile'], content: [{ html: HOSTILE_HTML }] });

    const body = await storedBody(cms, url);
    assert.equal(body, '## Heading\n\nA _post_ ![](x)\n\nclick');
    assert.deepEqual(await sourceContent(cms, token, url), [body]);
    const html = await page(cms, url);
    assert.doesNotMatch(html, /alert\(/, 'none of the scripts reaches the page');
    assert.match(html, /<h2 id="heading">Heading<\/h2>/);
  });

  it('converts an update that replaces the content with HTML', async () => {
    const { cms, token } = await site();
    const url = await created(cms, token, { name: ['Plain'], content: ['Plain words.'] });

    const response = await post(cms, token, {
      action: 'update',
      url,
      replace: {
        content: [{ html: '<p>New <strong>words</strong><script>alert(1)</script></p>' }],
      },
    });

    assert.equal(response.status, 204, await response.clone().text());
    assert.equal(await storedBody(cms, url), 'New **words**');
    assert.doesNotMatch(await page(cms, url), /alert\(/);
  });
});

describe('Markdown content over Micropub (AC #4, #6)', () => {
  it('keeps text and clean Markdown exactly as sent', async () => {
    const { cms, token } = await site();
    const markdown = 'Some *Markdown* with `<code>` and a [link](https://example.com/).';
    const url = await created(cms, token, {
      content: [markdown],
      'p3k-content-type': ['text/markdown'],
    });

    assert.equal(await storedBody(cms, url), markdown);
    assert.deepEqual(await sourceContent(cms, token, url), [markdown]);
  });

  it('cleans raw HTML a client sends as Markdown', async () => {
    const { cms, token } = await site();
    const url = await created(cms, token, {
      content: [
        'Hello *there* <img src=x onerror=alert(1)>.\n\n<script>alert(2)</script>\n\n[x](javascript:alert(3))',
      ],
    });

    assert.equal(
      await storedBody(cms, url),
      'Hello *there* <img src="x">.\n\n[x](javascript:alert(3))',
    );
    const html = await page(cms, url);
    assert.doesNotMatch(html, /onerror|<script>alert|href="javascript:/i);
  });
});

describe('the owner’s own files (AC #6)', () => {
  it('still render raw HTML as written', async () => {
    const { cms } = await site({
      'posts/2026-09-01-own.md':
        "---\ntitle: Own\ndate: '2026-09-01T09:00:00Z'\npermalink: /2026/09/own/\n---\n\n" +
        '<span class="owner" data-x="1">mine</span>\n',
    });

    assert.match(
      await page(cms, `${BASE}/2026/09/own/`),
      /<span class="owner" data-x="1">mine<\/span>/,
    );
  });
});
