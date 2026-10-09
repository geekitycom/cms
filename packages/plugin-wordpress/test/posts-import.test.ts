import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { pluginDataFolder } from '@geekity/cms';
import type { PluginCommandContext, PluginSite } from '@geekity/cms/plugin';
import { load } from 'js-yaml';

import { importWordPressContent } from '../src/content-import.ts';
import type { ReportRow } from '../src/content-import.ts';
import { postsAndPages } from '../src/posts-import.ts';
import { parseWordPressExport } from '../src/wxr.ts';
import { SITE, wxr } from './wxr.ts';
import type { TestItem } from './wxr.ts';

const temporaryDirs: string[] = [];

after(async () => {
  await Promise.all(temporaryDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

function unused(): never {
  throw new Error('The posts import does not reach this.');
}

interface Imported {
  readonly rows: readonly ReportRow[];
  file(relative: string): Promise<string>;
  frontMatter(relative: string): Promise<Record<string, unknown>>;
  body(relative: string): Promise<string>;
  files(): Promise<string[]>;
}

interface Site {
  readonly contentDir: string;
  run(items: readonly TestItem[]): Promise<Imported>;
}

async function site(siteJson: Record<string, unknown> = { title: 'Blog' }): Promise<Site> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'geekity-wp-posts-'));
  temporaryDirs.push(root);
  const contentDir = path.join(root, 'content');
  await fs.mkdir(path.join(contentDir, '_data'), { recursive: true });
  await fs.writeFile(
    path.join(contentDir, '_data', 'site.json'),
    `${JSON.stringify(siteJson, null, 2)}\n`,
  );
  const data = pluginDataFolder(path.join(root, 'data'), '@geekity/plugin-wordpress');
  const pluginSite: PluginSite = {
    baseUrl: 'https://new.example',
    contentDir,
    users: () => [{ username: 'ada' }],
    setActorId: unused,
    actorKey: unused,
    writeActorKey: unused,
    loadActorKeys: unused,
    followers: () => [],
    addFollower: unused,
    checkUpload: unused,
    comments: unused,
    putComments: unused,
  };
  const context: PluginCommandContext = {
    args: [],
    options: {},
    cwd: root,
    site: pluginSite,
    write: () => undefined,
  };
  const read = (relative: string) => fs.readFile(path.join(contentDir, relative), 'utf8');
  const split = async (relative: string) => {
    const match = /^---\n([\s\S]*?)---\n\n?([\s\S]*)$/.exec(await read(relative));
    assert.ok(match, `${relative} has front matter`);
    return { yaml: match[1] ?? '', body: match[2] ?? '' };
  };
  return {
    contentDir,
    run: async (items) => {
      const report = await importWordPressContent({
        exported: parseWordPressExport(wxr(items)),
        context,
        data,
        importers: [postsAndPages],
      });
      return {
        rows: report.rows,
        file: read,
        frontMatter: async (relative) =>
          load((await split(relative)).yaml) as Record<string, unknown>,
        body: async (relative) => (await split(relative)).body,
        files: async () =>
          (await fs.readdir(contentDir, { recursive: true, withFileTypes: true }))
            .filter((entry) => entry.isFile())
            .map((entry) => path.relative(contentDir, path.join(entry.parentPath, entry.name)))
            .sort(),
      };
    },
  };
}

function rowsFor(rows: readonly ReportRow[], id: number): readonly ReportRow[] {
  return rows.filter((row) => row.item.id === id);
}

const FEDERATED = { key: 'activitypub_status', value: 'federated' };

describe('the posts and pages import', () => {
  it('writes a post and a page at the paths and permalinks WordPress served', async () => {
    const imported = await (
      await site()
    ).run([
      {
        id: 10,
        slug: 'hello',
        title: 'Hello',
        date: '2024-03-05 09:30:00',
        link: `${SITE}/archives/2024/hello-there/`,
      },
      {
        id: 11,
        slug: 'i-%e2%99%a5-rss',
        title: 'I ♥ RSS',
        link: `${SITE}/2024/03/i-%e2%99%a5-rss/`,
      },
      { id: 20, type: 'page', slug: 'about', title: 'About', link: `${SITE}/about/` },
      {
        id: 21,
        type: 'page',
        slug: 'deep',
        title: 'Deep',
        parent: 22,
        link: `${SITE}/notes/deep/`,
      },
      { id: 22, type: 'page', slug: 'notes', title: 'Notes', link: `${SITE}/notes/` },
    ]);

    assert.deepEqual(await imported.files(), [
      '_data/redirects/wordpress.json',
      '_data/site.json',
      'pages/about.md',
      'pages/deep.md',
      'pages/notes.md',
      'posts/2024-03-05-hello.md',
      'posts/2024-03-05-i-♥-rss.md',
    ]);
    assert.equal(
      (await imported.frontMatter('posts/2024-03-05-hello.md'))['permalink'],
      '/archives/2024/hello-there/',
    );
    assert.equal(
      (await imported.frontMatter('posts/2024-03-05-i-♥-rss.md'))['permalink'],
      '/2024/03/i-♥-rss/',
      'stored decoded, as the site stores every permalink',
    );
    assert.equal((await imported.frontMatter('pages/about.md'))['permalink'], '/about/');
    assert.equal((await imported.frontMatter('pages/deep.md'))['permalink'], '/notes/deep/');
  });

  it('writes the whole file in the order the site writes front matter', async () => {
    const imported = await (
      await site()
    ).run([
      {
        id: 10,
        slug: 'hello',
        title: 'Hello: a "post"',
        dateGmt: '2024-03-05 14:30:00',
        modifiedGmt: '2024-04-01 08:00:00',
        guid: 'https://old.example/essays/hello/',
        terms: [
          { taxonomy: 'category', slug: 'essays', name: 'Essays' },
          { taxonomy: 'post_tag', slug: 'rss', name: 'RSS' },
        ],
        meta: [FEDERATED],
        content: '<!-- wp:paragraph -->\n<p>Body of 10.</p>\n<!-- /wp:paragraph -->',
      },
    ]);

    assert.equal(
      await imported.file('posts/2024-03-05-hello.md'),
      [
        '---',
        'title: \'Hello: a "post"\'',
        "date: '2024-03-05T14:30:00Z'",
        "updated: '2024-04-01T08:00:00Z'",
        'permalink: /2024/03/hello/',
        'tags:',
        '  - RSS',
        'categories:',
        '  - Essays',
        'author: ada',
        'activitypub:',
        '  id: https://blog.example/?p=10',
        "  published: '2024-03-05T14:30:00Z'",
        'guid: https://old.example/essays/hello/',
        'migrated: true',
        '---',
        '',
        'Body of 10.',
        '',
      ].join('\n'),
    );
  });

  it('dates a post at post_date_gmt and writes updated only when it was modified', async () => {
    const imported = await (
      await site()
    ).run([
      {
        id: 10,
        slug: 'edited',
        dateGmt: '2024-03-05 14:30:00',
        modifiedGmt: '2024-03-07 10:00:00',
      },
      { id: 11, slug: 'untouched', dateGmt: '2024-03-05 14:30:00' },
    ]);

    const edited = await imported.frontMatter('posts/2024-03-05-edited.md');
    assert.equal(edited['date'], '2024-03-05T14:30:00Z');
    assert.equal(edited['updated'], '2024-03-07T10:00:00Z');
    const untouched = await imported.frontMatter('posts/2024-03-05-untouched.md');
    assert.equal(untouched['date'], '2024-03-05T14:30:00Z');
    assert.equal(untouched['updated'], undefined);
  });

  it('files a post under its categories and tags by name, and not under its post format', async () => {
    const imported = await (
      await site()
    ).run([
      {
        id: 10,
        slug: 'filed',
        terms: [
          { taxonomy: 'category', slug: 'rsscloud', name: 'rssCloud' },
          { taxonomy: 'category', slug: 'wordpress', name: 'WordPress' },
          { taxonomy: 'post_tag', slug: 'wpus', name: 'WPUS' },
          { taxonomy: 'post_format', slug: 'post-format-aside', name: 'Aside' },
        ],
      },
    ]);

    const front = await imported.frontMatter('posts/2024-03-05-filed.md');
    assert.deepEqual(front['categories'], ['rssCloud', 'WordPress']);
    assert.deepEqual(front['tags'], ['WPUS']);
  });

  it('keeps the ActivityPub id and the announce state WordPress federated under', async () => {
    const imported = await (
      await site()
    ).run([
      { id: 813, slug: 'federated', dateGmt: '2026-08-17 15:51:17', meta: [FEDERATED] },
      { id: 290, slug: 'never-sent' },
    ]);

    const federated = await imported.frontMatter('posts/2024-03-05-federated.md');
    assert.deepEqual(federated['activitypub'], {
      id: `${SITE}/?p=813`,
      published: '2026-08-17T15:51:17Z',
    });
    assert.equal(federated['migrated'], true);

    const neverSent = await imported.frontMatter('posts/2024-03-05-never-sent.md');
    assert.deepEqual(neverSent['activitypub'], { id: `${SITE}/?p=290` });
    assert.equal(neverSent['migrated'], true);
  });

  it('writes the WordPress guid as the feed guid only where it differs from the ActivityPub id', async () => {
    const imported = await (
      await site()
    ).run([
      { id: 813, slug: 'permalink-guid', guid: `${SITE}/2024/03/permalink-guid/` },
      { id: 30, slug: 'eleventy', guid: 'https://old.example/essays/eleventy/' },
      { id: 40, slug: 'plain' },
    ]);

    assert.equal(
      (await imported.frontMatter('posts/2024-03-05-permalink-guid.md'))['guid'],
      `${SITE}/2024/03/permalink-guid/`,
    );
    assert.equal(
      (await imported.frontMatter('posts/2024-03-05-eleventy.md'))['guid'],
      'https://old.example/essays/eleventy/',
    );
    assert.equal((await imported.frontMatter('posts/2024-03-05-plain.md'))['guid'], undefined);
  });

  it('imports drafts, scheduled, private and protected posts by what WordPress showed of them', async () => {
    const imported = await (
      await site()
    ).run([
      {
        id: 1,
        slug: 'a-draft',
        status: 'draft',
        link: `${SITE}/?p=1`,
        dateGmt: '0000-00-00 00:00:00',
      },
      {
        id: 2,
        slug: 'pending',
        status: 'pending',
        link: `${SITE}/?p=2`,
        guid: 'https://old.example/essays/pending/',
      },
      {
        id: 3,
        slug: 'scheduled',
        status: 'future',
        dateGmt: '2030-01-02 03:04:05',
        date: '2030-01-01 22:04:05',
        link: `${SITE}/?p=3`,
      },
      { id: 4, slug: 'secret', status: 'private' },
      { id: 5, slug: 'locked', password: 'hunter2' },
      { id: 6, slug: 'binned', status: 'trash' },
      { id: 7, slug: 'published' },
    ]);

    const draft = await imported.frontMatter('posts/2024-03-05-a-draft.md');
    assert.equal(draft['draft'], true);
    assert.equal(draft['date'], undefined, 'WordPress dates a draft when it is published');
    assert.equal(draft['permalink'], '/2024/03/a-draft/', 'the permalink the published posts use');
    assert.equal(draft['migrated'], true, 'a draft may have been public before WordPress');
    assert.equal(draft['activitypub'], undefined, 'WordPress never served it as an object');
    assert.equal(draft['guid'], undefined, 'its guid is only its ?p= address');

    const pending = await imported.frontMatter('posts/2024-03-05-pending.md');
    assert.equal(pending['draft'], true);
    assert.equal(
      pending['guid'],
      'https://old.example/essays/pending/',
      'feed readers that held it before WordPress see no new post when it is published',
    );

    const scheduled = await imported.frontMatter('posts/2030-01-01-scheduled.md');
    assert.equal(scheduled['draft'], undefined);
    assert.equal(scheduled['date'], '2030-01-02T03:04:05Z');
    assert.equal(scheduled['permalink'], '/2030/01/scheduled/');
    assert.equal(scheduled['migrated'], undefined, 'it publishes here as news, as on WordPress');

    const secret = await imported.frontMatter('posts/2024-03-05-secret.md');
    assert.equal(secret['draft'], true);
    assert.equal(secret['migrated'], true);
    assert.match(
      rowsFor(imported.rows, 4).find((row) => row.outcome === 'warned')?.why ?? '',
      /private/,
    );

    const locked = await imported.frontMatter('posts/2024-03-05-locked.md');
    assert.equal(locked['draft'], true);
    assert.match(
      rowsFor(imported.rows, 5).find((row) => row.outcome === 'warned')?.why ?? '',
      /password/,
    );

    assert.deepEqual(
      rowsFor(imported.rows, 6).map((row) => row.outcome),
      ['skipped'],
    );
    assert.ok(!(await imported.files()).some((file) => file.includes('binned')));
    assert.equal((await imported.frontMatter('posts/2024-03-05-published.md'))['draft'], undefined);
  });

  it('imports a status post with no title, so it reads as a note', async () => {
    const imported = await (
      await site()
    ).run([
      {
        id: 10,
        slug: 'a-status',
        title: 'Where is it?',
        terms: [{ taxonomy: 'post_format', slug: 'post-format-status', name: 'Status' }],
      },
      {
        id: 11,
        slug: 'untitled-status',
        title: '',
        terms: [{ taxonomy: 'post_format', slug: 'post-format-status', name: 'Status' }],
      },
    ]);

    assert.equal((await imported.frontMatter('posts/2024-03-05-a-status.md'))['title'], undefined);
    assert.equal(
      (await imported.frontMatter('posts/2024-03-05-untitled-status.md'))['title'],
      undefined,
    );
  });

  it('matches the author by login and names a post by a login the site has no user for', async () => {
    const imported = await (
      await site()
    ).run([
      { id: 10, slug: 'by-ada' },
      { id: 11, slug: 'by-guest', creator: 'guest' },
    ]);

    assert.equal((await imported.frontMatter('posts/2024-03-05-by-ada.md'))['author'], 'ada');
    assert.equal((await imported.frontMatter('posts/2024-03-05-by-guest.md'))['author'], undefined);
    const warned = rowsFor(imported.rows, 11).find((row) => row.outcome === 'warned');
    assert.match(warned?.why ?? '', /guest/);
  });

  it('makes the static front page the site.json homepage, and leaves one the site chose', async () => {
    const front = { id: 238, type: 'page', slug: 'home-page', title: 'Home', link: `${SITE}/` };
    const fresh = await site({ title: 'Blog', tagline: 'Kept' });
    const imported = await fresh.run([front]);

    assert.equal((await imported.frontMatter('pages/home-page.md'))['permalink'], '/home-page/');
    const siteJson = JSON.parse(await imported.file('_data/site.json')) as Record<string, unknown>;
    assert.deepEqual(siteJson, { title: 'Blog', tagline: 'Kept', homepage: 'home-page' });

    const chosen = await site({ title: 'Blog', homepage: 'welcome' });
    const again = await chosen.run([front]);
    assert.equal(
      (JSON.parse(await again.file('_data/site.json')) as Record<string, unknown>)['homepage'],
      'welcome',
    );
    assert.ok(
      rowsFor(again.rows, 238).some(
        (row) => row.outcome === 'clash' && row.path === '_data/site.json',
      ),
    );
  });

  it('converts block and classic markup to Markdown and keeps what Markdown cannot say as HTML', async () => {
    const blocks = [
      '<!-- wp:paragraph -->',
      '<p>A <strong>bold</strong> <a href="https://example.com/a_b">link</a>, and <code>code</code>.</p>',
      '<!-- /wp:paragraph -->',
      '',
      '<!-- wp:heading -->',
      '<h2 class="wp-block-heading">A heading</h2>',
      '<!-- /wp:heading -->',
      '',
      '<!-- wp:list -->',
      '<ul class="wp-block-list"><!-- wp:list-item -->',
      '<li>One</li>',
      '<!-- /wp:list-item --><!-- wp:list-item -->',
      '<li>Two</li>',
      '<!-- /wp:list-item --></ul>',
      '<!-- /wp:list -->',
      '',
      '<!-- wp:code -->',
      '<pre class="wp-block-code"><code class="language-php">echo 1 &lt; 2;\n</code></pre>',
      '<!-- /wp:code -->',
      '',
      '<!-- wp:image {"id":5} -->',
      '<figure class="wp-block-image"><img src="https://blog.example/a.png" alt="An A"/><figcaption class="wp-element-caption">The letter A</figcaption></figure>',
      '<!-- /wp:image -->',
      '',
      '<!-- wp:table -->',
      '<figure class="wp-block-table"><table><tbody><tr><td colspan="2">Wide</td></tr><tr><td>a</td><td>b</td></tr></tbody></table></figure>',
      '<!-- /wp:table -->',
      '',
      '<!-- wp:html -->',
      '<iframe src="https://maps.example/embed?x=1" width="400"></iframe>',
      '<!-- /wp:html -->',
      '',
      '<!-- wp:paragraph -->',
      '<p></p>',
      '<!-- /wp:paragraph -->',
    ].join('\n');
    const classic = [
      'First paragraph with <em>emphasis</em>.',
      '',
      'Second paragraph,',
      'with a line break.',
      '',
      '<!--more-->',
      '',
      '<table><tr><th>Name</th><th>Value</th></tr><tr><td>a</td><td>1</td></tr></table>',
      '',
      '<div class="h-card"><span class="p-name">Ada</span></div>',
    ].join('\n');

    const imported = await (
      await site()
    ).run([
      { id: 10, slug: 'blocks', content: blocks },
      { id: 11, slug: 'classic', content: classic },
    ]);

    assert.equal(
      await imported.body('posts/2024-03-05-blocks.md'),
      [
        'A **bold** [link](https://example.com/a_b), and `code`.',
        '',
        '## A heading',
        '',
        '- One',
        '- Two',
        '',
        '```php',
        'echo 1 < 2;',
        '```',
        '',
        '<figure class="wp-block-image">',
        '<img src="https://blog.example/a.png" alt="An A">',
        '<figcaption class="wp-element-caption">The letter A</figcaption>',
        '</figure>',
        '',
        '<table>',
        '<tbody>',
        '<tr>',
        '<td colspan="2">Wide</td>',
        '</tr>',
        '<tr>',
        '<td>a</td>',
        '<td>b</td>',
        '</tr>',
        '</tbody>',
        '</table>',
        '',
        '<iframe src="https://maps.example/embed?x=1" width="400"></iframe>',
        '',
      ].join('\n'),
    );
    assert.equal(
      await imported.body('posts/2024-03-05-classic.md'),
      [
        'First paragraph with _emphasis_.',
        '',
        'Second paragraph,  ',
        'with a line break.',
        '',
        '<!--more-->',
        '',
        '| Name | Value |',
        '| --- | --- |',
        '| a | 1 |',
        '',
        '<div class="h-card">',
        '<span class="p-name">Ada</span>',
        '</div>',
        '',
      ].join('\n'),
    );
  });

  it('turns a YouTube or Vimeo iframe or embed block into the video URL on a line of its own', async () => {
    const content = [
      '<p>Watch this:</p>',
      '<p><iframe width="560" height="315" src="https://www.youtube.com/embed/dQw4w9WgXcQ?start=42" frameborder="0" allowfullscreen></iframe></p>',
      '<iframe src="https://player.vimeo.com/video/76979871?h=8272103f6e&amp;badge=0" width="640"></iframe>',
      '<!-- wp:embed {"url":"https://youtu.be/9bZkp7q19f0","type":"video","providerNameSlug":"youtube"} -->',
      '<figure class="wp-block-embed is-type-video is-provider-youtube wp-block-embed-youtube"><div class="wp-block-embed__wrapper">',
      'https://youtu.be/9bZkp7q19f0',
      '</div></figure>',
      '<!-- /wp:embed -->',
    ].join('\n');

    const imported = await (await site()).run([{ id: 10, slug: 'videos', content }]);

    const body = await imported.body('posts/2024-03-05-videos.md');
    assert.doesNotMatch(body, /<iframe/);
    assert.equal(
      body,
      [
        'Watch this:',
        '',
        'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42',
        '',
        'https://vimeo.com/76979871/8272103f6e',
        '',
        'https://youtu.be/9bZkp7q19f0',
        '',
      ].join('\n'),
    );
  });

  it('makes a reply block the post’s in-reply-to', async () => {
    const content = [
      '<!-- wp:activitypub/reply {"url":"https://daveverse.example/2026/04/29/8611/","embedPost":true} /-->',
      '',
      '<!-- wp:paragraph -->',
      '<p>I disagree.</p>',
      '<!-- /wp:paragraph -->',
    ].join('\n');

    const imported = await (await site()).run([{ id: 10, slug: 'reply', content }]);

    assert.equal(
      (await imported.frontMatter('posts/2024-03-05-reply.md'))['in-reply-to'],
      'https://daveverse.example/2026/04/29/8611/',
    );
    assert.equal(await imported.body('posts/2024-03-05-reply.md'), 'I disagree.\n');
  });

  it('picks up the posts, pages and edits a newer export carries', async () => {
    const fresh = await site();
    await fresh.run([
      { id: 10, slug: 'kept', content: '<p>First draft.</p>' },
      { id: 20, type: 'page', slug: 'about', link: `${SITE}/about/` },
    ]);

    const newer = await fresh.run([
      {
        id: 10,
        slug: 'kept',
        content: '<p>Revised on WordPress.</p>',
        modifiedGmt: '2024-04-01 08:00:00',
      },
      { id: 20, type: 'page', slug: 'about', link: `${SITE}/about/` },
      { id: 11, slug: 'arrived-later', content: '<p>New since the last run.</p>' },
      { id: 21, type: 'page', slug: 'now', link: `${SITE}/now/` },
    ]);

    assert.deepEqual(
      newer.rows
        .filter((row) => row.path !== '_data/redirects/wordpress.json')
        .map((row) => [row.item.id, row.outcome, row.why]),
      [
        [10, 'written', 'changed on WordPress since the last import'],
        [20, 'unchanged', 'already as WordPress has it'],
        [11, 'written', 'new'],
        [21, 'written', 'new'],
      ],
    );
    assert.equal(await newer.body('posts/2024-03-05-kept.md'), 'Revised on WordPress.\n');
    assert.equal(
      await newer.body('posts/2024-03-05-arrived-later.md'),
      'New since the last run.\n',
    );
    assert.equal((await newer.frontMatter('pages/now.md'))['permalink'], '/now/');
  });

  it('writes the same bytes on a second run', async () => {
    const items: TestItem[] = [
      {
        id: 10,
        slug: 'one',
        meta: [FEDERATED],
        terms: [{ taxonomy: 'post_tag', slug: 'b', name: 'B' }],
      },
      { id: 20, type: 'page', slug: 'home', link: `${SITE}/` },
    ];
    const fresh = await site();
    const first = await fresh.run(items);
    const before = await Promise.all((await first.files()).map((file) => first.file(file)));
    const second = await fresh.run(items);

    assert.deepEqual(
      await Promise.all((await second.files()).map((file) => second.file(file))),
      before,
    );
    assert.ok(
      second.rows.every((row) => row.outcome === 'unchanged'),
      JSON.stringify(second.rows),
    );
  });
});
