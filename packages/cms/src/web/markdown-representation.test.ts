import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { LOCATIONS, dataPath } from '../files/data-files.ts';
import { createCms } from '../index.ts';
import type { Cms } from '../index.ts';
import { setUserProfile } from '../site/users.ts';
import { createUser } from './__testing__/users.ts';

/**
 * A page's Markdown carries its place in the site: the front matter a Markdown
 * browser navigates by, links that stay in the Markdown web, and a header and
 * footer the theme draws.
 */

const started: Cms[] = [];
const temporaryDirs: string[] = [];

after(async () => {
  for (const instance of started) await instance.close();
  await Promise.all(temporaryDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

async function temporaryDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  temporaryDirs.push(dir);
  return dir;
}

async function writeTree(root: string, files: Record<string, string>): Promise<void> {
  for (const [relative, contents] of Object.entries(files)) {
    const file = path.join(root, relative);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, contents, 'utf8');
  }
}

function post(slug: string, day: string, body: string): string {
  return [
    '---',
    `title: Post ${slug}`,
    `date: '2026-09-${day}T09:00:00Z'`,
    `permalink: /2026/09/${slug}/`,
    'author: ada',
    ...(slug === 'two' ? ['redirect_from:', '  - /old-two/'] : []),
    '---',
    '',
    body,
    '',
  ].join('\n');
}

const MIDDLE_BODY = [
  'See [one](/2026/09/one/#part), [three](https://example.com/2026/09/three/) and',
  '[the old two](/old-two/), [by id](/?p=7), [about](../../../about/) and [home](/).',
  '',
  '![a photo](/2026/09/one/) and [elsewhere](https://elsewhere.example/2026/09/one/).',
  '',
  '`[code](/2026/09/one/)` and [a file](/uploads/file.pdf).',
].join('\n');

const SITE = {
  title: 'Field *Notes*',
  tagline: 'Notes from the field.',
  author: 'ada',
  postsPerPage: 2,
  menus: {
    primary: [
      { label: 'Home', url: '/' },
      { label: 'About [me]', url: '/about/' },
      { label: 'Search', url: '/search/' },
    ],
    footer: [{ label: 'Mastodon', url: 'https://mastodon.example/@ada', rel: 'me' }],
  },
};

const FILES: Record<string, string> = {
  'posts/2026-09-01-one.md': post('one', '01', 'The first.'),
  'posts/2026-09-02-two.md': post('two', '02', MIDDLE_BODY),
  'posts/2026-09-03-three.md': post('three', '03', 'The third.'),
  'pages/about.md': '---\ntitle: About\npermalink: /about/\n---\n\nWho writes this.\n',
  '_data/redirects.json': `${JSON.stringify([{ from: '/?p=7', to: '/2026/09/three/' }])}\n`,
};

async function site(
  options: {
    site?: Record<string, unknown>;
    files?: Record<string, string>;
    theme?: Record<string, string>;
    locations?: Record<string, unknown>;
  } = {},
): Promise<Cms> {
  const contentDir = await temporaryDir('geekity-md-content-');
  const dataDir = await temporaryDir('geekity-md-data-');
  const themesDir = await temporaryDir('geekity-md-themes-');
  await writeTree(contentDir, {
    ...FILES,
    ...options.files,
    '_data/site.json': `${JSON.stringify({ ...SITE, ...options.site }, null, 2)}\n`,
  });
  if (options.locations !== undefined) {
    await writeFile(dataPath(dataDir, LOCATIONS), JSON.stringify(options.locations), 'utf8');
  }
  if (options.theme !== undefined) {
    await writeTree(path.join(themesDir, 'mine'), {
      'theme.json': JSON.stringify({ name: 'mine', kind: 'site' }),
      ...options.theme,
    });
  }

  const ada = await createUser({ dataDir, username: 'ada', password: 'correct horse battery' });
  await setUserProfile({
    dataDir,
    userId: ada.id,
    profile: {
      displayName: 'Ada Lovelace',
      bio: 'Wrote the *first* program.',
      links: [{ label: 'Her notes', href: 'https://ada.example' }],
    },
  });

  const instance = createCms({
    contentDir,
    dataDir,
    themesDir,
    watch: false,
    baseUrl: 'https://example.com',
  });
  started.push(instance);
  await instance.sync();
  return instance;
}

async function markdown(cms: Cms, url: string): Promise<string> {
  const response = await cms.app.request(url);
  assert.equal(response.status, 200, `GET ${url} answered ${String(response.status)}`);
  return response.text();
}

function frontMatterOf(text: string): string {
  const end = text.indexOf('\n---\n', 4);
  return text.slice(4, end + 1);
}

function headerOf(text: string, body: string): string {
  const start = text.indexOf('\n---\n', 4) + 5;
  const end = body === '' ? text.indexOf('\n## ', start) : text.indexOf(`\n${body}\n`, start);
  return text.slice(start, end).trim();
}

const FOOTER = [
  '## Field \\*Notes\\*',
  '',
  '[Written by Ada Lovelace](/author/ada/index.md)',
  '',
  '- [Home](/index.md)',
  '- [About \\[me\\]](/about/index.md)',
  '- [Search](/search/index.md)',
  '- [Mastodon](https://mastodon.example/@ada)',
  '',
].join('\n');

describe('the front matter a Markdown browser navigates by (AC #1, #7)', () => {
  it('gives a post home, and previous and next as the HTML post navigation has them', async () => {
    const cms = await site();
    const html = await markdown(cms, '/2026/09/two/');
    assert.match(html, /href="\/2026\/09\/one\/"[^>]*>[\s\S]*?Post one/);

    assert.equal(
      frontMatterOf(await markdown(cms, '/2026/09/two/index.md')),
      [
        'title: Post two',
        "date: '2026-09-02T09:00:00Z'",
        'permalink: /2026/09/two/',
        'redirect_from:',
        '  - /old-two/',
        'author: Ada Lovelace',
        'author_username: ada',
        'home: /index.md',
        'previous: /2026/09/one/index.md',
        'next: /2026/09/three/index.md',
        '',
      ].join('\n'),
    );
  });

  it('leaves out a neighbour there is none of, and both on a page', async () => {
    const cms = await site();
    const first = frontMatterOf(await markdown(cms, '/2026/09/one/index.md'));
    assert.match(first, /^next: \/2026\/09\/two\/index\.md$/m);
    assert.doesNotMatch(first, /^previous:/m);

    const about = frontMatterOf(await markdown(cms, '/about/index.md'));
    assert.match(about, /^home: \/index\.md$/m);
    assert.doesNotMatch(about, /^(previous|next):/m);
  });

  it('gives a page of a listing its newer and older pages', async () => {
    const cms = await site();
    const second = frontMatterOf(await markdown(cms, '/page/2/index.md'));
    assert.equal(
      second,
      [
        'title: Field *Notes*',
        'permalink: /page/2/',
        'home: /index.md',
        'previous: /index.md',
        '',
      ].join('\n'),
    );
    const firstPage = frontMatterOf(await markdown(cms, '/index.md'));
    assert.match(firstPage, /^next: \/page\/2\/index\.md$/m);
    assert.doesNotMatch(firstPage, /^previous:/m);
  });
});

describe('links that stay in the Markdown web (AC #2)', () => {
  it('points every link to a document of the site at its Markdown, through redirects', async () => {
    const cms = await site();
    const text = await markdown(cms, '/2026/09/two/index.md');

    assert.match(
      text,
      new RegExp(
        [
          'See [one](/2026/09/one/index.md#part), [three](/2026/09/three/index.md) and',
          '[the old two](/2026/09/two/index.md), [by id](/2026/09/three/index.md), [about](/about/index.md) and [home](/index.md).',
          '',
          '![a photo](/2026/09/one/) and [elsewhere](https://elsewhere.example/2026/09/one/).',
          '',
          '`[code](/2026/09/one/)` and [a file](/uploads/file.pdf).',
        ]
          .join('\n')
          .replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
      ),
    );
  });

  it('links each listed post at its Markdown, root-relative', async () => {
    const cms = await site();
    assert.match(
      await markdown(cms, '/index.md'),
      /^- \[2026-09-03 Post three\]\(\/2026\/09\/three\/index\.md\)$/m,
    );
  });

  it('adds the suffix to llms.txt as it is written', async () => {
    const cms = await site();
    const text = await markdown(cms, '/llms.txt');
    assert.match(text, /^- \[About\]\(https:\/\/example\.com\/about\/index\.md\)$/m);
  });
});

describe('the header and footer the theme draws (AC #3, #4)', () => {
  it('ends a post with a heading, its byline and the site menus, each label literal', async () => {
    const cms = await site();
    const text = await markdown(cms, '/2026/09/two/index.md');
    assert.ok(text.endsWith(`\n\n${FOOTER}`), text);
  });

  it('gives a page no byline', async () => {
    const cms = await site();
    assert.doesNotMatch(await markdown(cms, '/about/index.md'), /Written by/);
  });

  it('takes either partial from a site theme, leaving front matter and body to the CMS', async () => {
    const cms = await site({
      site: { theme: 'mine' },
      theme: {
        'partials/markdown-header.md.njk': 'HEADER {{ title }}\n',
        'partials/markdown-footer.md.njk':
          '{% for item in navigation %}=> {{ item.url | markdownUrl }} {{ item.label }}\n{% endfor %}',
      },
    });
    const text = await markdown(cms, '/about/index.md');
    assert.equal(
      text,
      [
        '---',
        'title: About',
        'permalink: /about/',
        'home: /index.md',
        '---',
        '',
        'HEADER About',
        '',
        'Who writes this.',
        '',
        '=> /index.md Home',
        '=> /about/index.md About [me]',
        '=> /search/index.md Search',
        '=> https://mastodon.example/@ada Mastodon',
        '',
      ].join('\n'),
    );
  });
});

describe('the bio (AC #5)', () => {
  const BIO = ['Wrote the *first* program.', '', '- [Her notes](https://ada.example)'].join('\n');

  it('opens the author archive', async () => {
    const cms = await site();
    const text = await markdown(cms, '/author/ada/index.md');
    assert.ok(text.includes(`---\n\n# Ada Lovelace\n\n${BIO}\n\n## Posts`), text);
  });

  it("is on a solo author site's homepage that lists posts, as the HTML card is", async () => {
    const listing = await site();
    assert.ok((await markdown(listing, '/index.md')).includes(BIO));
  });

  it('is left out of a static homepage by the default theme, which prints only the page', async () => {
    const page = await site({ site: { homepage: 'about' } });
    const home = await markdown(page, '/index.md');
    assert.ok(home.includes('# About\n\nWho writes this.'), home);
    assert.doesNotMatch(home, /first\\\* program/, 'the bio is not printed');
  });

  it('is given to a site theme on a static homepage, which may print it', async () => {
    const page = await site({
      site: { homepage: 'about', theme: 'mine' },
      theme: {
        'partials/markdown-header.md.njk':
          '{% if staticFrontPage and bio %}{{ bio.note | escapeMarkdown }}\n\n{% endif %}',
      },
    });
    assert.ok((await markdown(page, '/index.md')).includes('Wrote the \\*first\\* program.'));
  });

  it('is nowhere on a site whose author is nobody', async () => {
    const cms = await site({ site: { author: '' } });
    assert.doesNotMatch(await markdown(cms, '/index.md'), /first/);
  });
});

describe('dated lists (AC #6)', () => {
  it('lists a listing’s and an archive’s posts as YYYY-MM-DD Title', async () => {
    const cms = await site();
    assert.match(
      await markdown(cms, '/author/ada/index.md'),
      /## Posts\n\n- \[2026-09-03 Post three\]\(\/2026\/09\/three\/index\.md\)\n- \[2026-09-02 Post two\]\(\/2026\/09\/two\/index\.md\)\n/,
    );
  });
});

describe('llms.txt navigation (AC #8)', () => {
  it('has a Navigation section with the site menus', async () => {
    const cms = await site();
    assert.match(
      await markdown(cms, '/llms.txt'),
      new RegExp(
        [
          '## Navigation',
          '',
          '- [Home](https://example.com/index.md)',
          '- [About \\[me\\]](https://example.com/about/index.md)',
          '- [Search](https://example.com/search/index.md)',
          '- [Mastodon](https://mastodon.example/@ada)',
        ]
          .join('\n')
          .replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
      ),
    );
  });
});

describe('an archive page (TASK-468)', () => {
  const ARCHIVE_FILES: Record<string, string> = {
    'pages/archive.md':
      '---\ntitle: Everything\npermalink: /archive/\narchive: true\n---\n\nEvery post.\n',
    'posts/2026-08-20-four.md': [
      '---',
      'title: Post *four*',
      "date: '2026-08-20T09:00:00Z'",
      'permalink: /2026/08/four/',
      'description: |-',
      '  A summer',
      '  note.',
      '---',
      '',
      'The fourth.',
      '',
    ].join('\n'),
    'posts/2026-09-04-drafted.md':
      "---\ntitle: Drafted\ndate: '2026-09-04T09:00:00Z'\npermalink: /2026/09/drafted/\ndraft: true\n---\n\nNot yet.\n",
  };

  const MONTHS = [
    '## September 2026',
    '',
    '- [2026-09-03 Post three](/2026/09/three/index.md)',
    '- [2026-09-02 Post two](/2026/09/two/index.md)',
    '- [2026-09-01 Post one](/2026/09/one/index.md)',
    '',
    '## August 2026',
    '',
    '- [2026-08-20 Post \\*four\\*](/2026/08/four/index.md): A summer note.',
  ].join('\n');

  it('lists every published post under the page, by month, newest first, as the HTML does', async () => {
    const cms = await site({ files: ARCHIVE_FILES });
    const text = await markdown(cms, '/archive/index.md');
    assert.ok(text.includes(`# Everything\n\nEvery post.\n\n${MONTHS}\n\n## Feeds`), text);
    assert.doesNotMatch(text, /Drafted/);

    const html = await markdown(cms, '/archive/');
    const htmlTitles = [...html.matchAll(/<li><a href="[^"]*"><span>([^<]*)<\/span>/g)].map(
      (match) => match[1],
    );
    const markdownTitles = [...text.matchAll(/^- \[\d{4}-\d{2}-\d{2} (.*?)\]\(/gm)].map((match) =>
      match[1]?.replaceAll('\\', ''),
    );
    assert.deepEqual(markdownTitles, htmlTitles);
  });

  it('lists nothing on a page that did not ask for the archive', async () => {
    const cms = await site({ files: ARCHIVE_FILES });
    assert.doesNotMatch(await markdown(cms, '/about/index.md'), /September 2026/);
  });

  it('gives archiveMonths to both partials, so a site theme lays it out', async () => {
    const cms = await site({
      files: ARCHIVE_FILES,
      site: { theme: 'mine' },
      theme: {
        'partials/markdown-header.md.njk':
          '{% for group in archiveMonths %}{{ group.month }}: {{ group.posts.length }}\n{% endfor %}',
        'partials/markdown-footer.md.njk':
          '{% for group in archiveMonths %}{% for entry in group.posts %}=> {{ entry.url | markdownUrl }} {{ entry.date }} {{ entry.label }}{{ (" " + entry.description) if entry.description }}\n{% endfor %}{% endfor %}',
      },
    });
    const text = await markdown(cms, '/archive/index.md');
    assert.ok(text.includes('---\n\nSeptember 2026: 3\nAugust 2026: 1\n\nEvery post.\n\n'), text);
    assert.ok(
      text.endsWith(
        [
          '=> /2026/09/three/index.md 2026-09-03 Post three',
          '=> /2026/09/two/index.md 2026-09-02 Post two',
          '=> /2026/09/one/index.md 2026-09-01 Post one',
          '=> /2026/08/four/index.md 2026-08-20 Post *four* A summer note.',
          '',
        ].join('\n'),
      ),
      text,
    );
  });
});

describe('what a post links to beyond its words (TASK-473)', () => {
  const FILED: Record<string, string> = {
    'posts/2026-09-01-one.md': [
      '---',
      'title: Post one',
      "date: '2026-09-01T09:00:00Z'",
      'permalink: /2026/09/one/',
      'author: ada',
      'tags: [Travel, Two words]',
      'categories: [Field notes]',
      '---',
      '',
      'The first.',
      '',
    ].join('\n'),
  };

  function section(text: string, heading: string): string | undefined {
    const start = text.indexOf(`\n## ${heading}\n\n`);
    if (start === -1) return undefined;
    const body = text.slice(start + heading.length + 6);
    const end = body.indexOf('\n\n');
    return end === -1 ? body.trimEnd() : body.slice(0, end);
  }

  it('lists a post’s categories and tags as links to their archives’ Markdown', async () => {
    const cms = await site({ files: FILED });
    const text = await markdown(cms, '/2026/09/one/index.md');
    assert.equal(
      section(text, 'Filed under'),
      [
        '- [Category: Field notes](/category/Field%20notes/index.md)',
        '- [Tag: Travel](/tag/travel/index.md)',
        '- [Tag: Two words](/tag/two%20words/index.md)',
      ].join('\n'),
    );
    for (const url of ['/category/Field%20notes/index.md', '/tag/two%20words/index.md']) {
      assert.match(await markdown(cms, url), /Post one/);
    }
    assert.equal(section(await markdown(cms, '/2026/09/two/index.md'), 'Filed under'), undefined);
  });

  it('links a post’s previous and next posts in its body', async () => {
    const cms = await site();
    assert.equal(
      section(await markdown(cms, '/2026/09/two/index.md'), 'More posts'),
      [
        '- [Previous: Post one](/2026/09/one/index.md)',
        '- [Next: Post three](/2026/09/three/index.md)',
      ].join('\n'),
    );
    assert.equal(
      section(await markdown(cms, '/2026/09/three/index.md'), 'More posts'),
      '- [Previous: Post two](/2026/09/two/index.md)',
    );
    assert.equal(section(await markdown(cms, '/about/index.md'), 'More posts'), undefined);
  });

  it('lists the posts and pages that link here under Linked from, as the HTML does', async () => {
    const cms = await site();
    for (const url of ['/2026/09/one/', '/about/']) {
      const html = await markdown(cms, url);
      assert.match(html, /Linked from[\s\S]*href="\/2026\/09\/two\/">Post two</);
      assert.equal(
        section(await markdown(cms, `${url}index.md`), 'Linked from'),
        '- [2026-09-02 Post two](/2026/09/two/index.md)',
      );
    }
    assert.equal(section(await markdown(cms, '/2026/09/two/index.md'), 'Linked from'), undefined);

    const front = await site({ site: { homepage: 'about' } });
    const html = await markdown(front, '/');
    const htmlLinks = [
      ...(/<section class="backlinks"[\s\S]*?<\/section>/.exec(html)?.[0] ?? '').matchAll(
        /href="([^"]*)"/g,
      ),
    ].map((match) => `${match[1] ?? ''}index.md`);
    const markdownLinks = [
      ...(section(await markdown(front, '/index.md'), 'Linked from') ?? '').matchAll(
        /\]\(([^)]*)\)/g,
      ),
    ].map((match) => match[1]);
    assert.deepEqual(markdownLinks, htmlLinks, 'a static homepage lists what its HTML lists');
  });

  async function feedsMatch(cms: Cms, url: string): Promise<void> {
    const html = await markdown(cms, url);
    const advertised = [
      ...html.matchAll(
        /<link rel="alternate" type="application\/(?:rss\+xml|atom\+xml|feed\+json)" title="[^"]*" href="([^"]*)">/g,
      ),
    ].map((match) => match[1]);
    const listed = [
      ...(section(await markdown(cms, `${url}index.md`), 'Feeds') ?? '').matchAll(
        /^- \[.*\]\((.*)\)$/gm,
      ),
    ].map((match) => match[1]);
    assert.deepEqual(listed, advertised, url);
  }

  it('lists the feeds the HTML head advertises, on every kind of page', async () => {
    const cms = await site({ files: FILED });
    const pages = [
      '/2026/09/two/',
      '/about/',
      '/',
      '/tag/travel/',
      '/category/Field%20notes/',
      '/author/ada/',
    ];
    for (const url of pages) await feedsMatch(cms, url);
    await feedsMatch(await site({ site: { homepage: 'about' } }), '/');

    assert.equal(
      section(await markdown(cms, '/2026/09/two/index.md'), 'Feeds'),
      [
        '- [Field \\*Notes\\* (RSS)](/feed/)',
        '- [Field \\*Notes\\* (Atom)](/feed/atom/)',
        '- [Field \\*Notes\\* (JSON Feed)](/feed/json/)',
        '- [Field \\*Notes\\* comments (RSS)](/comments/feed/)',
        '- [Comments on: Post two (RSS)](/2026/09/two/feed/)',
      ].join('\n'),
    );
    assert.match(
      section(await markdown(cms, '/tag/travel/index.md'), 'Feeds') ?? '',
      /\n- \[Field \\\*Notes\\\*: Travel \(Atom\)\]\(\/tag\/travel\/feed\/atom\/\)\n/,
    );
  });

  it('gives every list to both partials, so a site theme lays them out', async () => {
    const partial = [
      'type={{ type }}',
      '{% for link in categories %}c {{ link.label }} {{ link.url }}\n{% endfor %}',
      '{% for link in tags %}t {{ link.label }} {{ link.url }}\n{% endfor %}',
      '{% for link in backlinks %}b {{ link.date }} {{ link.label }} {{ link.url }}\n{% endfor %}',
      '{% for feed in feeds %}f {{ feed.format }} {{ feed.type }} {{ feed.label }} {{ feed.url }}\n{% endfor %}',
    ].join('\n');
    const cms = await site({
      files: FILED,
      site: { theme: 'mine' },
      theme: {
        'partials/markdown-header.md.njk': partial,
        'partials/markdown-footer.md.njk': partial,
      },
    });
    const text = await markdown(cms, '/2026/09/one/index.md');
    const expected = [
      'type=post',
      'c Field notes /category/Field%20notes/',
      't Travel /tag/travel/',
      't Two words /tag/two%20words/',
      'b 2026-09-02 Post two /2026/09/two/',
      'f RSS application/rss+xml Field *Notes* /feed/',
      'f Atom application/atom+xml Field *Notes* /feed/atom/',
      'f JSON Feed application/feed+json Field *Notes* /feed/json/',
      'f RSS application/rss+xml Field *Notes* comments /comments/feed/',
      'f RSS application/rss+xml Comments on: Post one /2026/09/one/feed/',
    ].join('\n');
    assert.ok(text.includes(`---\n\n${expected}\n\nThe first.\n\n${expected}\n`), text);
    assert.match(await markdown(cms, '/tag/travel/index.md'), /^type=listing$/m);
    assert.match(await markdown(cms, '/about/index.md'), /^type=page$/m);
  });
});

describe('what kind of post a post is (TASK-474)', () => {
  const THEIRS = 'https://them.example/post';
  const LIKED = 'https://them.example/liked';
  const REPOSTED = 'https://them.example/reposted';
  const SONG = 'https://them.example/song';
  const CAMP = 'https://events.example/indieweb-camp';
  const COPY = 'https://silo.example/notes/42';
  const ORIGINAL = 'https://them.example/party';
  const ZONE = 'America/Chicago';

  function kind(slug: string, lines: readonly string[], body = ''): Record<string, string> {
    return {
      [`posts/2026-09-10-${slug}.md`]: [
        '---',
        "date: '2026-09-10T09:00:00Z'",
        `permalink: /2026/09/${slug}/`,
        'author: ada',
        ...lines,
        '---',
        '',
        body,
        '',
      ].join('\n'),
    };
  }

  const KINDS: Record<string, string> = {
    ...kind('reply', [`in-reply-to: ${THEIRS}`], 'Agreed.'),
    ...kind('like', [`like-of: ${LIKED}`]),
    ...kind('copy', [`in-reply-to: ${COPY}`], 'Count me in.'),
    ...kind('repost', [`repost-of: ${REPOSTED}`]),
    ...kind('bookmark', [`bookmark-of: ${SONG}`]),
    ...kind('home-reply', ['in-reply-to: https://example.com/2026/09/one/'], 'Me too.'),
    ...kind('rsvp', [`in-reply-to: ${CAMP}`, 'rsvp: yes'], 'See you there.'),
    ...kind(
      'event',
      [
        'title: Homebrew Website Club',
        "start: '2026-10-14T00:30:00Z'",
        "end: '2026-10-14T02:30:00Z'",
        'location: The *Bridge*, Portland',
      ],
      'Bring a laptop.',
    ),
    ...kind('online', ["start: '2026-10-14T00:30:00Z'", 'location: https://meet.example/room']),
    ...kind(
      'review',
      [
        'item:',
        '  kind: book',
        '  name: Dune',
        '  by: Frank Herbert',
        '  year: 1965',
        '  url: https://books.example/dune',
        '  date: 2026-09-01',
        'rating: 4',
      ],
      'A classic.',
    ),
    ...kind('located', [], 'Lunch.'),
    ...kind('pinned', [], 'Here.'),
    '_data/replyContexts.json': JSON.stringify({
      [THEIRS]: {
        name: 'Their *post*',
        author: { name: 'Bea' },
        published: '2026-09-01T12:00:00Z',
      },
      [LIKED]: {},
      [COPY]: { original: ORIGINAL, name: 'The party' },
      [REPOSTED]: { author: { name: 'Bea' } },
      [SONG]: { name: 'Flickermood by Forss', author: { name: 'Forss' } },
      [CAMP]: {
        name: 'IndieWeb Camp Chicago',
        start: '2026-10-10T14:00:00Z',
        location: 'Chicago Public Library',
      },
    }),
  };

  const LOCATIONS_STORED = {
    '/2026/09/located/': {
      name: 'Los Gorditos',
      locality: 'Portland',
      geo: { latitude: 45.5, longitude: -122.6 },
    },
    '/2026/09/pinned/': { geo: { latitude: 45.5, longitude: -122.6 } },
  };

  async function kinds(sharing: string = 'none', theme?: Record<string, string>): Promise<Cms> {
    return await site({
      files: KINDS,
      site: { timezone: ZONE, locationSharing: sharing, ...(theme ? { theme: 'mine' } : {}) },
      locations: LOCATIONS_STORED,
      ...(theme ? { theme } : {}),
    });
  }

  it('opens a reply, like, repost and bookmark with a linked line naming what it answers (AC #1)', async () => {
    const cms = await kinds();
    const expected: [slug: string, body: string, line: string][] = [
      ['reply', 'Agreed.', `In reply to [Their \\*post\\*](${THEIRS}) by Bea, 1 September 2026`],
      ['like', '', `Liked [a page on them.example](${LIKED})`],
      [
        'copy',
        'Count me in.',
        `In reply to [The party](${ORIGINAL})\n\nAlso in reply to [its copy on silo.example](${COPY})`,
      ],
      ['repost', '', `Reposted [a post](${REPOSTED}) by Bea`],
      ['bookmark', '', `Bookmarked [Flickermood by Forss](${SONG})`],
      [
        'home-reply',
        'Me too.',
        'In reply to [Post one](/2026/09/one/index.md) by Ada Lovelace, 1 September 2026',
      ],
    ];
    for (const [slug, body, line] of expected) {
      const url = `/2026/09/${slug}/`;
      assert.equal(headerOf(await markdown(cms, `${url}index.md`), body), line, slug);
    }
    const html = await markdown(cms, '/2026/09/home-reply/');
    assert.match(
      html,
      /In reply to <a class="u-url p-name" href="[^"]*\/2026\/09\/one\/">Post one<\/a> by [\s\S]*Ada Lovelace[\s\S]*>1 September 2026</,
    );
  });

  it('writes an RSVP’s answer and the event, and when and where an event is (AC #2)', async () => {
    const cms = await kinds();
    assert.equal(
      headerOf(await markdown(cms, '/2026/09/rsvp/index.md'), 'See you there.'),
      `Going to [IndieWeb Camp Chicago](${CAMP}), 10 October 2026, Chicago Public Library`,
    );

    const html = await markdown(cms, '/2026/09/event/');
    const times = [...html.matchAll(/<time class="dt-(?:start|end)"[^>]*>([^<]*)<\/time>/g)].map(
      (match) => match[1] ?? '',
    );
    assert.equal(times.length, 2);
    assert.match(times[0] ?? '', /October 13, 2026|13 October 2026/, 'the site’s zone, not UTC');
    assert.equal(
      headerOf(await markdown(cms, '/2026/09/event/index.md'), 'Bring a laptop.'),
      [
        '# Homebrew Website Club',
        '',
        `When: ${times[0] ?? ''} to ${times[1] ?? ''}`,
        '',
        'Where: The \\*Bridge\\*, Portland',
      ].join('\n'),
    );
    assert.equal(
      headerOf(await markdown(cms, '/2026/09/online/index.md'), ''),
      [
        `When: ${times[0] ?? ''}`,
        '',
        'Where: Online at [meet.example](https://meet.example/room)',
      ].join('\n'),
    );
  });

  it('writes a review’s item, kind, year, creator and rating (AC #3)', async () => {
    const cms = await kinds();
    assert.equal(
      headerOf(await markdown(cms, '/2026/09/review/index.md'), 'A classic.'),
      [
        'Review of [Dune](https://books.example/dune) (book, 1965), by Frank Herbert',
        '',
        'Finished on 1 September 2026.',
        '',
        'Rated 4 out of 5',
      ].join('\n'),
    );
  });

  it('writes the location only as far as Settings > Privacy shares it (AC #4)', async () => {
    const hidden = await kinds('none');
    assert.equal(headerOf(await markdown(hidden, '/2026/09/located/index.md'), 'Lunch.'), '');
    assert.doesNotMatch(await markdown(hidden, '/2026/09/located/'), /p-location/);
    assert.doesNotMatch(await markdown(hidden, '/2026/09/located/index.md'), /Gorditos|45\.5/);
    assert.equal(headerOf(await markdown(hidden, '/2026/09/pinned/index.md'), 'Here.'), '');

    const place = await kinds('place');
    assert.equal(
      headerOf(await markdown(place, '/2026/09/located/index.md'), 'Lunch.'),
      'Location: Los Gorditos, Portland',
    );
    assert.doesNotMatch(await markdown(place, '/2026/09/located/index.md'), /45\.5/);
    assert.equal(headerOf(await markdown(place, '/2026/09/pinned/index.md'), 'Here.'), '');

    const exact = await kinds('exact');
    assert.equal(
      headerOf(await markdown(exact, '/2026/09/located/index.md'), 'Lunch.'),
      'Location: Los Gorditos, Portland',
    );
    assert.equal(
      headerOf(await markdown(exact, '/2026/09/pinned/index.md'), 'Here.'),
      'Location: 45.5, -122.6',
    );
  });

  it('gives each kind’s data to both partials, so a site theme writes its own lines (AC #5)', async () => {
    const partial = [
      'type={{ postType }}',
      '{% for cite in cites %}c {{ cite.verb }} {{ cite.name }} {{ cite.url }} {{ cite.author }}\n{% endfor %}',
      '{% if rsvp %}r {{ rsvp.value }} {{ rsvp.label }}\n{% endif %}',
      '{% if event %}e {{ event.start | date("iso") }} {{ event.location.name }}\n{% endif %}',
      '{% if review %}v {{ review.item.name }} {{ review.about | join("/") }} {{ review.rating }}/{{ review.best }}\n{% endif %}',
      '{% if location %}l {{ location.type }} {% for word in location.words %}{{ word.text }};{% endfor %}\n{% endif %}',
    ].join('\n');
    const cms = await kinds('place', {
      'partials/markdown-header.md.njk': partial,
      'partials/markdown-footer.md.njk': partial,
    });
    const lines = async (slug: string): Promise<string> =>
      (await markdown(cms, `/2026/09/${slug}/index.md`)).split('\n---\n')[1] ?? '';
    assert.match(
      await lines('repost'),
      /^type=repost\nc Reposted a post https:\/\/them\.example\/reposted Bea$/m,
    );
    assert.match(
      await lines('rsvp'),
      /^c Going to IndieWeb Camp Chicago https:\S+ $\nr yes Going$/m,
    );
    assert.match(
      await lines('event'),
      /^type=event\ne 2026-10-14T00:30:00\.000Z The \*Bridge\*, Portland$/m,
    );
    assert.match(await lines('review'), /^v Dune book\/1965 4\/5$/m);
    assert.match(await lines('located'), /^l h-card Los Gorditos;Portland;$/m);
  });
});

describe('a post’s photos and its recording (TASK-475)', () => {
  function media(slug: string, lines: readonly string[], body: string): Record<string, string> {
    return {
      [`posts/2026-09-11-${slug}.md`]: [
        '---',
        "date: '2026-09-11T09:00:00Z'",
        `permalink: /2026/09/${slug}/`,
        'author: ada',
        ...lines,
        '---',
        '',
        body,
        '',
      ].join('\n'),
    };
  }

  const MEDIA: Record<string, string> = {
    '_data/media.json': JSON.stringify({ '2026/09/dog.jpg': { alt: 'A dog asleep on a rug' } }),
    ...media(
      'beach',
      [
        'photo:',
        '  - url: /uploads/2026/09/beach.jpg',
        '    alt: Waves [breaking] at *dusk*',
        '  - url: /uploads/2026/09/dog.jpg',
        '  - url: https://cdn.example/cat.webp',
        '    alt: A cat on a wall',
      ],
      'A day at the beach.',
    ),
    ...media(
      'episode',
      [
        'title: Episode twelve',
        'enclosure:',
        '  url: /uploads/2026/09/episode-12.mp3',
        '  type: audio/mpeg',
        '  length: 23456789',
        '  transcript:',
        '    url: /uploads/2026/09/episode-12.vtt',
        '    type: text/vtt',
        '  alternates:',
        '    - url: /uploads/2026/09/episode-12.mp4',
        '      type: video/mp4',
        '      length: 98765432',
        '      title: Video',
        '    - url: https://cdn.example.com/episode-12-low.mp3',
        '      type: audio/mpeg',
        '      lang: en',
      ],
      'Show notes.',
    ),
    ...media(
      'screencast',
      [
        'enclosure:',
        '  url: /uploads/2026/09/screencast.webm',
        '  type: video/webm',
        '  length: 4096',
        '  transcript:',
        '    url: /uploads/2026/09/screencast.html',
        '    type: text/html',
        'photo:',
        '  - url: /uploads/2026/09/still.jpg',
        '    alt: The first frame',
      ],
      'Watch this.',
    ),
  };

  it('writes each photo as an image with its alt text, in the order the HTML draws them (AC #1)', async () => {
    const cms = await site({ files: MEDIA });
    const html = await markdown(cms, '/2026/09/beach/');
    const drawn = [...html.matchAll(/<img class="u-photo" src="([^"]+)" alt="([^"]*)"/g)].map(
      (match) => `${match[2] ?? ''} ${match[1] ?? ''}`,
    );
    assert.deepEqual(drawn, [
      'Waves [breaking] at *dusk* /uploads/2026/09/beach.jpg',
      'A dog asleep on a rug /uploads/2026/09/dog.jpg',
      'A cat on a wall https://cdn.example/cat.webp',
    ]);
    assert.equal(
      headerOf(await markdown(cms, '/2026/09/beach/index.md'), 'A day at the beach.'),
      [
        '![Waves \\[breaking\\] at \\*dusk\\*](/uploads/2026/09/beach.jpg)',
        '',
        '![A dog asleep on a rug](/uploads/2026/09/dog.jpg)',
        '',
        '![A cat on a wall](https://cdn.example/cat.webp)',
      ].join('\n'),
    );
  });

  it('links the recording with its type and size, its transcript or captions, and each other version (AC #2)', async () => {
    const cms = await site({ files: MEDIA });
    assert.equal(
      headerOf(await markdown(cms, '/2026/09/episode/index.md'), 'Show notes.'),
      [
        '# Episode twelve',
        '',
        '[Download the recording](/uploads/2026/09/episode-12.mp3) (audio/mpeg, 22.4 MB)',
        '',
        '[Captions](/uploads/2026/09/episode-12.vtt)',
        '',
        'Other versions:',
        '',
        '- [Video](/uploads/2026/09/episode-12.mp4) (video/mp4, 94.2 MB)',
        '- [audio/mpeg](https://cdn.example.com/episode-12-low.mp3)',
      ].join('\n'),
    );
  });

  it('puts a video before the photos, as the HTML does, with its transcript', async () => {
    const cms = await site({ files: MEDIA });
    const html = await markdown(cms, '/2026/09/screencast/');
    assert.ok(html.indexOf('<video') < html.indexOf('class="post-photos"'));
    assert.equal(
      headerOf(await markdown(cms, '/2026/09/screencast/index.md'), 'Watch this.'),
      [
        '[Download the video](/uploads/2026/09/screencast.webm) (video/webm, 4 KB)',
        '',
        '[Transcript](/uploads/2026/09/screencast.html)',
        '',
        '![The first frame](/uploads/2026/09/still.jpg)',
      ].join('\n'),
    );
  });

  it('writes no media lines on a post with neither', async () => {
    const cms = await site({ files: MEDIA });
    const text = await markdown(cms, '/2026/09/one/index.md');
    assert.doesNotMatch(text, /!\[|Download the|Other versions/);
  });

  it('gives photos and enclosure to both partials, so a site theme writes its own lines (AC #3)', async () => {
    const partial = [
      '{% for photo in photos %}p {{ photo.url }} {{ photo.alt }}\n{% endfor %}',
      '{% if enclosure %}e {{ enclosure.player }} {{ enclosure.url }} {{ enclosure.type }} {{ enclosure.length | fileSize }} {{ enclosure.transcript.captions }}\n{% endif %}',
      '{% for alternate in enclosure.alternates %}a {{ alternate.title }} {{ alternate.lang }}\n{% endfor %}',
    ].join('\n');
    const cms = await site({
      files: MEDIA,
      site: { theme: 'mine' },
      theme: {
        'partials/markdown-header.md.njk': partial,
        'partials/markdown-footer.md.njk': partial,
      },
    });
    const parts = async (slug: string): Promise<string[]> =>
      (await markdown(cms, `/2026/09/${slug}/index.md`))
        .split('\n---\n')[1]
        ?.split('Show notes.') ?? [];
    for (const part of await parts('episode')) {
      assert.match(
        part,
        /^e audio \/uploads\/2026\/09\/episode-12\.mp3 audio\/mpeg 22\.4 MB true$/m,
      );
      assert.match(part, /^a Video $\na {2}en$/m);
    }
    const beach = (await markdown(cms, '/2026/09/beach/index.md')).split('\n---\n')[1] ?? '';
    assert.equal(
      beach.match(/^p \/uploads\/2026\/09\/dog\.jpg A dog asleep on a rug$/gm)?.length,
      2,
    );
  });
});
