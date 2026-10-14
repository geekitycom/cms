import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { manifestFiles, siteArchive, siteFiles } from '../__testing__/site-archive.ts';
import type { ArchivedEntry } from '../__testing__/site-archive.ts';
import { resolveConfig } from '../config.ts';
import { createSettings } from '../site/namespace.ts';
import { EXPORT_FORMAT } from './site-export.ts';
import {
  checkImportTargets,
  finishSiteImport,
  placeSiteImport,
  readSiteManifest,
  stageSiteImport,
} from './site-import.ts';
import type { ImportTargets } from './site-import.ts';

const dirs: string[] = [];
const readOnly: string[] = [];
after(async () => {
  await Promise.all(readOnly.map((dir) => chmod(dir, 0o755)));
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

async function scratch(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'geekity-import-'));
  dirs.push(dir);
  return dir;
}

async function setup(archive: Buffer) {
  const root = await scratch();
  const file = path.join(root, 'site.tar.gz');
  await writeFile(file, archive);
  const targets: ImportTargets = {
    contentDir: path.join(root, 'site', 'content'),
    dataDir: path.join(root, 'site', 'data'),
  };
  const config = resolveConfig({ ...targets, baseUrl: 'https://blog.example' }, { env: {} });
  const settings = createSettings({ config, env: {} });
  return { root, file, targets, settings };
}

/**
 * Make `content/` and `data/` behave as the mount points a Docker site has:
 * they exist, and the folder that holds them cannot be written, so neither
 * target can be renamed or removed and nothing can be made beside them.
 */
async function mountPoints(targets: ImportTargets) {
  await mkdir(targets.contentDir, { recursive: true });
  await mkdir(targets.dataDir, { recursive: true });
  const parent = path.dirname(targets.dataDir);
  await chmod(parent, 0o555);
  readOnly.push(parent);
}

function killedAfter(allowed: number) {
  let made = 0;
  return async (from: string, to: string) => {
    if (made === allowed) throw new Error('killed');
    made += 1;
    await rename(from, to);
  };
}

async function importFiles(
  file: string,
  targets: ImportTargets,
  settings: ReturnType<typeof createSettings>,
  replace = false,
  place: { stamp?: string; rename?: (from: string, to: string) => Promise<void> } = {},
) {
  const archived = await readSiteManifest(file);
  const states = checkImportTargets(archived, targets, settings);
  const occupied = states.filter((state) => state.state === 'occupied');
  if (occupied.length > 0 && !replace) {
    throw new Error(`occupied: ${occupied.map((state) => state.dir).join(', ')}`);
  }
  const staged = await stageSiteImport({ archive: file, archived, targets, settings });
  const moved = await placeSiteImport(staged, { stamp: '20261014T150000Z', ...place });
  await finishSiteImport(targets);
  return { staged, moved };
}

async function tree(dir: string): Promise<Record<string, string>> {
  const found: Record<string, string> = {};
  for (const entry of await readdir(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const file = path.join(entry.parentPath, entry.name);
    const hash = createHash('sha256')
      .update(await readFile(file))
      .digest('hex');
    found[path.relative(dir, file)] = `${((await stat(file)).mode & 0o777).toString(8)} ${hash}`;
  }
  return found;
}

async function refused(entries: readonly ArchivedEntry[], pattern: RegExp, manifest = {}) {
  const { file, targets, settings } = await setup(siteArchive(entries, manifest));
  await assert.rejects(importFiles(file, targets, settings), pattern);
  const site = path.dirname(targets.dataDir);
  assert.deepEqual(existsSync(site) ? await readdir(site) : [], [], 'nothing was left behind');
}

async function sites(targets: ImportTargets) {
  const unstamped = async (dir: string) =>
    Object.fromEntries(
      Object.entries(await tree(dir)).map(([name, file]) => [
        name.replace(/^\.geekity-before-import-[^/]+/, '.geekity-before-import-*'),
        file,
      ]),
    );
  return { content: await unstamped(targets.contentDir), data: await unstamped(targets.dataDir) };
}

async function occupy(targets: ImportTargets) {
  await mkdir(path.join(targets.contentDir, 'posts'), { recursive: true });
  await writeFile(path.join(targets.contentDir, 'posts', 'old.md'), '---\ntitle: Old\n---\n');
  await mkdir(path.join(targets.dataDir, 'keys'), { recursive: true });
  await writeFile(path.join(targets.dataDir, 'users.json'), 'the old site');
  await writeFile(path.join(targets.dataDir, 'keys', 'a.jwk'), 'old key');
}

describe('site import', () => {
  it('unpacks content/ and data/ with their modes, and the marker is gone at the end', async () => {
    const { file, targets, settings } = await setup(siteArchive(siteFiles()));
    await importFiles(file, targets, settings);

    assert.deepEqual(Object.keys(await tree(targets.contentDir)).sort(), [
      '_data/site.json',
      'posts/2026-01-01-one.md',
    ]);
    const data = await tree(targets.dataDir);
    assert.deepEqual(Object.keys(data).sort(), ['notification-secret', 'users.json']);
    assert.match(data['users.json'] ?? '', /^600 /);
    assert.deepEqual(await readdir(path.dirname(targets.dataDir)), ['content', 'data']);
  });

  it('refuses a newer format', async () => {
    await refused(siteFiles(), /format 2.*reads format 1/s, { format: EXPORT_FORMAT + 1 });
  });

  it('refuses an entry that climbs out with ..', async () => {
    await refused(
      [...siteFiles(), { name: 'data/../../escaped', body: 'x' }],
      /data\/\.\.\/\.\.\/escaped/,
    );
  });

  it('refuses an absolute path', async () => {
    await refused([...siteFiles(), { name: '/etc/passwd', body: 'x' }], /\/etc\/passwd/);
  });

  it('refuses a name outside content/ and data/', async () => {
    await refused([...siteFiles(), { name: 'plugins/evil/index.js', body: 'x' }], /plugins\/evil/);
  });

  it('refuses a name the import keeps for itself inside a target', async () => {
    await refused(
      [...siteFiles(), { name: 'content/.geekity-import', body: 'x' }],
      /\.geekity-import"/,
    );
    await refused(
      [...siteFiles(), { name: 'data/.geekity-before-import-1/users.json', body: 'x' }],
      /\.geekity-before-import-1/,
    );
    await refused(
      [...siteFiles(), { name: 'data/.geekity-importing/users.json', body: 'x' }],
      /\.geekity-importing/,
    );
  });

  it('refuses a link and a folder entry', async () => {
    await refused([...siteFiles(), { name: 'data/keys', type: '2' }], /data\/keys.*link/s);
    await refused([...siteFiles(), { name: 'content/posts', type: '5' }], /content\/posts/);
  });

  it('refuses a file whose sha256 does not match the manifest', async () => {
    await refused(
      [...siteFiles(), { name: 'data/comment-salt', body: 'salt', sha256: '0'.repeat(64) }],
      /data\/comment-salt.*sha256/s,
    );
  });

  it('refuses a file the manifest does not list, and one it lists that is missing', async () => {
    await refused(
      [...siteFiles(), { name: 'data/comment-salt', body: 'salt', listed: false }],
      /data\/comment-salt/,
    );
    const { file, targets, settings } = await setup(
      siteArchive(siteFiles(), {
        files: manifestFiles([...siteFiles(), { name: 'data/locations.json', body: '{}' }]),
      }),
    );
    await assert.rejects(importFiles(file, targets, settings), /data\/locations\.json/);
  });

  it('skips a data/ file this site would rebuild, and names it', async () => {
    const { file, targets, settings } = await setup(
      siteArchive([...siteFiles(), { name: 'data/geekity.db', body: 'not a database' }]),
    );
    const { staged } = await importFiles(file, targets, settings);
    assert.deepEqual(
      staged.skipped.map((skip) => skip.path),
      ['data/geekity.db'],
    );
    assert.equal(Object.hasOwn(await tree(targets.dataDir), 'geekity.db'), false);
  });

  it('keeps the files of an archived plugin folder', async () => {
    const { file, targets, settings } = await setup(
      siteArchive([
        ...siteFiles(),
        { name: 'data/plugins/@acme/plugin-x/notes.json', body: '{}' },
        { name: 'data/plugins/@acme/plugin-x/settings.json', body: '{}' },
      ]),
    );
    await importFiles(file, targets, settings);
    const data = await tree(targets.dataDir);
    assert.ok(Object.hasOwn(data, path.join('plugins', '@acme', 'plugin-x', 'notes.json')));
  });

  it('refuses a folder that holds a file, and with replace renames it aside and deletes nothing', async () => {
    const { file, targets, settings } = await setup(siteArchive(siteFiles()));
    await mkdir(targets.dataDir, { recursive: true });
    await writeFile(path.join(targets.dataDir, 'users.json'), 'the old site');
    await writeFile(path.join(targets.dataDir, 'users.json.12-3.tmp'), '');
    await mkdir(targets.contentDir, { recursive: true });
    await writeFile(path.join(targets.contentDir, 'posts.md.1-1.tmp'), '');

    await assert.rejects(importFiles(file, targets, settings), /occupied: .*data/);
    assert.equal(await readFile(path.join(targets.dataDir, 'users.json'), 'utf8'), 'the old site');

    const { moved } = await importFiles(file, targets, settings, true);
    const aside = path.join(targets.dataDir, '.geekity-before-import-20261014T150000Z');
    assert.deepEqual(moved, [aside]);
    assert.equal(await readFile(path.join(aside, 'users.json'), 'utf8'), 'the old site');
    assert.equal(
      await readFile(path.join(targets.dataDir, 'users.json'), 'utf8'),
      '{"users":[],"nextId":1}\n',
    );
  });

  it('a second run after one killed mid-unpack, or between placing the two folders, ends the same', async () => {
    const archive = siteArchive([
      ...siteFiles(),
      { name: 'data/comment-salt', body: 'salt', mode: 0o600 },
    ]);
    const clean = await setup(archive);
    await importFiles(clean.file, clean.targets, clean.settings);
    const expected = {
      content: await tree(clean.targets.contentDir),
      data: await tree(clean.targets.dataDir),
    };

    const killed = await setup(archive);
    const leftover = path.join(killed.targets.contentDir, '.geekity-importing', 'posts');
    await mkdir(leftover, { recursive: true });
    await writeFile(path.join(leftover, '2026-01-01-one.md'), '---\nti');
    await importFiles(killed.file, killed.targets, killed.settings);
    assert.deepEqual(
      { content: await tree(killed.targets.contentDir), data: await tree(killed.targets.dataDir) },
      expected,
    );
    assert.deepEqual(await readdir(path.dirname(killed.targets.dataDir)), ['content', 'data']);

    const halfPlaced = await setup(archive);
    const archived = await readSiteManifest(halfPlaced.file);
    const staged = await stageSiteImport({
      archive: halfPlaced.file,
      archived,
      targets: halfPlaced.targets,
      settings: halfPlaced.settings,
    });
    await placeSiteImport(
      {
        ...staged,
        states: staged.states.filter((target) => target.dir === staged.targets.contentDir),
      },
      { stamp: '20261014T150000Z' },
    );
    await importFiles(halfPlaced.file, halfPlaced.targets, halfPlaced.settings);
    assert.deepEqual(
      {
        content: await tree(halfPlaced.targets.contentDir),
        data: await tree(halfPlaced.targets.dataDir),
      },
      expected,
    );
  });
});

describe('site import into mount points', () => {
  it('restores the site without renaming, removing or writing beside content/ and data/', async () => {
    const { file, targets, settings } = await setup(siteArchive(siteFiles()));
    await mountPoints(targets);
    await importFiles(file, targets, settings);

    assert.deepEqual(Object.keys(await tree(targets.contentDir)).sort(), [
      '_data/site.json',
      'posts/2026-01-01-one.md',
    ]);
    assert.deepEqual(Object.keys(await tree(targets.dataDir)).sort(), [
      'notification-secret',
      'users.json',
    ]);
  });

  it('with replace keeps the old contents inside each target, and a later import keeps them too', async () => {
    const { file, targets, settings } = await setup(siteArchive(siteFiles()));
    await mountPoints(targets);
    await occupy(targets);
    const old = await sites(targets);

    await assert.rejects(importFiles(file, targets, settings), /occupied/);
    const { moved } = await importFiles(file, targets, settings, true);
    assert.deepEqual(moved, [
      path.join(targets.contentDir, '.geekity-before-import-20261014T150000Z'),
      path.join(targets.dataDir, '.geekity-before-import-20261014T150000Z'),
    ]);
    const aside = await tree(moved[1] ?? '');
    assert.deepEqual(aside, old.data);
    assert.equal(
      await readFile(path.join(moved[0] ?? '', 'posts', 'old.md'), 'utf8'),
      '---\ntitle: Old\n---\n',
    );

    await importFiles(file, targets, settings, true, { stamp: '20261015T150000Z' });
    assert.equal(await readFile(path.join(moved[1] ?? '', 'users.json'), 'utf8'), 'the old site');
  });

  it('changes nothing in a target when an entry fails its check', async () => {
    const { file, targets, settings } = await setup(
      siteArchive([
        ...siteFiles(),
        { name: 'data/comment-salt', body: 'salt', sha256: '0'.repeat(64) },
      ]),
    );
    await mountPoints(targets);
    await occupy(targets);
    const before = await sites(targets);

    await assert.rejects(importFiles(file, targets, settings, true), /comment-salt.*sha256/s);
    assert.deepEqual(await sites(targets), before);
    assert.deepEqual(await readdir(targets.dataDir), ['keys', 'users.json']);
  });

  it('a run killed before any rename of placing, and run again, ends as a clean import does', async () => {
    const archive = siteArchive([
      ...siteFiles(),
      { name: 'data/comment-salt', body: 'salt', mode: 0o600 },
      { name: 'data/keys/b.jwk', body: 'new key', mode: 0o600 },
    ]);
    const clean = await setup(archive);
    await mountPoints(clean.targets);
    await occupy(clean.targets);
    let renames = 0;
    await importFiles(clean.file, clean.targets, clean.settings, true, {
      rename: async (from, to) => {
        renames += 1;
        await rename(from, to);
      },
    });
    const expected = await sites(clean.targets);
    assert.ok(renames > 4);

    for (let allowed = 0; allowed < renames; allowed += 1) {
      const killed = await setup(archive);
      await mountPoints(killed.targets);
      await occupy(killed.targets);
      await assert.rejects(
        importFiles(killed.file, killed.targets, killed.settings, true, {
          rename: killedAfter(allowed),
        }),
        /killed/,
      );
      await importFiles(killed.file, killed.targets, killed.settings, true, {
        stamp: '20261015T150000Z',
      });
      assert.deepEqual(await sites(killed.targets), expected, `killed after ${String(allowed)}`);
      for (const dir of [killed.targets.contentDir, killed.targets.dataDir]) {
        const asides = (await readdir(dir)).filter((name) => name.startsWith('.geekity-before'));
        assert.equal(asides.length, 1, `one folder aside in ${dir} after ${String(allowed)}`);
      }
    }
  });
});
