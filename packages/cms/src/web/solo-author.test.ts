import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { createUser, setUserProfile } from '../admin/accounts.ts';
import { createCms } from '../index.ts';
import type { Cms } from '../index.ts';

/**
 * The Solo author blog setting, from the outside (TASK-180).
 *
 * On, the homepage speaks for the site's author: it carries their bio card and
 * their `rel="me"` links, and it and their archive point at each other with
 * `rel="me"`. Off, the homepage speaks for nobody.
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

/** A site whose author setting names Ada, who has a profile with a Mastodon link. */
async function site(settings: Record<string, unknown>): Promise<Cms> {
  const contentDir = await temporaryDir('geekity-solo-content-');
  const dataDir = await temporaryDir('geekity-solo-data-');
  const files = {
    ...POSTS,
    '_data/site.json': `${JSON.stringify({ title: 'A Site', author: 'ada', ...settings }, null, 2)}\n`,
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
  const json = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)?.[1] ?? '{}';
  const graph = (JSON.parse(json) as { '@graph': Record<string, unknown>[] })['@graph'];
  const node = graph.find((entry) => entry['@type'] === 'WebSite');
  assert.ok(node !== undefined, 'the graph has a WebSite');
  return node;
}

const LISTING = {};
const FRONT_PAGE = { homepage: 'welcome' };

describe('a solo author blog (AC #2, AC #3)', () => {
  for (const [shape, settings] of [
    ['a post-listing homepage', LISTING],
    ['a static front page', FRONT_PAGE],
  ] as const) {
    it(`prints the site author's bio card on ${shape}`, async () => {
      const home = main(await body(await site({ ...settings, soloAuthor: true }), '/'));

      assert.match(home, /class="bio p-author h-card"/);
      assert.match(home, /Ada Lovelace/);
      assert.match(home, /Wrote the first program\./);
    });

    it(`claims the author's profiles and archive with rel="me" on ${shape}`, async () => {
      const home = await body(await site({ ...settings, soloAuthor: true }), '/');

      assert.ok(claimsMe(home, MASTODON), 'a Mastodon profile linking here verifies');
      assert.ok(claimsMe(home, '/author/ada/'), 'the homepage claims the author archive');
    });
  }

  it('has the author archive claim the homepage back with rel="me"', async () => {
    const archive = await body(await site({ soloAuthor: true }), '/author/ada/');

    assert.ok(claimsMe(archive, '/'), 'the archive claims the homepage');
  });
});

describe('a site that is not a solo author blog (AC #4)', () => {
  it('prints no bio card on a post-listing homepage', async () => {
    const home = main(await body(await site({}), '/'));

    assert.doesNotMatch(home, /h-card/);
    assert.doesNotMatch(home, /Wrote the first program\./);
  });

  for (const [shape, settings] of [
    ['a post-listing homepage', LISTING],
    ['a static front page', FRONT_PAGE],
  ] as const) {
    it(`makes no rel="me" claims from ${shape}`, async () => {
      const home = await body(await site(settings), '/');

      assert.ok(!claimsMe(home, '/author/ada/'), 'the homepage does not claim the archive');
      assert.ok(!claimsMe(home, MASTODON), 'nor the author’s profiles');
    });
  }

  it('has the author archive make no claim on the homepage', async () => {
    const archive = await body(await site({}), '/author/ada/');

    assert.ok(!claimsMe(archive, '/'), 'the archive does not claim the homepage');
  });

  it('is what a site with no soloAuthor key gets', async () => {
    const off = await body(await site({ soloAuthor: false }), '/');
    const absent = await body(await site({}), '/');

    assert.equal(main(off), main(absent));
  });
});

describe('the homepage’s structured data (AC #5)', () => {
  it('names the site author as what the site is about when the switch is on', async () => {
    const node = website(await body(await site({ soloAuthor: true }), '/'));

    assert.deepEqual(node['about'], { '@id': 'http://localhost:3000/author/ada/#person' });
  });

  it('names nobody when it is off', async () => {
    for (const settings of [LISTING, FRONT_PAGE]) {
      const node = website(await body(await site(settings), '/'));
      assert.equal(node['about'], undefined);
    }
  });
});

describe('turning the switch on for a site with a static front page (AC #6)', () => {
  it('changes nothing a reader sees there', async () => {
    const before = await body(await site(FRONT_PAGE), '/');
    const after = await body(await site({ ...FRONT_PAGE, soloAuthor: true }), '/');
    const visible = (html: string): string =>
      main(html)
        .replace(/\s+rel="[^"]*"/g, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    assert.match(
      visible(before),
      /Written by Ada Lovelace/,
      'the front page already shows the bio',
    );
    assert.equal(visible(after), visible(before));
    assert.equal(
      main(after).replace(/\s+rel="[^"]*"/g, ''),
      main(before).replace(/\s+rel="[^"]*"/g, ''),
      'only the rel attributes differ',
    );
  });
});
