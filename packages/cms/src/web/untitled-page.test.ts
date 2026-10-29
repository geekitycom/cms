import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { remoteHostsDoNotExist } from '../__testing__/offline.ts';
import { csrfField, sandbox } from '../admin/__testing__/harness.ts';
import type { Browser } from '../admin/__testing__/harness.ts';
import { signedIn } from './__testing__/users.ts';
import { titleCell } from '../admin/__testing__/markup.ts';
import type { Cms } from '../index.ts';

remoteHostsDoNotExist();

const box = sandbox();
after(() => box.cleanup());

const ABOUT_WORDS = 'I write software in Ohio and keep notes here.';
const ABOUT_BODY = 'I write software in Ohio and keep [notes](/2026/10/hello/) here.';
const HOME_WORDS = 'Welcome to the site.';

const FILES: Record<string, string> = {
  '_data/site.json': JSON.stringify({
    title: 'Shll.me',
    timezone: 'UTC',
    homepage: 'home',
    postsPage: 'blog',
    menus: { primary: [{ label: 'About me', url: '/about/' }] },
  }),
  'pages/about.md': `---\npermalink: /about/\n---\n\n${ABOUT_BODY}\n`,
  'pages/home.md': `---\ntitle: ''\npermalink: /home/\n---\n\n${HOME_WORDS}\n`,
  'pages/blog.md': '---\npermalink: /blog/\n---\n',
  'posts/2026-10-01-hello.md':
    "---\ntitle: Hello\ndate: '2026-10-01T09:00:00Z'\npermalink: /2026/10/hello/\n---\n\nHello.\n",
  'posts/2026-10-02-twin.md': `---\ndate: '2026-10-02T09:00:00Z'\npermalink: /2026/10/twin/\n---\n\n${ABOUT_WORDS}\n`,
};

async function site(): Promise<{ cms: Cms; contentDir: string }> {
  const contentDir = await box.dir('geekity-untitled-page-content-');
  for (const [relative, contents] of Object.entries(FILES)) {
    const file = path.join(contentDir, ...relative.split('/'));
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, contents, 'utf8');
  }
  const cms = await box.site({ contentDir });
  return { cms, contentDir };
}

function jsonLd(html: string): Record<string, unknown>[] {
  const script = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)?.[1];
  assert.ok(script !== undefined, 'the page has JSON-LD');
  return (JSON.parse(script) as { '@graph': Record<string, unknown>[] })['@graph'];
}

function assertNoEmptyName(html: string): void {
  assert.doesNotMatch(html, /<title>\s*(&middot;)?\s*<\/title>/, 'no empty <title>');
  assert.doesNotMatch(html, /<title>[^<]*&middot; Shll\.me<\/title>/, 'no own name in <title>');
  assert.doesNotMatch(html, /<h[12][^>]*>\s*<\/h[12]>/, 'no empty h1 or h2');
  assert.doesNotMatch(html, /content=""/, 'no empty meta content');
  for (const node of jsonLd(html)) {
    for (const key of ['name', 'headline']) {
      assert.notEqual(node[key], '', `no empty JSON-LD ${key}`);
    }
  }
}

describe('a page with no title (TASK-343)', () => {
  let cms: Cms;
  let contentDir: string;
  let agent: Browser;

  before(async () => {
    ({ cms, contentDir } = await site());
    agent = await signedIn(cms);
  });

  it('parses and serves an untitled page (AC #1)', async () => {
    assert.equal(cms.store.getByPath('pages/about.md')?.title, '');
    const response = await cms.app.request('/about/');
    assert.equal(response.status, 200);
    assert.ok((await response.text()).includes(ABOUT_WORDS));
  });

  it('prints no h1 and heads the page with the site title (AC #3)', async () => {
    const html = await (await cms.app.request('/about/')).text();
    assert.match(html, /<title>Shll\.me<\/title>/);
    assert.doesNotMatch(html, /<h1\b/);
    assert.match(html, /<meta property="og:title" content="Shll\.me">/);
    assert.match(html, /<meta name="twitter:title" content="Shll\.me">/);
    const article = jsonLd(html).find((node) => node['@type'] === 'Article');
    assert.ok(article !== undefined, 'the page is an Article');
    assert.equal(article['headline'], undefined, 'an untitled page claims no headline');
    assertNoEmptyName(html);
  });

  it('prints no h2 on an untitled static front page, titled by the site (AC #3)', async () => {
    const html = await (await cms.app.request('/')).text();
    assert.ok(html.includes(HOME_WORDS));
    assert.match(html, /<title>Shll\.me<\/title>/);
    assert.doesNotMatch(html, /class="section-title"/);
    assertNoEmptyName(html);
  });

  it('heads an untitled posts page with the site title, never an empty one (AC #4)', async () => {
    const html = await (await cms.app.request('/blog/')).text();
    assert.match(html, /<h1 class="page-title">Shll\.me<\/h1>/);
    assert.match(html, /<title>Shll\.me<\/title>/);
    const markdown = await (await cms.app.request('/blog/index.md')).text();
    assert.match(markdown, /^# Shll\.me$/m);
  });

  it('lists an untitled page in /admin/pages as an untitled post is in /admin/posts (AC #4)', async () => {
    const pages = await (await agent.get('/admin/pages')).text();
    const posts = await (await agent.get('/admin/posts')).text();
    const pageCell = titleCell(pages, ABOUT_WORDS);
    const postCell = titleCell(posts, ABOUT_WORDS);
    assert.notEqual(pageCell, '', 'the page is listed by its first words');
    assert.notEqual(postCell, '', 'the post is listed by its first words');
    assert.equal(
      /<a\b[^>]*>[^<]*<\/a>/.exec(pageCell)?.[0].replace(/href="[^"]*"/, ''),
      /<a\b[^>]*>[^<]*<\/a>/.exec(postCell)?.[0].replace(/href="[^"]*"/, ''),
      'the same link markup names both',
    );
    assert.notEqual(titleCell(pages, 'Untitled'), '', 'a wordless page is Untitled, as a post is');
  });

  it('offers an untitled page by its label in the homepage and posts page picks (AC #4)', async () => {
    const html = await (await agent.get('/admin/settings/reading')).text();
    assert.match(html, new RegExp(`<option value="about"[^>]*>${ABOUT_WORDS}</option>`));
    assert.match(html, new RegExp(`<option value="home"[^>]*selected[^>]*>${HOME_WORDS}</option>`));
    assert.doesNotMatch(html, /<option value="[^"]+"[^>]*>\s*<\/option>/, 'no empty option');
  });

  it('keeps a menu item’s own label when it points at an untitled page', async () => {
    const html = await (await cms.app.request('/2026/10/hello/')).text();
    assert.match(html, /<a href="\/about\/"[^>]*>About me<\/a>/);
    const editor = await (await agent.get('/admin/navigation')).text();
    assert.ok(editor.includes('About me | /about/'), 'the menu editor shows the item as stored');
  });

  it('names an untitled page by its label in search, llms.txt and backlinks (AC #4)', async () => {
    const search = await (await cms.app.request('/search/?q=Ohio')).text();
    assert.match(search, new RegExp(`class="u-url">${ABOUT_WORDS}</a>`));

    const llms = await (await cms.app.request('/llms.txt')).text();
    assert.ok(llms.includes(`- [${ABOUT_WORDS}](http`), llms);
    assert.doesNotMatch(llms, /- \[\]\(/, 'no empty link text');

    const hello = await (await cms.app.request('/2026/10/hello/')).text();
    assert.match(hello, new RegExp(`<a href="/about/">${ABOUT_WORDS}</a>`));
  });

  it('gives an untitled page no heading in Markdown and no title in JSON (AC #4)', async () => {
    const markdown = await (await cms.app.request('/about/index.md')).text();
    assert.doesNotMatch(markdown, /^# /m);
    assert.doesNotMatch(markdown, /^title:/m);
    const json = (await (await cms.app.request('/about/index.json')).json()) as {
      frontMatter: Record<string, unknown>;
    };
    assert.equal(json.frontMatter['title'], undefined);
  });

  it('saves a page with no title from the editor (AC #2)', async () => {
    const html = await (await agent.get('/admin/pages/new')).text();
    const token = csrfField(html);
    assert.ok(token !== undefined);
    const response = await agent.post('/admin/pages/new', {
      csrf_token: token,
      title: '',
      body: 'A landing page with no heading.',
      action: 'publish',
    });
    assert.equal(response.status, 303);
    const editor = response.headers.get('location');
    assert.ok(editor !== null);
    const written = await readFile(
      path.join(contentDir, 'pages', `${editor.split('/').at(-1) ?? ''}.md`),
      'utf8',
    );
    assert.doesNotMatch(written, /^title:/m);
    const screen = await (await agent.get(editor)).text();
    assert.ok(screen.includes('Published: A landing page with no heading.'), 'the flash names it');
    assert.ok(
      screen.includes('Edit page: A landing page with no heading.'),
      'the heading names it',
    );
  });
});
