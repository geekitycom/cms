import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { sandbox } from '../admin/__testing__/harness.ts';
import type { FollowingRecord } from '../following/list.ts';
import type { Cms } from '../index.ts';
import { child, childrenNamed, parseXml } from './__testing__/xml.ts';

const box = sandbox();
after(() => box.cleanup());

const SOURCE = 'https://public.example/index.opml';

const RECORD: FollowingRecord = {
  source: SOURCE,
  list: {
    feeds: [
      {
        text: 'Aaron <Parecki> & co',
        xmlUrl: 'https://aaronparecki.com/feed.xml',
        htmlUrl: 'https://aaronparecki.com/',
        description: 'Notes "and" articles',
        category: '/Indieweb',
      },
      { text: 'Top level', xmlUrl: 'https://top.example/feed?a=1&b=2' },
    ],
    fetchedAt: '2026-11-16T20:00:00.000Z',
    changedAt: '2026-11-16T18:00:00.000Z',
    opmlUrl: SOURCE,
  },
};

async function site(options: { followingOpml?: string; record?: FollowingRecord }): Promise<Cms> {
  const contentDir = await box.dir('geekity-following-content-');
  const dataDir = await box.dir('geekity-following-data-');
  await mkdir(path.join(contentDir, '_data'), { recursive: true });
  await writeFile(
    path.join(contentDir, '_data', 'site.json'),
    JSON.stringify({ title: 'Engines', followingOpml: options.followingOpml ?? '' }),
    'utf8',
  );
  if (options.record !== undefined) {
    await writeFile(path.join(dataDir, 'following.json'), JSON.stringify(options.record), 'utf8');
  }
  return box.open({ contentDir, dataDir, baseUrl: 'https://blog.example' });
}

async function get(cms: Cms, pathname: string, headers: Record<string, string> = {}) {
  const response = await cms.app.request(pathname, { headers });
  return { response, body: await response.text() };
}

const FOLLOWING_LINK = /<link rel="following"[^>]*>/;

describe('/.well-known/following.opml', () => {
  it('is the stored list as flat OPML 2.0', async () => {
    const cms = await site({ followingOpml: SOURCE, record: RECORD });
    const { response, body } = await get(cms, '/.well-known/following.opml');

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'text/x-opml; charset=utf-8');
    assert.equal(response.headers.get('access-control-allow-origin'), '*');

    const opml = parseXml(body);
    assert.equal(opml.name, 'opml');
    assert.equal(opml.attributes['version'], '2.0');
    const head = child(opml, 'head');
    assert.equal(child(head, 'title').text, 'Feeds Engines follows');
    assert.equal(child(head, 'dateModified').text, 'Mon, 16 Nov 2026 18:00:00 GMT');
    assert.equal(child(head, 'docs').text, 'http://opml.org/spec2.opml');

    const outlines = childrenNamed(child(opml, 'body'), 'outline');
    assert.deepEqual(
      outlines.map((outline) => outline.attributes),
      [
        {
          type: 'rss',
          text: 'Aaron <Parecki> & co',
          xmlUrl: 'https://aaronparecki.com/feed.xml',
          htmlUrl: 'https://aaronparecki.com/',
          description: 'Notes "and" articles',
          category: '/Indieweb',
        },
        { type: 'rss', text: 'Top level', xmlUrl: 'https://top.example/feed?a=1&b=2' },
      ],
    );
    assert.ok(
      outlines.every((outline) => outline.children.length === 0),
      'one level deep',
    );
  });

  it('answers a matching If-None-Match with 304', async () => {
    const cms = await site({ followingOpml: SOURCE, record: RECORD });
    const first = await get(cms, '/.well-known/following.opml');
    const etag = first.response.headers.get('etag');
    assert.ok(etag !== null, 'an ETag');

    const again = await get(cms, '/.well-known/following.opml', { 'if-none-match': etag });
    assert.equal(again.response.status, 304);
    assert.equal(again.response.headers.get('access-control-allow-origin'), '*');
  });

  it('is a 404 while no list is set', async () => {
    const cms = await site({ record: RECORD });
    assert.equal((await get(cms, '/.well-known/following.opml')).response.status, 404);
  });

  it('is a 404 while nothing has been fetched from the address set', async () => {
    const cms = await site({ followingOpml: SOURCE });
    assert.equal((await get(cms, '/.well-known/following.opml')).response.status, 404);

    const elsewhere = await site({
      followingOpml: 'https://other.example/list.opml',
      record: RECORD,
    });
    assert.equal((await get(elsewhere, '/.well-known/following.opml')).response.status, 404);
  });

  it('is a 404 while the only fetch failed', async () => {
    const cms = await site({
      followingOpml: SOURCE,
      record: { source: SOURCE, failure: { at: '2026-11-16T20:00:00.000Z', reason: 'down' } },
    });
    assert.equal((await get(cms, '/.well-known/following.opml')).response.status, 404);
  });
});

describe('the front page’s rel=following link', () => {
  it('points at the list while one is served', async () => {
    const cms = await site({ followingOpml: SOURCE, record: RECORD });
    const { body } = await get(cms, '/');

    assert.equal(
      FOLLOWING_LINK.exec(body)?.[0],
      '<link rel="following" type="text/x-opml" title="Feeds Engines follows" href="https://blog.example/.well-known/following.opml">',
    );
  });

  it('is left out while no list is served', async () => {
    for (const cms of [await site({ record: RECORD }), await site({ followingOpml: SOURCE })]) {
      assert.doesNotMatch((await get(cms, '/')).body, FOLLOWING_LINK);
    }
  });
});
