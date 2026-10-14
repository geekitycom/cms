import assert from 'node:assert/strict';
import { createPrivateKey, sign, verify } from 'node:crypto';
import { readFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import { writeUsers } from './admin/__testing__/users.ts';
import { cleanupTemporaryDirs, exists, runCli, temporaryDir } from './__testing__/cli.ts';
import { fakeNpmRegistry, pluginFiles } from './__testing__/npm-registry.ts';
import type { FakePackage, FakeRegistry } from './__testing__/npm-registry.ts';
import { ARCHIVE_BASE_URL, siteArchive, siteFiles } from './__testing__/site-archive.ts';
import type { ArchivedEntry } from './__testing__/site-archive.ts';
import type { ExportManifest } from './export/site-export.ts';
import { createToken } from './indieauth/tokens.ts';
import { createCms } from './index.ts';
import type { Cms } from './index.ts';
import { addCommentOptOut, readCommentOptOuts } from './notifications/optouts.ts';
import { readNotificationToken, signNotificationToken } from './notifications/tokens.ts';
import { readEnabledPlugins } from './plugins/enabled.ts';

after(cleanupTemporaryDirs);

const registries: FakeRegistry[] = [];
after(() => Promise.all(registries.map((registry) => registry.close())));

const PLUGIN_A = '@acme/plugin-a';
const PLUGIN_B = '@acme/plugin-b';
const PLUGIN_C = '@acme/plugin-c';

function release(name: string, version: string): FakePackage {
  return { name, version, files: pluginFiles({ name, version }) };
}

async function registry(packages: readonly FakePackage[]): Promise<FakeRegistry> {
  const started = await fakeNpmRegistry(packages);
  registries.push(started);
  return started;
}

async function unreachableRegistry(): Promise<string> {
  const closed = await fakeNpmRegistry([]);
  await closed.close();
  return closed.url;
}

async function setup(entries: readonly ArchivedEntry[], manifest: Partial<ExportManifest> = {}) {
  const root = await temporaryDir('geekity-import-');
  const archive = path.join(root, 'site.tar.gz');
  await fs.writeFile(archive, siteArchive(entries, manifest));
  const site = path.join(root, 'site');
  await fs.mkdir(site);
  return {
    root,
    archive,
    site,
    contentDir: path.join(site, 'content'),
    dataDir: path.join(site, 'data'),
    pluginsDir: path.join(site, 'plugins'),
  };
}

function geekity(
  site: string,
  args: readonly string[],
  env: Readonly<Record<string, string>> = {},
) {
  return runCli(args, site, undefined, env);
}

async function installedVersion(pluginsDir: string, name: string): Promise<string | undefined> {
  try {
    const text = await fs.readFile(path.join(pluginsDir, name, 'plugin.json'), 'utf8');
    return (JSON.parse(text) as { version: string }).version;
  } catch {
    return undefined;
  }
}

const PLUGINS: ExportManifest['plugins'] = [
  { name: PLUGIN_A, version: '1.0.0', source: 'folder', enabled: true },
  { name: PLUGIN_B, version: '1.0.0', source: 'folder', enabled: false },
  { name: PLUGIN_C, version: '0.3.1', source: 'config', enabled: true },
];

function withEnabledPlugins(): ArchivedEntry[] {
  return siteFiles().map((entry) =>
    entry.name === 'content/_data/site.json'
      ? {
          ...entry,
          body: `${JSON.stringify({
            title: 'Blog',
            url: ARCHIVE_BASE_URL,
            plugins: { [PLUGIN_A]: { enabled: true }, [PLUGIN_C]: { enabled: true } },
          })}\n`,
        }
      : entry,
  );
}

describe('geekity import', () => {
  it('brings a site back with the same actor, keys, users, followers, comment emails, opt-outs, tokens and links', async () => {
    const source = await temporaryDir('geekity-import-source-');
    const contentDir = path.join(source, 'content');
    const dataDir = path.join(source, 'data');
    const now = new Date();
    writeUsers(dataDir, [{ username: 'ada', email: 'ada@example.com' }]);
    await fs.mkdir(path.join(contentDir, '_data', 'federation', 'ada'), { recursive: true });
    await fs.writeFile(
      path.join(contentDir, '_data', 'federation', 'ada', 'followers.json'),
      `${JSON.stringify([
        {
          actorId: 'https://remote.example/users/bea',
          inboxId: 'https://remote.example/users/bea/inbox',
          sharedInboxId: null,
          handle: '@bea@remote.example',
          name: 'Bea',
          iconUrl: null,
          url: 'https://remote.example/@bea',
          followedAt: '2026-01-03T10:00:00.000Z',
        },
      ])}\n`,
    );
    await fs.mkdir(path.join(contentDir, 'posts'), { recursive: true });
    await fs.writeFile(
      path.join(contentDir, 'posts', '2026-01-01-one.md'),
      '---\ntitle: One\npermalink: /one/\n---\n\nOne.\n',
    );
    await fs.mkdir(path.join(dataDir, 'comments'), { recursive: true });
    await fs.writeFile(
      path.join(dataDir, 'comments', 'one.json'),
      '{"c1":{"email":"cy@example.com"}}\n',
      { mode: 0o600 },
    );
    await addCommentOptOut(dataDir, 'gone@example.com');

    const before = createCms({ contentDir, dataDir, baseUrl: ARCHIVE_BASE_URL, watch: false });
    let actorBefore: Actor;
    let accessToken: string;
    let link: string;
    let signedBefore: Buffer;
    try {
      await before.sync();
      actorBefore = await actorOf(before);
      ({ accessToken } = await createToken(
        dataDir,
        {
          userId: 1,
          me: `${ARCHIVE_BASE_URL}/`,
          name: 'Quill',
          scopes: ['create'],
          resource: ARCHIVE_BASE_URL,
          lifetimeMs: 86_400_000,
        },
        now,
      ));
      link = signNotificationToken(
        dataDir,
        { action: 'approve', subject: 'c1', lifetimeSeconds: 86_400 },
        now,
      );
      signedBefore = signActivity(dataDir);
    } finally {
      await before.close();
    }
    const usersBefore = await fs.readFile(path.join(dataDir, 'users.json'), 'utf8');

    const exported = await geekity(source, ['export', '--out', 'site.tar.gz'], {
      GEEKITY_BASE_URL: ARCHIVE_BASE_URL,
    });
    assert.equal(exported.code, 0, exported.stderr);

    const target = await temporaryDir('geekity-import-target-');
    const imported = await geekity(target, ['import', path.join(source, 'site.tar.gz')], {
      GEEKITY_BASE_URL: ARCHIVE_BASE_URL,
    });
    assert.equal(imported.code, 0, imported.stderr);

    const newData = path.join(target, 'data');
    const after = createCms({
      contentDir: path.join(target, 'content'),
      dataDir: newData,
      baseUrl: ARCHIVE_BASE_URL,
      watch: false,
    });
    try {
      const actorAfter = await actorOf(after);
      assert.deepEqual(actorAfter.keyIds, actorBefore.keyIds);
      assert.equal(actorAfter.id, actorBefore.id);
      assert.ok(verifyActivity(actorBefore.publicKeyPem, signedBefore));
      assert.ok(verifyActivity(actorBefore.publicKeyPem, signActivity(newData)));
      assert.ok(verifyActivity(actorAfter.publicKeyPem, signedBefore));

      assert.equal(await fs.readFile(path.join(newData, 'users.json'), 'utf8'), usersBefore);
      assert.equal(after.admin.countFollowers(), 1);
      assert.equal(
        await fs.readFile(path.join(newData, 'comments', 'one.json'), 'utf8'),
        '{"c1":{"email":"cy@example.com"}}\n',
      );
      assert.deepEqual([...readCommentOptOuts(newData)], ['gone@example.com']);

      const micropub = await after.app.request(
        new Request(`${ARCHIVE_BASE_URL}/_geekity/micropub?q=config`, {
          headers: { authorization: `Bearer ${accessToken}` },
        }),
      );
      assert.equal(micropub.status, 200);
      assert.deepEqual(readNotificationToken(newData, link, new Date()), {
        action: 'approve',
        subject: 'c1',
      });
    } finally {
      await after.close();
    }
  });

  it('installs each folder plugin at its recorded version, keeps enabled states, names config plugins, and says what is left to do', async () => {
    const { archive, site, pluginsDir, contentDir, dataDir } = await setup(withEnabledPlugins(), {
      plugins: PLUGINS,
      overrides: [{ setting: 'mail.brevo_api_key', source: 'env GEEKITY_MAIL__BREVO_API_KEY' }],
      credentialsLeftOut: ['mail', PLUGIN_A],
    });
    const npm = await registry([
      release(PLUGIN_A, '1.0.0'),
      release(PLUGIN_A, '1.1.0'),
      release(PLUGIN_B, '1.0.0'),
    ]);

    const run = await geekity(site, ['import', archive], {
      GEEKITY_PLUGINS_DIR: pluginsDir,
      npm_config_registry: npm.url,
    });
    assert.equal(run.code, 0, run.stderr);
    assert.equal(await installedVersion(pluginsDir, PLUGIN_A), '1.0.0');
    assert.equal(await installedVersion(pluginsDir, PLUGIN_B), '1.0.0');
    assert.equal(await installedVersion(pluginsDir, PLUGIN_C), undefined);
    assert.deepEqual([...readEnabledPlugins(contentDir)].sort(), [PLUGIN_A, PLUGIN_C]);
    assert.ok(await exists(path.join(dataDir, 'geekity.db')));

    assert.match(run.stdout, /mail\.brevo_api_key.*env GEEKITY_MAIL__BREVO_API_KEY/);
    assert.match(run.stdout, /credentials.*mail, @acme\/plugin-a/i);
    assert.match(run.stdout, /@acme\/plugin-c 0\.3\.1/);
    assert.match(run.stdout, /signs in again/);
  });

  it('restores enabled states from the manifest when the export left content out', async () => {
    const { archive, site, pluginsDir, contentDir } = await setup(
      siteFiles().filter((entry) => entry.name.startsWith('data/')),
      { content: false, plugins: PLUGINS },
    );
    const npm = await registry([release(PLUGIN_A, '1.0.0'), release(PLUGIN_B, '1.0.0')]);

    const run = await geekity(site, ['import', archive], {
      GEEKITY_PLUGINS_DIR: pluginsDir,
      GEEKITY_BASE_URL: ARCHIVE_BASE_URL,
      npm_config_registry: npm.url,
    });
    assert.equal(run.code, 0, run.stderr);
    assert.equal(await installedVersion(pluginsDir, PLUGIN_A), '1.0.0');
    assert.deepEqual([...readEnabledPlugins(contentDir)].sort(), [PLUGIN_A, PLUGIN_C]);
  });

  it('restores everything else when a recorded version is gone, names it with the retry, and exits 1', async () => {
    const { archive, site, pluginsDir, contentDir, dataDir } = await setup(withEnabledPlugins(), {
      plugins: PLUGINS,
    });
    const npm = await registry([release(PLUGIN_A, '1.1.0'), release(PLUGIN_B, '1.0.0')]);

    const run = await geekity(site, ['import', archive], {
      GEEKITY_PLUGINS_DIR: pluginsDir,
      npm_config_registry: npm.url,
    });
    assert.equal(run.code, 1, run.stdout);
    assert.equal(await installedVersion(pluginsDir, PLUGIN_A), undefined);
    assert.equal(await installedVersion(pluginsDir, PLUGIN_B), '1.0.0');
    assert.match(run.stderr, /@acme\/plugin-a 1\.0\.0.*no version matching 1\.0\.0/);
    assert.match(run.stderr, /geekity plugin add @acme\/plugin-a@1\.0\.0/);
    assert.ok(readEnabledPlugins(contentDir).has(PLUGIN_A));
    assert.ok(await exists(path.join(dataDir, 'users.json')));
    assert.ok(await exists(path.join(dataDir, 'geekity.db')));
  });

  it('restores the data and rebuilds when the registry cannot be reached, and exits 1', async () => {
    const { archive, site, pluginsDir, dataDir } = await setup(withEnabledPlugins(), {
      plugins: PLUGINS,
    });

    const run = await geekity(site, ['import', archive], {
      GEEKITY_PLUGINS_DIR: pluginsDir,
      npm_config_registry: await unreachableRegistry(),
    });
    assert.equal(run.code, 1, run.stdout);
    assert.match(run.stderr, /@acme\/plugin-a 1\.0\.0.*could not be reached/);
    assert.match(run.stderr, /@acme\/plugin-b 1\.0\.0.*could not be reached/);
    assert.ok(await exists(path.join(dataDir, 'users.json')));
    assert.ok(await exists(path.join(dataDir, 'geekity.db')));
  });

  it('refuses while the site runs', async () => {
    const { archive, site, contentDir, dataDir } = await setup(siteFiles());
    const running = createCms({ contentDir, dataDir, watch: false });
    try {
      const run = await geekity(site, ['import', archive]);
      assert.equal(run.code, 1);
      assert.match(run.stderr, /running/);
      assert.equal(await exists(path.join(dataDir, 'users.json')), false);
    } finally {
      await running.close();
    }
  });

  it('refuses a folder that holds a site unless --replace, which moves it aside', async () => {
    const { archive, site, dataDir } = await setup(siteFiles());
    await fs.mkdir(dataDir, { recursive: true });
    await fs.writeFile(path.join(dataDir, 'users.json'), 'the old site');

    const refused = await geekity(site, ['import', archive]);
    assert.equal(refused.code, 1);
    assert.match(refused.stderr, /--replace/);
    assert.equal(await fs.readFile(path.join(dataDir, 'users.json'), 'utf8'), 'the old site');

    const replaced = await geekity(site, ['import', archive, '--replace']);
    assert.equal(replaced.code, 0, replaced.stderr);
    const aside = (await fs.readdir(dataDir)).filter((name) =>
      name.startsWith('.geekity-before-import-'),
    );
    assert.equal(aside.length, 1);
    assert.match(replaced.stdout, /Moved what was there into .*\.geekity-before-import-/);
    assert.equal(
      await fs.readFile(path.join(dataDir, aside[0] ?? '', 'users.json'), 'utf8'),
      'the old site',
    );
    assert.deepEqual(await fs.readdir(site), ['content', 'data']);
  });

  it('leaves lost+found where it is with --replace, unread, and restores the site', async () => {
    const { archive, site, contentDir, dataDir } = await setup(siteFiles());
    const lostFolders = [path.join(contentDir, 'lost+found'), path.join(dataDir, 'lost+found')];
    for (const [dir, file] of [
      [contentDir, 'posts/old.md'],
      [dataDir, 'users.json'],
    ] as const) {
      await fs.mkdir(path.dirname(path.join(dir, file)), { recursive: true });
      await fs.writeFile(path.join(dir, file), 'the old site');
    }
    for (const folder of lostFolders) {
      await fs.mkdir(folder);
      await fs.writeFile(path.join(folder, '#1234'), 'a block fsck found');
      await fs.chmod(folder, 0o000);
    }
    try {
      const run = await geekity(site, ['import', archive, '--replace']);
      assert.equal(run.code, 0, run.stderr);

      for (const dir of [contentDir, dataDir]) {
        const folder = path.join(dir, 'lost+found');
        assert.equal((await fs.stat(folder)).mode & 0o777, 0o000, folder);
        const aside = (await fs.readdir(dir)).find((name) =>
          name.startsWith('.geekity-before-import-'),
        );
        assert.ok(aside !== undefined, `${dir} has a folder moved aside`);
        assert.ok(!(await fs.readdir(path.join(dir, aside))).includes('lost+found'));
      }
      assert.equal(
        await fs.readFile(path.join(dataDir, 'users.json'), 'utf8'),
        '{"users":[],"nextId":1}\n',
      );
      assert.ok(await exists(path.join(contentDir, 'posts', '2026-01-01-one.md')));
    } finally {
      for (const folder of lostFolders) await fs.chmod(folder, 0o700);
    }
    for (const folder of lostFolders) {
      assert.deepEqual(await fs.readdir(folder), ['#1234']);
    }
  });

  it('refuses an archive that holds a lost+found folder', async () => {
    const { archive, site, dataDir } = await setup([
      ...siteFiles(),
      { name: 'data/lost+found/#1234', body: 'from another disk' },
    ]);
    const run = await geekity(site, ['import', archive]);
    assert.equal(run.code, 1);
    assert.match(run.stderr, /lost\+found/);
    assert.equal(await exists(path.join(dataDir, 'users.json')), false);
  });

  it('refuses a different base URL unless --new-base-url', async () => {
    const { archive, site, dataDir } = await setup(siteFiles());
    const env = { GEEKITY_BASE_URL: 'https://new.example' };

    const refused = await geekity(site, ['import', archive], env);
    assert.equal(refused.code, 1);
    assert.match(refused.stderr, /https:\/\/new\.example.*https:\/\/blog\.example/s);
    assert.match(refused.stderr, /--new-base-url/);
    assert.equal(await exists(dataDir), false);

    const moved = await geekity(site, ['import', archive, '--new-base-url'], env);
    assert.equal(moved.code, 0, moved.stderr);
  });

  it('keeps the dev mode the site was exported in, and --dev-mode turns it on', async () => {
    const devOn = await setup([
      ...siteFiles(),
      { name: 'data/dev-mode.json', body: '{"on":true}' },
    ]);
    assert.equal((await geekity(devOn.site, ['import', devOn.archive])).code, 0);
    assert.match((await geekity(devOn.site, ['dev-mode', 'status'])).stdout, /Dev mode is on/);

    const live = await setup(siteFiles());
    assert.equal((await geekity(live.site, ['import', live.archive])).code, 0);
    assert.match((await geekity(live.site, ['dev-mode', 'status'])).stdout, /Dev mode is off/);

    const staging = await setup(siteFiles());
    const run = await geekity(staging.site, ['import', staging.archive, '--dev-mode']);
    assert.equal(run.code, 0, run.stderr);
    assert.match((await geekity(staging.site, ['dev-mode', 'status'])).stdout, /Dev mode is on/);
  });
});

interface Actor {
  id: string;
  keyIds: string[];
  publicKeyPem: string;
}

async function actorOf(cms: Cms): Promise<Actor> {
  const response = await cms.app.request(
    new Request(`${ARCHIVE_BASE_URL}/author/ada/`, {
      headers: { accept: 'application/activity+json' },
    }),
  );
  assert.equal(response.status, 200);
  const actor = (await response.json()) as {
    id: string;
    publicKey: { id: string; publicKeyPem: string };
    assertionMethod?: { id: string }[];
  };
  return {
    id: actor.id,
    keyIds: [actor.publicKey.id, ...(actor.assertionMethod ?? []).map((method) => method.id)],
    publicKeyPem: actor.publicKey.publicKeyPem,
  };
}

const ACTIVITY = Buffer.from(
  JSON.stringify({
    type: 'Create',
    actor: `${ARCHIVE_BASE_URL}/author/ada/`,
    object: `${ARCHIVE_BASE_URL}/one/`,
  }),
);

function signActivity(dataDir: string): Buffer {
  const jwk = JSON.parse(
    readFileSync(path.join(dataDir, 'keys', 'ada.rsassa-pkcs1-v1_5.jwk'), 'utf8'),
  ) as JsonWebKey;
  return sign('sha256', ACTIVITY, createPrivateKey({ key: jwk, format: 'jwk' }));
}

function verifyActivity(publicKeyPem: string, signature: Buffer): boolean {
  return verify('sha256', ACTIVITY, publicKeyPem, signature);
}
