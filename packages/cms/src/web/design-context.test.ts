/**
 * The four things the andrewshell.org design reads that the context did not
 * carry (decision-16, TASK-79): `siteAuthor` on every page, `summary` on every
 * listing entry, `previous` and `next` on a post, and `recentPosts` on the
 * front page.
 *
 * Everything here goes through HTTP and through a theme that prints the keys,
 * because the question is not what a function returned — it is what a template
 * is handed on the page the site actually serves.
 */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { createUser, setUserProfile } from '../admin/accounts.ts';
import { sandbox } from '../admin/__testing__/harness.ts';
import type { Cms, GeekityConfig } from '../index.ts';

const box = sandbox();
after(() => box.cleanup());

/** What the site's clock says while these tests run: mid-September 2026. */
const NOW = '2026-09-13T12:00:00Z';

/** Write a tree of files, relative paths to contents, under `root`. */
async function writeTree(root: string, files: Record<string, string>): Promise<void> {
  for (const [relative, contents] of Object.entries(files)) {
    const file = path.join(root, ...relative.split('/'));
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, contents, 'utf8');
  }
}

/**
 * A theme that prints the context rather than a page.
 *
 * One partial does the keys every layout carries, so a test asking "is
 * siteAuthor on the 404 too" reads the same markup as the one asking about a
 * post. `'key' in entry` is how the empty string a post with nothing to
 * summarise gets is told apart from a key that is not there at all.
 */
function probeTheme(): Record<string, string> {
  const probe = [
    '<p class="site-author">',
    '{% if siteAuthor %}{{ siteAuthor.name }}|{{ siteAuthor.username }}',
    '|{{ siteAuthor.jobTitle }}|{{ siteAuthor.location }}{% else %}nobody{% endif %}',
    '</p>',
    '<p class="recent-posts">{% if recentPosts %}',
    '{% for entry in recentPosts %}[{{ entry.title }}|{{ entry.url }}|{{ entry.summary }}]{% endfor %}',
    '{% else %}none{% endif %}</p>',
  ].join('');
  const list = [
    '<ul class="entries">',
    '{% for entry in posts %}',
    '<li data-has-summary="{{ \'summary\' in entry }}">{{ entry.title }}|{{ entry.summary }}</li>',
    '{% endfor %}',
    '</ul>',
  ].join('');

  const listing = `<!doctype html><title>{{ title }}</title>{% include "partials/probe.njk" %}${list}`;

  return {
    'theme.json': JSON.stringify({ name: 'Probe', kind: 'site' }),
    'partials/probe.njk': probe,
    'layouts/post.njk': [
      '<!doctype html><title>{{ title }}</title>',
      '{% include "partials/probe.njk" %}',
      '<p class="summary">{{ summary }}</p>',
      '<p class="previous">{% if previous %}{{ previous.title }}|{{ previous.url }}',
      '{% else %}none{% endif %}</p>',
      '<p class="next">{% if next %}{{ next.title }}|{{ next.url }}{% else %}none{% endif %}</p>',
    ].join(''),
    'layouts/page.njk': [
      '<!doctype html><title>{{ title }}</title>',
      '{% include "partials/probe.njk" %}',
      '<p class="summary">{{ summary }}</p>',
    ].join(''),
    'layouts/front-page.njk': [
      '<!doctype html><title>{{ title }}</title>',
      '{% include "partials/probe.njk" %}',
      '<p class="front">the front page</p>',
    ].join(''),
    'layouts/home.njk': listing,
    'layouts/tag.njk': listing,
    'layouts/category.njk': listing,
    'layouts/author.njk': listing,
    'layouts/404.njk': `<!doctype html><title>Not found</title>{% include "partials/probe.njk" %}`,
  };
}

/** A post file. */
function post(
  title: string,
  slug: string,
  date: string,
  front: Record<string, string | boolean> = {},
  body = `Body of ${slug}.`,
): string {
  const extra = Object.entries(front)
    .map(([key, value]) => `${key}: ${typeof value === 'string' ? value : String(value)}\n`)
    .join('');
  return `---\ntitle: ${title}\ndate: '${date}'\npermalink: /posts/${slug}/\n${extra}---\n\n${body}\n`;
}

/** A page file. */
function page(title: string, slug: string): string {
  return `---\ntitle: ${title}\npermalink: /${slug}/\n---\n\nThe ${slug} page.\n`;
}

/** The archive these tests read: four published posts, a draft and one still to come. */
const CONTENT: Record<string, string> = {
  'posts/alpha.md': post('Alpha', 'alpha', '2026-09-10T09:00:00Z', {
    description: 'What Alpha is about.',
  }),
  'posts/beta.md': post(
    'Beta',
    'beta',
    '2026-09-05T09:00:00Z',
    { author: 'Ada Lovelace' },
    'Beta has a body and no description.',
  ),
  'posts/gamma.md': post('Gamma', 'gamma', '2026-08-20T09:00:00Z', { tags: '[shared]' }),
  'posts/delta.md': post('Delta', 'delta', '2026-07-15T09:00:00Z', { tags: '[shared]' }, ''),
  'posts/drafted.md': post('Drafted', 'drafted', '2026-09-11T09:00:00Z', { draft: true }),
  'posts/later.md': post('Later', 'later', '2026-12-01T09:00:00Z'),
  'pages/about.md': page('About', 'about'),
};

/** A CMS over `files`, wearing the probe theme, with whatever `site.json` says. */
async function site(
  settings: Record<string, unknown> = {},
  files: Record<string, string> = CONTENT,
  config: GeekityConfig = {},
): Promise<Cms> {
  const contentDir = await box.dir('geekity-design-content-');
  const dataDir = await box.dir('geekity-design-data-');
  const themesDir = await box.dir('geekity-design-themes-');

  await writeTree(path.join(themesDir, 'probe'), probeTheme());
  await writeTree(contentDir, {
    ...files,
    '_data/site.json': JSON.stringify({ title: 'A Site', theme: 'probe', ...settings }, null, 2),
  });

  return await box.open({
    contentDir,
    dataDir,
    themesDir,
    now: () => new Date(NOW),
    ...config,
  });
}

/** Give the site a user with a profile, the way the users screen would. */
async function addUser(cms: Cms, username: string, profile: Record<string, string>): Promise<void> {
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

/** What the probe printed for `siteAuthor` on a page. */
function siteAuthorOf(html: string): string {
  return /<p class="site-author">([\s\S]*?)<\/p>/.exec(html)?.[1] ?? '';
}

/** What the probe printed for one class of element. */
function printed(html: string, className: string): string {
  return new RegExp(`<p class="${className}">([\\s\\S]*?)</p>`).exec(html)?.[1] ?? '';
}

/** Every listing entry the probe printed, as `title|summary`. */
function entries(html: string): string[] {
  return [...html.matchAll(/<li data-has-summary="(\w+)">([\s\S]*?)<\/li>/g)].map(
    (match) => `${match[1] ?? ''}:${match[2] ?? ''}`,
  );
}

describe('siteAuthor, on every page (AC #1)', () => {
  it('is the profile behind the site author setting wherever the site is read', async () => {
    const cms = await site({ author: 'Ada Lovelace' });
    await addUser(cms, 'ada', {
      displayName: 'Ada Lovelace',
      jobTitle: 'Analyst',
      location: 'London',
    });

    for (const pathname of ['/', '/about/', '/posts/alpha/', '/tag/shared/']) {
      assert.equal(
        siteAuthorOf(await body(cms, pathname)),
        'Ada Lovelace|ada|Analyst|London',
        `on ${pathname}`,
      );
    }

    const missing = await cms.app.request('/nothing-here/');
    assert.equal(missing.status, 404);
    assert.equal(
      siteAuthorOf(await missing.text()),
      'Ada Lovelace|ada|Analyst|London',
      'and on the 404',
    );
  });

  it('is the entry’s own author on a post that names somebody else', async () => {
    const cms = await site({ author: 'grace' });
    await addUser(cms, 'grace', { displayName: 'Grace Hopper', jobTitle: 'Rear Admiral' });
    await addUser(cms, 'ada', { displayName: 'Ada Lovelace', location: 'London' });

    assert.equal(
      siteAuthorOf(await body(cms, '/posts/beta/')),
      'Ada Lovelace|ada||London',
      'the post Ada wrote is Ada’s page',
    );
    assert.equal(
      siteAuthorOf(await body(cms, '/posts/alpha/')),
      'Grace Hopper|grace|Rear Admiral|',
      'and a post naming nobody is the site’s own',
    );
  });

  it('is the archive’s user on an author archive', async () => {
    const cms = await site({ author: 'grace' });
    await addUser(cms, 'grace', { displayName: 'Grace Hopper' });
    await addUser(cms, 'ada', { displayName: 'Ada Lovelace', jobTitle: 'Analyst' });

    assert.equal(siteAuthorOf(await body(cms, '/author/ada/')), 'Ada Lovelace|ada|Analyst|');
  });

  it('is absent altogether when the setting names nobody this site has', async () => {
    const cms = await site({ author: 'Joe Blog' });

    assert.equal(siteAuthorOf(await body(cms, '/')), 'nobody');
    assert.equal(siteAuthorOf(await body(cms, '/posts/alpha/')), 'nobody');
  });

  it('is absent when the site names no author at all', async () => {
    const cms = await site();
    await addUser(cms, 'ada', { displayName: 'Ada Lovelace' });

    assert.equal(siteAuthorOf(await body(cms, '/')), 'nobody');
  });
});

describe('summary, on every listing entry (AC #2)', () => {
  it('is the description the author wrote, else the excerpt the feeds print', async () => {
    const cms = await site();

    assert.deepEqual(entries(await body(cms, '/')), [
      'true:Alpha|What Alpha is about.',
      'true:Beta|Beta has a body and no description.',
      'true:Gamma|Body of gamma.',
      'true:Delta|',
    ]);

    const feed = await (await cms.app.request('/feed/')).text();
    assert.ok(
      feed.includes('Beta has a body and no description.'),
      'the same string the feed carries',
    );
  });

  it('is an empty string rather than a missing key for a post with neither', async () => {
    const cms = await site();

    const listed = entries(await body(cms, '/'));
    assert.ok(
      listed.includes('true:Delta|'),
      'a post with no description and no body still carries the key',
    );
  });

  it('is on the entries of a taxonomy archive and an author archive too', async () => {
    const cms = await site();
    await addUser(cms, 'ada', { displayName: 'Ada Lovelace' });

    assert.deepEqual(entries(await body(cms, '/tag/shared/')), [
      'true:Gamma|Body of gamma.',
      'true:Delta|',
    ]);
    assert.deepEqual(entries(await body(cms, '/author/ada/')), [
      'true:Beta|Beta has a body and no description.',
    ]);
  });

  it('is on a rendered post as well, so a head can print it', async () => {
    const cms = await site();

    assert.equal(printed(await body(cms, '/posts/alpha/'), 'summary'), 'What Alpha is about.');
  });
});

describe('previous and next, on a post (AC #3)', () => {
  it('link the published posts either side of one by date', async () => {
    const cms = await site();
    const html = await body(cms, '/posts/beta/');

    assert.equal(printed(html, 'previous'), 'Gamma|/posts/gamma/', 'the older post');
    assert.equal(printed(html, 'next'), 'Alpha|/posts/alpha/', 'the newer post');
  });

  it('are absent at the ends of the archive rather than wrapping round', async () => {
    const cms = await site();

    const newest = await body(cms, '/posts/alpha/');
    assert.equal(printed(newest, 'next'), 'none');
    assert.equal(printed(newest, 'previous'), 'Beta|/posts/beta/');

    const oldest = await body(cms, '/posts/delta/');
    assert.equal(printed(oldest, 'previous'), 'none');
    assert.equal(printed(oldest, 'next'), 'Gamma|/posts/gamma/');
  });

  it('never name a draft or a post whose date has not arrived', async () => {
    const cms = await site();

    // `Drafted` is dated after Alpha and `Later` after that; neither is a page
    // a reader could open, so neither is a link.
    const newest = await body(cms, '/posts/alpha/');
    assert.doesNotMatch(newest, /Drafted|Later/);
  });
});

describe('recentPosts, on the front page (AC #4)', () => {
  /** A page at `/`, and the archive under `/posts-page/`. */
  const READING = { homepage: 'about', postsPage: 'archive' };

  /** The content above plus the page the listing moves to. */
  const WITH_ARCHIVE = { ...CONTENT, 'pages/archive.md': page('Archive', 'archive') };

  it('is the five newest posts when the current month holds fewer than five', async () => {
    const cms = await site(READING, WITH_ARCHIVE);

    // September has two; the rule falls back to the newest five, and this
    // archive has four altogether.
    assert.equal(
      printed(await body(cms, '/'), 'recent-posts'),
      '[Alpha|/posts/alpha/|What Alpha is about.]' +
        '[Beta|/posts/beta/|Beta has a body and no description.]' +
        '[Gamma|/posts/gamma/|Body of gamma.]' +
        '[Delta|/posts/delta/|]',
    );
  });

  it('is the whole of the current month once the month holds five', async () => {
    const monthly: Record<string, string> = { ...WITH_ARCHIVE };
    for (const day of ['01', '02', '03', '04']) {
      monthly[`posts/sept-${day}.md`] = post(
        `Sept ${day}`,
        `sept-${day}`,
        `2026-09-${day}T09:00:00Z`,
      );
    }
    const cms = await site(READING, monthly);

    const recent = printed(await body(cms, '/'), 'recent-posts');
    const titles = [...recent.matchAll(/\[([^|]+)\|/g)].map((match) => match[1]);
    assert.deepEqual(
      titles,
      ['Alpha', 'Beta', 'Sept 04', 'Sept 03', 'Sept 02', 'Sept 01'],
      'every September post, and none from August',
    );
  });

  it('is not on the listing, which still pages the whole archive', async () => {
    const cms = await site({ ...READING, postsPerPage: 2 }, WITH_ARCHIVE);

    const listing = await body(cms, '/archive/');
    assert.equal(printed(listing, 'recent-posts'), 'none', 'the listing has no recent posts');
    assert.deepEqual(entries(listing), [
      'true:Alpha|What Alpha is about.',
      'true:Beta|Beta has a body and no description.',
    ]);
    assert.deepEqual(entries(await body(cms, '/archive/page/2/')), [
      'true:Gamma|Body of gamma.',
      'true:Delta|',
    ]);
  });

  it('is on the front page only, and not on an ordinary page', async () => {
    const cms = await site(READING, WITH_ARCHIVE);

    assert.equal(printed(await body(cms, '/posts/alpha/'), 'recent-posts'), 'none');
  });
});
