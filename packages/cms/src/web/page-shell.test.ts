/**
 * The shell of the default theme: the wrapper, the header, the footer
 * (decision-16, TASK-80), the head (TASK-81) and the one script it ever loads,
 * the code highlighter (TASK-86).
 *
 * The source design puts the site title and the tagline on the front page as a
 * heading and a small link home on every other page, keeps the whole page in
 * one `.global-wrapper` that says when it is at the root, and ends with a
 * footer holding the copyright, the colophon, an RSS link and the site author's
 * `rel="me"` links. Its head carries a description, Open Graph and Twitter card
 * tags, icons derived from the site avatar and one JSON-LD graph. None of that
 * is a function's return value, so all of it is asserted over HTTP against the
 * packaged theme.
 */
import assert from 'node:assert/strict';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, describe, it } from 'node:test';

import sharp from 'sharp';

import { createUser, setUserProfile } from '../admin/accounts.ts';
import { sandbox } from '../admin/__testing__/harness.ts';
import type { Cms, GeekityConfig } from '../index.ts';
import { PACKAGED_THEME_DIR } from './themes.ts';

const box = sandbox();
after(() => box.cleanup());

/** What the site's clock says while these tests run. */
const NOW = '2026-09-13T12:00:00Z';

/**
 * The year the footer prints: the wall clock rather than the site's injected
 * `now`, because `{{ "now" | date("year") }}` is read when the page is rendered
 * and a site left running over New Year should say the new one.
 */
const YEAR = String(new Date().getUTCFullYear());

/** Write a tree of files, relative paths to contents, under `root`. */
async function writeTree(root: string, files: Record<string, string>): Promise<void> {
  for (const [relative, contents] of Object.entries(files)) {
    const file = path.join(root, ...relative.split('/'));
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, contents, 'utf8');
  }
}

/** Where a site's avatar upload is written, and the path `site.json` names. */
const AVATAR = '/uploads/2026/09/avatar.png';

/** One published post and one page, which is enough to visit every shell. */
const CONTENT: Record<string, string> = {
  'posts/hello.md':
    "---\ntitle: Hello\ndate: '2026-09-02T09:00:00Z'\nupdated: '2026-09-05T09:00:00Z'\npermalink: /2026/09/hello/\ntags:\n  - notes\n---\n\nBody.\n",
  // A post whose front matter names its own picture, which is the one case
  // where the head's image is not the site's avatar.
  'posts/photo.md':
    "---\ntitle: A photo\ndate: '2026-09-03T09:00:00Z'\npermalink: /2026/09/photo/\nimage: /uploads/2026/09/hero.png\n---\n\nLook at it.\n",
  'pages/about.md':
    '---\ntitle: About\npermalink: /about/\ndescription: What this site is about.\n---\n\nAbout us.\n',
  // A page with a fenced block on it, which is the one page the shell loads a
  // script for (TASK-86).
  'pages/code.md': '---\ntitle: Code\npermalink: /code/\n---\n\n```js\nconst answer = 42;\n```\n',
};

/** A CMS wearing the packaged theme, with whatever `site.json` says. */
async function site(
  settings: Record<string, unknown> = {},
  config: GeekityConfig = {},
): Promise<Cms> {
  return (await siteWithContent(settings, config)).cms;
}

/** The same, for a test that also has to put a file in the content directory. */
async function siteWithContent(
  settings: Record<string, unknown> = {},
  config: GeekityConfig = {},
): Promise<{ cms: Cms; contentDir: string }> {
  const contentDir = await box.dir('geekity-shell-content-');
  const dataDir = await box.dir('geekity-shell-data-');

  await writeTree(contentDir, {
    ...CONTENT,
    '_data/site.json': JSON.stringify(
      { title: 'A Site', tagline: 'Words about words', ...settings },
      null,
      2,
    ),
  });

  const cms = await box.open({ contentDir, dataDir, now: () => new Date(NOW), ...config });
  return { cms, contentDir };
}

/** A CMS whose `site.json` names an avatar, with the upload behind it on disk. */
async function siteWearingAnAvatar(settings: Record<string, unknown> = {}): Promise<Cms> {
  const { cms, contentDir } = await siteWithContent({ avatar: AVATAR, ...settings });

  const file = path.join(contentDir, ...AVATAR.slice(1).split('/'));
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(
    file,
    await sharp({
      create: { width: 240, height: 240, channels: 3, background: { r: 179, g: 57, b: 0 } },
    })
      .png()
      .toBuffer(),
  );

  return cms;
}

/** Give the site a user with a profile, the way the users screen would. */
async function addUser(
  cms: Cms,
  username: string,
  profile: Record<string, unknown>,
): Promise<void> {
  const user = await createUser({
    dataDir: cms.config.dataDir,
    username,
    password: 'a password of theirs',
  });
  await setUserProfile({ dataDir: cms.config.dataDir, userId: user.id, profile });
}

/** GET a path and read the body. */
async function body(cms: Cms, pathname: string): Promise<string> {
  const response = await cms.app.request(pathname);
  assert.equal(response.status, 200, `GET ${pathname} answered ${String(response.status)}`);
  return response.text();
}

/** The `<header>…</header>` of a page. */
function header(html: string): string {
  return /<header class="global-header">([\s\S]*?)<\/header>/.exec(html)?.[1] ?? '';
}

/**
 * The `<footer>…</footer>` of the page: the one after `</main>`.
 *
 * An entry prints a `<footer>` of its own, holding the bio (TASK-83), so the
 * first one in the document is not the page's.
 */
function footer(html: string): string {
  const afterMain = html.slice(html.lastIndexOf('</main>'));
  return /<footer>([\s\S]*?)<\/footer>/.exec(afterMain)?.[1] ?? '';
}

/** The `content` of one `<meta>`, by whichever of `name` or `property` it uses. */
function metaContent(html: string, key: string): string | undefined {
  const tag = new RegExp(`<meta (?:name|property)="${key}" content="([^"]*)">`);
  return tag.exec(html)?.[1];
}

/** Every `<link rel=…>` of a page, as `{ rel, sizes, type, href }`. */
function links(html: string): { rel: string; sizes: string; type: string; href: string }[] {
  return [...html.matchAll(/<link ([^>]*)>/g)].map((match) => {
    const attributes = match[1] ?? '';
    const value = (name: string): string =>
      new RegExp(`${name}="([^"]*)"`).exec(attributes)?.[1] ?? '';
    return {
      rel: value('rel'),
      sizes: value('sizes'),
      type: value('type'),
      href: value('href'),
    };
  });
}

/**
 * The page's JSON-LD, parsed.
 *
 * Through `JSON.parse` rather than a regex over the text, because the whole
 * point of the partial is that what it prints is valid JSON: a title with a
 * quote in it or a stray comma would fail here and nowhere else.
 */
function graph(html: string): Record<string, unknown>[] {
  const script = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)?.[1];
  assert.ok(script !== undefined, 'the page has no JSON-LD');

  const parsed = JSON.parse(script) as { '@context'?: unknown; '@graph'?: unknown };
  assert.equal(parsed['@context'], 'https://schema.org');
  assert.ok(Array.isArray(parsed['@graph']), 'the JSON-LD has no @graph');
  return parsed['@graph'] as Record<string, unknown>[];
}

/** One node of a graph by its `@type`. */
function node(nodes: Record<string, unknown>[], type: string): Record<string, unknown> | undefined {
  return nodes.find((candidate) => candidate['@type'] === type);
}

describe('the page shell (AC #1)', () => {
  it('wraps every page in a global wrapper, marked only at the root', async () => {
    const cms = await site();

    assert.match(
      await body(cms, '/'),
      /<div class="global-wrapper" data-is-root-path="true">/,
      'the front page is not marked as the root path',
    );

    for (const pathname of ['/about/', '/2026/09/hello/', '/tag/notes/']) {
      const html = await body(cms, pathname);
      assert.match(html, /<div class="global-wrapper">/, `${pathname} has no wrapper`);
      assert.doesNotMatch(html, /data-is-root-path/, `${pathname} claims to be the root path`);
    }

    const missing = await cms.app.request('/nothing-here/');
    assert.equal(missing.status, 404);
    assert.doesNotMatch(await missing.text(), /data-is-root-path/, 'and the 404 does not either');
  });

  it('keeps the skip link ahead of the wrapper', async () => {
    const html = await body(await site(), '/');

    assert.match(html, /<a class="screen-reader-text" href="#main">Skip to content<\/a>/);
    assert.ok(
      html.indexOf('Skip to content') < html.indexOf('global-wrapper'),
      'the skip link is not the first thing in the body',
    );
    assert.match(html, /<main id="main">/, 'there is nothing for the skip link to reach');
  });

  it('heads the front page with the site title and the tagline', async () => {
    const front = header(await body(await site(), '/'));

    assert.match(front, /<h1 class="main-heading">\s*<a href="\/">A Site<\/a>\s*<\/h1>/);
    assert.match(front, /<p>Words about words<\/p>/);
    assert.doesNotMatch(front, /header-link-home/, 'the front page also has the small home link');
  });

  it('heads every other page with the small link home', async () => {
    const cms = await site();

    for (const pathname of ['/about/', '/2026/09/hello/', '/tag/notes/']) {
      const inside = header(await body(cms, pathname));
      assert.match(
        inside,
        /<a class="header-link-home" href="\/">A Site<\/a>/,
        `${pathname} has no link home`,
      );
      assert.doesNotMatch(inside, /main-heading/, `${pathname} repeats the front page heading`);
      assert.doesNotMatch(
        inside,
        /Words about words/,
        `${pathname} repeats the tagline under the heading`,
      );
    }
  });

  it('heads the root listing once, with the header rather than the site title twice', async () => {
    const cms = await site({ postsPerPage: 1 });

    const root = [...(await body(cms, '/')).matchAll(/<h1[^>]*>/g)];
    assert.equal(root.length, 1, `the root listing has ${String(root.length)} h1 elements`);
    assert.match(root[0]?.[0] ?? '', /main-heading/, 'and the one it has is not the header');

    // Page two is not the root path, so the header steps down to the small link
    // home and the listing heads itself. Still one heading either way.
    const second = [...(await body(cms, '/page/2/')).matchAll(/<h1[^>]*>/g)];
    assert.equal(second.length, 1, `page two has ${String(second.length)} h1 elements`);
  });

  it('heads a listing at its own path with its title, since the header does not', async () => {
    const { cms, contentDir } = await siteWithContent({ homepage: 'about', postsPage: 'news' });
    await writeTree(contentDir, {
      'pages/news.md': '---\ntitle: News\npermalink: /news/\n---\n\nThe latest.\n',
    });
    await cms.sync();

    const html = await body(cms, '/news/');

    assert.doesNotMatch(header(html), /main-heading/, 'the header heads a page that is not root');
    assert.match(html, /<h1 class="page-title">News<\/h1>/, 'so the listing must head itself');
  });

  it('gives the root header the menu as a line of its own under the tagline (TASK-105 AC #1)', async () => {
    const cms = await site({
      menus: {
        primary: [
          { label: 'Home', url: '/' },
          { label: 'About', url: '/about/' },
        ],
      },
    });

    assert.match(
      header(await body(cms, '/')),
      /<p>Words about words<\/p>\s*<nav class="site-nav" aria-label="Site">/,
      'the menu does not follow the tagline in the root header',
    );
  });

  it('puts the menu beside the link home on every other page (TASK-105 AC #1)', async () => {
    const cms = await site({ menus: { primary: [{ label: 'About', url: '/about/' }] } });

    for (const pathname of ['/about/', '/2026/09/hello/', '/tag/notes/']) {
      assert.match(
        header(await body(cms, pathname)),
        /<a class="header-link-home" href="\/">A Site<\/a>\s*<nav class="site-nav" aria-label="Site">/,
        `${pathname} does not carry the menu beside its link home`,
      );
    }

    // The two are different layouts rather than the same markup twice: a line
    // of its own under the tagline at the root, and one line with the link
    // home everywhere else, which is the stylesheet's half of the same rule.
    assert.match(
      await readFile(path.join(PACKAGED_THEME_DIR, 'static', 'style.css'), 'utf8'),
      /\.global-wrapper:not\(\[data-is-root-path='true'\]\) \.global-header \{[^}]*display: flex;/,
      'the stylesheet does not lay the header of an inside page out as one line',
    );
  });

  it('prints the menu once, in the header, on every kind of page (TASK-105 AC #2)', async () => {
    const cms = await site({
      author: 'Ada Lovelace',
      menus: { primary: [{ label: 'About', url: '/about/' }] },
    });
    await addUser(cms, 'ada', { displayName: 'Ada Lovelace' });

    // A post, a listing, an author archive and a 404: every shape of page the
    // theme draws, including the two that used to read the menu out of a bio.
    for (const pathname of [
      '/',
      '/2026/09/hello/',
      '/about/',
      '/tag/notes/',
      '/author/ada/',
      '/nothing-here/',
    ]) {
      const response = await cms.app.request(pathname);
      const html = await response.text();

      assert.equal(
        [...html.matchAll(/<nav class="site-nav" aria-label="Site"/g)].length,
        1,
        `${pathname} does not print the menu exactly once`,
      );
      assert.match(
        header(html),
        /<nav class="site-nav" aria-label="Site"/,
        `${pathname} prints the menu outside the header`,
      );
    }
  });
});

describe('the menus a theme renders by name (TASK-107)', () => {
  /** The `<nav>` an `aria-label` names, anywhere on the page. */
  function nav(html: string, label: string): string {
    const found = new RegExp(`<nav class="site-nav" aria-label="${label}">([\\s\\S]*?)</nav>`).exec(
      html,
    );
    return found?.[1] ?? '';
  }

  it('renders menus.primary and menus.footer, each in its own place (AC #4)', async () => {
    const cms = await site({
      menus: {
        primary: [
          { label: 'Home', url: '/' },
          { label: 'About', url: '/about/' },
        ],
        footer: [
          { label: 'Colophon', url: '/colophon/' },
          { label: 'Sources', url: '/sources/' },
        ],
      },
    });

    const html = await body(cms, '/about/');

    assert.deepEqual(
      [...nav(html, 'Site').matchAll(/>([^<]+)<\/a>/g)].map((match) => match[1]),
      ['Home', 'About'],
      'the site menu is not menus.primary',
    );
    assert.deepEqual(
      [...nav(html, 'Footer').matchAll(/>([^<]+)<\/a>/g)].map((match) => match[1]),
      ['Colophon', 'Sources'],
      'the footer menu is not menus.footer',
    );
  });

  it('marks the current item of whichever menu holds this page (AC #5)', async () => {
    const cms = await site({
      menus: {
        primary: [{ label: 'Home', url: '/' }],
        footer: [
          { label: 'About', url: '/about/' },
          { label: 'Elsewhere', url: 'https://example.org/' },
        ],
      },
    });

    const printed = nav(await body(cms, '/about/'), 'Footer');

    assert.match(
      printed,
      /<a href="\/about\/" class="is-current" aria-current="page">About<\/a>/,
      'the footer menu does not know which page this is',
    );
    assert.match(
      printed,
      /<a href="https:\/\/example\.org\/">Elsewhere<\/a>/,
      'a link off the site is never the current page',
    );
  });

  it('gives an item marked me a rel="me" and an unmarked one none (AC #2)', async () => {
    const cms = await site({
      menus: {
        footer: [
          { label: 'Mastodon', url: 'https://example.social/@ada', me: true },
          { label: 'Colophon', url: '/colophon/' },
        ],
      },
    });

    const printed = nav(await body(cms, '/about/'), 'Footer');

    assert.match(printed, /<a href="https:\/\/example\.social\/@ada" rel="me">Mastodon<\/a>/);
    assert.match(printed, /<a href="\/colophon\/">Colophon<\/a>/);
    assert.equal([...printed.matchAll(/rel="me"/g)].length, 1, 'only the marked item carries it');
  });

  it('keeps a menu whose name no theme declares, and renders it nowhere (AC #6)', async () => {
    const { cms, contentDir } = await siteWithContent({
      menus: {
        primary: [{ label: 'Home', url: '/' }],
        sidebar: [{ label: 'Blogroll', url: '/blogroll/' }],
      },
    });

    for (const pathname of ['/', '/about/', '/2026/09/hello/']) {
      assert.doesNotMatch(
        await body(cms, pathname),
        /Blogroll/,
        `${pathname} rendered a menu the theme declares no area for`,
      );
    }

    const stored: unknown = JSON.parse(
      await readFile(path.join(contentDir, '_data', 'site.json'), 'utf8'),
    );
    assert.deepEqual((stored as { menus: Record<string, unknown> }).menus['sidebar'], [
      { label: 'Blogroll', url: '/blogroll/' },
    ]);
  });

  it('reads no menu at all out of the navigation key TASK-106 left behind (AC #7)', async () => {
    const cms = await site({ navigation: [{ label: 'Anachronism', url: '/old/' }] });

    assert.doesNotMatch(await body(cms, '/about/'), /Anachronism/);
  });
});

describe('the footer (AC #2, TASK-105)', () => {
  it('prints the year, the site author and the colophon', async () => {
    const printed = footer(await body(await site({ author: 'Ada Lovelace' }), '/'));

    assert.match(printed, new RegExp(`&copy; ${YEAR}, Ada Lovelace`), 'no copyright line');
    assert.match(printed, /Published with[\s\S]*Geekity/, 'no colophon');
  });

  it('prints menus.footer on every page and nothing off an account (TASK-105 AC #4)', async () => {
    // The footer used to print an RSS link and one `rel="me"` link per entry
    // of `siteAuthor.links` — one nominated user's profile presented as the
    // site's. The footer menu replaces both: a site that wants its feed in
    // the footer types a line for it, the same way it types anything else.
    const cms = await site({
      author: 'Ada Lovelace',
      menus: {
        footer: [
          { label: 'RSS', url: '/feed/' },
          { label: 'Colophon', url: '/colophon/' },
        ],
      },
    });
    await addUser(cms, 'ada', {
      displayName: 'Ada Lovelace',
      links: [
        { label: 'Mastodon', href: 'https://example.social/@ada' },
        { label: 'GitHub', href: 'https://github.example/ada' },
      ],
    });

    for (const pathname of ['/', '/about/', '/2026/09/hello/', '/tag/notes/', '/author/ada/']) {
      const printed = footer(await body(cms, pathname));

      assert.match(
        printed,
        /<nav class="site-nav" aria-label="Footer">[\s\S]*<a href="\/feed\/">RSS<\/a>[\s\S]*<a href="\/colophon\/">Colophon<\/a>/,
        `${pathname} does not print the footer menu`,
      );
      assert.doesNotMatch(
        printed,
        /example\.social|github\.example|rel="me"/,
        `${pathname} prints the site author’s own links as the site’s`,
      );
    }
  });

  it('prints no list for an empty or missing footer menu (TASK-105 AC #5)', async () => {
    for (const menus of [{}, { footer: [] }, { primary: [{ label: 'Home', url: '/' }] }]) {
      const printed = footer(await body(await site({ author: 'Joe Blog', menus }), '/'));

      assert.doesNotMatch(printed, /<nav|<ul/, `${JSON.stringify(menus)} left an empty list`);
      assert.match(
        printed,
        new RegExp(`&copy; ${YEAR}, Joe Blog`),
        'the copyright line went with it',
      );
    }
  });

  it('still has a footer when the site author is nobody this site has', async () => {
    // What the demo does: `site.json` names an author no user answers to, so
    // `siteAuthor` is absent. Nothing in the footer reads it either way.
    const printed = footer(await body(await site({ author: 'Joe Blog' }), '/'));

    assert.match(
      printed,
      new RegExp(`&copy; ${YEAR}, Joe Blog`),
      'the name in the setting is still printed',
    );
    assert.doesNotMatch(printed, /rel="me"/, 'a name with no profile behind it has no links');
  });
});

describe('the head (AC #5)', () => {
  it('still carries the canonical, the feeds, the comments feed and webmention', async () => {
    const cms = await site({ url: 'https://example.com' });
    const html = await body(cms, '/2026/09/hello/');

    for (const marker of [
      '<link rel="canonical" href="https://example.com/2026/09/hello/">',
      'type="application/rss+xml"',
      'type="application/atom+xml"',
      'type="application/feed+json"',
      '/comments/feed/',
      'title="Comments on: Hello" href="/2026/09/hello/feed/"',
      'type="application/activity+json"',
      'rel="webmention"',
      '<link rel="stylesheet" href="/theme/style.css">',
    ]) {
      assert.ok(html.includes(marker), `the head lost ${marker}`);
    }
  });
});

describe('the description, Open Graph and Twitter card tags (TASK-81 AC #1)', () => {
  it('describes an entry by its own description, else its summary', async () => {
    const cms = await site();

    const post = await body(cms, '/2026/09/hello/');
    assert.equal(metaContent(post, 'description'), 'Body.', 'a post falls back to its summary');
    assert.equal(metaContent(post, 'og:description'), 'Body.');
    assert.equal(metaContent(post, 'twitter:description'), 'Body.');

    const page = await body(cms, '/about/');
    assert.equal(
      metaContent(page, 'description'),
      'What this site is about.',
      'the description in the front matter did not win',
    );

    assert.equal(
      [...post.matchAll(/<meta name="description"/g)].length,
      1,
      'the page describes itself twice',
    );
  });

  it('describes a page that is not an entry by the tagline', async () => {
    const cms = await site();

    for (const pathname of ['/', '/tag/notes/']) {
      assert.equal(
        metaContent(await body(cms, pathname), 'description'),
        'Words about words',
        `${pathname} is not described by the tagline`,
      );
    }

    const missing = await cms.app.request('/nothing-here/');
    assert.equal(missing.status, 404);
    assert.equal(metaContent(await missing.text(), 'description'), 'Words about words');
  });

  it('cards a post as an article and a listing as a website', async () => {
    const cms = await siteWearingAnAvatar({ url: 'https://example.com' });

    const post = await body(cms, '/2026/09/hello/');
    assert.equal(metaContent(post, 'og:title'), 'Hello');
    assert.equal(metaContent(post, 'og:url'), 'https://example.com/2026/09/hello/');
    assert.equal(metaContent(post, 'og:type'), 'article');
    assert.equal(metaContent(post, 'og:site_name'), 'A Site');
    assert.equal(metaContent(post, 'og:image'), `https://example.com${AVATAR}`);
    assert.equal(metaContent(post, 'twitter:card'), 'summary');
    assert.equal(metaContent(post, 'twitter:title'), 'Hello');
    assert.equal(metaContent(post, 'twitter:image'), `https://example.com${AVATAR}`);

    assert.equal(
      metaContent(await body(cms, '/about/'), 'og:type'),
      'article',
      'a page is one too',
    );

    // A listing is a website, and its og:title is what the page is called:
    // the site on the front page, the term on an archive.
    for (const [pathname, called] of [
      ['/', 'A Site'],
      ['/tag/notes/', 'notes'],
    ] as const) {
      const html = await body(cms, pathname);
      assert.equal(metaContent(html, 'og:type'), 'website', `${pathname} claims to be an article`);
      assert.equal(metaContent(html, 'og:title'), called, `${pathname} has the wrong og:title`);
    }

    assert.equal(metaContent(await body(cms, '/'), 'og:url'), 'https://example.com/');
  });

  it('prefers the entry’s own image to the site avatar', async () => {
    const cms = await siteWearingAnAvatar({ url: 'https://example.com' });
    const html = await body(cms, '/2026/09/photo/');

    assert.equal(metaContent(html, 'og:image'), 'https://example.com/uploads/2026/09/hero.png');
    assert.equal(
      metaContent(html, 'twitter:image'),
      'https://example.com/uploads/2026/09/hero.png',
    );
  });

  it('leaves the image out when the site has no avatar and the entry no picture', async () => {
    const html = await body(await site({ url: 'https://example.com' }), '/2026/09/hello/');

    assert.equal(metaContent(html, 'og:image'), undefined, 'an image was invented');
    assert.equal(metaContent(html, 'twitter:image'), undefined);
    assert.equal(metaContent(html, 'twitter:card'), 'summary', 'and the card is still a summary');
  });
});

describe('the icons (TASK-81 AC #2)', () => {
  it('links three square icons derived from the site avatar', async () => {
    const cms = await siteWearingAnAvatar();
    const icons = links(await body(cms, '/')).filter((link) => link.rel.includes('icon'));

    assert.deepEqual(
      icons.map((icon) => `${icon.rel} ${icon.sizes}`),
      ['icon 32x32', 'icon 16x16', 'apple-touch-icon 180x180'],
      'the head does not link the three icons the design wants',
    );

    for (const icon of icons) {
      assert.equal(icon.type, 'image/png', `${icon.href} is not announced as a PNG`);

      const response = await cms.app.request(icon.href);
      assert.equal(response.status, 200, `GET ${icon.href} answered ${String(response.status)}`);
      assert.equal(response.headers.get('content-type'), 'image/png');

      const size = Number(icon.sizes.split('x')[0]);
      const derived = await sharp(Buffer.from(await response.arrayBuffer())).metadata();
      assert.deepEqual(
        { width: derived.width, height: derived.height, format: derived.format },
        { width: size, height: size, format: 'png' },
        `${icon.href} is not ${icon.sizes}`,
      );
    }
  });

  it('links no icon at all when the site has no avatar', async () => {
    const cms = await site();

    for (const pathname of ['/', '/about/', '/2026/09/hello/']) {
      const html = await body(cms, pathname);
      assert.equal(
        links(html).filter((link) => link.rel.includes('icon')).length,
        0,
        `${pathname} links an icon the site has nothing to derive`,
      );
    }
  });

  it('serves every link in the head of a site without an avatar', async () => {
    // The demo's case, and the one that would 404 quietly: a head full of
    // links to files nobody has uploaded.
    const cms = await site();

    for (const link of links(await body(cms, '/2026/09/hello/'))) {
      if (!link.href.startsWith('/') || link.rel === 'webmention') continue;
      const response = await cms.app.request(link.href);
      assert.notEqual(response.status, 404, `${link.rel} ${link.href} is not there`);
    }
  });
});

describe('the JSON-LD graph (TASK-81 AC #3)', () => {
  /** A site whose `author` setting names a user with a whole profile. */
  async function siteOfAda(settings: Record<string, unknown> = {}): Promise<Cms> {
    const cms = await siteWearingAnAvatar({
      url: 'https://example.com',
      author: 'ada',
      ...settings,
    });
    await addUser(cms, 'ada', {
      displayName: 'Ada Lovelace',
      bio: 'Writes about engines.',
      avatar: '/uploads/2026/09/ada.png',
      jobTitle: 'Analyst',
      location: 'London',
      links: [{ label: 'Mastodon', href: 'https://example.social/@ada' }],
    });
    return cms;
  }

  it('prints one WebSite and one Person on every page', async () => {
    const cms = await siteOfAda();

    for (const pathname of ['/', '/about/', '/2026/09/hello/', '/tag/notes/']) {
      const nodes = graph(await body(cms, pathname));

      const website = node(nodes, 'WebSite');
      assert.ok(website !== undefined, `${pathname} has no WebSite`);
      assert.equal(website['@id'], 'https://example.com/#website');
      assert.equal(website['url'], 'https://example.com/');
      assert.equal(website['name'], 'A Site');
      assert.equal(website['description'], 'Words about words');

      const person = node(nodes, 'Person');
      assert.ok(person !== undefined, `${pathname} has no Person`);
      assert.equal(person['@id'], 'https://example.com/author/ada/#person');
      assert.equal(person['name'], 'Ada Lovelace');
      assert.equal(person['url'], 'https://example.com/author/ada/');
      assert.equal(person['image'], 'https://example.com/uploads/2026/09/ada.png');
      assert.equal(person['description'], 'Writes about engines.');
      assert.equal(person['jobTitle'], 'Analyst');
      assert.deepEqual(person['address'], {
        '@type': 'PostalAddress',
        addressLocality: 'London',
      });
      assert.deepEqual(person['sameAs'], [
        'https://example.social/@ada',
        'https://example.com/author/ada/',
      ]);

      assert.deepEqual(website['publisher'], { '@id': person['@id'] });
    }
  });

  it('adds a ProfilePage on an author archive', async () => {
    const cms = await siteOfAda();
    const nodes = graph(await body(cms, '/author/ada/'));

    const profile = node(nodes, 'ProfilePage');
    assert.ok(profile !== undefined, 'the author archive has no ProfilePage');
    assert.equal(profile['@id'], 'https://example.com/author/ada/#profilepage');
    assert.equal(profile['url'], 'https://example.com/author/ada/');
    assert.equal(profile['name'], 'Ada Lovelace');
    assert.deepEqual(profile['mainEntity'], { '@id': 'https://example.com/author/ada/#person' });

    for (const pathname of ['/', '/2026/09/hello/']) {
      assert.equal(
        node(graph(await body(cms, pathname)), 'ProfilePage'),
        undefined,
        `${pathname} has a ProfilePage`,
      );
    }
  });

  it('adds a BlogPosting on a post and an Article on a page', async () => {
    const cms = await siteOfAda();

    const posting = node(graph(await body(cms, '/2026/09/hello/')), 'BlogPosting');
    assert.ok(posting !== undefined, 'the post has no BlogPosting');
    assert.equal(posting['headline'], 'Hello');
    assert.equal(posting['url'], 'https://example.com/2026/09/hello/');
    assert.equal(posting['mainEntityOfPage'], 'https://example.com/2026/09/hello/');
    assert.equal(posting['datePublished'], '2026-09-02T09:00:00.000Z');
    assert.equal(posting['dateModified'], '2026-09-05T09:00:00.000Z');
    assert.equal(posting['description'], 'Body.');
    assert.equal(posting['image'], `https://example.com${AVATAR}`);
    assert.deepEqual(posting['author'], { '@id': 'https://example.com/author/ada/#person' });
    assert.deepEqual(posting['publisher'], { '@id': 'https://example.com/author/ada/#person' });

    const article = node(graph(await body(cms, '/about/')), 'Article');
    assert.ok(article !== undefined, 'the page has no Article');
    assert.equal(article['headline'], 'About');
    assert.equal(article['url'], 'https://example.com/about/');
    assert.equal(article['description'], 'What this site is about.');

    assert.equal(
      node(graph(await body(cms, '/tag/notes/')), 'BlogPosting'),
      undefined,
      'a listing prints an entry',
    );
  });

  it('leaves the Person and every reference to it out when nobody matches', async () => {
    // The demo's case: `site.json` names an author no user answers to.
    const nodes = graph(await body(await site({ author: 'Joe Blog' }), '/2026/09/hello/'));

    assert.equal(node(nodes, 'Person'), undefined, 'a Person was invented');

    const website = node(nodes, 'WebSite');
    assert.ok(website !== undefined);
    assert.equal(website['publisher'], undefined, 'the WebSite is published by nobody');

    const posting = node(nodes, 'BlogPosting');
    assert.ok(posting !== undefined, 'the post lost its BlogPosting with its author');
    assert.equal(posting['author'], undefined);
    assert.equal(posting['publisher'], undefined);
  });

  it('keeps printing JSON when the words in it could close the script', async () => {
    const cms = await site({ title: 'A </script><script>alert(1)</script> Site' });
    const html = await body(cms, '/2026/09/hello/');

    const website = node(graph(html), 'WebSite');
    assert.ok(website !== undefined);
    assert.equal(website['name'], 'A </script><script>alert(1)</script> Site');
  });
});

describe('structured data is JSON-LD and nothing else (TASK-81 AC #4)', () => {
  it('has no Microdata in any packaged template', async () => {
    const root = fileURLToPath(new URL('../..', import.meta.url));
    const templates: string[] = [];

    async function walk(dir: string): Promise<void> {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) await walk(file);
        else if (entry.name.endsWith('.njk')) templates.push(file);
      }
    }

    for (const dir of ['themes', 'admin', 'templates']) await walk(path.join(root, dir));
    assert.ok(templates.length > 20, 'the walk found hardly any templates');

    for (const file of templates) {
      const source = await readFile(file, 'utf8');
      assert.doesNotMatch(
        source,
        /itemscope|itemtype|itemprop/,
        `${path.relative(root, file)} still carries Microdata`,
      );
    }
  });
});

describe('a site theme replaces the graph (TASK-81 AC #5)', () => {
  it('renders its own partials/jsonld.njk instead of the packaged one', async () => {
    const themesDir = await box.dir('geekity-shell-themes-');
    await writeTree(path.join(themesDir, 'mine'), {
      'theme.json': JSON.stringify({ name: 'Mine', kind: 'site' }),
      'partials/jsonld.njk':
        '<script type="application/ld+json">{"@context": "https://schema.org", "@graph": [{"@type": "WebPage", "name": {{ site.title | dump | safe }}}]}</script>',
    });

    const cms = await site({ theme: 'mine' }, { themesDir });
    const nodes = graph(await body(cms, '/2026/09/hello/'));

    assert.deepEqual(nodes, [{ '@type': 'WebPage', name: 'A Site' }]);
  });
});

describe('the code highlighter in the shell (TASK-86 AC #2)', () => {
  /** Every `<script>` on a page, as `{ src, type }`. */
  function scripts(html: string): { src: string; type: string }[] {
    return [...html.matchAll(/<script\b([^>]*)>/g)].map((match) => {
      const attributes = match[1] ?? '';
      const value = (name: string): string =>
        new RegExp(`${name}="([^"]*)"`).exec(attributes)?.[1] ?? '';
      return { src: value('src'), type: value('type') };
    });
  }

  it('loads the highlighter, deferred, on a page that has a code block', async () => {
    const html = await body(await site(), '/code/');

    assert.match(
      html,
      /<script src="\/theme\/highlight\.js" defer><\/script>/,
      'the page with code on it loads no highlighter',
    );
    assert.match(html, /<pre tabindex="0"><code class="language-js">/, 'nothing to highlight');

    // At the end of the body, after the content it is going to work on.
    assert.ok(
      html.indexOf('highlight.js') > html.indexOf('</main>'),
      'the highlighter is not at the end of the body',
    );
  });

  it('ships no JavaScript at all on a page without one', async () => {
    const cms = await site();

    for (const pathname of ['/', '/about/', '/2026/09/hello/', '/tag/notes/']) {
      const other = scripts(await body(cms, pathname)).filter(
        (script) => script.type !== 'application/ld+json',
      );
      assert.deepEqual(other, [], `${pathname} ships JavaScript and has no code on it`);
    }
  });

  it('serves the bundle the script tag points at', async () => {
    const cms = await site();
    const response = await cms.app.request('/theme/highlight.js');

    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /text\/javascript/);
    assert.match(await response.text(), /hljs/);
  });

  it('lets a site theme drop it by overriding the scripts block', async () => {
    const themesDir = await box.dir('geekity-shell-themes-');
    await writeTree(path.join(themesDir, 'quiet'), {
      'theme.json': JSON.stringify({ name: 'Quiet', kind: 'site' }),
      'layouts/page.njk':
        '{% extends "layouts/base.njk" %}\n' +
        '{% block content %}{{ content | safe }}{% endblock %}\n' +
        '{% block scripts %}{% endblock %}\n',
    });

    const cms = await site({ theme: 'quiet' }, { themesDir });
    assert.doesNotMatch(await body(cms, '/code/'), /highlight\.js/);
  });
});
