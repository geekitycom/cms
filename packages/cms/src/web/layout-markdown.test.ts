import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { sandbox } from '../admin/__testing__/harness.ts';
import type { Cms } from '../index.ts';
import { setUserProfile } from '../site/users.ts';
import { shared } from './__testing__/shared.ts';
import { addUser } from '../admin/__testing__/users.ts';

const box = sandbox();
after(() => box.cleanup());

const COMMENT = '0000000000000001';

function post(slug: string, day: string, extra: readonly string[], body: string): string {
  return [
    '---',
    `title: Post ${slug}`,
    `date: '2026-09-${day}T09:00:00Z'`,
    `permalink: /2026/09/${slug}/`,
    'author: ada',
    ...extra,
    '---',
    '',
    body,
    '',
  ].join('\n');
}

const CONTENT: Record<string, string> = {
  'posts/2026-09-01-one.md': post(
    'one',
    '01',
    ['tags:', '  - travel', 'categories:', '  - Field notes'],
    'The first, see [two](/2026/09/two/).',
  ),
  'posts/2026-09-02-two.md': post('two', '02', [], 'The second.'),
  'posts/2026-09-03-three.md': post('three', '03', [], 'The third.'),
  'pages/about.md': '---\ntitle: About\npermalink: /about/\n---\n\nWho writes this.\n',
  'pages/blog.md': '---\ntitle: Blog\npermalink: /blog/\n---\n\nThe blog.\n',
  '_data/comments/2026-09-01-one.json': JSON.stringify({
    post: '/2026/09/one/',
    comments: [
      {
        id: COMMENT,
        source: 'comment',
        kind: 'reply',
        status: 'approved',
        author: { name: 'Grace Hopper', url: null, email: null, avatar: null },
        content: { markdown: '<p>Said here.</p>', html: '<p>Said here.</p>' },
        submitted: '2026-09-11T10:00:00.000Z',
        addressHash: null,
        inReplyTo: null,
        url: null,
        notify: false,
      },
    ],
  }),
};

async function writeTree(root: string, files: Record<string, string>): Promise<void> {
  for (const [relative, contents] of Object.entries(files)) {
    const file = path.join(root, ...relative.split('/'));
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, contents, 'utf8');
  }
}

async function site(
  theme: Record<string, string> | undefined,
  siteData: Record<string, unknown> = {},
): Promise<Cms> {
  const contentDir = await box.dir('geekity-layout-md-content-');
  const dataDir = await box.dir('geekity-layout-md-data-');
  const themesDir = await box.dir('geekity-layout-md-themes-');
  await writeTree(contentDir, {
    ...CONTENT,
    '_data/site.json': JSON.stringify({
      title: 'Field Notes',
      author: 'ada',
      postsPerPage: 2,
      menus: { primary: [{ label: 'About', url: '/about/' }] },
      ...(theme === undefined ? {} : { theme: 'mine' }),
      ...siteData,
    }),
  });
  if (theme !== undefined) {
    await writeTree(path.join(themesDir, 'mine'), {
      'theme.json': JSON.stringify({ name: 'mine', kind: 'site' }),
      ...theme,
    });
  }
  const ada = addUser({ dataDir, username: 'ada', password: 'correct horse battery' });
  await setUserProfile({
    dataDir,
    userId: ada.id,
    profile: {
      displayName: 'Ada Lovelace',
      bio: 'Wrote the *first* program.',
      links: [{ label: 'Her notes', href: 'https://ada.example' }],
    },
  });
  return box.open({
    contentDir,
    dataDir,
    themesDir,
    baseUrl: 'https://blog.example',
    now: () => new Date('2026-09-28T12:00:00Z'),
  });
}

const sharedSite = shared(site);

async function text(cms: Cms, url: string): Promise<string> {
  const response = await cms.app.request(url);
  assert.equal(response.status, 200, url);
  return response.text();
}

async function afterFrontMatter(cms: Cms, url: string): Promise<string> {
  return (await text(cms, url)).split('\n---\n')[1] ?? '';
}

describe('a theme’s layout Markdown template (AC #1, #2)', () => {
  it('builds a post’s Markdown from layouts/post.md.njk, which includes the header and leaves the footer out', async () => {
    const cms = await sharedSite({
      'layouts/post.md.njk': [
        '{% include "partials/markdown-header.md.njk" %}',
        'Before the words.',
        '',
        '{{ content }}',
        '',
        'After the words.',
        '',
      ].join('\n'),
    });

    assert.equal(
      await afterFrontMatter(cms, '/2026/09/one/index.md'),
      [
        '',
        '# Post one',
        '',
        'Before the words.',
        '',
        'The first, see [two](/2026/09/two/index.md).',
        '',
        'After the words.',
        '',
      ].join('\n'),
    );
    assert.match(
      await afterFrontMatter(cms, '/about/index.md'),
      /## Feeds/,
      'a page keeps the footer',
    );
  });

  it('gives the header and footer already written, to place in any order', async () => {
    const cms = await sharedSite({
      'layouts/post.md.njk': '{{ footer }}\n\n{{ content }}\n\n{{ header }}\n',
    });

    const written = await afterFrontMatter(cms, '/2026/09/one/index.md');
    const at = (needle: string): number => written.indexOf(needle);
    assert.ok(at('## Feeds') >= 0, written);
    assert.ok(at('## Feeds') < at('The first, see'), written);
    assert.ok(at('The first, see') < at('# Post one'), written);
  });

  it('looks up the slot of each HTML layout', async () => {
    const theme: Record<string, string> = {};
    for (const name of ['post', 'page', 'home', 'tag', 'category', 'author', 'search', 'comment']) {
      theme[`layouts/${name}.md.njk`] = `Slot ${name}: {{ type }}\n\n{{ content }}\n`;
    }
    const cms = await sharedSite(theme);

    const opens = async (url: string, slot: string, words: RegExp): Promise<void> => {
      const written = await afterFrontMatter(cms, url);
      assert.ok(written.startsWith(`\nSlot ${slot}: `), `${url}: ${written}`);
      assert.match(written, words, url);
    };
    await opens('/2026/09/two/index.md', 'post', /The second\./);
    await opens('/about/index.md', 'page', /Who writes this\./);
    await opens('/index.md', 'home', /## Posts\n\n- \[2026-09-03 Post three\]/);
    await opens('/tag/travel/index.md', 'tag', /Post one/);
    await opens('/category/Field%20notes/index.md', 'category', /Post one/);
    await opens('/author/ada/index.md', 'author', /Post three/);
    await opens('/search/index.md?q=third', 'search', /One result/);
    await opens(`/comment/${COMMENT}/index.md`, 'comment', /Said here\./);
  });

  it('uses front-page.md.njk on a homepage that is a page, else page.md.njk', async () => {
    const both = await sharedSite(
      {
        'layouts/front-page.md.njk': 'Front: {{ content }}\n',
        'layouts/page.md.njk': 'Page: {{ content }}\n',
      },
      { homepage: 'about' },
    );
    assert.equal(await afterFrontMatter(both, '/index.md'), '\nFront: Who writes this.\n');
    assert.equal(await afterFrontMatter(both, '/blog/index.md'), '\nPage: The blog.\n');

    const pageOnly = await sharedSite(
      { 'layouts/page.md.njk': 'Page: {{ content }}\n' },
      {
        homepage: 'about',
      },
    );
    assert.equal(await afterFrontMatter(pageOnly, '/index.md'), '\nPage: Who writes this.\n');
  });

  it('uses posts-page.md.njk on the posts page, else home.md.njk', async () => {
    const both = await sharedSite(
      {
        'layouts/posts-page.md.njk': 'Posts page\n\n{{ content }}\n',
        'layouts/home.md.njk': 'Home\n\n{{ content }}\n',
      },
      { homepage: 'about', postsPage: 'blog' },
    );
    assert.match(
      await afterFrontMatter(both, '/blog/index.md'),
      /^\nPosts page\n\nThe blog\.\n\n## Posts\n/,
    );

    const homeOnly = await sharedSite(
      { 'layouts/home.md.njk': 'Home\n\n{{ content }}\n' },
      { homepage: 'about', postsPage: 'blog' },
    );
    assert.match(await afterFrontMatter(homeOnly, '/blog/index.md'), /^\nHome\n\nThe blog\.\n/);
  });
});

describe('a static front page’s Markdown with the author’s card and the newest posts (AC #5)', () => {
  it('prints both from the layout through the shared partials, between the package’s header and footer', async () => {
    const cms = await sharedSite(
      {
        'layouts/front-page.md.njk': [
          '{{ header }}',
          '',
          '{{ content }}',
          '',
          '{% include "partials/markdown-bio.md.njk" %}',
          '',
          '## Newest posts',
          '',
          '{% set postList = newestPosts(2) %}',
          '{% include "partials/markdown-post-list.md.njk" %}',
          '',
          '{{ footer }}',
          '',
        ].join('\n'),
      },
      { homepage: 'about' },
    );

    const written = await afterFrontMatter(cms, '/index.md');
    assert.ok(
      written.startsWith(
        [
          '',
          '# About',
          '',
          'Who writes this.',
          '',
          'Wrote the *first* program.',
          '',
          '- [Her notes](https://ada.example)',
          '',
          '## Newest posts',
          '',
          '- [2026-09-03 Post three](/2026/09/three/index.md)',
          '- [2026-09-02 Post two](/2026/09/two/index.md)',
          '',
          '## Feeds',
          '',
        ].join('\n'),
      ),
      written,
    );

    const gemtext = await text(cms, '/index.gmi');
    assert.ok(
      gemtext.includes(
        [
          'Who writes this.',
          '',
          'Wrote the first program.',
          '',
          '=> https://ada.example Her notes',
          '',
          '## Newest posts',
          '',
          '=> /2026/09/three/index.gmi 2026-09-03 Post three',
          '=> /2026/09/two/index.gmi 2026-09-02 Post two',
          '',
        ].join('\n'),
      ),
      gemtext,
    );
  });
});

describe('a layout’s gemtext (AC #4)', () => {
  it('writes a theme’s layouts/post.gmi.njk as it is, with the header, footer and words as gemtext', async () => {
    const cms = await sharedSite({
      'partials/markdown-footer.md.njk': '- [About]({{ "/about/" | markdownUrl }})\n',
      'layouts/post.gmi.njk': '{{ header }}\n\n## Words\n{{ content }}\n\n{{ footer }}\n',
    });

    assert.equal(
      await text(cms, '/2026/09/one/index.gmi'),
      [
        '# Post one',
        '',
        '## Words',
        'Published 2026-09-01',
        '',
        'The first, see two[1].',
        '',
        '=> /2026/09/two/index.gmi 1: /2026/09/two/index.gmi',
        '',
        '=> /about/index.gmi About',
        '',
        '=> /index.gmi Home',
        '',
      ].join('\n'),
    );
  });

  it('converts a theme’s layouts/post.md.njk when it has no .gmi.njk', async () => {
    const cms = await sharedSite({
      'layouts/post.md.njk': 'Before [about]({{ "/about/" | markdownUrl }}).\n\n{{ content }}\n',
    });

    assert.equal(
      await text(cms, '/2026/09/one/index.gmi'),
      [
        'Before about[1].',
        '',
        '=> /about/index.gmi 1: /about/index.gmi',
        '',
        'Published 2026-09-01',
        '',
        'The first, see two[2].',
        '',
        '=> /2026/09/two/index.gmi 2: /2026/09/two/index.gmi',
        '',
        '=> /index.gmi Home',
        '',
      ].join('\n'),
    );
    assert.doesNotMatch(await text(cms, '/2026/09/one/index.md'), /Published/);
  });

  it('writes a static front page’s newest posts from layouts/front-page.gmi.njk', async () => {
    const cms = await sharedSite(
      {
        'layouts/front-page.gmi.njk': [
          '{{ content }}',
          '',
          '## Newest posts',
          '{% for entry in newestPosts(5) %}',
          '=> {{ entry.url | geminiUrl }} {{ entry.date | date("html") }} {{ entry.label }}',
          '{% endfor %}',
          '',
        ].join('\n'),
      },
      { homepage: 'about' },
    );

    assert.equal(
      await text(cms, '/index.gmi'),
      [
        'Who writes this.',
        '',
        '## Newest posts',
        '=> /2026/09/three/index.gmi 2026-09-03 Post three',
        '=> /2026/09/two/index.gmi 2026-09-02 Post two',
        '=> /2026/09/one/index.gmi 2026-09-01 Post one',
        '',
        '=> /index.gmi Home',
        '',
      ].join('\n'),
    );
  });

  it('prefers the theme’s .gmi.njk to its .md.njk, and leaves the Markdown to the .md.njk', async () => {
    const cms = await sharedSite({
      'layouts/post.gmi.njk': 'From the gemtext.\n',
      'layouts/post.md.njk': 'From the Markdown.\n',
    });

    assert.match(await text(cms, '/2026/09/one/index.gmi'), /^From the gemtext\.\n/);
    assert.match(await text(cms, '/2026/09/one/index.md'), /\n---\n\nFrom the Markdown\.\n$/);
  });
});

describe('a page with no layout template (AC #3)', () => {
  it('writes the Markdown and gemtext a theme without layout templates writes', async () => {
    const plain = await sharedSite({ 'partials/head-end.njk': '' });
    const posts = await sharedSite({ 'layouts/post.md.njk': '{{ content }}\n' });

    for (const url of [
      '/index.md',
      '/index.gmi',
      '/about/index.md',
      '/about/index.gmi',
      '/tag/travel/index.md',
      '/tag/travel/index.gmi',
      `/comment/${COMMENT}/index.md`,
    ]) {
      assert.equal(await text(posts, url), await text(plain, url), url);
    }
  });
});
