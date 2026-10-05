/**
 * The admin bar on the public site (TASK-183): what a signed-in user is sent
 * across the top of every page, what an anonymous reader is still sent, and
 * what the caching headers say about each.
 *
 * Everything goes through HTTP against the real app, with two themes: the
 * packaged one and `bare`, a minimal theme that knows nothing about the bar
 * and does its best to restyle everything on the page.
 */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { browser, csrfField, sandbox, signIn } from '../admin/__testing__/harness.ts';
import type { Browser } from '../admin/__testing__/harness.ts';
import { writeUsers } from '../admin/__testing__/users.ts';
import { sessionCookieName } from '../admin/session.ts';
import type { Cms } from '../index.ts';

const box = sandbox();
after(async () => {
  await box.cleanup();
});

const BASE_URL = 'https://blog.example';
const NOW = new Date('2026-09-20T12:00:00.000Z');
const ADA = { username: 'ada', password: 'correct horse battery', displayName: 'Ada Lovelace' };

const POST_URL = '/2026/09/hello-world/';
const PAGE_URL = '/about/';

const CONTENT: Record<string, string> = {
  'posts/2026-09-19-hello-world.md': [
    '---',
    'title: Hello world',
    "date: '2026-09-19T09:00:00Z'",
    `permalink: ${POST_URL}`,
    'tags: [engines]',
    '---',
    '',
    'Words about engines.',
    '',
  ].join('\n'),
  'pages/about.md': ['---', 'title: About', `permalink: ${PAGE_URL}`, '---', '', 'Me.', ''].join(
    '\n',
  ),
};

/**
 * A theme written with no knowledge of the bar: its own sticky header, and
 * rules broad enough to catch anything a bar in the light DOM would be made of.
 */
const BARE_BASE = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>{{ title or site.title }}</title>
    <link rel="stylesheet" href="/theme/style.css">
  </head>
  <body class="bare">
    <header class="bare-header"><a href="/">{{ site.title }}</a></header>
    <main>{% block content %}{% endblock %}</main>
  </body>
</html>
`;

const BARE_LIST =
  '{% extends "layouts/base.njk" %}{% block content %}<h1>{{ title }}</h1>{% if content %}{{ content | safe }}{% endif %}<ul>{% for d in documents %}<li><a href="{{ d.permalink }}">{{ d.title }}</a></li>{% endfor %}</ul>{% endblock %}';

const BARE_ENTRY =
  '{% extends "layouts/base.njk" %}{% block content %}<h1>{{ title }}</h1>{{ content | safe }}{% endblock %}';

const BARE_THEME: Record<string, string> = {
  'theme.json': JSON.stringify({ name: 'Bare', kind: 'site' }),
  'layouts/base.njk': BARE_BASE,
  'layouts/post.njk': BARE_ENTRY,
  'layouts/page.njk': BARE_ENTRY,
  'layouts/front-page.njk': BARE_ENTRY,
  'layouts/home.njk': BARE_LIST,
  'layouts/tag.njk': BARE_LIST,
  'layouts/category.njk': BARE_LIST,
  'layouts/author.njk': BARE_LIST,
  'layouts/search.njk':
    '{% extends "layouts/base.njk" %}{% block content %}<h1>Search: {{ query }}</h1><ul>{% for hit in hits %}<li>{{ hit.document.title }}</li>{% endfor %}</ul>{% endblock %}',
  'layouts/404.njk':
    '{% extends "layouts/base.njk" %}{% block content %}<h1>Not here</h1>{% endblock %}',
  'layouts/500.njk':
    '{% extends "layouts/base.njk" %}{% block content %}<h1>Broken</h1>{% endblock %}',
  'layouts/503.njk':
    '{% extends "layouts/base.njk" %}{% block content %}<h1>Away</h1>{% endblock %}',
  'static/style.css': [
    '* { font-family: Georgia, serif !important; color: #333; }',
    'a { color: hotpink !important; text-decoration: underline wavy; }',
    'button { background: yellow; font-size: 2rem; }',
    'nav, header { background: lime; }',
    'body > * { max-width: 30rem; margin-inline: auto; padding: 2rem; border: 3px dashed red; }',
    '.bare-header { position: sticky; top: 0; }',
    '.admin-bar, .admin-account-menu { display: none !important; }',
    'main { min-height: 200vh; }',
    '',
  ].join('\n'),
};

async function writeTree(root: string, files: Record<string, string>): Promise<void> {
  for (const [relative, contents] of Object.entries(files)) {
    const file = path.join(root, ...relative.split('/'));
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, contents, 'utf8');
  }
}

/** The bare theme with a page layout that throws, so a page is answered with the 500. */
const BROKEN_THEME: Record<string, string> = {
  ...BARE_THEME,
  'layouts/page.njk':
    '{% extends "layouts/base.njk" %}{% block content %}{{ nothing() }}{% endblock %}',
};

/** The bare theme with a class of its own on <html>, in single quotes. */
const CLASSED_THEME: Record<string, string> = {
  ...BARE_THEME,
  'layouts/base.njk': BARE_BASE.replace('<html lang="en">', `<html lang="en" class='dark'>`),
};

/**
 * The bare theme with speculation rules of its own, one of them written the
 * way a hand-written page might spell it.
 */
const SPECULATIVE_THEME: Record<string, string> = {
  ...BARE_THEME,
  'layouts/base.njk': BARE_BASE.replace(
    '</head>',
    '<script type="speculationrules">{"prefetch":[{"source":"document","eagerness":"moderate"}]}</script>\n' +
      '<SCRIPT TYPE=\'SpeculationRules\' >{"prerender":[{"urls":["/about/"]}]}</SCRIPT >\n' +
      '</head>',
  ),
};

interface SiteOptions {
  theme?: 'bare' | 'broken' | 'classed' | 'speculative' | undefined;
  homepage?: string | undefined;
}

/** A site with one post, one page and Ada's account, nobody signed in. */
async function site(options: SiteOptions = {}): Promise<Cms> {
  const contentDir = await box.dir('geekity-bar-content-');
  const dataDir = await box.dir('geekity-bar-data-');
  const themesDir = await box.dir('geekity-bar-themes-');

  await writeTree(path.join(themesDir, 'bare'), BARE_THEME);
  await writeTree(path.join(themesDir, 'broken'), BROKEN_THEME);
  await writeTree(path.join(themesDir, 'classed'), CLASSED_THEME);
  await writeTree(path.join(themesDir, 'speculative'), SPECULATIVE_THEME);
  await writeTree(contentDir, {
    ...CONTENT,
    '_data/site.json': JSON.stringify({
      title: 'A Site',
      ...(options.theme === undefined ? {} : { theme: options.theme }),
      ...(options.homepage === undefined ? {} : { homepage: options.homepage }),
    }),
  });
  writeUsers(dataDir, [
    {
      username: ADA.username,
      password: ADA.password,
      email: 'ada@example.com',
      profile: { displayName: ADA.displayName },
    },
  ]);

  return await box.open({
    contentDir,
    dataDir,
    themesDir,
    baseUrl: BASE_URL,
    watch: false,
    now: () => NOW,
  });
}

async function signedInTo(cms: Cms): Promise<Browser> {
  return await signIn(cms, { username: ADA.username, password: ADA.password });
}

/** The bar's markup in a page, host element and shadow root included. */
function barIn(html: string): string | undefined {
  return /<geekity-admin-bar[\s\S]*?<\/geekity-admin-bar>/.exec(html)?.[0];
}

/** The stylesheet that makes room for the bar, from outside its shadow root. */
function offsetStyleIn(html: string): string | undefined {
  return /<style id="geekity-admin-bar-offset">[\s\S]*?<\/style>/.exec(html)?.[0];
}

/**
 * The page with the bar, its offset stylesheet and its class on `<html>` taken
 * out, which is what the theme drew.
 */
function withoutBar(html: string): string {
  let drawn = html;
  for (const added of [barIn(html), offsetStyleIn(html)]) {
    if (added !== undefined) drawn = drawn.replace(added, '');
  }
  return drawn.replace('<html class="geekity-admin-bar" lang="en">', '<html lang="en">');
}

/** The bar's links, as label and href, in the order they appear. */
function barLinks(html: string): { label: string; href: string }[] {
  const bar = barIn(html) ?? '';
  return [...bar.matchAll(/<a\b[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/g)].map((match) => ({
    label: (match[2] ?? '').trim(),
    href: match[1] ?? '',
  }));
}

// The pages a reader can land on, one of each kind the renderer draws.
const HTML_PAGES = {
  home: '/',
  post: POST_URL,
  page: PAGE_URL,
  archive: '/tag/engines/',
  author: '/author/ada/',
  search: '/search/?q=engines',
  notFound: '/no-such-thing/',
} as const;

describe('the admin bar for a signed-in user', () => {
  it('is at the top of every public HTML page, its title leading home and View admin first, with no View site (AC #1)', async () => {
    const cms = await site();
    const agent = await signedInTo(cms);

    for (const [kind, url] of Object.entries(HTML_PAGES)) {
      const response = await agent.get(url);
      const html = await response.text();
      const bar = barIn(html);
      assert.ok(bar !== undefined, `${kind} (${url}) carries the bar`);
      assert.match(
        html,
        /<body[^>]*>\s*<style id="geekity-admin-bar-offset">[^<]*<\/style><geekity-admin-bar/,
        `${kind}: the bar, behind its offset stylesheet, is the first thing in <body>`,
      );
      assert.match(bar, /aria-label="Admin bar"/, `${kind}: the bar is labelled`);
      assert.match(bar, /Hoopla! Ada Lovelace/, `${kind}: the account menu greets her`);

      assert.deepEqual(
        barLinks(html).slice(0, 3),
        [
          { label: 'A Site', href: '/' },
          { label: 'View admin', href: '/admin' },
          { label: '+ New', href: '/admin/posts/new' },
        ],
        `${kind}: the title leads home, then View admin and + New (TASK-257)`,
      );
      assert.ok(!bar.includes('View site'), `${kind}: no View site`);
    }
  });

  it('links the post or page being read to its editor, and a listing to neither (AC #2)', async () => {
    const cms = await site();
    const agent = await signedInTo(cms);

    const edits = async (url: string): Promise<{ label: string; href: string }[]> =>
      barLinks(await (await agent.get(url)).text()).filter((link) =>
        /^Edit (Post|Page)$/.test(link.label),
      );

    assert.deepEqual(await edits(POST_URL), [
      { label: 'Edit Post', href: '/admin/posts/hello-world' },
    ]);
    assert.deepEqual(
      barLinks(await (await agent.get(POST_URL)).text()).slice(0, 4),
      [
        { label: 'A Site', href: '/' },
        { label: 'View admin', href: '/admin' },
        { label: '+ New', href: '/admin/posts/new' },
        { label: 'Edit Post', href: '/admin/posts/hello-world' },
      ],
      'Edit Post follows + New',
    );
    assert.deepEqual(await edits(PAGE_URL), [{ label: 'Edit Page', href: '/admin/pages/about' }]);
    for (const url of ['/', '/tag/engines/', '/author/ada/', '/search/?q=engines', '/nope/']) {
      assert.deepEqual(await edits(url), [], `${url} offers no Edit link`);
    }
  });

  it('offers Edit Page on a static front page (AC #2)', async () => {
    const cms = await site({ homepage: 'about' });
    const agent = await signedInTo(cms);

    const links = barLinks(await (await agent.get('/')).text());
    assert.ok(
      links.some((link) => link.label === 'Edit Page' && link.href === '/admin/pages/about'),
    );
  });

  it('is sent private, no-store, with no validator and never as a 304 (AC #5)', async () => {
    const cms = await site();
    const agent = await signedInTo(cms);

    for (const [kind, url] of Object.entries(HTML_PAGES)) {
      // An anonymous copy's validators, which a browser would send back.
      const anonymous = await cms.app.request(url);
      const etag = anonymous.headers.get('etag');
      const lastModified = anonymous.headers.get('last-modified');

      const conditional = await cms.app.request(url, {
        headers: {
          cookie: `${sessionCookieName(cms.config)}=${agent.session() ?? ''}`,
          ...(etag === null ? {} : { 'if-none-match': etag }),
          ...(lastModified === null ? {} : { 'if-modified-since': lastModified }),
        },
      });
      assert.notEqual(conditional.status, 304, `${kind}: no 304 for a signed-in reader`);
      assert.equal(conditional.headers.get('cache-control'), 'private, no-store', kind);
      assert.equal(conditional.headers.get('etag'), null, `${kind}: no ETag`);
      assert.equal(conditional.headers.get('last-modified'), null, `${kind}: no Last-Modified`);
      assert.ok(barIn(await conditional.text()) !== undefined, `${kind}: carries the bar`);
    }
  });

  it('changes nothing else the theme drew', async () => {
    const cms = await site({ theme: 'bare' });
    const agent = await signedInTo(cms);

    for (const [kind, url] of Object.entries(HTML_PAGES)) {
      const anonymous = await (await cms.app.request(url)).text();
      const signedIn = await (await agent.get(url)).text();
      assert.equal(withoutBar(signedIn), anonymous, `${kind}: only the bar was added`);
    }
  });

  it('is drawn the same under the packaged theme and one that knows nothing of it (AC #6)', async () => {
    const packaged = await site();
    const bare = await site({ theme: 'bare' });
    const tokenless = (html: string): string =>
      (barIn(html) ?? '').replace(/name="csrf_token" value="[^"]+"/, 'name="csrf_token" value=""');

    for (const url of [POST_URL, PAGE_URL, '/', '/nope/']) {
      const fromPackaged = await (await (await signedInTo(packaged)).get(url)).text();
      const fromBare = await (await (await signedInTo(bare)).get(url)).text();
      assert.ok(barIn(fromBare) !== undefined, `${url}: the bare theme gets the bar`);
      assert.equal(tokenless(fromBare), tokenless(fromPackaged), `${url}: the same bar`);
    }
  });

  it('keeps its markup and styles in a shadow root the theme cannot reach (AC #6)', async () => {
    const cms = await site({ theme: 'bare' });
    const agent = await signedInTo(cms);
    const bar = barIn(await (await agent.get(POST_URL)).text()) ?? '';

    assert.match(
      bar,
      /^<geekity-admin-bar style="all: initial; display: block; position: fixed; top: 0; left: 0; right: 0; z-index: \d+">/,
      "the host is reset and pinned to the top of the window, out of the theme's flow",
    );
    assert.match(bar, /<template shadowrootmode="open"><style>/);
    assert.match(bar, /\.admin-bar\s*\{/, 'its stylesheet travels inside the shadow root');
  });

  it('makes room for itself at the top of the page, from outside the shadow root', async () => {
    const cms = await site({ theme: 'bare' });
    const agent = await signedInTo(cms);
    const html = await (await agent.get(POST_URL)).text();

    const style = offsetStyleIn(html);
    assert.ok(style !== undefined, 'the page carries the offset stylesheet');
    assert.match(
      html,
      /<body class="bare"><style id="geekity-admin-bar-offset">[\s\S]*?<\/style><geekity-admin-bar /,
      'straight after <body>, right before the bar',
    );
    assert.match(style, /:root \{ --geekity-admin-bar-height: 40px; \}/, 'one line by default');
    assert.match(
      style,
      /@media \(max-width: 600px\) \{ :root \{ --geekity-admin-bar-height: 80px; \} \}/,
      'two lines where the bar wraps, for a reader without script',
    );
    assert.match(
      style,
      /html \{ margin-top: var\(--geekity-admin-bar-height\) !important; \}/,
      'the page is pushed down by the bar',
    );
    assert.match(
      style,
      /:where\(html\) \{ scroll-padding-top: var\(--geekity-admin-bar-height\); \}/,
      'an in-page link scrolls its target clear of the bar',
    );
    assert.match(html, /<html class="geekity-admin-bar" lang="en">/, 'a class for the theme');
    assert.match(
      barIn(html) ?? '',
      /<script src="\/admin\/_static\/admin-bar\.js" defer><\/script>/,
    );
    const script = await (await cms.app.request('/admin/_static/admin-bar.js')).text();
    assert.match(script, /setProperty\('--geekity-admin-bar-height'/, 'the bar measures itself');
  });

  it("adds its class to the theme's own classes on <html>", async () => {
    const cms = await site({ theme: 'classed' });
    const agent = await signedInTo(cms);
    const html = await (await agent.get(POST_URL)).text();

    assert.match(html, /<html lang="en" class="geekity-admin-bar dark">/);
    assert.equal(
      (await (await cms.app.request(POST_URL)).text()).match(/<html[^>]*>/)?.[0],
      `<html lang="en" class='dark'>`,
      "an anonymous reader gets the theme's tag untouched",
    );
  });

  it('goes on the 500 too, which stays unstored', async () => {
    const cms = await site({ theme: 'broken' });
    const agent = await signedInTo(cms);

    const response = await agent.get(PAGE_URL);
    assert.equal(response.status, 500);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    const html = await response.text();
    assert.match(html, /<h1>Broken<\/h1>/);
    assert.ok(barIn(html) !== undefined);

    const anonymous = await cms.app.request(PAGE_URL);
    assert.equal(anonymous.status, 500);
    assert.equal(anonymous.headers.get('cache-control'), 'no-store');
    assert.equal(barIn(await anonymous.text()), undefined);
  });

  it('never goes on JSON, Markdown, feeds or ActivityPub (AC #9)', async () => {
    const cms = await site();
    const agent = await signedInTo(cms);
    const cookie = `${sessionCookieName(cms.config)}=${agent.session() ?? ''}`;

    const requests: [string, Record<string, string>][] = [
      [`${POST_URL}index.json`, {}],
      [`${POST_URL}index.md`, {}],
      [POST_URL, { accept: 'application/json' }],
      [POST_URL, { accept: 'text/markdown' }],
      ['/index.json', {}],
      ['/search/index.json?q=engines', {}],
      ['/feed/', {}],
      ['/feed/json/', {}],
      ['/feed/atom/', {}],
      ['/comments/feed/', {}],
      ['/sitemap.xml', {}],
      ['/author/ada/', { accept: 'application/activity+json' }],
      [POST_URL, { accept: 'application/activity+json' }],
    ];
    for (const [url, headers] of requests) {
      const response = await cms.app.request(url, { headers: { ...headers, cookie } });
      const body = await response.text();
      assert.ok(!body.includes('geekity-admin-bar'), `${url} ${JSON.stringify(headers)}`);
      assert.doesNotMatch(response.headers.get('content-type') ?? '', /text\/html/, url);
    }
  });
});

describe('speculation rules for a signed-in reader (TASK-140 AC #2)', () => {
  const SPECULATION_RULES = /<script\b[^>]*speculationrules/i;

  it('are left off every page the packaged theme draws for one', async () => {
    const cms = await site();
    const agent = await signedInTo(cms);

    for (const [kind, url] of Object.entries(HTML_PAGES)) {
      const anonymous = await (await cms.app.request(url)).text();
      assert.match(anonymous, SPECULATION_RULES, `${kind}: an anonymous reader gets the rules`);

      const signedIn = await (await agent.get(url)).text();
      assert.ok(barIn(signedIn) !== undefined, `${kind}: carries the bar`);
      assert.doesNotMatch(signedIn, SPECULATION_RULES, `${kind}: the signed-in page has rules`);
    }
  });

  it("are taken out of a theme's own page, however it spells the tag", async () => {
    const cms = await site({ theme: 'speculative' });
    const agent = await signedInTo(cms);

    const anonymous = await (await cms.app.request(POST_URL)).text();
    assert.equal(anonymous.match(new RegExp(SPECULATION_RULES, 'gi'))?.length, 2);

    const signedIn = await (await agent.get(POST_URL)).text();
    assert.doesNotMatch(signedIn, SPECULATION_RULES);
    assert.doesNotMatch(signedIn, /prerender|"prefetch"/);
    assert.match(signedIn, /<link rel="stylesheet" href="\/theme\/style\.css">/);
  });
});

describe('logging out from the public bar (AC #7)', () => {
  it('signs out with the POST, the CSRF token and the same-origin check', async () => {
    const cms = await site();
    const agent = await signedInTo(cms);
    const bar = barIn(await (await agent.get(POST_URL)).text()) ?? '';

    const form = /<form method="post" action="([^"]+)">[\s\S]*?<\/form>/.exec(bar);
    assert.equal(form?.[1], '/admin/logout');
    const token = csrfField(form?.[0] ?? '');
    assert.ok(token !== undefined, 'the logout form carries the token');

    const crossSite = await agent.post(
      '/admin/logout',
      { csrf_token: token },
      { 'sec-fetch-site': 'cross-site' },
    );
    assert.equal(crossSite.status, 403, 'a cross-site logout is refused');
    assert.ok(barIn(await (await agent.get(POST_URL)).text()) !== undefined, 'still signed in');

    const wrongToken = await agent.post(
      '/admin/logout',
      { csrf_token: 'x'.repeat(token.length) },
      { 'sec-fetch-site': 'same-origin' },
    );
    assert.notEqual(wrongToken.status, 303, 'a wrong token does not sign out');
    assert.ok(barIn(await (await agent.get(POST_URL)).text()) !== undefined, 'still signed in');

    const out = await agent.post(
      '/admin/logout',
      { csrf_token: token },
      { 'sec-fetch-site': 'same-origin' },
    );
    assert.equal(out.status, 303);
    const after = await agent.get(POST_URL);
    assert.equal(barIn(await after.text()), undefined, 'signed out: no bar');
  });
});

// What an anonymous reader was sent before the bar existed, captured from main
// under the bare theme. Regenerate with GEEKITY_UPDATE_GOLDEN=1 only when a
// change is meant to alter what everybody is sent.
const GOLDEN = fileURLToPath(new URL('./__testing__/anonymous-pages.golden.json', import.meta.url));

interface Captured {
  status: number;
  headers: Record<string, string>;
  body: string;
}

async function capture(cms: Cms, url: string, headers: Record<string, string>): Promise<Captured> {
  const response = await cms.app.request(url, { headers });
  return {
    status: response.status,
    headers: Object.fromEntries(
      [...response.headers.entries()].filter(([name]) => name !== 'date').sort(),
    ),
    body: await response.text(),
  };
}

describe('an anonymous reader (AC #5)', () => {
  it('is sent byte-identical pages and headers to before the bar', async () => {
    const listing = await site({ theme: 'bare' });
    const front = await site({ theme: 'bare', homepage: 'about' });
    // A stranger's cookie, and a session that names nobody, are both anonymous.
    const stranger = { cookie: '__Host-geekity_session=forged' };

    const captured: Record<string, Captured> = {};
    for (const [kind, url] of Object.entries(HTML_PAGES)) {
      captured[kind] = await capture(listing, url, {});
      captured[`${kind} (stranger)`] = await capture(listing, url, stranger);
      const etag = captured[kind].headers['etag'];
      if (etag !== undefined) {
        captured[`${kind} (revalidated)`] = await capture(listing, url, { 'if-none-match': etag });
      }
    }
    captured['static front page'] = await capture(front, '/', {});
    captured['post json'] = await capture(listing, `${POST_URL}index.json`, {});
    captured['post markdown'] = await capture(listing, `${POST_URL}index.md`, {});
    captured['feed'] = await capture(listing, '/feed/', {});

    if (process.env['GEEKITY_UPDATE_GOLDEN'] === '1') {
      await writeFile(GOLDEN, `${JSON.stringify(captured, undefined, 2)}\n`, 'utf8');
    }
    const golden = JSON.parse(await readFile(GOLDEN, 'utf8')) as Record<string, Captured>;
    assert.deepEqual(Object.keys(captured).sort(), Object.keys(golden).sort());
    for (const [name, response] of Object.entries(captured)) {
      assert.deepEqual(response, golden[name], name);
    }
  });

  it('gets no bar even with a session that belongs to nobody', async () => {
    const cms = await site();
    const agent = browser(cms);
    agent.setSession('0'.repeat(64));
    for (const url of Object.values(HTML_PAGES)) {
      assert.equal(barIn(await (await agent.get(url)).text()), undefined, url);
    }
  });
});
