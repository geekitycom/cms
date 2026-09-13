/**
 * The demo site, booted the way `pnpm --filter demo dev` boots it.
 *
 * The point of these tests is the override mechanism of decision-6 and the
 * named themes of decision-15: the demo ships one theme, `themes/demo/`, whose
 * whole content is `layouts/post.njk` and `static/style.css`; its `site.json`
 * chooses it by name, and everything else — the home page, the tag archives,
 * the 404 — still comes from the package. So the assertions are about what the
 * site actually serves over HTTP, not about which file was read.
 *
 * The content directory and the themes directory are the demo's own, from
 * `geekity.config.ts`. Only the port and the data directory are replaced: the
 * index is derived state, so a run gets a fresh one in a temporary directory
 * and leaves `apps/demo/data/` alone.
 */
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  CONTACT_FIELDS,
  CONTACT_POST_PATH,
  createCms,
  createUser,
  PACKAGED_THEME_DIR,
  readSiteSettings,
  setUserProfile,
} from '@geekity/cms';
import type { Cms } from '@geekity/cms';

import config from '../geekity.config.ts';

/** The demo's content directory, absolute, for the readers that want a path. */
const CONTENT_DIR = fileURLToPath(new URL('../content', import.meta.url));

/** The demo's themes directory, absolute: one folder, `demo/`. */
const THEMES_DIR = fileURLToPath(new URL('../themes', import.meta.url));

let cms: Cms;
let origin: string;
let dataDir: string;

/** GET a path from the running demo site. */
async function get(pathname: string, init?: RequestInit): Promise<Response> {
  return fetch(new URL(pathname, origin), init);
}

/** GET a path and assert it came back 200, returning the body. */
async function text(pathname: string): Promise<string> {
  const response = await get(pathname);
  assert.equal(response.status, 200, `GET ${pathname} answered ${String(response.status)}`);
  return response.text();
}

before(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), 'geekity-demo-'));
  cms = createCms({ ...config, port: 0, dataDir, watch: false });
  const { port } = await cms.serve();
  origin = `http://127.0.0.1:${String(port)}`;
});

after(async () => {
  await cms.close();
  await rm(dataDir, { recursive: true, force: true });
});

describe('the theme the demo chose', () => {
  it('serves a post through the demo post layout, not the packaged one', async () => {
    const body = await text('/2026/08/markdown-on-disk/');

    // The packaged `layouts/post.njk` prints its byline in the meta line and
    // no reading time; the demo's override gives the byline a line of its own
    // and adds the reading time, and that is the whole visible difference.
    assert.match(body, /<p class="post-byline">[\s\S]{0,200}Andrew Shell/);
    assert.match(body, /\d+ minute read/);
  });

  it('keeps the packaged layouts it did not override', async () => {
    // `layouts/home.njk` and `partials/post-list.njk` are the package's, and
    // the listing they draw is on the posts page now (TASK-85).
    const listing = await text('/posts/');
    assert.match(listing, /<div class="feed h-feed">/);
    assert.match(listing, /<article class="feed-item h-entry">/);

    const body = await text('/');

    // So is `layouts/base.njk` — the shell of the andrewshell.org design
    // (decision-16): the skip link, the wrapper that says it is the root path,
    // and the site title as the heading with the tagline under it.
    assert.match(body, /<a class="screen-reader-text" href="#main">Skip to content<\/a>/);
    assert.match(body, /<div class="global-wrapper" data-is-root-path="true">/);
    assert.match(body, /<h1 class="main-heading">\s*<a href="\/">Geekity Demo<\/a>/);
    assert.match(body, /A file-first site, served straight from Markdown/);
  });

  it('degrades the footer for a site author no user answers to', async () => {
    // `site.json` says `"author": "Joe Blog"` and the demo has no such account,
    // so `siteAuthor` is absent: the name is still in the copyright line and
    // there are no `rel="me"` links to print (TASK-79, TASK-80).
    const body = await text('/2026/08/markdown-on-disk/');
    const footer = /<footer>([\s\S]*?)<\/footer>/.exec(body)?.[1] ?? '';

    assert.match(footer, /&copy; \d{4}, Joe Blog/, 'no copyright line');
    assert.match(footer, /Published with[\s\S]*Geekity/, 'no colophon');
    assert.match(footer, /<a href="\/feed\/">RSS<\/a>/, 'no RSS link');
    assert.doesNotMatch(footer, /rel="me"/, 'a name with no profile behind it has links');
  });

  it('heads every page but the front one with the small link home', async () => {
    const body = await text('/2026/08/markdown-on-disk/');

    assert.match(body, /<a class="header-link-home" href="\/">Geekity Demo<\/a>/);
    assert.doesNotMatch(body, /main-heading/, 'the front page heading is on an entry');
  });

  it('serves the demo stylesheet at /theme/style.css', async () => {
    const response = await get('/theme/style.css');
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'text/css; charset=utf-8');

    const body = await response.text();
    assert.match(body, /Geekity demo/, 'the packaged stylesheet is being served, not the demo one');
  });
});

/**
 * The same content with the choice taken out (decision-15).
 *
 * `themes/demo/` is still on disk and `themesDir` still points at it; the only
 * difference is that `site.json` no longer names it, which is exactly what the
 * Appearance screen writes when the packaged theme is activated. So this is
 * the other half of the override mechanism: an unchosen theme is not on the
 * search path at all, and the site falls back to the theme inside the package
 * rather than to nothing.
 *
 * It runs against a copy of the demo's content in a temporary directory.
 * `apps/demo/content/` is a working site that a person may have running, so a
 * test never edits it — not even to put it back afterwards, because a crashed
 * run would leave the demo wearing no theme.
 */
describe('the demo with its theme unchosen', () => {
  let bare: Cms;
  let bareOrigin: string;
  let sandbox: string;

  /** GET a path from the second site and assert it came back 200. */
  async function bareText(pathname: string): Promise<string> {
    const response = await fetch(new URL(pathname, bareOrigin));
    assert.equal(response.status, 200, `GET ${pathname} answered ${String(response.status)}`);
    return response.text();
  }

  before(async () => {
    sandbox = await mkdtemp(path.join(tmpdir(), 'geekity-demo-unchosen-'));
    const contentDir = path.join(sandbox, 'content');
    const bareDataDir = path.join(sandbox, 'data');
    await cp(CONTENT_DIR, contentDir, { recursive: true });
    await mkdir(bareDataDir, { recursive: true });

    const settingsFile = path.join(contentDir, '_data', 'site.json');
    const settings = JSON.parse(await readFile(settingsFile, 'utf8')) as Record<string, unknown>;
    assert.equal(settings['theme'], 'demo', 'the demo does not choose a theme to unchoose');
    delete settings['theme'];
    await writeFile(settingsFile, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');

    bare = createCms({
      ...config,
      port: 0,
      contentDir,
      dataDir: bareDataDir,
      themesDir: THEMES_DIR,
      watch: false,
    });
    const { port } = await bare.serve();
    bareOrigin = `http://127.0.0.1:${String(port)}`;
  });

  after(async () => {
    await bare.close();
    await rm(sandbox, { recursive: true, force: true });
  });

  it('serves a post through the packaged post layout', async () => {
    const body = await bareText('/2026/08/markdown-on-disk/');

    // The packaged entry is the andrewshell.org one (TASK-83): the Published
    // line lives inside the `e-content`, not in a meta line under the title.
    assert.match(body, /<article class="blog-post h-entry">/, 'not the packaged entry');
    assert.match(body, /<p class="entry-meta">[\s\S]*?Published/, 'not the packaged meta line');
    assert.doesNotMatch(body, /post-byline/, 'the unchosen theme is still on the search path');
    assert.doesNotMatch(body, /minute read/, 'the unchosen theme is still on the search path');
  });

  it('serves the packaged stylesheet at /theme/style.css', async () => {
    const response = await fetch(new URL('/theme/style.css', bareOrigin));
    assert.equal(response.status, 200);

    const packaged = await readFile(path.join(PACKAGED_THEME_DIR, 'static', 'style.css'), 'utf8');
    assert.equal(await response.text(), packaged, 'not the stylesheet inside the package');
  });

  it('serves the rest of the site exactly as before', async () => {
    assert.match(await bareText('/'), /<div class="feed h-feed">/);
    assert.match(await bareText('/colophon/'), /Colophon/);
  });

  it('wears the packaged shell on every page of it', async () => {
    assert.match(await bareText('/'), /<div class="global-wrapper" data-is-root-path="true">/);
    assert.match(await bareText('/colophon/'), /<a class="header-link-home" href="\/">/);
  });

  it('loads the highlighter only on the post with code on it (TASK-86)', async () => {
    const withCode = await bareText('/2026/07/six-tables-and-a-migration/');

    assert.match(withCode, /<pre tabindex="0"><code class="language-sql">/);
    assert.match(withCode, /<pre tabindex="0"><code class="language-typescript">/);
    assert.match(withCode, /<pre tabindex="0"><code class="language-diff">/);
    assert.match(withCode, /<script src="\/theme\/highlight\.js" defer><\/script>/);

    const withoutCode = await bareText('/2026/08/one-url-many-representations/');
    assert.doesNotMatch(withoutCode, /highlight\.js/, 'a post with no code ships JavaScript');
    assert.doesNotMatch(withoutCode, /<script(?![^>]*application\/ld\+json)/, 'and any script');
  });

  it('serves the packaged token colours with the packaged stylesheet', async () => {
    const css = await bareText('/theme/style.css');

    assert.match(css, /--color-code-keyword:/, 'the stylesheet has no highlighting palette');
    assert.match(css, /\.hljs-addition \{/, 'the stylesheet has no diff treatment');
  });
});

describe('the demo content', () => {
  it('paginates the posts page at the configured postsPerPage', async () => {
    const body = await text('/posts/');
    assert.match(body, /class="pagination"/, 'the listing is not paginated');

    // `postsPerPage` is 2 and five posts are published, so there is a page 2
    // and a page 3 to page through.
    assert.match(await text('/posts/page/2/'), /<div class="feed h-feed">/);
    assert.match(await text('/posts/page/3/'), /<div class="feed h-feed">/);
  });

  it('gives the person its posts name an archive, once there is an account (TASK-67)', async () => {
    // Every demo post says `author: Andrew Shell`, which is a display name
    // rather than a login — what a file written before decision-14 holds. With
    // a user answering to it, that name reads as that user: their posts land
    // on their archive and the byline links to it. Without one — which is what
    // a fresh checkout has, because `data/` is not in git — the name is still
    // printed, it simply links nowhere.
    const andrew = await createUser({
      dataDir,
      username: 'andrew',
      password: 'a password for the demo',
    });
    await setUserProfile({
      dataDir,
      userId: andrew.id,
      profile: { displayName: 'Andrew Shell', bio: 'Writes the CMS this runs on.' },
    });

    const archive = await text('/author/andrew/');
    assert.match(archive, /Andrew Shell/, 'the archive is headed with the profile');
    assert.match(archive, /Writes the CMS this runs on\./);
    assert.match(archive, /The theme is just templates/, 'and lists the posts they wrote');
    assert.match(archive, /href="\/author\/andrew\/page\/2\/"/, 'paginated like the home page');
    assert.match(await text('/author/andrew/page/2/'), /Markdown on disk/);
    assert.doesNotMatch(archive, /A draft nobody can see/, 'but not the draft');

    assert.match(
      await text('/2026/08/markdown-on-disk/'),
      /href="\/author\/andrew\/"/,
      'and the byline on a post links to it',
    );
    assert.match(await text('/author/andrew/feed/'), /The theme is just templates/);
    assert.equal((await get('/author/nobody/')).status, 404);
  });

  it('serves the page with an explicit permalink at that permalink', async () => {
    assert.match(await text('/colophon/'), /Colophon/);
  });

  it('serves the post that opted out of the dated permalink', async () => {
    assert.match(await text('/reading-the-index/'), /Reading the index/);
  });

  it('renders footnotes and fenced code in the post that carries them', async () => {
    const body = await text('/2026/07/six-tables-and-a-migration/');
    assert.match(body, /class="footnotes"/, 'markdown-it-footnote did not run');
    assert.match(body, /<code class="language-sql"/, 'the fenced block lost its language class');
  });

  it('keeps the draft off the site', async () => {
    assert.equal((await get('/2026/09/a-draft-nobody-can-see/')).status, 404);
    assert.doesNotMatch(await text('/'), /A draft nobody can see/);
    assert.doesNotMatch(await text('/posts/'), /A draft nobody can see/);
    assert.doesNotMatch(await text('/archive/'), /A draft nobody can see/);
    assert.doesNotMatch(await text('/tag/theme/'), /A draft nobody can see/);
    assert.doesNotMatch(await text('/category/general/'), /A draft nobody can see/);
  });

  it('files its posts under categories, with an archive at /category/{slug}/', async () => {
    const post = await text('/2026/08/markdown-on-disk/');
    assert.match(post, /href="\/category\/engineering\/"/, 'the post links its category');

    const archive = await text('/category/engineering/');
    assert.match(archive, /Markdown on disk/);
    assert.doesNotMatch(archive, /The theme is just templates/, 'filed elsewhere');

    assert.equal((await get('/category/nothing-is-filed-here/')).status, 404);
  });

  it('offers the same document as Markdown and as JSON', async () => {
    const markdown = await get('/2026/08/markdown-on-disk/', {
      headers: { accept: 'text/markdown' },
    });
    assert.equal(markdown.status, 200);
    assert.match(await markdown.text(), /^---\ntitle: Markdown on disk\n/);

    const json = (await (await get('/2026/08/markdown-on-disk/index.json')).json()) as {
      frontMatter: { title: string };
    };
    assert.equal(json.frontMatter.title, 'Markdown on disk');
  });

  it('publishes a feed holding the published posts', async () => {
    const feed = (await (await get('/feed/json/')).json()) as { items: { title: string }[] };
    assert.ok(feed.items.length >= 5, `the feed holds only ${String(feed.items.length)} items`);
    assert.ok(!feed.items.some((item) => item.title === 'A draft nobody can see'));

    // The RSS feed at `/feed/` is what a subscriber of a WordPress site holds.
    const rss = await (await get('/feed/')).text();
    assert.match(rss, /^<\?xml version="1\.0" encoding="utf-8"\?>\n<rss version="2\.0"/);
    assert.equal((rss.match(/<item>/g) ?? []).length, feed.items.length);
    assert.ok(!rss.includes('A draft nobody can see'));
  });
});

/**
 * The demo's Reading settings (TASK-74) and the two page kinds they turn on
 * (TASK-85): `site.json` names About as the homepage and Posts as the posts
 * page, so `/` is the About page's words over the recent posts and the
 * listing lives at `/posts/`. The Archive page says `archive: true`, and is
 * the whole archive grouped by month.
 */
describe('the demo front page and archive page', () => {
  it('serves the About page at / over the recent posts', async () => {
    const body = await text('/');

    assert.match(body, /The demo site exists so the CMS/, 'the homepage’s own words');
    assert.match(body, /<h2>Recent Posts<\/h2>/);
    assert.match(body, /<h3 class="feed-title p-name">/, 'the entries are headed under the h2');
    assert.match(body, /The theme is just templates/, 'the newest post is not listed');
    assert.match(body, /<p class="front-links">[\s\S]*?href="\/posts\/"/, 'no link to the listing');
  });

  it('redirects the About page’s own permalink to /', async () => {
    const response = await get('/about/', { redirect: 'manual' });
    assert.equal(response.status, 301);
    assert.equal(response.headers.get('location'), '/');
  });

  it('lists every published post by month on the archive page', async () => {
    const body = await text('/archive/');

    assert.match(body, /puts every published post below/, 'the page’s own words');
    assert.match(body, /<h2>September 2026<\/h2>\s*<ol class="list-none">/);
    assert.match(body, /<h2>August 2026<\/h2>/);
    assert.match(body, /<a href="\/reading-the-index\/">/, 'the oldest post is missing');

    // Newest month first, and the pages are not on it: an archive is the posts.
    const months = [...body.matchAll(/<h2>(\w+ 2026)<\/h2>/g)].map((match) => match[1]);
    assert.deepEqual(months, ['September 2026', 'August 2026', 'July 2026', 'June 2026']);
    assert.doesNotMatch(body, /<a href="\/colophon\/"><span>/);
  });
});

/**
 * The contact page is the demo's only page that asks for a form, and the only
 * place the demo exercises TASK-56 at all. What is asserted here is what a
 * visitor can see: the form is under the page, the page is reachable from the
 * menu, and the address the message goes to is not anywhere in the bytes.
 */
describe('the demo contact page', () => {
  it('renders the contact form under the page content', async () => {
    const body = await text('/contact/');

    assert.match(body, new RegExp(`action="${CONTACT_POST_PATH}"`), 'the form posts to the CMS');
    for (const field of [
      CONTACT_FIELDS.name,
      CONTACT_FIELDS.email,
      CONTACT_FIELDS.subject,
      CONTACT_FIELDS.message,
    ]) {
      assert.match(body, new RegExp(`name="${field}"`), `the form has no ${field} field`);
    }
  });

  it('puts the contact page in the site navigation', async () => {
    const body = await text('/');

    assert.match(body, /<nav class="site-nav"/, 'the demo renders no menu at all');
    assert.match(body, /<a href="\/contact\/"[^>]*>Contact<\/a>/, 'the menu has no contact item');
  });

  it('keeps the address a message goes to out of the HTML', async () => {
    const { contactEmail } = readSiteSettings(CONTENT_DIR);
    assert.notEqual(contactEmail, '', 'the demo configures no contact address to look for');

    // Both what a visitor asks for and what the form itself is rendered into:
    // the address is read when a submission arrives and reaches no template.
    assert.doesNotMatch(await text('/contact/'), new RegExp(contactEmail));
    assert.doesNotMatch(await text('/'), new RegExp(contactEmail));
  });
});

/**
 * Code highlighting (TASK-86), on the two sites this file boots.
 *
 * The packaged base layout loads `/theme/highlight.js` on a page whose rendered
 * body holds a `language-` class and on no other page, so the demo is where
 * that is worth proving end to end: one post has three fenced blocks on it and
 * another has none, and both are served by the same layout.
 */
describe('the demo highlights code where there is code', () => {
  /** The post with fenced SQL, TypeScript and a diff in it. */
  const WITH_CODE = '/2026/07/six-tables-and-a-migration/';

  /** A post of the same shape with nothing fenced in it. */
  const WITHOUT_CODE = '/2026/08/one-url-many-representations/';

  it('marks the fenced blocks up for the highlighter to find', async () => {
    const body = await text(WITH_CODE);

    for (const language of ['sql', 'typescript', 'diff']) {
      assert.match(
        body,
        new RegExp(`<pre tabindex="0"><code class="language-${language}">`),
        `the post has no ${language} block, or it lost its class`,
      );
    }
  });

  it('loads the highlighter there and nowhere else, on the theme the demo chose', async () => {
    assert.match(await text(WITH_CODE), /<script src="\/theme\/highlight\.js" defer><\/script>/);
    assert.doesNotMatch(await text(WITHOUT_CODE), /highlight\.js/);
    assert.doesNotMatch(await text('/'), /highlight\.js/);
  });

  it('gives the demo stylesheet its own token colours for what the bundle marks up', async () => {
    // A stylesheet is an all-or-nothing override, so the theme that ships one
    // owns the highlighter's colours too. Without these the bundle would still
    // run and every token would come out the colour of the code around it.
    const css = await text('/theme/style.css');

    assert.match(css, /--code-keyword:/, 'the demo stylesheet has no highlighting palette');
    assert.match(css, /\.hljs-addition \{/, 'the demo stylesheet has no diff treatment');
  });

  it('serves the packaged bundle, because the demo theme has no static of its own', async () => {
    const response = await get('/theme/highlight.js');
    assert.equal(response.status, 200);

    const packaged = await readFile(
      path.join(PACKAGED_THEME_DIR, 'static', 'highlight.js'),
      'utf8',
    );
    assert.equal(await response.text(), packaged);
  });
});
