import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { csrfField, sandbox, signedIn } from '../admin/__testing__/harness.ts';
import { createMailTemplates } from '../mail/templates.ts';
import type { Cms } from '../index.ts';
import { createThemeSource } from './themes.ts';

const box = sandbox();
after(() => box.cleanup());

const UMAMI =
  '<script defer src="https://cloud.umami.is/script.js" data-website-id="0b4c6a2e-1111-4222-8333-944455556666"></script>';

const GA4 = [
  '<script async src="https://www.googletagmanager.com/gtag/js?id=G-TEST123"></script>',
  '<script>',
  '  window.dataLayer = window.dataLayer || [];',
  '  function gtag(){dataLayer.push(arguments);}',
  "  gtag('js', new Date());",
  "  gtag('config', 'G-TEST123');",
  '</script>',
].join('\n');

const BODY_END = '<script defer src="https://chat.example/widget.js"></script>';

const HOOKS: Record<string, string> = {
  'theme.json': JSON.stringify({ name: 'Analytics', kind: 'site' }),
  'partials/head-end.njk': `${UMAMI}\n${GA4}\n`,
  'partials/body-end.njk': `${BODY_END}\n`,
};

async function writeTree(root: string, files: Record<string, string>): Promise<void> {
  for (const [relative, contents] of Object.entries(files)) {
    const file = path.join(root, ...relative.split('/'));
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, contents, 'utf8');
  }
}

async function siteWithHooks(): Promise<{ cms: Cms; themesDir: string }> {
  const contentDir = await box.dir('geekity-hooks-content-');
  const dataDir = await box.dir('geekity-hooks-data-');
  const themesDir = await box.dir('geekity-hooks-themes-');

  await writeTree(path.join(themesDir, 'analytics'), HOOKS);
  await writeTree(contentDir, {
    '_data/site.json': JSON.stringify({ title: 'A Site', theme: 'analytics' }),
    'posts/hello.md':
      "---\ntitle: Hello\ndate: '2026-09-02T09:00:00Z'\npermalink: /2026/09/hello/\ntags:\n  - notes\n---\n\nBody.\n",
    'pages/about.md': '---\ntitle: About\npermalink: /about/\n---\n\nAbout us.\n',
  });

  const cms = await box.open({ contentDir, dataDir, themesDir });
  return { cms, themesDir };
}

function headOf(html: string): string {
  return html.slice(html.indexOf('<head>'), html.indexOf('</head>'));
}

function bodyOf(html: string): string {
  return html.slice(html.indexOf('<body'), html.indexOf('</body>'));
}

describe('the hook partials a site theme fills (TASK-298)', () => {
  it('puts the head snippets in the head of every public page, and keeps the packaged templates (AC #1, #2)', async () => {
    const { cms } = await siteWithHooks();

    for (const pathname of ['/', '/2026/09/hello/', '/about/', '/tag/notes/', '/nothing-here/']) {
      const html = await (await cms.app.request(pathname)).text();
      const head = headOf(html);

      assert.ok(head.includes(UMAMI), `${pathname} has no Umami script in its head`);
      assert.ok(head.includes(GA4), `${pathname} has no GA4 snippet in its head`);
      assert.ok(
        head.indexOf(GA4) > head.indexOf('application/ld+json'),
        `${pathname} puts the snippets before the packaged head`,
      );
      assert.match(html, /<link rel="stylesheet" href="\/theme\/style\.css\?v=/);
      assert.match(html, /<footer/, `${pathname} lost the packaged shell`);
    }
  });

  it('puts the body snippet last in the body of every public page', async () => {
    const { cms } = await siteWithHooks();

    for (const pathname of ['/', '/2026/09/hello/', '/nothing-here/']) {
      const html = await (await cms.app.request(pathname)).text();

      assert.ok(bodyOf(html).includes(BODY_END), `${pathname} has no body snippet`);
      assert.ok(
        html.indexOf(BODY_END) > html.indexOf('</footer>'),
        `${pathname} puts the body snippet before the footer`,
      );
      assert.equal(headOf(html).includes(BODY_END), false);
    }
  });

  it('adds nothing to a site on the packaged theme', async () => {
    const contentDir = await box.dir('geekity-hooks-plain-');
    await writeTree(contentDir, {
      '_data/site.json': JSON.stringify({ title: 'A Site' }),
      'pages/about.md': '---\ntitle: About\npermalink: /about/\n---\n\nAbout us.\n',
    });
    const cms = await box.open({ contentDir, dataDir: await box.dir('geekity-hooks-data-') });

    const html = await (await cms.app.request('/about/')).text();
    const headEnd = html.indexOf('</head>');
    const bodyEnd = html.indexOf('</body>');

    assert.equal(html.slice(html.lastIndexOf('</script>', headEnd) + 9, headEnd).trim(), '');
    assert.equal(html.slice(html.lastIndexOf('</div>', bodyEnd) + 6, bodyEnd).trim(), '');
  });

  it('keeps the snippets out of every other representation (AC #3)', async () => {
    const { cms } = await siteWithHooks();

    const requests: [string, Record<string, string>][] = [
      ['/2026/09/hello/', { accept: 'text/markdown' }],
      ['/2026/09/hello/', { accept: 'text/plain' }],
      ['/2026/09/hello/', { accept: 'application/json' }],
      ['/2026/09/hello/index.md', {}],
      ['/tag/notes/index.md', {}],
      ['/index.json', {}],
      ['/feed/', {}],
      ['/feed/atom/', {}],
      ['/feed/json/', {}],
      ['/llms.txt', {}],
    ];

    for (const [pathname, headers] of requests) {
      const response = await cms.app.request(pathname, { headers });
      const text = await response.text();
      const label = `${pathname} ${JSON.stringify(headers)}`;

      assert.equal(response.status, 200, `${label} answered ${String(response.status)}`);
      assert.equal(text.includes('umami'), false, `${label} carries the Umami snippet`);
      assert.equal(text.includes('googletagmanager'), false, `${label} carries the GA4 snippet`);
      assert.equal(text.includes('chat.example'), false, `${label} carries the body snippet`);
    }
  });

  it('keeps the snippets out of the admin (AC #3)', async () => {
    const { cms } = await siteWithHooks();
    const agent = await signedIn(cms);

    for (const pathname of ['/admin', '/admin/posts', '/admin/settings', '/admin/login']) {
      const html = await (await agent.get(pathname)).text();

      assert.equal(html.includes('umami'), false, `${pathname} carries the Umami snippet`);
      assert.equal(html.includes('googletagmanager'), false, `${pathname} carries GA4`);
    }
  });

  it("keeps the snippets out of the editor's preview, which renders the post layout (AC #3)", async () => {
    const { cms } = await siteWithHooks();
    const agent = await signedIn(cms);
    const token = csrfField(await (await agent.get('/admin/posts/new')).text());
    assert.ok(token !== undefined);

    for (const type of ['post', 'page']) {
      const response = await agent.post('/admin/preview', {
        csrf_token: token,
        type,
        title: 'Unsaved',
        body: 'Words.',
      });
      const html = await response.text();

      assert.equal(response.status, 200);
      assert.match(html, /Unsaved/);
      assert.equal(html.includes('umami'), false, `the ${type} preview carries the Umami snippet`);
      assert.equal(html.includes('googletagmanager'), false, `the ${type} preview carries GA4`);
      assert.equal(
        html.includes('chat.example'),
        false,
        `the ${type} preview carries the body snippet`,
      );
    }
  });

  it('keeps the snippets out of mail (AC #3)', async () => {
    const { themesDir } = await siteWithHooks();
    const templates = createMailTemplates({
      themes: createThemeSource({ themesDir, chosen: () => 'analytics' }),
      baseUrl: 'https://blog.example',
    });

    const message = templates.render('test', {
      site: { title: 'A Site' },
      baseUrl: 'https://blog.example',
    });

    for (const part of [message.subject, message.text, message.html ?? '']) {
      assert.equal(part.includes('umami'), false);
      assert.equal(part.includes('googletagmanager'), false);
      assert.equal(part.includes('chat.example'), false);
    }
  });
});
