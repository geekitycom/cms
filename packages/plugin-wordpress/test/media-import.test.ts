import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { createCms, pluginDataFolder } from '@geekity/cms';
import type { Cms } from '@geekity/cms';
import type { PluginCommandContext, PluginSite } from '@geekity/cms/plugin';

import { importWordPressContent } from '../src/content-import.ts';
import type { ReportRow } from '../src/content-import.ts';
import wordpress from '../src/index.ts';
import { attachments } from '../src/media-import.ts';
import { postsAndPages } from '../src/posts-import.ts';
import { parseWordPressExport } from '../src/wxr.ts';
import { runCli, writeSite } from './site.ts';
import { SITE, wxr } from './wxr.ts';
import type { TestItem } from './wxr.ts';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

const temporaryDirs: string[] = [];
const started: Cms[] = [];

after(async () => {
  for (const instance of started) await instance.close();
  await Promise.all(temporaryDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

async function temporaryDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  temporaryDirs.push(dir);
  return dir;
}

function unused(): never {
  throw new Error('The media import does not reach this.');
}

async function writeUploads(
  directory: string,
  files: Readonly<Record<string, string | Uint8Array>>,
): Promise<void> {
  for (const [relative, contents] of Object.entries(files)) {
    const file = path.join(directory, ...relative.split('/'));
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, contents);
  }
}

function attachment(
  id: number,
  file: string,
  extra: { parent?: number; alt?: string; host?: string } = {},
): TestItem {
  return {
    id,
    type: 'attachment',
    status: 'inherit',
    slug: path.posix.basename(file).replace(/\.[^.]+$/, ''),
    parent: extra.parent ?? 0,
    link: `${SITE}/?attachment_id=${String(id)}`,
    attachmentUrl: `${extra.host ?? SITE}/wp-content/uploads/${file}`,
    guid: `${extra.host ?? SITE}/wp-content/uploads/${file}`,
    content: '',
    meta: [
      { key: '_wp_attached_file', value: file },
      ...(extra.alt === undefined ? [] : [{ key: '_wp_attachment_image_alt', value: extra.alt }]),
    ],
  };
}

interface Imported {
  readonly rows: readonly ReportRow[];
  text(relative: string): Promise<string>;
  bytes(relative: string): Promise<Buffer>;
  files(): Promise<string[]>;
}

interface Site {
  readonly root: string;
  readonly contentDir: string;
  readonly uploadsDir: string;
  run(items: readonly TestItem[], options?: Record<string, string | true>): Promise<Imported>;
}

async function site(): Promise<Site> {
  const root = await temporaryDir('geekity-wp-media-');
  const contentDir = path.join(root, 'content');
  const uploadsDir = path.join(root, 'wp-content', 'uploads');
  await fs.mkdir(path.join(contentDir, '_data'), { recursive: true });
  await fs.writeFile(path.join(contentDir, '_data', 'site.json'), '{\n  "title": "Blog"\n}\n');
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
    checkUpload: (_name, bytes) => ({ accepted: true, bytes }),
    comments: unused,
    putComments: unused,
  };
  return {
    root,
    contentDir,
    uploadsDir,
    run: async (items, options = { uploads: uploadsDir }) => {
      const context: PluginCommandContext = {
        args: [],
        options,
        cwd: root,
        site: pluginSite,
        write: () => undefined,
      };
      const report = await importWordPressContent({
        exported: parseWordPressExport(wxr(items)),
        context,
        data,
        importers: [postsAndPages, attachments],
      });
      return {
        rows: report.rows,
        text: (relative) => fs.readFile(path.join(contentDir, relative), 'utf8'),
        bytes: (relative) => fs.readFile(path.join(contentDir, relative)),
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

describe('the media import', () => {
  it('copies each attachment original from the uploads directory to uploads/YYYY/MM/, and no size variant', async () => {
    const where = await site();
    await writeUploads(where.uploadsDir, {
      '2024/03/photo.png': PNG,
      '2024/03/photo-1024x575.png': 'a variant',
      '2024/03/photo-150x150.png': 'a thumbnail',
      '2024/03/big.png': Buffer.concat([PNG, Buffer.from('the original')]),
      '2024/03/big-scaled.png': 'the scaled copy',
      '2011/03/show.mp3': 'ID3 an episode',
    });

    const imported = await where.run([
      attachment(30, '2024/03/photo.png'),
      attachment(31, '2024/03/big-scaled.png'),
      attachment(32, '2011/03/show.mp3'),
    ]);

    assert.deepEqual(
      (await imported.files()).filter((file) => file.startsWith('uploads/')),
      ['uploads/2011/03/show.mp3', 'uploads/2024/03/big.png', 'uploads/2024/03/photo.png'],
    );
    assert.deepEqual(await imported.bytes('uploads/2024/03/photo.png'), PNG);
    assert.equal(
      (await imported.bytes('uploads/2024/03/big.png')).toString('latin1').endsWith('the original'),
      true,
    );
    assert.deepEqual(
      rowsFor(imported.rows, 31).map((row) => [row.outcome, row.path]),
      [['written', 'uploads/2024/03/big.png']],
    );
  });

  it('points every body URL on the site or a given origin at the original under /uploads/', async () => {
    const where = await site();
    await writeUploads(where.uploadsDir, { '2024/03/photo.png': PNG, '2024/03/chart.png': PNG });

    const imported = await where.run(
      [
        attachment(30, '2024/03/photo.png', { parent: 10 }),
        attachment(31, '2024/03/chart.png', { parent: 10 }),
        {
          id: 10,
          slug: 'pictures',
          content: [
            `<!-- wp:image --><figure class="wp-block-image"><img src="${SITE}/wp-content/uploads/2024/03/photo-1024x575.png" alt="A photo"/></figure><!-- /wp:image -->`,
            `<p><a href="https://staging.blog.example/wp-content/uploads/2024/03/photo-scaled.png">Full size</a> and <a href="/wp-content/uploads/2024/03/chart.png">the chart</a>.</p>`,
            `<figure class="wp-block-image"><img src="//blog.example/wp-content/uploads/2024/03/chart-300x200.png" alt="A chart"/><figcaption class="wp-element-caption">The chart</figcaption></figure>`,
            `<p><img src="https://elsewhere.example/wp-content/uploads/2024/03/photo-1024x575.png" alt="Not ours"/></p>`,
          ].join('\n'),
        },
      ],
      { uploads: where.uploadsDir, origins: 'https://staging.blog.example' },
    );

    const post = await imported.text('posts/2024-03-05-pictures.md');
    assert.match(post, /!\[A photo\]\(\/uploads\/2024\/03\/photo\.png\)/);
    assert.match(post, /\[Full size\]\(\/uploads\/2024\/03\/photo\.png\)/);
    assert.match(post, /\[the chart\]\(\/uploads\/2024\/03\/chart\.png\)/);
    assert.match(post, /<img src="\/uploads\/2024\/03\/chart\.png" alt="A chart">/);
    assert.match(
      post,
      /https:\/\/elsewhere\.example\/wp-content\/uploads\/2024\/03\/photo-1024x575\.png/,
    );
    assert.doesNotMatch(post, /blog\.example\/wp-content|\(\/wp-content|"\/wp-content/);
  });

  it('leaves a staging host alone unless it is given as an origin', async () => {
    const where = await site();
    await writeUploads(where.uploadsDir, { '2024/03/photo.png': PNG });
    const body = `<p><a href="https://staging.blog.example/wp-content/uploads/2024/03/photo.png">Photo</a></p>`;

    const imported = await where.run([
      attachment(30, '2024/03/photo.png'),
      { id: 10, slug: 'staged', content: body },
    ]);

    assert.match(
      await imported.text('posts/2024-03-05-staged.md'),
      /\(https:\/\/staging\.blog\.example\/wp-content\/uploads\/2024\/03\/photo\.png\)/,
    );
  });

  it('writes each attachment’s alt text to _data/media.json, keyed by its upload path', async () => {
    const where = await site();
    await writeUploads(where.uploadsDir, { '2024/03/photo.png': PNG, '2024/03/plain.png': PNG });
    await fs.writeFile(
      path.join(where.contentDir, '_data', 'media.json'),
      '{\n  "2020/01/mine.png": {\n    "decorative": true\n  }\n}\n',
    );

    await where.run([
      attachment(30, '2024/03/photo.png', { alt: 'Ada at the loom' }),
      attachment(31, '2024/03/plain.png'),
    ]);
    const again = await where.run([
      attachment(30, '2024/03/photo.png', { alt: 'Ada at the loom' }),
      attachment(31, '2024/03/plain.png'),
    ]);

    assert.deepEqual(JSON.parse(await again.text('_data/media.json')), {
      '2020/01/mine.png': { decorative: true },
      '2024/03/photo.png': { alt: 'Ada at the loom' },
    });
    assert.deepEqual(
      rowsFor(again.rows, 30).map((row) => row.outcome),
      ['unchanged', 'unchanged'],
    );
  });

  it('names a missing file, and every attachment when no uploads directory is given', async () => {
    const where = await site();
    await writeUploads(where.uploadsDir, { '2024/03/here.png': PNG, '2024/03/loose.png': PNG });
    const items = [
      attachment(30, '2024/03/here.png'),
      attachment(31, '2024/03/gone.png'),
      {
        id: 10,
        slug: 'loose',
        content: `<p><img src="${SITE}/wp-content/uploads/2024/03/loose.png" alt="Loose"/><img src="${SITE}/wp-content/uploads/2024/03/lost.png" alt="Lost"/></p>`,
      },
    ];

    const imported = await where.run(items);

    assert.deepEqual(
      rowsFor(imported.rows, 31).map((row) => [row.outcome, row.why]),
      [
        [
          'warned',
          `2024/03/gone.png is not in ${where.uploadsDir}; /uploads/2024/03/gone.png will not answer until it is there`,
        ],
      ],
    );
    assert.deepEqual(
      rowsFor(imported.rows, 10)
        .filter((row) => row.path !== 'posts/2024-03-05-loose.md')
        .map((row) => [row.outcome, row.path ?? row.why]),
      [
        [
          'warned',
          `2024/03/lost.png is not in ${where.uploadsDir}; /uploads/2024/03/lost.png will not answer until it is there`,
        ],
        ['written', 'uploads/2024/03/loose.png'],
      ],
    );

    const without = await (await site()).run(items, {});
    assert.deepEqual(
      rowsFor(without.rows, 30).map((row) => [row.outcome, row.why]),
      [['warned', 'not copied: give --uploads <directory>, a copy of wp-content/uploads']],
    );
  });

  it('picks up media a newer export carries and leaves the rest byte-identical', async () => {
    const where = await site();
    await writeUploads(where.uploadsDir, { '2024/03/one.png': PNG, '2024/04/two.png': PNG });
    const first = [attachment(30, '2024/03/one.png', { alt: 'One' })];
    await where.run(first);
    const before = await where.run(first);
    assert.deepEqual(
      before.rows.map((row) => row.outcome),
      ['unchanged', 'unchanged'],
    );

    const newer = await where.run([
      ...first,
      attachment(31, '2024/04/two.png', { alt: 'Two' }),
      {
        id: 10,
        slug: 'two',
        content: `<p><img src="${SITE}/wp-content/uploads/2024/04/two-1024x575.png" alt="Two"/></p>`,
      },
    ]);

    assert.deepEqual(
      rowsFor(newer.rows, 31).map((row) => [row.outcome, row.path]),
      [
        ['written', 'uploads/2024/04/two.png'],
        ['written', '_data/media.json'],
      ],
    );
    assert.deepEqual(
      rowsFor(newer.rows, 30).map((row) => row.outcome),
      ['unchanged', 'unchanged'],
    );
    assert.match(await newer.text('posts/2024-03-05-two.md'), /\(\/uploads\/2024\/04\/two\.png\)/);
  });
});

describe('geekity import wordpress with media', () => {
  it('names a file over the upload limit or of a type the site refuses, and copies neither', async () => {
    const directory = await temporaryDir('geekity-wp-media-cli-');
    const entry = new URL('../src/index.ts', import.meta.url).pathname;
    await fs.writeFile(
      path.join(directory, 'geekity.config.mjs'),
      `import wordpress from ${JSON.stringify(entry)};\n\nexport default { plugins: [wordpress], uploadMaxBytes: ${String(PNG.length)} };\n`,
    );
    const uploads = path.join(directory, 'wp-uploads');
    await writeUploads(uploads, {
      '2024/03/small.png': PNG,
      '2024/03/large.png': Buffer.concat([PNG, Buffer.alloc(64)]),
      '2024/03/logo.svg': '<svg xmlns="http://www.w3.org/2000/svg"/>',
    });
    const file = path.join(directory, 'export.xml');
    await fs.writeFile(
      file,
      wxr([
        attachment(30, '2024/03/small.png'),
        attachment(31, '2024/03/large.png'),
        attachment(32, '2024/03/logo.svg'),
      ]),
    );

    const run = await runCli(['import', 'wordpress', file, '--uploads', uploads], directory);

    assert.equal(run.code, 0, run.stderr);
    assert.match(run.stdout, /^written\tattachment\t30\t.*\tuploads\/2024\/03\/small\.png\t/m);
    assert.match(
      run.stdout,
      /^warned\tattachment\t31\t.*2024\/03\/large\.png was not copied: That file is too big/m,
    );
    assert.match(
      run.stdout,
      /^warned\tattachment\t32\t.*2024\/03\/logo\.svg was not copied: Uploads of \.svg are not allowed here/m,
    );
    const copied = await fs.readdir(path.join(directory, 'content', 'uploads', '2024', '03'));
    assert.deepEqual(copied, ['small.png']);
  });
});

describe('the old media URLs', () => {
  async function importedSite(): Promise<Cms> {
    const where = await site();
    await writeUploads(where.uploadsDir, {
      '2024/03/photo.png': PNG,
      '2024/03/badge-88x31.png': PNG,
    });
    await where.run([
      attachment(30, '2024/03/photo.png'),
      attachment(31, '2024/03/badge-88x31.png'),
    ]);
    writeSite(where.contentDir, { baseUrl: SITE, author: 'ada', enabled: true });
    const instance = createCms({
      dataDir: path.join(where.root, 'data'),
      contentDir: where.contentDir,
      watch: false,
      baseUrl: SITE,
      federation: { queue: null },
      plugins: [wordpress],
    });
    started.push(instance);
    return instance;
  }

  async function location(instance: Cms, url: string): Promise<[number, string | null]> {
    const response = await instance.app.request(url);
    return [response.status, response.headers.get('location')];
  }

  it('answers 301 at the same file under /uploads/, or at its original for a size variant', async () => {
    const instance = await importedSite();

    assert.deepEqual(await location(instance, `${SITE}/wp-content/uploads/2024/03/photo.png`), [
      301,
      '/uploads/2024/03/photo.png',
    ]);
    assert.deepEqual(
      await location(instance, `${SITE}/wp-content/uploads/2024/03/photo-1024x575.png?ver=2`),
      [301, '/uploads/2024/03/photo.png?ver=2'],
    );
    assert.deepEqual(
      await location(instance, `${SITE}/wp-content/uploads/2024/03/photo-scaled-300x200.png`),
      [301, '/uploads/2024/03/photo.png'],
    );
    assert.deepEqual(
      await location(instance, `${SITE}/wp-content/uploads/2024/03/badge-88x31.png`),
      [301, '/uploads/2024/03/badge-88x31.png'],
    );
    assert.deepEqual(
      await location(instance, `${SITE}/wp-content/uploads/2019/01/hand-copied.pdf`),
      [301, '/uploads/2019/01/hand-copied.pdf'],
    );
    const followed = await instance.app.request(`${SITE}/uploads/2024/03/photo.png`);
    assert.equal(followed.status, 200);
    assert.deepEqual(Buffer.from(await followed.arrayBuffer()), PNG);
  });

  it('has no redirects.json entry per file', async () => {
    const instance = await importedSite();

    await assert.rejects(
      fs.readFile(path.join(instance.config.contentDir, '_data', 'redirects.json')),
    );
  });
});
