import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { sandbox } from '../admin/__testing__/harness.ts';
import type { Cms } from '../index.ts';
import { setUserProfile } from '../site/users.ts';
import { createUser } from './__testing__/users.ts';

const box = sandbox();
after(() => box.cleanup());

const BASE_URL = 'https://blog.example';

const LINKED_BIO = 'Start [here](/about/), or read [elsewhere](https://elsewhere.example/).';

async function site(bio: string): Promise<Cms> {
  const contentDir = await box.dir('geekity-bio-content-');
  const dataDir = await box.dir('geekity-bio-data-');
  const files: Record<string, string> = {
    '_data/site.json': JSON.stringify({ title: 'Field Notes', author: 'ada' }),
    'pages/about.md': '---\ntitle: About\npermalink: /about/\n---\n\nWho writes this.\n',
    'posts/2026-09-01-one.md':
      "---\ntitle: One\ndate: '2026-09-01T09:00:00Z'\npermalink: /2026/09/one/\nauthor: ada\n---\n\nThe first.\n",
  };
  for (const [relative, contents] of Object.entries(files)) {
    const file = path.join(contentDir, ...relative.split('/'));
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, contents, 'utf8');
  }
  const ada = await createUser({ dataDir, username: 'ada', password: 'correct horse battery' });
  await setUserProfile({ dataDir, userId: ada.id, profile: { displayName: 'Ada Lovelace', bio } });
  return box.open(
    { contentDir, dataDir, baseUrl: BASE_URL, now: () => new Date('2026-09-28T12:00:00Z') },
    { actorKeys: ['ada'] },
  );
}

async function get(cms: Cms, pathname: string, accept?: string): Promise<string> {
  const response = await cms.app.request(
    new Request(`${BASE_URL}${pathname}`, accept === undefined ? {} : { headers: { accept } }),
  );
  assert.equal(response.status, 200, pathname);
  return response.text();
}

async function actorSummary(cms: Cms): Promise<unknown> {
  const actor = JSON.parse(await get(cms, '/author/ada/', 'application/activity+json')) as Record<
    string,
    unknown
  >;
  return actor['summary'];
}

async function personDescription(cms: Cms): Promise<unknown> {
  const html = await get(cms, '/about/');
  const json = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)?.[1];
  assert.ok(json !== undefined, 'no JSON-LD');
  const graph = (JSON.parse(json) as { '@graph': Record<string, unknown>[] })['@graph'];
  return graph.find((node) => node['@type'] === 'Person')?.['description'];
}

describe('a bio with a link in it', () => {
  it('links from the card under a post, keeping the p-note', async () => {
    const html = await get(await site(LINKED_BIO), '/2026/09/one/');

    assert.match(
      html,
      /<div class="bio-note p-note"><p>Start <a href="\/about\/">here<\/a>, or read <a href="https:\/\/elsewhere\.example\/">elsewhere<\/a>\.<\/p>/,
    );
  });

  it('prints the Markdown as written in the .md, with the site’s links at their .md URLs', async () => {
    const markdown = await get(await site(LINKED_BIO), '/author/ada/index.md');

    assert.ok(
      markdown.includes(
        'Start [here](/about/index.md), or read [elsewhere](https://elsewhere.example/).',
      ),
      markdown,
    );
  });

  it('is text and link lines in the .gmi', async () => {
    const gemtext = await get(await site(LINKED_BIO), '/author/ada/index.gmi');

    assert.ok(gemtext.includes('Start here[1], or read elsewhere[2].'), gemtext);
    assert.match(gemtext, /^=> \/about\/index\.gmi 1: \/about\/index\.gmi$/m, gemtext);
    assert.match(gemtext, /^=> https:\/\/elsewhere\.example\/ 2: /m, gemtext);
  });

  it('is HTML with absolute links in the actor’s summary', async () => {
    assert.equal(
      await actorSummary(await site(LINKED_BIO)),
      '<p>Start <a href="https://blog.example/about/">here</a>, or read ' +
        '<a href="https://elsewhere.example/">elsewhere</a>.</p>\n',
    );
  });

  it('is text in the JSON-LD Person', async () => {
    assert.equal(await personDescription(await site(LINKED_BIO)), 'Start here, or read elsewhere.');
  });
});

describe('a bio with raw HTML in it', () => {
  const RAW = 'Hi <script>alert(1)</script> & <b>bold</b>';

  it('is escaped on the card and in the actor’s summary', async () => {
    const cms = await site(RAW);
    const escaped = 'Hi &lt;script&gt;alert(1)&lt;/script&gt; &amp; &lt;b&gt;bold&lt;/b&gt;';

    assert.ok((await get(cms, '/2026/09/one/')).includes(`<p>${escaped}</p>`));
    assert.equal(await actorSummary(cms), `<p>${escaped}</p>\n`);
    assert.equal(await personDescription(cms), RAW);
  });
});

describe('a bio with no Markdown in it', () => {
  const PLAIN = 'Wrote the first program.';

  it('reads as it did in every format', async () => {
    const cms = await site(PLAIN);

    assert.ok((await get(cms, '/2026/09/one/')).includes(`<p>${PLAIN}</p>`));
    assert.match(await get(cms, '/author/ada/index.md'), /^Wrote the first program\.$/m);
    assert.match(await get(cms, '/author/ada/index.gmi'), /^Wrote the first program\.$/m);
    assert.equal(await actorSummary(cms), `<p>${PLAIN}</p>\n`);
    assert.equal(await personDescription(cms), PLAIN);
  });
});
