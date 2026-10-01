import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { createUser, setUserProfile } from '../admin/accounts.ts';
import { createCms } from '../index.ts';
import type { Cms } from '../index.ts';

/**
 * Who the site is, from the outside (TASK-180, TASK-192).
 *
 * `author` in site.json names one user by username, and the site is then that
 * user's: the homepage carries their bio card and their `rel="me"` links, and
 * it and their archive point at each other with `rel="me"`. A site with no
 * author has several authors, and its homepage speaks for nobody.
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

const MASTODON = 'https://example.social/@ada';

const POSTS: Record<string, string> = {
  'posts/2026-09-02-hello.md':
    "---\ntitle: Hello\ndate: '2026-09-02T09:00:00Z'\npermalink: /2026/09/hello/\nauthor: ada\n---\n\nHello.\n",
  'pages/welcome.md': '---\ntitle: Welcome\npermalink: /welcome/\n---\n\nHello and welcome.\n',
};

/**
 * A site with Ada, who has a profile with a Mastodon link, as a user. The
 * settings say whether she is the site's author.
 */
async function site(settings: Record<string, unknown>): Promise<Cms> {
  const contentDir = await temporaryDir('geekity-solo-content-');
  const dataDir = await temporaryDir('geekity-solo-data-');
  const files = {
    ...POSTS,
    '_data/site.json': `${JSON.stringify({ title: 'A Site', ...settings }, null, 2)}\n`,
  };
  for (const [relative, contents] of Object.entries(files)) {
    const file = path.join(contentDir, relative);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, contents, 'utf8');
  }

  const ada = await createUser({ dataDir, username: 'ada', password: 'correct horse battery' });
  await setUserProfile({
    dataDir,
    userId: ada.id,
    profile: {
      displayName: 'Ada Lovelace',
      bio: 'Wrote the first program.',
      links: [{ label: 'Mastodon', href: MASTODON }],
    },
  });

  const instance = createCms({ contentDir, dataDir, watch: false });
  started.push(instance);
  await instance.sync();
  return instance;
}

async function body(cms: Cms, pathname: string): Promise<string> {
  const response = await cms.app.request(pathname);
  assert.equal(response.status, 200, `${pathname} answers`);
  return response.text();
}

function main(html: string): string {
  return /<main[^>]*>([\s\S]*?)<\/main>/.exec(html)?.[1] ?? '';
}

/** Every `rel` an anchor or link element carries, keyed by its href. */
function relsTo(html: string, href: string): string[] {
  const rels: string[] = [];
  for (const [tag] of html.matchAll(/<(?:a|link)\b[^>]*>/g)) {
    const target = /\bhref="([^"]*)"/.exec(tag)?.[1];
    const rel = /\brel="([^"]*)"/.exec(tag)?.[1];
    if (target === href && rel !== undefined) rels.push(rel);
  }
  return rels;
}

function claimsMe(html: string, href: string): boolean {
  return relsTo(html, href).some((rel) => rel.split(/\s+/).includes('me'));
}

/** The WebSite node of a page's JSON-LD graph. */
function website(html: string): Record<string, unknown> {
  const node = graph(html).find((entry) => entry['@type'] === 'WebSite');
  assert.ok(node !== undefined, 'the graph has a WebSite');
  return node;
}

/** Every node of a page's JSON-LD graph. */
function graph(html: string): Record<string, unknown>[] {
  const json = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)?.[1] ?? '{}';
  return (JSON.parse(json) as { '@graph': Record<string, unknown>[] })['@graph'];
}

/** The copyright line of the page's footer. */
function copyright(html: string): string {
  return /&copy; \d{4}, ([^<&]*?) &middot;/.exec(html)?.[1] ?? '';
}

const LISTING = {};
const FRONT_PAGE = { homepage: 'welcome' };
const SOLO = { author: 'ada' };
const SEVERAL = {};
const ADA_PERSON = { '@id': 'http://localhost:3000/author/ada/#person' };

describe('a site whose author is a user (AC #2)', () => {
  for (const [shape, settings] of [
    ['a post-listing homepage', LISTING],
    ['a static front page', FRONT_PAGE],
  ] as const) {
    it(`prints the site author's bio card on ${shape}`, async () => {
      const home = main(await body(await site({ ...settings, ...SOLO }), '/'));

      assert.match(home, /class="bio p-author h-card"/);
      assert.match(home, /Ada Lovelace/);
      assert.match(home, /Wrote the first program\./);
    });

    it(`claims the author's profiles and archive with rel="me" on ${shape}`, async () => {
      const home = await body(await site({ ...settings, ...SOLO }), '/');

      assert.ok(claimsMe(home, MASTODON), 'a Mastodon profile linking here verifies');
      assert.ok(claimsMe(home, '/author/ada/'), 'the homepage claims the author archive');
    });
  }

  it('has the author archive claim the homepage back with rel="me"', async () => {
    const archive = await body(await site(SOLO), '/author/ada/');

    assert.ok(claimsMe(archive, '/'), 'the archive claims the homepage');
  });
});

describe('a site with several authors (AC #2, AC #3)', () => {
  for (const [shape, settings] of [
    ['a post-listing homepage', LISTING],
    ['a static front page', FRONT_PAGE],
  ] as const) {
    it(`prints no bio card on ${shape}`, async () => {
      const home = main(await body(await site({ ...settings, ...SEVERAL }), '/'));

      assert.doesNotMatch(home, /h-card/);
      assert.doesNotMatch(home, /Wrote the first program\./);
    });

    it(`makes no rel="me" claims from ${shape}`, async () => {
      const home = await body(await site({ ...settings, ...SEVERAL }), '/');

      assert.ok(!claimsMe(home, '/author/ada/'), 'the homepage does not claim the archive');
      assert.ok(!claimsMe(home, MASTODON), 'nor the author’s profiles');
    });
  }

  it('has the author archive make no claim on the homepage', async () => {
    const archive = await body(await site(SEVERAL), '/author/ada/');

    assert.ok(!claimsMe(archive, '/'), 'the archive does not claim the homepage');
  });

  it('is what an empty author gets', async () => {
    const empty = await body(await site({ author: '' }), '/');
    const absent = await body(await site(SEVERAL), '/');

    assert.equal(main(empty), main(absent));
  });
});

describe('a site.json written before the select (AC #5)', () => {
  it('reads an author that is a display name as that user', async () => {
    const home = await body(await site({ author: 'Ada Lovelace', soloAuthor: false }), '/');

    assert.match(main(home), /class="bio p-author h-card"/);
    assert.ok(claimsMe(home, '/author/ada/'), 'the homepage claims the archive');
    assert.equal(copyright(home), 'Ada Lovelace');
  });

  it('reads an author that matches nobody as several authors', async () => {
    const home = await body(await site({ author: 'Joe Blog', soloAuthor: true }), '/');

    assert.doesNotMatch(main(home), /h-card/);
    assert.ok(!claimsMe(home, '/author/ada/'), 'no claim on anybody’s archive');
    assert.equal(copyright(home), 'A Site', 'the site title stands in for the old name');
  });
});

describe('the footer (AC #4)', () => {
  it('prints the site author’s display name, not their username', async () => {
    for (const pathname of ['/', '/welcome/', '/2026/09/hello/']) {
      assert.equal(copyright(await body(await site(SOLO), pathname)), 'Ada Lovelace', pathname);
    }
  });

  it('prints the site title on a site with several authors', async () => {
    assert.equal(copyright(await body(await site(SEVERAL), '/')), 'A Site');
  });
});

describe('the structured data (AC #9)', () => {
  it('has the WebSite published by and about the site author, on every page', async () => {
    const cms = await site(SOLO);
    for (const pathname of ['/', '/welcome/', '/2026/09/hello/', '/author/ada/']) {
      const node = website(await body(cms, pathname));
      assert.deepEqual(node['publisher'], ADA_PERSON, pathname);
      assert.deepEqual(node['about'], ADA_PERSON, pathname);
    }
  });

  it('prints the site author’s Person on a page about nobody in particular', async () => {
    const nodes = graph(await body(await site(SOLO), '/welcome/'));
    const person = nodes.find((node) => node['@type'] === 'Person');

    assert.equal(person?.['@id'], ADA_PERSON['@id']);
    assert.equal(person?.['name'], 'Ada Lovelace');
  });

  it('has a site with several authors published by an Organization named for it', async () => {
    const cms = await site(SEVERAL);
    for (const pathname of ['/', '/welcome/']) {
      const nodes = graph(await body(cms, pathname));
      const node = website(await body(cms, pathname));
      const organization = nodes.find((entry) => entry['@type'] === 'Organization');

      assert.ok(organization !== undefined, `${pathname} has an Organization`);
      assert.equal(organization['name'], 'A Site');
      assert.equal(organization['url'], 'http://localhost:3000/');
      assert.deepEqual(node['publisher'], { '@id': organization['@id'] }, pathname);
      assert.equal(node['about'], undefined, `${pathname} is about nobody`);
      assert.equal(
        nodes.find((entry) => entry['@type'] === 'Person'),
        undefined,
        `${pathname} prints no Person`,
      );
    }
  });

  it('still credits a post’s writer on a site with several authors', async () => {
    const nodes = graph(await body(await site(SEVERAL), '/2026/09/hello/'));
    const posting = nodes.find((entry) => entry['@type'] === 'BlogPosting');

    assert.deepEqual(posting?.['author'], ADA_PERSON);
  });
});
