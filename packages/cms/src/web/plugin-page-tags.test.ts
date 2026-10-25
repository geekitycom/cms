import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { csrfField, sandbox, signedIn } from '../admin/__testing__/harness.ts';
import type { Cms } from '../index.ts';
import { definePlugin, HOST_API_VERSION } from '../plugin.ts';
import type { Plugin, PluginHost, PluginPageTags, PluginPageTagsContext } from '../plugin.ts';
import { pluginRegistryOptions } from '../__testing__/plugin-registry-options.ts';
import { createPluginRegistry } from '../plugins/registry.ts';

const box = sandbox();
after(() => box.cleanup());

const DATA_DIR = mkdtempSync(path.join(tmpdir(), 'geekity-page-tags-registry-'));
after(() => rmSync(DATA_DIR, { recursive: true, force: true }));

const PAGES = [
  '/',
  '/2026/09/hello/',
  '/about/',
  '/tag/notes/',
  '/search/?q=body',
  '/nothing-here/',
];

function tagger(
  name: string,
  tags: (
    host: PluginHost,
  ) => (context: PluginPageTagsContext) => PluginPageTags | Promise<PluginPageTags>,
  hostApi = HOST_API_VERSION,
): Plugin {
  return definePlugin({
    name,
    version: '1.0.0',
    label: name,
    description: 'Adds tags.',
    hostApi,
    register(host) {
      host.pageTags(tags(host));
    },
  });
}

async function writeTree(root: string, files: Record<string, string>): Promise<void> {
  for (const [relative, contents] of Object.entries(files)) {
    const file = path.join(root, ...relative.split('/'));
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, contents, 'utf8');
  }
}

function siteJson(enabled: readonly string[], theme?: string): string {
  return JSON.stringify({
    title: 'A Site',
    ...(theme === undefined ? {} : { theme }),
    plugins: Object.fromEntries(enabled.map((name) => [name, { enabled: true }])),
  });
}

async function site(
  plugins: Plugin[],
  options: { enabled?: readonly string[]; partials?: boolean } = {},
): Promise<{ cms: Cms; contentDir: string; dataDir: string }> {
  const contentDir = await box.dir('geekity-page-tags-content-');
  const dataDir = await box.dir('geekity-page-tags-data-');
  const themesDir = await box.dir('geekity-page-tags-themes-');
  const enabled = options.enabled ?? plugins.map((plugin) => plugin.name);
  const theme = options.partials === true ? 'hooks' : undefined;
  if (theme !== undefined) {
    await writeTree(path.join(themesDir, theme), {
      'theme.json': JSON.stringify({ name: 'Hooks', kind: 'site' }),
      'partials/head-end.njk': '<meta name="site-head-end" content="yes">\n',
      'partials/body-end.njk': '<script src="/site-body-end.js"></script>\n',
    });
  }
  await writeTree(contentDir, {
    '_data/site.json': siteJson(enabled, theme),
    'posts/hello.md':
      "---\ntitle: Hello\ndate: '2026-09-02T09:00:00Z'\npermalink: /2026/09/hello/\ntags:\n  - notes\n---\n\nBody.\n",
    'pages/about.md': '---\ntitle: About\npermalink: /about/\n---\n\nAbout us.\n',
  });
  const cms = await box.open({ contentDir, dataDir, themesDir, plugins });
  return { cms, contentDir, dataDir };
}

function headOf(html: string): string {
  return html.slice(html.indexOf('<head>'), html.indexOf('</head>'));
}

function bodyOf(html: string): string {
  return html.slice(html.indexOf('<body'), html.indexOf('</body>'));
}

async function page(cms: Cms, pathname: string): Promise<string> {
  return await (await cms.app.request(pathname)).text();
}

const UMAMI = tagger('@test/plugin-umami', () => () => ({
  headEnd: [
    {
      tag: 'script',
      src: 'https://cloud.umami.is/script.js',
      attributes: { defer: true, async: false, 'data-website-id': 'abc-123' },
    },
    { tag: 'link', attributes: { rel: 'preconnect', href: 'https://cloud.umami.is' } },
    { tag: 'meta', attributes: { name: 'umami', content: 'on' } },
  ],
  bodyEnd: [{ tag: 'script', src: '/umami-body.js' }],
}));

const UMAMI_HEAD =
  '<script src="https://cloud.umami.is/script.js" defer data-website-id="abc-123"></script>\n<link rel="preconnect" href="https://cloud.umami.is">\n<meta name="umami" content="on">';

describe('plugin page tags (TASK-443)', () => {
  it('puts an enabled plugin’s head-end and body-end tags on every public page (AC #1)', async () => {
    const { cms } = await site([UMAMI]);

    for (const pathname of PAGES) {
      const html = await page(cms, pathname);
      assert.ok(headOf(html).includes(UMAMI_HEAD), `${pathname} has no head tags`);
      assert.ok(
        bodyOf(html).includes('<script src="/umami-body.js"></script>'),
        `${pathname} has no body tag`,
      );
      assert.ok(
        html.indexOf('/umami-body.js') > html.indexOf('</footer>'),
        `${pathname} puts the body tag before the footer`,
      );
    }
  });

  it('escapes every attribute value (AC #2)', async () => {
    const { cms } = await site([
      tagger('@test/plugin-quotes', () => () => ({
        headEnd: [
          {
            tag: 'meta',
            attributes: { name: 'x', content: '"><script>alert(1)</script>&\'' },
          },
          { tag: 'script', src: 'https://a.example/s.js?a=1&b="2"' },
        ],
      })),
    ]);

    const head = headOf(await page(cms, '/about/'));
    assert.ok(
      head.includes(
        '<meta name="x" content="&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;&amp;&#39;">',
      ),
    );
    assert.ok(
      head.includes('<script src="https://a.example/s.js?a=1&amp;b=&quot;2&quot;"></script>'),
    );
    assert.equal(head.includes('alert(1)</script>'), false);
  });

  it('refuses an event handler, a script URL, a bad attribute name or an unknown tag, and adds nothing of that plugin (AC #2)', async () => {
    const refused: (() => PluginPageTags)[] = [
      () => ({ headEnd: [{ tag: 'meta', attributes: { name: 'x', onload: 'alert(1)' } }] }),
      () => ({ headEnd: [{ tag: 'script', src: 'javascript:alert(1)' }] }),
      () => ({ headEnd: [{ tag: 'script', src: 'data:text/javascript,alert(1)' }] }),
      () => ({ headEnd: [{ tag: 'link', attributes: { rel: 'x', href: 'javascript:alert(1)' } }] }),
      () => ({ headEnd: [{ tag: 'meta', attributes: { 'a"><b': 'x' } }] }),
      () => ({ bodyEnd: [{ tag: 'script', src: '/s.js', attributes: { src: '/other.js' } }] }),
      () =>
        ({
          headEnd: [{ tag: 'style', attributes: { media: 'all' } }],
        }) as unknown as PluginPageTags,
      () => ({ headEnd: [{ tag: 'meta', attributes: { name: 3 } }] }) as unknown as PluginPageTags,
    ];
    const plugins = refused.map((tags, index) =>
      tagger(`@test/plugin-bad-${String(index)}`, () => () => ({
        ...tags(),
        bodyEnd: [...(tags().bodyEnd ?? []), { tag: 'script', src: `/bad-${String(index)}.js` }],
      })),
    );
    const warnings: string[] = [];
    const warn = console.warn;
    console.warn = (message: unknown) => warnings.push(String(message));
    try {
      const { cms } = await site([...plugins, UMAMI]);
      const html = await page(cms, '/about/');

      assert.ok(html.includes(UMAMI_HEAD), 'a refused plugin stopped another one');
      assert.equal(html.includes('alert'), false);
      assert.equal(html.includes('/bad-'), false);
      assert.equal(html.includes('<style media'), false);
      for (const index of refused.keys()) {
        assert.ok(
          warnings.some((line) => line.includes(`@test/plugin-bad-${String(index)}`)),
          `no warning names plugin ${String(index)}`,
        );
      }
    } finally {
      console.warn = warn;
    }
  });

  it('has no way to hand over raw HTML or an inline script in its types (AC #2)', () => {
    // @ts-expect-error -- a script tag has no body
    const inline: PluginPageTags = { headEnd: [{ tag: 'script', src: '/a.js', body: 'x()' }] };
    // @ts-expect-error -- there is no raw HTML tag
    const raw: PluginPageTags = { headEnd: [{ tag: 'html', html: '<b>' }] };
    assert.ok(inline !== raw);
  });

  it('draws plugin tags before the site’s partials, in plugin order, and keeps the partials (AC #3)', async () => {
    const first = tagger('@test/plugin-first', () => () => ({
      headEnd: [{ tag: 'meta', attributes: { name: 'first' } }],
      bodyEnd: [{ tag: 'script', src: '/first.js' }],
    }));
    const second = tagger('@test/plugin-second', () => () => ({
      headEnd: [{ tag: 'meta', attributes: { name: 'second' } }],
      bodyEnd: [{ tag: 'script', src: '/second.js' }],
    }));
    const { cms } = await site([first, second], { partials: true });

    for (const pathname of PAGES) {
      const html = await page(cms, pathname);
      const head = headOf(html);
      const order = ['name="first"', 'name="second"', 'name="site-head-end"'].map((mark) =>
        head.indexOf(mark),
      );
      assert.ok(
        order.every((at) => at > head.indexOf('application/ld+json')),
        pathname,
      );
      assert.deepEqual(
        [...order].sort((a, b) => a - b),
        order,
        `${pathname} head order`,
      );
      const body = bodyOf(html);
      const bodyOrder = ['/first.js', '/second.js', '/site-body-end.js'].map((mark) =>
        body.indexOf(mark),
      );
      assert.ok(
        bodyOrder.every((at) => at > body.indexOf('</footer>')),
        pathname,
      );
      assert.deepEqual(
        [...bodyOrder].sort((a, b) => a - b),
        bodyOrder,
        `${pathname} body order`,
      );
    }
  });

  it('leaves the tags out of the editor preview and the admin (AC #4)', async () => {
    const { cms } = await site([UMAMI]);
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
      assert.equal(html.includes('umami'), false, `the ${type} preview carries plugin tags`);
    }
    for (const pathname of ['/admin', '/admin/posts']) {
      assert.equal((await (await agent.get(pathname)).text()).includes('umami'), false);
    }
  });

  it('adds none for a disabled plugin, and follows enabling and disabling with no restart (AC #4)', async () => {
    const { cms, contentDir } = await site([UMAMI], { enabled: [] });
    assert.equal((await page(cms, '/about/')).includes('umami'), false);

    await writeFile(path.join(contentDir, '_data', 'site.json'), siteJson([UMAMI.name]));
    assert.ok((await page(cms, '/about/')).includes(UMAMI_HEAD));

    await writeFile(path.join(contentDir, '_data', 'site.json'), siteJson([]));
    assert.equal((await page(cms, '/about/')).includes('umami'), false);
  });

  it('keeps the tags out of every other representation', async () => {
    const { cms } = await site([UMAMI]);
    for (const pathname of ['/2026/09/hello/index.md', '/index.json', '/feed/', '/llms.txt']) {
      assert.equal((await page(cms, pathname)).includes('umami'), false, pathname);
    }
  });

  it('reads the plugin’s settings when the page is drawn, and declares none while they are unset (AC #5)', async () => {
    const plugin = definePlugin({
      name: '@test/plugin-tracker',
      version: '1.0.0',
      label: 'Tracker',
      description: 'Tracks.',
      hostApi: HOST_API_VERSION,
      register(host) {
        const settings = host.settings([{ type: 'text', key: 'website_id', label: 'Website' }]);
        host.pageTags(async () => {
          const { website_id } = await settings.current();
          return website_id === ''
            ? {}
            : {
                headEnd: [
                  {
                    tag: 'script',
                    src: 'https://t.example/t.js',
                    attributes: { 'data-website-id': website_id },
                  },
                ],
              };
        });
      },
    });
    const { cms } = await site([plugin]);
    const before = await cms.app.request('/tag/notes/');
    const etag = before.headers.get('etag');
    assert.equal((await before.text()).includes('t.example'), false);
    assert.ok(etag !== null);

    await cms.settings.set('@test/plugin-tracker', new Map([['website_id', 'site-42']]), 'cli');

    const listing = await cms.app.request('/tag/notes/', { headers: { 'if-none-match': etag } });
    assert.equal(listing.status, 200, 'a revalidating browser kept the copy without the tag');
    for (const html of [await listing.text(), await page(cms, '/about/')]) {
      assert.ok(
        html.includes('<script src="https://t.example/t.js" data-website-id="site-42"></script>'),
      );
    }
  });

  it('draws the rest of the page when a tag function throws', async () => {
    const warnings: string[] = [];
    const warn = console.warn;
    console.warn = (message: unknown) => warnings.push(String(message));
    try {
      const broken = tagger('@test/plugin-broken', () => () => {
        throw new Error('no settings file');
      });
      const { cms } = await site([broken, UMAMI]);
      const response = await cms.app.request('/about/');
      assert.equal(response.status, 200);
      assert.ok((await response.text()).includes(UMAMI_HEAD));
      assert.ok(warnings.some((line) => line.includes('@test/plugin-broken')));
    } finally {
      console.warn = warn;
    }
  });

  it('refuses a second page tags declaration', () => {
    const twice = definePlugin({
      name: '@test/plugin-twice',
      version: '1.0.0',
      label: 'Twice',
      description: 'Declares twice.',
      hostApi: HOST_API_VERSION,
      register(host) {
        host.pageTags(() => ({}));
        host.pageTags(() => ({}));
      },
    });
    const registry = createPluginRegistry(
      [{ plugin: twice, source: 'site config, plugins[0]' }],
      pluginRegistryOptions(DATA_DIR),
    );
    assert.match(registry.problem(twice.name) ?? '', /page tags once/);
  });
});

describe('the reader a page tag is drawn for (TASK-459)', () => {
  const ANALYTICS = tagger(
    '@test/plugin-analytics',
    () =>
      ({ signedIn, devMode }) =>
        signedIn || devMode ? {} : { headEnd: [{ tag: 'script', src: '/count.js' }] },
  );

  it('tells read() whether the reader is signed in and whether the site is in dev mode (AC #1)', async () => {
    const seen: PluginPageTagsContext[] = [];
    const { cms } = await site([
      tagger('@test/plugin-seer', () => (context) => {
        seen.push(context);
        return {};
      }),
    ]);

    await page(cms, '/about/');
    const agent = await signedIn(cms);
    await agent.get('/about/');
    await cms.settings.set('dev_mode', new Map([['on', true]]), 'cli');
    await page(cms, '/about/');

    assert.deepEqual(seen, [
      { signedIn: false, devMode: false },
      { signedIn: true, devMode: false },
      { signedIn: false, devMode: true },
    ]);
  });

  it('draws none for a signed-in reader and its tags for an anonymous one on the same page (AC #2)', async () => {
    const { cms } = await site([ANALYTICS]);
    const agent = await signedIn(cms);

    for (const pathname of PAGES) {
      const mine = await (await agent.get(pathname)).text();
      assert.ok(mine.includes('geekity-admin-bar'), `${pathname} was not drawn for the owner`);
      assert.equal(mine.includes('/count.js'), false, `${pathname} counts the owner`);
      assert.ok((await page(cms, pathname)).includes('/count.js'), `${pathname} counts nobody`);
    }
  });

  it('never answers 304 with the other reader’s tags (AC #3)', async () => {
    const { cms } = await site([ANALYTICS]);
    const anonymous = await cms.app.request('/tag/notes/');
    const etag = anonymous.headers.get('etag');
    assert.ok(etag !== null);

    const agent = await signedIn(cms);
    const mine = await agent.get('/tag/notes/', { 'if-none-match': etag });
    assert.equal(mine.status, 200, 'the owner kept the copy that counts them');
    assert.equal((await mine.text()).includes('/count.js'), false);
    assert.equal(mine.headers.get('etag'), null, 'the owner’s copy carries a validator');

    await cms.settings.set('dev_mode', new Map([['on', true]]), 'cli');
    const dev = await cms.app.request('/tag/notes/', { headers: { 'if-none-match': etag } });
    assert.equal(dev.status, 200, 'dev mode kept the copy with the tags');
    assert.equal((await dev.text()).includes('/count.js'), false);
  });
});

describe('the host API version (TASK-443, AC #6)', () => {
  it('goes up for page tags, and a plugin built against version 2 still loads and runs', async () => {
    assert.ok(HOST_API_VERSION >= 3);
    const older = definePlugin({
      name: '@test/plugin-older',
      version: '1.0.0',
      label: 'Older',
      description: 'Built for version 2.',
      hostApi: 2,
      register(host) {
        host.get('/older', () => new Response('still here'));
      },
    });
    const { cms } = await site([older]);
    assert.equal(await page(cms, '/older'), 'still here');
  });
});
