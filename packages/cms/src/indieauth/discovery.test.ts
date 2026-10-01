/**
 * IndieAuth discovery, from the outside (TASK-157).
 *
 * The site publishes one OAuth 2.0 Authorization Server Metadata document, at
 * its own URL and at RFC 8414's well-known one, and every identity URL (the
 * root and each author archive) points at it with a `Link` header and a
 * `<link>` in the head, whatever the theme's layouts say.
 */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { sandbox } from '../admin/__testing__/harness.ts';
import { createUser } from '../admin/accounts.ts';
import type { Cms } from '../index.ts';

const box = sandbox();
after(() => box.cleanup());

const BASE = 'https://blog.example';
const METADATA = `${BASE}/_geekity/indieauth/metadata`;

async function writeTree(root: string, files: Record<string, string>): Promise<void> {
  for (const [relative, contents] of Object.entries(files)) {
    const file = path.join(root, ...relative.split('/'));
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, contents, 'utf8');
  }
}

/**
 * A theme whose every layout is its own bare page, extending nothing of the
 * packaged theme, so nothing it prints can be what advertises the endpoint.
 */
const BARE_LAYOUT =
  '<!doctype html><html><head><title>{{ title }}</title></head><body>{{ title }}</body></html>';
const BARE_THEME: Record<string, string> = {
  'bare/theme.json': JSON.stringify({ name: 'Bare', kind: 'site' }),
  'bare/layouts/home.njk': BARE_LAYOUT,
  'bare/layouts/author.njk': BARE_LAYOUT,
  'bare/layouts/front-page.njk': BARE_LAYOUT,
  'bare/layouts/page.njk': BARE_LAYOUT,
  'bare/layouts/post.njk': BARE_LAYOUT,
};

async function site(settings: Record<string, unknown> = {}): Promise<Cms> {
  const contentDir = await box.dir('geekity-indieauth-content-');
  const dataDir = await box.dir('geekity-indieauth-data-');
  const themesDir = await box.dir('geekity-indieauth-themes-');
  await writeTree(themesDir, BARE_THEME);
  await writeTree(contentDir, {
    '_data/site.json': JSON.stringify({ title: 'A Site', author: 'ada', ...settings }),
    'posts/2026-09-02-hello.md':
      "---\ntitle: Hello\ndate: '2026-09-02T09:00:00Z'\npermalink: /2026/09/hello/\nauthor: ada\n---\n\nHello.\n",
    'pages/welcome.md': '---\ntitle: Welcome\npermalink: /welcome/\n---\n\nWelcome.\n',
  });
  await createUser({ dataDir, username: 'ada', password: 'correct horse battery' });
  return box.open({ contentDir, dataDir, themesDir, baseUrl: BASE });
}

describe('the authorization server metadata', () => {
  for (const pathname of [
    '/_geekity/indieauth/metadata',
    '/.well-known/oauth-authorization-server',
  ]) {
    it(`is served at ${pathname}`, async () => {
      const cms = await site();
      const response = await cms.app.request(pathname);

      assert.equal(response.status, 200);
      assert.match(response.headers.get('content-type') ?? '', /^application\/json/);
      const metadata = (await response.json()) as Record<string, unknown>;
      assert.equal(metadata['issuer'], BASE);
      assert.equal(metadata['authorization_endpoint'], `${BASE}/_geekity/indieauth/auth`);
      assert.equal(metadata['token_endpoint'], `${BASE}/_geekity/indieauth/token`);
      assert.deepEqual(metadata['code_challenge_methods_supported'], ['S256']);
      assert.deepEqual(metadata['scopes_supported'], [
        'profile',
        'email',
        'create',
        'update',
        'delete',
        'media',
      ]);
      assert.deepEqual(metadata['grant_types_supported'], ['authorization_code', 'refresh_token']);
      assert.deepEqual(metadata['response_types_supported'], ['code']);
      assert.equal(metadata['authorization_response_iss_parameter_supported'], true);
      // MCP's client registration of choice since 2025-11-25 (TASK-158).
      assert.equal(metadata['client_id_metadata_document_supported'], true);
    });
  }

  it('names the configured base URL over the setting, as every absolute URL does', async () => {
    const cms = await site({ baseUrl: 'https://renamed.example' });
    const metadata = (await (
      await cms.app.request('/.well-known/oauth-authorization-server')
    ).json()) as Record<string, unknown>;
    assert.equal(metadata['issuer'], BASE);
  });
});

describe('advertising the metadata', () => {
  const advertised = `<${METADATA}>; rel="indieauth-metadata"`;
  const headLink = `<link rel="indieauth-metadata" href="${METADATA}">`;

  for (const theme of ['default', 'bare']) {
    for (const solo of [true, false]) {
      for (const pathname of ['/', '/author/ada/']) {
        it(`${pathname} carries the header and the head link under the ${theme} theme, solo ${String(solo)}`, async () => {
          const cms = await site({ soloAuthor: solo, ...(theme === 'default' ? {} : { theme }) });
          const response = await cms.app.request(pathname);
          assert.equal(response.status, 200);

          const links = response.headers.get('link') ?? '';
          assert.ok(links.includes(advertised), `Link header: ${links}`);

          const html = await response.text();
          const head = /<head\b[^>]*>([\s\S]*?)<\/head>/i.exec(html)?.[1] ?? '';
          assert.equal(head.split(headLink).length - 1, 1, 'one head link, inside <head>');
          if (theme === 'bare') assert.match(html, /^<!doctype html><html><head><title>/);
        });
      }
    }
  }

  it('is on a static front page too', async () => {
    const cms = await site({ homepage: 'welcome' });
    const response = await cms.app.request('/');
    assert.ok((response.headers.get('link') ?? '').includes(advertised));
    assert.match(await response.text(), /Welcome\./);
  });

  it('is on a HEAD of an identity URL', async () => {
    const cms = await site();
    const response = await cms.app.request('/author/ada/', { method: 'HEAD' });
    assert.ok((response.headers.get('link') ?? '').includes(advertised));
  });

  it('is not on any other page, nor on a user who does not exist', async () => {
    const cms = await site();
    for (const pathname of [
      '/2026/09/hello/',
      '/author/ada/page/1/',
      '/author/nobody/',
      '/feed/',
    ]) {
      const response = await cms.app.request(pathname);
      assert.ok(
        !(response.headers.get('link') ?? '').includes('indieauth-metadata'),
        `${pathname} carries no advertisement`,
      );
      assert.doesNotMatch(await response.text(), /indieauth-metadata/, pathname);
    }
  });
});
