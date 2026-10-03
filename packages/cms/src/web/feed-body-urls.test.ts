import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { resolveNothing } from '../admin/__testing__/harness.ts';
import { createCms } from '../index.ts';
import type { Cms } from '../index.ts';
import { child, parseXml } from './__testing__/xml.ts';

const started: Cms[] = [];
const temporaryDirs: string[] = [];

after(async () => {
  for (const instance of started) await instance.close();
  await Promise.all(temporaryDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

async function site(baseUrl: string, body: string): Promise<Cms> {
  const contentDir = await mkdtemp(path.join(tmpdir(), 'geekity-feed-body-urls-content-'));
  const dataDir = await mkdtemp(path.join(tmpdir(), 'geekity-feed-body-urls-data-'));
  temporaryDirs.push(contentDir, dataDir);
  const file = path.join(contentDir, 'posts/2026-10-01-gull.md');
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(
    file,
    [
      '---',
      'title: A gull',
      "date: '2026-10-01T09:00:00Z'",
      'permalink: /2026/10/gull/',
      '---',
      '',
      body,
      '',
    ].join('\n'),
  );
  const cms = createCms({ contentDir, dataDir, watch: false, baseUrl, hostLookup: resolveNothing });
  started.push(cms);
  await cms.sync();
  return cms;
}

const RELATIVE_BODY = [
  '![A gull](/uploads/2026/10/gull.jpg)',
  '',
  'See [the archive](/2026/10/) and [the next one](../next/?a=1&b=2).',
  '',
  '<img src="gull-close.jpg" srcset="/uploads/2026/10/gull-400.jpg 400w, gull-800.jpg 800w" alt="Closer">',
].join('\n');

const RELATIVE_EXPECTED =
  '<p><img src="https://example.com/uploads/2026/10/gull.jpg" alt="A gull"></p>\n' +
  '<p>See <a href="https://example.com/2026/10/">the archive</a> and ' +
  '<a href="https://example.com/2026/10/next/?a=1&amp;b=2">the next one</a>.</p>\n' +
  '<img src="https://example.com/2026/10/gull/gull-close.jpg"' +
  ' srcset="https://example.com/uploads/2026/10/gull-400.jpg 400w,' +
  ' https://example.com/2026/10/gull/gull-800.jpg 800w" alt="Closer">';

const UNTOUCHED_BODY = [
  'A [footnote][^1], [a mail](mailto:gull@example.com), [elsewhere](https://elsewhere.example/gull/)',
  'and [the top](#top).',
  '',
  '<img src="https://cdn.example.org/gull.jpg" srcset="https://cdn.example.org/gull-2x.jpg 2x" alt="">',
  '',
  '[^1]: A note.',
].join('\n');

interface Format {
  name: string;
  content(cms: Cms): Promise<string>;
}

const FORMATS: Format[] = [
  {
    name: 'RSS content:encoded',
    async content(cms) {
      const feed = parseXml(await (await cms.app.request('/feed/')).text());
      return child(child(child(feed, 'channel'), 'item'), 'content:encoded').text;
    },
  },
  {
    name: 'Atom content',
    async content(cms) {
      const feed = parseXml(await (await cms.app.request('/feed/atom/')).text());
      return child(child(feed, 'entry'), 'content').text;
    },
  },
  {
    name: 'JSON Feed content_html',
    async content(cms) {
      const feed = (await (await cms.app.request('/feed/json/')).json()) as {
        items: { content_html: string }[];
      };
      return feed.items[0]?.content_html ?? '';
    },
  },
];

for (const format of FORMATS) {
  describe(`body URLs in the ${format.name} (TASK-226)`, () => {
    it('prints a relative src, href and srcset absolute on the site’s base URL', async () => {
      const cms = await site('https://example.com', RELATIVE_BODY);

      assert.equal((await format.content(cms)).trim(), RELATIVE_EXPECTED);
    });

    it('leaves an absolute URL, a fragment and a mailto: link as they are', async () => {
      const cms = await site('https://example.com', UNTOUCHED_BODY);
      const content = await format.content(cms);

      assert.match(content, /href="mailto:gull@example\.com"/, 'mailto: kept');
      assert.match(content, /href="https:\/\/elsewhere\.example\/gull\/"/, 'absolute href kept');
      assert.match(content, /href="#top"/, 'fragment kept');
      assert.match(content, /href="#fn1"/, 'footnote reference kept');
      assert.match(content, /href="#fnref1"/, 'footnote back-reference kept');
      assert.match(
        content,
        /<img src="https:\/\/cdn\.example\.org\/gull\.jpg" srcset="https:\/\/cdn\.example\.org\/gull-2x\.jpg 2x" alt="">/,
        'absolute src and srcset kept',
      );
      assert.doesNotMatch(content, /example\.com\/[^"]*#/, 'no fragment was made absolute');
    });

    it('keeps the base URL’s path for a site served under one', async () => {
      const cms = await site('https://example.com/blog', '![A gull](/uploads/2026/10/gull.jpg)');

      assert.match(
        await format.content(cms),
        /<img src="https:\/\/example\.com\/blog\/uploads\/2026\/10\/gull\.jpg" alt="A gull">/,
      );
    });
  });
}
