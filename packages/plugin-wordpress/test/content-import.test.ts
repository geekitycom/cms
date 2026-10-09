import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { pluginDataFolder } from '@geekity/cms';
import type { PluginCommandContext, PluginDataFolder, PluginSite } from '@geekity/cms/plugin';

import { importWordPressContent } from '../src/content-import.ts';
import type { ReportRow, WordPressImporter } from '../src/content-import.ts';
import { NotAWordPressExportError, parseWordPressExport } from '../src/wxr.ts';
import { runCli, writeConfigWithPlugin } from './site.ts';
import { SITE, wxr } from './wxr.ts';
import type { TestItem } from './wxr.ts';

const temporaryDirs: string[] = [];

after(async () => {
  await Promise.all(temporaryDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

async function temporaryDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  temporaryDirs.push(dir);
  return dir;
}

async function tree(directory: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  for (const entry of await fs.readdir(directory, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const file = path.join(entry.parentPath, entry.name);
    files[path.relative(directory, file)] = (await fs.readFile(file)).toString('base64');
  }
  return files;
}

function unused(): never {
  throw new Error('The content import does not reach this.');
}

function testSite(contentDir: string): PluginSite {
  return {
    baseUrl: SITE,
    contentDir,
    users: () => [],
    setActorId: unused,
    actorKey: unused,
    writeActorKey: unused,
    loadActorKeys: unused,
    followers: () => [],
    addFollower: unused,
  };
}

const postsImporter: WordPressImporter = {
  postTypes: ['post'],
  import: (exported) => ({
    files: exported.items
      .filter((item) => item.type === 'post')
      .map((item) => ({
        item,
        path: `posts/${item.slug}.md`,
        contents: `---\ntitle: ${item.title}\n---\n${item.content}\n`,
      })),
    notes: [],
  }),
};

interface Site {
  contentDir: string;
  data: PluginDataFolder;
  run(
    items: readonly TestItem[],
    importers?: readonly WordPressImporter[],
  ): Promise<readonly ReportRow[]>;
}

async function site(): Promise<Site> {
  const root = await temporaryDir('geekity-wxr-');
  const contentDir = path.join(root, 'content');
  await fs.mkdir(contentDir);
  const data = pluginDataFolder(path.join(root, 'data'), '@geekity/plugin-wordpress');
  const context: PluginCommandContext = {
    args: [],
    options: {},
    cwd: root,
    site: testSite(contentDir),
    write: () => undefined,
  };
  return {
    contentDir,
    data,
    run: async (items, importers = [postsImporter]) =>
      (
        await importWordPressContent({
          exported: parseWordPressExport(wxr(items)),
          context,
          data,
          importers,
        })
      ).rows,
  };
}

function row(rows: readonly ReportRow[], id: number): ReportRow {
  const found = rows.find((entry) => entry.item.id === id);
  assert.ok(found, `no report row for item ${String(id)}`);
  return found;
}

describe('parseWordPressExport', () => {
  it('reads an item with its dates, terms, meta and comments', () => {
    const exported = parseWordPressExport(
      wxr([
        {
          id: 12,
          title: 'Fish & chips',
          slug: 'fish-and-chips',
          dateGmt: '2024-03-05 14:30:00',
          modifiedGmt: '2024-04-01 08:00:00',
          terms: [
            { taxonomy: 'category', slug: 'food', name: 'Food' },
            { taxonomy: 'post_tag', slug: 'uk', name: 'UK' },
          ],
          meta: [
            { key: '_wp_old_slug', value: 'fish' },
            { key: '_wp_old_slug', value: 'chips' },
          ],
          comments: [
            {
              id: 7,
              parent: 3,
              type: 'like',
              approved: '1',
              meta: [{ key: 'protocol', value: 'activitypub' }],
            },
          ],
        },
        { id: 13, status: 'draft', dateGmt: '0000-00-00 00:00:00' },
      ]),
    );

    assert.equal(exported.site.title, 'Blog & Co');
    assert.equal(exported.site.baseSiteUrl, SITE);
    assert.deepEqual(exported.authors, [
      { id: 2, login: 'ada', email: 'ada@blog.example', displayName: 'Ada Lovelace' },
    ]);

    const [post, draft] = exported.items;
    assert.ok(post && draft);
    assert.equal(post.id, 12);
    assert.equal(post.type, 'post');
    assert.equal(post.status, 'publish');
    assert.equal(post.title, 'Fish & chips');
    assert.equal(post.slug, 'fish-and-chips');
    assert.equal(post.link, `${SITE}/2024/03/fish-and-chips/`);
    assert.equal(post.guid, `${SITE}/?p=12`);
    assert.equal(post.creator, 'ada');
    assert.equal(post.content, '<p>Body of 12.</p>');
    assert.equal(post.date, '2024-03-05 09:30:00');
    assert.equal(post.dateGmt, '2024-03-05T14:30:00Z');
    assert.equal(post.modifiedGmt, '2024-04-01T08:00:00Z');
    assert.deepEqual(post.terms, [
      { taxonomy: 'category', slug: 'food', name: 'Food' },
      { taxonomy: 'post_tag', slug: 'uk', name: 'UK' },
    ]);
    assert.deepEqual(post.meta, [
      { key: '_wp_old_slug', value: 'fish' },
      { key: '_wp_old_slug', value: 'chips' },
    ]);
    assert.deepEqual(post.comments, [
      {
        id: 7,
        parent: 3,
        type: 'like',
        approved: '1',
        author: 'Weldon',
        authorEmail: 'weldon@mstdn.example',
        authorUrl: 'https://mstdn.example/@weldon',
        authorIp: '192.0.2.1',
        date: '2024-03-06 05:00:00',
        dateGmt: '2024-03-06T10:00:00Z',
        content: 'Nice.',
        userId: 0,
        meta: [{ key: 'protocol', value: 'activitypub' }],
      },
    ]);

    assert.equal(draft.dateGmt, undefined, 'a draft has no GMT date yet');
  });

  it('names every problem with a file that is not a WXR export', () => {
    const problems = (xml: string): readonly string[] => {
      try {
        parseWordPressExport(xml);
      } catch (error) {
        assert.ok(error instanceof NotAWordPressExportError);
        return error.problems;
      }
      assert.fail('the file was accepted');
    };

    assert.match(problems('<rss><channel>').join('\n'), /not well-formed XML.*line 1/);
    assert.match(problems('<feed xmlns="http://www.w3.org/2005/Atom"/>').join('\n'), /<feed>/);
    assert.match(
      problems('<rss version="2.0"><channel><title>x</title></channel></rss>').join('\n'),
      /wp:wxr_version/,
    );

    const broken = wxr([{ id: 1 }, { id: 2, type: '' }]).replace('<wp:post_id>1</wp:post_id>', '');
    const named = problems(broken);
    assert.equal(named.length, 2, named.join('\n'));
    assert.match(named[0] ?? '', /item 1 .*wp:post_id/);
    assert.match(named[1] ?? '', /item 2 .*wp:post_type/);
  });
});

describe('importWordPressContent', () => {
  it('leaves the content directory byte-identical when run twice over one export', async () => {
    const where = await site();
    const items = [{ id: 1 }, { id: 2 }];

    const first = await where.run(items);
    const once = await tree(where.contentDir);
    const second = await where.run(items);

    assert.deepEqual(Object.keys(once).sort(), ['posts/item-1.md', 'posts/item-2.md']);
    assert.deepEqual(await tree(where.contentDir), once);
    assert.deepEqual(
      first.map((entry) => entry.outcome),
      ['written', 'written'],
    );
    assert.deepEqual(
      second.map((entry) => entry.outcome),
      ['unchanged', 'unchanged'],
    );
  });

  it('never overwrites or deletes a file it did not write, and lists the clash', async () => {
    const where = await site();
    await fs.mkdir(path.join(where.contentDir, 'posts'));
    const mine = path.join(where.contentDir, 'posts', 'item-1.md');
    const other = path.join(where.contentDir, 'posts', 'mine.md');
    await fs.writeFile(mine, 'written by hand\n');
    await fs.writeFile(other, 'also mine\n');

    const rows = await where.run([{ id: 1 }, { id: 2 }]);

    assert.equal(await fs.readFile(mine, 'utf8'), 'written by hand\n');
    assert.equal(await fs.readFile(other, 'utf8'), 'also mine\n');
    const clash = row(rows, 1);
    assert.equal(clash.outcome, 'clash');
    assert.equal(clash.path, 'posts/item-1.md');
    assert.match(clash.why, /not written by the import/);
    assert.equal(row(rows, 2).outcome, 'written');

    const again = await where.run([{ id: 1 }, { id: 2 }]);
    assert.equal(row(again, 1).outcome, 'clash', 'a rerun still refuses it');
    assert.equal(await fs.readFile(mine, 'utf8'), 'written by hand\n');
  });

  it('picks up an edit made on WordPress to a file this site left alone', async () => {
    const where = await site();
    await where.run([{ id: 1, content: '<p>First.</p>' }]);

    const rows = await where.run([
      { id: 1, content: '<p>Second.</p>', modifiedGmt: '2024-05-01 00:00:00' },
    ]);

    assert.equal(row(rows, 1).outcome, 'written');
    assert.match(row(rows, 1).why, /changed on WordPress/);
    assert.match(
      await fs.readFile(path.join(where.contentDir, 'posts', 'item-1.md'), 'utf8'),
      /Second/,
    );
  });

  it('keeps a file edited here and reports a conflict with both dates when WordPress changed it too', async () => {
    const where = await site();
    await where.run([{ id: 1, content: '<p>First.</p>' }]);
    const file = path.join(where.contentDir, 'posts', 'item-1.md');
    await fs.writeFile(file, 'edited on Geekity\n');
    const editedAt = new Date('2024-06-01T12:00:00Z');
    await fs.utimes(file, editedAt, editedAt);

    const untouched = await where.run([{ id: 1, content: '<p>First.</p>' }]);
    assert.equal(row(untouched, 1).outcome, 'kept');
    assert.match(row(untouched, 1).why, /edited on this site/);

    const rows = await where.run([
      { id: 1, content: '<p>Second.</p>', modifiedGmt: '2024-05-01 09:15:00' },
    ]);

    assert.equal(await fs.readFile(file, 'utf8'), 'edited on Geekity\n');
    const conflict = row(rows, 1);
    assert.equal(conflict.outcome, 'conflict');
    assert.match(conflict.why, /2024-06-01T12:00:00/);
    assert.match(conflict.why, /2024-05-01T09:15:00/);
  });

  it('writes again a file this site removed, which is how a conflict takes WordPress’s side', async () => {
    const where = await site();
    await where.run([{ id: 1 }]);
    const file = path.join(where.contentDir, 'posts', 'item-1.md');
    await fs.rm(file);

    const rows = await where.run([{ id: 1 }]);

    assert.equal(row(rows, 1).outcome, 'written');
    assert.match(row(rows, 1).why, /removed on this site/);
    assert.match(await fs.readFile(file, 'utf8'), /Body of 1/);
  });

  it('adopts a file that already holds what it would write, as a crash after the write leaves it', async () => {
    const where = await site();
    await where.run([{ id: 1, content: '<p>First.</p>' }]);
    await where.data.update('import.json', () => '{"files":{}}\n');

    const adopted = await where.run([{ id: 1, content: '<p>First.</p>' }]);
    assert.equal(row(adopted, 1).outcome, 'unchanged');

    const rows = await where.run([{ id: 1, content: '<p>Second.</p>' }]);
    assert.equal(row(rows, 1).outcome, 'written', 'the adopted file is the import’s again');
  });

  it('refuses a path outside the content directory', async () => {
    const where = await site();
    const escaping: WordPressImporter = {
      postTypes: ['post'],
      import: (exported) => ({
        files: exported.items.map((item) => ({ item, path: '../data/users.json', contents: '' })),
        notes: [],
      }),
    };

    await assert.rejects(where.run([{ id: 1 }], [escaping]), /outside the content directory/);
  });

  it('reports the skips and warnings an importer notes', async () => {
    const where = await site();
    const noting: WordPressImporter = {
      postTypes: ['post'],
      import: (exported) => ({
        files: [],
        notes: exported.items.map((item) =>
          item.status === 'trash'
            ? { item, outcome: 'skipped', why: 'in the trash' }
            : { item, outcome: 'warned', why: 'password-protected, imported as a draft' },
        ),
      }),
    };

    const rows = await where.run([{ id: 1, status: 'trash' }, { id: 2 }], [noting]);

    assert.deepEqual(
      rows.map(({ outcome, why }) => ({ outcome, why })),
      [
        { outcome: 'skipped', why: 'in the trash' },
        { outcome: 'warned', why: 'password-protected, imported as a draft' },
      ],
    );
  });
});

describe('geekity import wordpress', () => {
  async function siteWithExport(xml: string): Promise<{ directory: string; file: string }> {
    const directory = await temporaryDir('geekity-import-wxr-');
    writeConfigWithPlugin(directory);
    const file = path.join(directory, 'export.xml');
    await fs.writeFile(file, xml);
    return { directory, file };
  }

  it('exits non-zero and names each problem when the file is not a WXR export', async () => {
    const { directory, file } = await siteWithExport(
      '<rss version="2.0"><channel><title>Just a feed</title></channel></rss>',
    );

    const run = await runCli(['import', 'wordpress', file], directory);

    assert.equal(run.code, 1);
    assert.match(run.stderr, /export\.xml is not a WordPress export/);
    assert.match(run.stderr, /wp:wxr_version/);
    await assert.rejects(fs.access(path.join(directory, 'content', 'posts')));
  });

  it('exits non-zero when the export is missing', async () => {
    const { directory } = await siteWithExport('');

    const run = await runCli(['import', 'wordpress', 'nowhere.xml'], directory);

    assert.equal(run.code, 1);
    assert.match(run.stderr, /nowhere\.xml/);
  });

  it('skips and counts what has no Geekity counterpart, one report row per item', async () => {
    const skippedTypes = [
      'revision',
      'oembed_cache',
      'nav_menu_item',
      'wp_navigation',
      'wp_global_styles',
      'ap_actor',
      'ap_inbox',
      'ap_inbox',
      'ap_outbox',
      'feedback',
    ];
    const { directory, file } = await siteWithExport(
      wxr([
        ...skippedTypes.map((type, index) => ({ id: index + 1, type })),
        { id: 50, type: 'acme_widget' },
      ]),
    );

    const run = await runCli(['import', 'wordpress', file], directory);

    assert.equal(run.code, 0, run.stderr);
    const rows = run.stdout.split('\n').filter((line) => /^(skipped|warned|written)\t/.test(line));
    assert.equal(rows.length, skippedTypes.length + 1, run.stdout);
    assert.match(run.stdout, /^skipped\trevision\t1\t.*\tan earlier version of a post/m);
    assert.match(run.stdout, /^skipped\tap_inbox\t7\t.*ActivityPub plugin/m);
    assert.match(run.stdout, /^skipped\tfeedback\t10\t.*contact form/m);
    assert.match(run.stdout, /^skipped\tacme_widget\t50\t.*no importer for acme_widget/m);
    assert.match(run.stdout, /11 skipped/);
    assert.match(run.stdout, /ap_inbox 2/);
    assert.match(run.stdout, /revision 1/);
  });
});
