import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, describe, it } from 'node:test';

import { SqliteMessageQueue } from '@fedify/sqlite';

import { resolveConfig } from '../config.ts';
import { readTar } from '../files/tar.ts';
import type { TarEntry } from '../files/tar.ts';
import { definePlugin, HOST_API_VERSION } from '../plugin.ts';
import type { Plugin } from '../plugin.ts';
import { sitePluginRegistry } from '../plugins/site.ts';
import { createSettings } from '../site/namespace.ts';
import { FEDERATION_QUEUE_TABLE } from '../store/queue-database.ts';
import { exportFileName, pendingWork, planSiteExport, writeSiteExport } from './site-export.ts';
import type { ExportManifest, SiteExportOptions } from './site-export.ts';

const dirs: string[] = [];
after(() => Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true }))));

const BASE = 'https://blog.example';
const SECRET_KEY = 'brevo-key-from-the-environment';
const NOW = new Date('2026-10-14T15:04:05.000Z');

function plugin(name: string, version: string, data?: Plugin['data']): Plugin {
  return definePlugin({
    name,
    version,
    label: name,
    description: 'A test plugin.',
    hostApi: HOST_API_VERSION,
    requires: {},
    ...(data === undefined ? {} : { data }),
    register() {},
  });
}

async function put(root: string, relative: string, contents: string, mode = 0o644) {
  const file = path.join(root, ...relative.split('/'));
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, contents);
  await chmod(file, mode);
}

/** A site with a file of every class under data/, scratch under content/, and work waiting. */
async function site() {
  const root = await mkdtemp(path.join(tmpdir(), 'geekity-export-'));
  dirs.push(root);
  const contentDir = path.join(root, 'content');
  const dataDir = path.join(root, 'data');

  await put(
    contentDir,
    '_data/site.json',
    JSON.stringify({ title: 'Blog', plugins: { '@acme/plugin-folder': { enabled: true } } }),
  );
  await put(contentDir, 'posts/hello.md', '---\ntitle: Hello\n---\n\nHello.\n');
  await put(contentDir, 'uploads/2026/10/cat.jpg', 'jpeg bytes');
  await put(contentDir, 'posts/hello.md.1a2b-3.tmp', 'half a write');
  await put(contentDir, '.geekity-watch-0f3e/probe', '');
  await put(contentDir, '.geekity-importing/posts/staged.md', 'staged');
  await put(contentDir, '.geekity-before-import-20261014T150000Z/posts/old.md', 'old');

  await put(dataDir, 'users.json', '[{"username":"ada"}]', 0o600);
  await put(dataDir, 'keys/ada.Ed25519.jwk', '{"kty":"OKP"}', 0o600);
  await put(dataDir, 'notification-secret', 'secret', 0o600);
  await put(dataDir, 'dev-mode.json', '{"on":true}');
  await put(dataDir, 'mail.json', '{"brevo_api_key":"from-the-file"}', 0o600);
  await put(dataDir, 'akismet.json', '', 0o600);
  await put(dataDir, 'plugins/@acme/plugin-folder/notes.json', '{"kept":true}');
  await put(dataDir, 'plugins/@acme/plugin-folder/cache.json', '{}');
  await put(dataDir, 'plugins/@acme/plugin-gone/notes.json', '{"gone":true}');
  await put(dataDir, 'plugins/@acme/plugin-gone/secrets.json', '{"api_key":"x"}', 0o600);
  await put(dataDir, 'geekity.db', 'index');
  await put(dataDir, 'images/2026/10/cat.jpg/cat-640.webp', 'webp');
  await put(dataDir, 'indieauth-activity.json', '[]');
  await put(dataDir, 'jobs.json.lock', '');
  await put(dataDir, 'users.json.1a2b-3.tmp', '');
  await put(dataDir, '.geekity-importing/users.json', 'staged', 0o600);
  await put(dataDir, '.geekity-before-import-20261014T150000Z/users.json', 'old', 0o600);
  await put(dataDir, 'exports/geekity-blog.example-20261013T000000Z.tar.gz', 'old');
  await put(dataDir, 'surprise.json', '{}');
  await put(
    dataDir,
    'jobs.json',
    JSON.stringify([
      {
        id: '1',
        name: 'strip-metadata',
        payload: null,
        queuedAt: NOW.toISOString(),
        state: 'queued',
        attempt: 1,
      },
    ]),
  );

  const queue = new SqliteMessageQueue(new DatabaseSync(path.join(dataDir, 'queue.sqlite')), {
    tableName: FEDERATION_QUEUE_TABLE,
  });
  await queue.enqueue({ deliver: 1 });
  await queue.enqueue({ deliver: 2 });
  queue[Symbol.dispose]();

  const config = resolveConfig(
    {
      contentDir,
      dataDir,
      baseUrl: BASE,
      plugins: [plugin('@acme/plugin-config', '0.3.1')],
    },
    { env: {} },
  );
  const settings = createSettings({ config, env: { GEEKITY_MAIL__BREVO_API_KEY: SECRET_KEY } });
  const plugins = sitePluginRegistry(
    config,
    [
      {
        plugin: plugin('@acme/plugin-folder', '1.2.0', {
          'notes.json': 'kept',
          'cache.json': 'rebuildable',
        }),
        source: 'the plugins folder, @acme/plugin-folder',
      },
    ],
    settings,
  );
  return { root, contentDir, dataDir, source: { config, settings, plugins } };
}

interface Exported {
  manifest: ExportManifest;
  entries: TarEntry[];
  names: string[];
  out: string;
}

async function exported(options: Partial<SiteExportOptions> = {}): Promise<Exported> {
  const { root, source } = await site();
  const plan = await planSiteExport(source, {
    withCredentials: false,
    withContent: true,
    ...options,
  });
  const out = path.join(root, 'site.tar.gz');
  await writeSiteExport(plan, { out, now: NOW });
  const entries = readTar(await readFile(out));
  const manifest = JSON.parse(entries[0]?.body.toString('utf8') ?? '{}') as ExportManifest;
  return { manifest, entries, names: entries.map((entry) => entry.name), out };
}

describe('a site export', () => {
  it('holds manifest.json first, every kept file and content without scratch, and nothing else', async () => {
    const { names } = await exported();
    assert.deepEqual(names, [
      'manifest.json',
      'content/_data/site.json',
      'content/posts/hello.md',
      'content/uploads/2026/10/cat.jpg',
      'data/dev-mode.json',
      'data/jobs.json',
      'data/keys/ada.Ed25519.jwk',
      'data/notification-secret',
      'data/plugins/@acme/plugin-folder/notes.json',
      'data/plugins/@acme/plugin-gone/notes.json',
      'data/users.json',
    ]);
  });

  it('never holds queue.sqlite, even with credentials', async () => {
    for (const withCredentials of [false, true]) {
      const { names } = await exported({ withCredentials });
      assert.deepEqual(
        names.filter((name) => name.includes('queue.sqlite')),
        [],
        `withCredentials: ${String(withCredentials)}`,
      );
    }
  });

  it('lists the files nobody declared, and leaves them out', async () => {
    const { manifest, names } = await exported();
    assert.deepEqual(manifest.undeclared, ['data/surprise.json']);
    assert.ok(!names.includes('data/surprise.json'));
  });

  it('records each file with its class, size and sha256', async () => {
    const { manifest, entries } = await exported();
    const users = entries.find((entry) => entry.name === 'data/users.json');
    assert.deepEqual(
      manifest.files.find((file) => file.path === 'data/users.json'),
      {
        path: 'data/users.json',
        class: 'kept',
        size: users?.body.length,
        sha256: createHash('sha256')
          .update(users?.body ?? '')
          .digest('hex'),
      },
    );
    assert.deepEqual(
      manifest.files.map((file) => file.path),
      entries.slice(1).map((entry) => entry.name),
    );
  });

  it('holds credentials only when asked, and names the namespaces it left out', async () => {
    const without = await exported();
    assert.equal(without.manifest.credentials, false);
    assert.deepEqual(without.manifest.credentialsLeftOut, ['@acme/plugin-gone', 'mail']);
    assert.ok(!without.names.includes('data/mail.json'));

    const withThem = await exported({ withCredentials: true });
    assert.equal(withThem.manifest.credentials, true);
    assert.deepEqual(withThem.manifest.credentialsLeftOut, []);
    assert.deepEqual(
      withThem.names.filter((name) => /mail|secrets|akismet/.test(name)),
      ['data/akismet.json', 'data/mail.json', 'data/plugins/@acme/plugin-gone/secrets.json'],
    );
    assert.equal(
      withThem.manifest.files.find((file) => file.path === 'data/mail.json')?.class,
      'credential',
    );
  });

  it('keeps file modes, and is written at 0600 itself', async () => {
    const { entries, out } = await exported();
    const mode = (name: string) => entries.find((entry) => entry.name === name)?.mode;
    assert.equal(mode('data/users.json'), 0o600);
    assert.equal(mode('data/keys/ada.Ed25519.jwk'), 0o600);
    assert.equal(mode('content/posts/hello.md'), 0o644);
    assert.equal((await stat(out)).mode & 0o777, 0o600);
  });

  it('leaves content out when asked', async () => {
    const { manifest, names } = await exported({ withContent: false });
    assert.equal(manifest.content, false);
    assert.deepEqual(
      names.filter((name) => name.startsWith('content/')),
      [],
    );
  });

  it('lists overrides by source with no value, and every installed plugin', async () => {
    const { manifest, entries } = await exported();
    assert.deepEqual(
      manifest.overrides.filter((each) => each.setting === 'mail.brevo_api_key'),
      [{ setting: 'mail.brevo_api_key', source: 'env GEEKITY_MAIL__BREVO_API_KEY' }],
    );
    assert.ok(manifest.overrides.some((each) => each.setting === 'site.base_url'));
    assert.ok(!entries[0]?.body.toString('utf8').includes(SECRET_KEY));
    assert.deepEqual(manifest.plugins, [
      { name: '@acme/plugin-config', version: '0.3.1', source: 'config', enabled: false },
      { name: '@acme/plugin-folder', version: '1.2.0', source: 'folder', enabled: true },
    ]);
  });

  it('records the site it came from and the work waiting', async () => {
    const { manifest } = await exported();
    assert.equal(manifest.format, 1);
    assert.equal(manifest.baseUrl, BASE);
    assert.equal(manifest.exportedAt, NOW.toISOString());
    assert.equal(manifest.devMode, true);
    assert.match(manifest.cms, /^\d+\.\d+\.\d+/);
    assert.deepEqual(manifest.pending, { deliveries: 2, jobs: { queued: 1, running: 0 } });
  });

  it('reports progress per file and stops between files when aborted', async () => {
    const { root, source } = await site();
    const plan = await planSiteExport(source, { withCredentials: false, withContent: true });
    const seen: number[] = [];
    const controller = new AbortController();
    const out = path.join(root, 'site.tar.gz');
    await assert.rejects(
      writeSiteExport(plan, {
        out,
        now: NOW,
        signal: controller.signal,
        progress: ({ files }) => {
          seen.push(files);
          if (files === 2) controller.abort();
        },
      }),
      { name: 'AbortError' },
    );
    assert.deepEqual(seen, [1, 2]);
    assert.deepEqual(
      (await readdir(root)).filter((name) => name !== 'content' && name !== 'data'),
      [],
      'no archive and no temporary file is left',
    );
  });
});

describe('pendingWork', () => {
  it('counts nothing on a site with no queue and no jobs', async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), 'geekity-export-empty-'));
    dirs.push(dataDir);
    assert.deepEqual(await pendingWork(dataDir), {
      deliveries: 0,
      jobs: { queued: 0, running: 0 },
    });
  });
});

describe('exportFileName', () => {
  it('names the host and the instant', () => {
    assert.equal(
      exportFileName('https://blog.example:8443/', NOW),
      'geekity-blog.example-20261014T150405Z.tar.gz',
    );
  });
});
