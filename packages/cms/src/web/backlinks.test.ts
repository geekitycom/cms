/**
 * Backlinks (TASK-322): the site's own posts and pages that link to a post or
 * a page, printed under it as "Linked from" by the packaged theme, and never
 * sent as webmentions.
 *
 * Asserted over HTTP against the packaged theme, because the list is markup a
 * reader gets; and against the admin store, because what must not happen is a
 * row in it.
 */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { sandbox } from '../admin/__testing__/harness.ts';
import type { Cms } from '../index.ts';

const box = sandbox();
after(() => box.cleanup());

const NOW = '2026-09-13T12:00:00Z';
const BASE = 'https://blog.example';

const CONTENT: Record<string, string> = {
  '_data/site.json': JSON.stringify({ title: 'A Site' }),
  'posts/target.md':
    "---\ntitle: The target\ndate: '2026-09-01T09:00:00Z'\npermalink: /2026/09/target/\n---\n\nA post worth citing, [itself](/2026/09/target/).\n",
  'posts/citing.md':
    "---\ntitle: Citing it\ndate: '2026-09-03T09:00:00Z'\npermalink: /2026/09/citing/\n---\n\nAs [I wrote](https://blog.example/2026/09/target).\n",
  'posts/note.md':
    "---\ndate: '2026-09-05T09:00:00Z'\npermalink: /2026/09/note/\n---\n\nStill true: [this](/2026/09/target/#more).\n",
  'posts/draft.md':
    "---\ntitle: Not yet\ndraft: true\ndate: '2026-09-04T09:00:00Z'\npermalink: /2026/09/draft/\n---\n\n[A link](/2026/09/target/).\n",
  'pages/about.md':
    '---\ntitle: About\npermalink: /about/\n---\n\nStart with [the target](/2026/09/target/).\n',
  'pages/colophon.md': '---\ntitle: Colophon\npermalink: /colophon/\n---\n\nNothing links here.\n',
};

async function site(): Promise<Cms> {
  const contentDir = await box.dir('geekity-backlinks-content-');
  for (const [relative, contents] of Object.entries(CONTENT)) {
    const file = path.join(contentDir, ...relative.split('/'));
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, contents, 'utf8');
  }
  return await box.open({
    contentDir,
    dataDir: await box.dir('geekity-backlinks-data-'),
    baseUrl: BASE,
    now: () => new Date(NOW),
  });
}

async function page(cms: Cms, pathname: string): Promise<string> {
  const response = await cms.app.request(pathname);
  assert.equal(response.status, 200, `GET ${pathname} answered ${String(response.status)}`);
  return response.text();
}

function linkedFrom(html: string): string | undefined {
  return /<section class="backlinks"[^>]*>([\s\S]*?)<\/section>/.exec(html)?.[1];
}

describe('the backlinks of a post (TASK-322)', () => {
  it('prints the posts and pages linking to it, newest first, apart from the comments', async () => {
    const html = await page(await site(), '/2026/09/target/');
    const list = linkedFrom(html);
    assert.ok(list !== undefined, 'there is no Linked from section');

    assert.match(list, /<h2[^>]*>Linked from<\/h2>/);
    const links = [...list.matchAll(/<a href="([^"]+)">([^<]+)<\/a>/g)].map(([, url, label]) => [
      url,
      label,
    ]);
    assert.deepEqual(links, [
      ['/2026/09/note/', 'Still true: this.'],
      ['/2026/09/citing/', 'Citing it'],
      ['/about/', 'About'],
    ]);
    assert.match(
      list,
      /<time datetime="2026-09-03T09:00:00\.000Z">3 September 2026<\/time>/,
      'a backlink is dated',
    );
    assert.ok(
      html.indexOf('class="backlinks"') > html.indexOf('</article>'),
      'the list follows the entry',
    );
  });

  it('prints nothing on a post or a page nothing links to', async () => {
    const cms = await site();
    assert.equal(linkedFrom(await page(cms, '/2026/09/citing/')), undefined);
    assert.equal(linkedFrom(await page(cms, '/colophon/')), undefined);
  });

  it('prints them under a page too', async () => {
    const cms = await site();
    await writeFile(
      path.join(cms.config.contentDir, 'posts', 'citing.md'),
      "---\ntitle: Citing it\ndate: '2026-09-03T09:00:00Z'\npermalink: /2026/09/citing/\n---\n\nSee [the colophon](/colophon/).\n",
      'utf8',
    );
    await cms.sync();
    const list = linkedFrom(await page(cms, '/colophon/'));
    assert.ok(list?.includes('<a href="/2026/09/citing/">Citing it</a>'));
  });

  it('sends no webmention, and writes no comment, for a link to the site’s own pages', async () => {
    const cms = await site();
    const report = await cms.webmentions.send('citing');
    assert.deepEqual(report?.sent, [], 'a webmention was sent to the site itself');
    await cms.webmentions.settled();

    assert.deepEqual(cms.admin.listSentWebmentions('citing'), []);
    assert.deepEqual(cms.admin.listComments({}), [], 'a comment was recorded');
    assert.equal(
      Object.values(cms.admin.countCommentsByStatus()).reduce((sum, count) => sum + count, 0),
      0,
      'something is waiting in moderation',
    );
    assert.doesNotMatch(await page(cms, '/2026/09/target/'), /comments-area|reactions-section/);
  });
});

describe('backlinks through the homepage and the site’s redirects (TASK-330)', () => {
  const IMPORTED: Record<string, string> = {
    '_data/site.json': JSON.stringify({ title: 'A Site', homepage: 'welcome', theme: 'front' }),
    '_data/redirects/imported.json': JSON.stringify({
      '/?p=7': '/2019/05/first-post/',
      '/?p=12': '/welcome/',
      '/?page_id=12': '/welcome/',
    }),
    'pages/welcome.md': '---\ntitle: Welcome\npermalink: /welcome/\n---\n\nHello.\n',
    'posts/first-post.md':
      "---\ntitle: First post\ndate: '2019-05-01T09:00:00Z'\npermalink: /2019/05/first-post/\n---\n\nThe first.\n",
    'posts/second-post.md':
      "---\ntitle: Second post\ndate: '2019-06-01T09:00:00Z'\npermalink: /2019/06/second-post/\n---\n\nFollowing up [my first post](https://blog.example/?p=7) and [the front page](/).\n",
  };

  async function imported(): Promise<Cms> {
    const contentDir = await box.dir('geekity-backlinks-imported-');
    const themesDir = await box.dir('geekity-backlinks-imported-themes-');
    const files: Record<string, string> = {
      ...Object.fromEntries(
        Object.entries(IMPORTED).map(([relative, contents]) => [
          path.join(contentDir, relative),
          contents,
        ]),
      ),
      [path.join(themesDir, 'front', 'theme.json')]: JSON.stringify({
        name: 'Front',
        kind: 'site',
      }),
      [path.join(themesDir, 'front', 'layouts', 'front-page.njk')]:
        '{% extends "layouts/base.njk" %}{% block content %}{{ content | safe }}{% include "partials/backlinks.njk" %}{% endblock %}',
    };
    for (const [file, contents] of Object.entries(files)) {
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, contents, 'utf8');
    }
    return await box.open({
      contentDir,
      themesDir,
      dataDir: await box.dir('geekity-backlinks-imported-data-'),
      baseUrl: BASE,
      now: () => new Date(NOW),
    });
  }

  it('lists an imported post’s ?p= link under the post the redirect leads to', async () => {
    const cms = await imported();
    const list = linkedFrom(await page(cms, '/2019/05/first-post/'));
    assert.ok(
      list?.includes('<a href="/2019/06/second-post/">Second post</a>'),
      list ?? 'no Linked from section',
    );
  });

  it('lists a link to / under the page the Reading setting makes the homepage, for a front page that prints them', async () => {
    const cms = await imported();
    const list = linkedFrom(await page(cms, '/'));
    assert.ok(
      list?.includes('<a href="/2019/06/second-post/">Second post</a>'),
      list ?? 'no Linked from section',
    );
  });

  it('drops the backlink when the redirect is taken out, with the linking post untouched', async () => {
    const cms = await imported();
    assert.ok(linkedFrom(await page(cms, '/2019/05/first-post/')) !== undefined);
    await writeFile(
      path.join(cms.config.contentDir, '_data', 'redirects', 'imported.json'),
      JSON.stringify({ '/?p=12': '/welcome/' }),
      'utf8',
    );
    assert.equal(linkedFrom(await page(cms, '/2019/05/first-post/')), undefined);
  });
});
