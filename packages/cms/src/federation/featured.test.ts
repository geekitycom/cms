import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { sandbox } from '../admin/__testing__/harness.ts';
import { writeUsers } from '../admin/__testing__/users.ts';
import { DEFAULT_SITE_SETTINGS, writeSiteJson } from '../admin/settings.ts';
import type { Cms } from '../index.ts';

const BASE_URL = 'https://blog.example';
const ACTOR_URL = `${BASE_URL}/author/ada/`;
const FEATURED_URL = `${ACTOR_URL}featured/`;
const AS = 'application/activity+json';

const box = sandbox();
after(() => box.cleanup());

/** A site whose one user, ada, wrote these posts, each `[slug, extra front matter]`. */
async function site(posts: [string, string[]][]): Promise<Cms> {
  const contentDir = await box.dir('geekity-featured-content-');
  const dataDir = await box.dir('geekity-featured-data-');

  await writeSiteJson({
    contentDir,
    settings: { ...DEFAULT_SITE_SETTINGS, title: 'Geekity', baseUrl: BASE_URL, author: 'ada' },
  });
  writeUsers(dataDir, [{ username: 'ada' }]);

  for (const [index, [slug, extra]] of posts.entries()) {
    const day = String(index + 1).padStart(2, '0');
    const file = path.join(contentDir, 'posts', `2026-01-${day}-${slug}.md`);
    await mkdir(path.dirname(file), { recursive: true });
    const frontMatter = [
      `title: ${slug}`,
      `date: 2026-01-${day}T00:00:00Z`,
      `permalink: /${slug}/`,
      'author: ada',
      ...extra,
    ];
    await writeFile(file, `---\n${frontMatter.join('\n')}\n---\n\nBody.\n`, 'utf8');
  }

  return await box.open({ contentDir, dataDir, baseUrl: BASE_URL });
}

async function activityStreams(cms: Cms, url: string): Promise<Record<string, unknown>> {
  const response = await cms.app.request(new Request(url, { headers: { accept: AS } }));
  assert.equal(response.status, 200, `${url} answers`);
  return (await response.json()) as Record<string, unknown>;
}

/** The ids of a collection's items, whether embedded or given as URLs. */
function itemIds(collection: Record<string, unknown>): string[] {
  const items = (collection['orderedItems'] ?? []) as (string | { id: string })[];
  return items.map((item) => (typeof item === 'string' ? item : item.id));
}

describe('the featured collection (TASK-207 AC #2)', () => {
  it('is linked from the actor as featured', async () => {
    const cms = await site([]);

    const actor = await activityStreams(cms, ACTOR_URL);

    assert.equal(actor['featured'], FEATURED_URL);
  });

  it('lists the published pinned posts, most recently pinned first', async () => {
    const cms = await site([
      ['first', ['pinned: 2026-02-01T00:00:00Z']],
      ['unpinned', []],
      ['second', ["pinned: '2026-03-01T00:00:00Z'"]],
      ['draft', ['pinned: 2026-04-01T00:00:00Z', 'draft: true']],
    ]);

    const collection = await activityStreams(cms, FEATURED_URL);

    assert.equal(collection['type'], 'OrderedCollection');
    assert.equal(collection['id'], FEATURED_URL);
    assert.deepEqual(itemIds(collection), [`${BASE_URL}/second/`, `${BASE_URL}/first/`]);
    assert.equal(collection['totalItems'], 2);
    assert.deepEqual(
      collection['orderedItems'],
      [`${BASE_URL}/second/`, `${BASE_URL}/first/`],
      'bare ids: Mastodon skips an embedded item unless it is a Note, and a titled post is an Article',
    );
  });

  it('holds no more than five, keeping the most recent pins', async () => {
    const cms = await site(
      Array.from({ length: 6 }, (_, index): [string, string[]] => [
        `post-${String(index + 1)}`,
        [`pinned: 2026-02-0${String(index + 1)}T00:00:00Z`],
      ]),
    );

    const collection = await activityStreams(cms, FEATURED_URL);

    assert.deepEqual(
      itemIds(collection),
      [6, 5, 4, 3, 2].map((n) => `${BASE_URL}/post-${String(n)}/`),
    );
  });

  it('is a 404 for a username nobody has', async () => {
    const cms = await site([]);

    const response = await cms.app.request(
      new Request(`${BASE_URL}/author/nobody/featured/`, { headers: { accept: AS } }),
    );

    assert.equal(response.status, 404);
  });
});
