import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { createUser, setUserProfile } from '../site/users.ts';
import { createCms } from '../index.ts';
import type { Cms } from '../index.ts';

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

const FOOTER = [
  '## Field \\*Notes\\*',
  '',
  '[Written by Ada Lovelace](/author/ada/index.md)',
  '',
  '- [Home](/index.md)',
  '- [About \\[me\\]](/about/index.md)',
  '- [Search](/search/)',
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
        '=> /search/ Search',
        '=> https://mastodon.example/@ada Mastodon',
        '',
      ].join('\n'),
    );
  });
});

describe('the bio (AC #5)', () => {
  const BIO = ['Wrote the \\*first\\* program.', '', '- [Her notes](https://ada.example)'].join(
    '\n',
  );

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
          '- [Search](https://example.com/search/)',
          '- [Mastodon](https://mastodon.example/@ada)',
        ]
          .join('\n')
          .replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
      ),
    );
  });
});
