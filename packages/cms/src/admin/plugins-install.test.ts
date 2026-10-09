import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { after, afterEach, before, describe, it } from 'node:test';

import type { Cms } from '../index.ts';
import { definePlugin, HOST_API_VERSION } from '../plugin.ts';
import type { GeekityConfig } from '../config.ts';
import { addPlugin } from '../plugins/install.ts';
import { importPluginFolders, scanPluginFolders } from '../plugins/folder.ts';
import { fakeNpmRegistry, pluginFiles } from '../__testing__/npm-registry.ts';
import type { FakePackage, FakeRegistry } from '../__testing__/npm-registry.ts';
import type { Supervision } from '../supervisor/supervision.ts';
import { flashes } from './__testing__/flash.ts';
import { csrfField, FIRST_ADMIN, sandbox, signedIn } from './__testing__/harness.ts';
import type { Browser } from './__testing__/harness.ts';
import {
  PLUGINS_ADD_PATH,
  PLUGINS_CHECK_PATH,
  PLUGINS_CONFIRM_PATH,
  PLUGINS_PATH,
  PLUGINS_RELOAD_PATH,
  PLUGINS_REMOVE_PATH,
  PLUGINS_UPDATE_ALL_PATH,
  PLUGINS_UPDATE_PATH,
} from './plugins.ts';

const box = sandbox();
after(() => box.cleanup());

const LLM = '@acme/plugin-llm';
const TAGS = '@acme/plugin-tags';
const SUMMARY = '@acme/plugin-summary';
const SHAKY = '@acme/plugin-shaky';

function release(
  name: string,
  version: string,
  options: { requires?: Record<string, string> } & Partial<FakePackage> = {},
): FakePackage {
  const { requires = {}, ...extra } = options;
  return { name, version, files: pluginFiles({ name, version, requires }), ...extra };
}

let registry: FakeRegistry;
const savedRegistry = process.env['npm_config_registry'];

before(async () => {
  registry = await fakeNpmRegistry([
    release(LLM, '1.0.0'),
    release(LLM, '1.1.0'),
    release(TAGS, '2.0.0'),
    release(TAGS, '2.1.0'),
    release(SUMMARY, '0.3.0', { requires: { [LLM]: '^1.0.0' } }),
    release(SHAKY, '0.1.0', { integrity: 'sha512-bm90IHRoZSBoYXNo' }),
  ]);
  process.env['npm_config_registry'] = registry.url;
});

after(async () => {
  if (savedRegistry === undefined) delete process.env['npm_config_registry'];
  else process.env['npm_config_registry'] = savedRegistry;
  await registry.close();
});

interface Site {
  cms: Cms;
  agent: Browser;
  pluginsDir: string;
  dataDir: string;
}

let current: { reloads: number } = { reloads: 0 };
afterEach(() => {
  current = { reloads: 0 };
});

async function site(
  options: { config?: GeekityConfig; installed?: string[]; supervised?: boolean } = {},
): Promise<Site> {
  const pluginsDir = await box.dir('geekity-install-plugins-');
  const dataDir = await box.dir('geekity-install-data-');
  for (const spec of options.installed ?? []) {
    const at = spec.lastIndexOf('@');
    await addPlugin(
      { name: spec.slice(0, at), wanted: spec.slice(at + 1) },
      { pluginsDir, registry: registry.url },
    );
  }
  const supervision: Supervision = {
    loaded: scanPluginFolders(pluginsDir),
    lastFailure: undefined,
    reload: () => {
      current.reloads += 1;
      return Promise.resolve({ ok: true });
    },
  };
  const cms = await box.open(
    {
      contentDir: await box.dir('geekity-install-content-'),
      dataDir,
      pluginsDir,
      ...options.config,
    },
    {
      serve: {
        folderPlugins: await importPluginFolders(scanPluginFolders(pluginsDir)),
        ...(options.supervised === true ? { supervision } : {}),
      },
    },
  );
  return { cms, agent: await signedIn(cms), pluginsDir, dataDir };
}

async function screen(agent: Browser, url = PLUGINS_PATH): Promise<string> {
  const response = await agent.get(url);
  assert.equal(response.status, 200);
  return response.text();
}

async function token(agent: Browser): Promise<string> {
  const value = csrfField(await screen(agent));
  assert.ok(value !== undefined, 'the screen carries a CSRF token');
  return value;
}

async function submit(
  agent: Browser,
  url: string,
  fields: Record<string, string>,
): Promise<{ status: number; html: string; flash: string[] }> {
  const response = await agent.post(url, { csrf_token: await token(agent), ...fields });
  const html = response.status === 303 ? await screen(agent) : await response.text();
  return { status: response.status, html, flash: flashes(html).map((entry) => entry.message) };
}

async function folderVersion(pluginsDir: string, name: string): Promise<string | undefined> {
  const file = path.join(pluginsDir, name, 'plugin.json');
  if (!existsSync(file)) return undefined;
  return (JSON.parse(await readFile(file, 'utf8')) as { version: string }).version;
}

async function record(dataDir: string): Promise<Record<string, unknown>[]> {
  const file = path.join(dataDir, 'plugin-changes.json');
  if (!existsSync(file)) return [];
  return (JSON.parse(await readFile(file, 'utf8')) as { entries: Record<string, unknown>[] })
    .entries;
}

function row(html: string, name: string): string {
  const id = `plugin-${name.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
  const start = html.indexOf(`id="${id}"`);
  assert.notEqual(start, -1, `the screen has a row for ${name}`);
  const end = html.indexOf('</li>', start);
  return html.slice(start, end);
}

const PASSWORD = FIRST_ADMIN.password;

describe('Add plugin (TASK-306)', () => {
  it('installs the named package at the version asked for, records it and says to Reload', async () => {
    const { agent, pluginsDir, dataDir } = await site({ supervised: true });

    const result = await submit(agent, PLUGINS_ADD_PATH, {
      package: LLM,
      version: '1.0.0',
      password: PASSWORD,
    });
    assert.equal(result.status, 303);
    assert.equal(await folderVersion(pluginsDir, LLM), '1.0.0');
    assert.ok(result.flash.some((message) => message.includes(`Added ${LLM} 1.0.0`)));
    assert.match(result.html, new RegExp(`action="${PLUGINS_RELOAD_PATH}"`));

    const [entry] = await record(dataDir);
    assert.deepEqual(
      { user: entry?.['user'], action: entry?.['action'], name: entry?.['name'] },
      { user: FIRST_ADMIN.username, action: 'add', name: LLM },
    );
    assert.equal(entry?.['to'], '1.0.0');
    assert.match(result.html, /Recent changes/);
    assert.match(result.html, new RegExp(`${FIRST_ADMIN.username}[\\s\\S]*Added[\\s\\S]*${LLM}`));
  });

  it('takes a range and installs the newest version in it', async () => {
    const { agent, pluginsDir } = await site();
    await submit(agent, PLUGINS_ADD_PATH, { package: TAGS, version: '~2.0', password: PASSWORD });
    assert.equal(await folderVersion(pluginsDir, TAGS), '2.0.0');
  });

  it('names a requirement that is not installed', async () => {
    const { agent, pluginsDir } = await site();
    const result = await submit(agent, PLUGINS_ADD_PATH, {
      package: SUMMARY,
      password: PASSWORD,
    });
    assert.equal(await folderVersion(pluginsDir, SUMMARY), '0.3.0');
    assert.ok(
      result.flash.some((message) =>
        message.includes(
          `requires ${LLM} ^1.0.0, which is not installed. Add ${LLM} with the Add plugin form.`,
        ),
      ),
      result.flash.join('\n'),
    );
    assert.ok(!result.flash.some((message) => message.includes('geekity plugin add')));
  });

  it('refuses a tarball that does not match its integrity hash, and records nothing', async () => {
    const { agent, pluginsDir, dataDir } = await site();
    const result = await submit(agent, PLUGINS_ADD_PATH, { package: SHAKY, password: PASSWORD });
    assert.equal(await folderVersion(pluginsDir, SHAKY), undefined);
    assert.ok(result.flash.some((message) => /integrity hash does not match/.test(message)));
    assert.deepEqual(await record(dataDir), []);
  });

  it('refuses without the password, keeps what was typed and installs nothing', async () => {
    const { agent, pluginsDir, dataDir } = await site();
    for (const password of ['', 'not the password']) {
      const result = await submit(agent, PLUGINS_ADD_PATH, {
        package: LLM,
        version: '1.0.0',
        password,
      });
      assert.equal(result.status, 400);
      assert.match(result.html, /Your password was not right, so nothing was installed/);
      assert.match(result.html, new RegExp(`value="${LLM}"`));
      assert.ok(!result.html.includes(PASSWORD));
    }
    assert.equal(await folderVersion(pluginsDir, LLM), undefined);
    assert.deepEqual(await record(dataDir), []);
  });

  it('refuses a request without the CSRF token', async () => {
    const { agent, pluginsDir } = await site();
    const response = await agent.post(PLUGINS_ADD_PATH, { package: LLM, password: PASSWORD });
    assert.equal(response.status, 403);
    assert.equal(await folderVersion(pluginsDir, LLM), undefined);
  });

  it('says what is wrong with a name that is not a package', async () => {
    const { agent } = await site();
    const result = await submit(agent, PLUGINS_ADD_PATH, {
      package: 'Not A Package',
      password: PASSWORD,
    });
    assert.equal(result.status, 400);
    assert.match(result.html, /is not a package/);
  });
});

describe('Update and Remove (TASK-306)', () => {
  it('offers Update on a row once a check finds a newer version, and updates it', async () => {
    const { agent, pluginsDir, dataDir } = await site({ installed: [`${LLM}@1.0.0`] });
    assert.ok(!row(await screen(agent), LLM).includes(PLUGINS_UPDATE_PATH));

    const checked = await submit(agent, PLUGINS_CHECK_PATH, {});
    assert.match(row(checked.html, LLM), /1\.1\.0 is available/);

    const confirmUrl = `${PLUGINS_CONFIRM_PATH}?action=update&plugin=${encodeURIComponent(LLM)}`;
    assert.ok(row(checked.html, LLM).includes(confirmUrl.replaceAll('&', '&amp;')));
    const confirm = await screen(agent, confirmUrl);
    assert.match(confirm, /1\.0\.0 can be upgraded to 1\.1\.0/);
    assert.match(confirm, new RegExp(`action="${PLUGINS_UPDATE_PATH}"`));
    assert.match(confirm, /type="password"/);

    const wrong = await submit(agent, PLUGINS_UPDATE_PATH, { plugin: LLM, password: 'nope' });
    assert.equal(wrong.status, 400);
    assert.equal(await folderVersion(pluginsDir, LLM), '1.0.0');

    const result = await submit(agent, PLUGINS_UPDATE_PATH, { plugin: LLM, password: PASSWORD });
    assert.equal(result.status, 303);
    assert.equal(await folderVersion(pluginsDir, LLM), '1.1.0');
    assert.ok(result.flash.some((message) => message.includes('upgraded from 1.0.0 to 1.1.0')));
    const [entry] = await record(dataDir);
    assert.deepEqual(
      [entry?.['action'], entry?.['name'], entry?.['from'], entry?.['to'], entry?.['user']],
      ['update', LLM, '1.0.0', '1.1.0', FIRST_ADMIN.username],
    );
  });

  it('updates every folder plugin with Update all', async () => {
    const { agent, pluginsDir, dataDir } = await site({
      installed: [`${LLM}@1.0.0`, `${TAGS}@2.0.0`],
    });
    const confirm = await screen(agent, `${PLUGINS_CONFIRM_PATH}?action=update-all`);
    assert.match(confirm, new RegExp(`${LLM}[\\s\\S]*1\\.0\\.0 can be upgraded to 1\\.1\\.0`));
    assert.match(confirm, new RegExp(`${TAGS}[\\s\\S]*2\\.0\\.0 can be upgraded to 2\\.1\\.0`));

    const result = await submit(agent, PLUGINS_UPDATE_ALL_PATH, { password: PASSWORD });
    assert.equal(result.status, 303);
    assert.equal(await folderVersion(pluginsDir, LLM), '1.1.0');
    assert.equal(await folderVersion(pluginsDir, TAGS), '2.1.0');
    const entries = await record(dataDir);
    assert.deepEqual(entries.map((entry) => entry['name']).sort(), [LLM, TAGS]);
  });

  it('says so on the confirm screen when nothing is newer, with nothing to press', async () => {
    const { agent } = await site({ installed: [`${LLM}@1.1.0`] });
    const confirm = await screen(agent, `${PLUGINS_CONFIRM_PATH}?action=update-all`);
    assert.match(confirm, /1\.1\.0 is the newest/);
    assert.ok(!confirm.includes(`action="${PLUGINS_UPDATE_ALL_PATH}"`));
  });

  it('removes a folder plugin after the password, records it and offers Reload', async () => {
    const { agent, pluginsDir, dataDir } = await site({
      installed: [`${TAGS}@2.0.0`],
      supervised: true,
    });
    const confirm = await screen(
      agent,
      `${PLUGINS_CONFIRM_PATH}?action=remove&plugin=${encodeURIComponent(TAGS)}`,
    );
    assert.match(confirm, new RegExp(`action="${PLUGINS_REMOVE_PATH}"`));

    const refused = await submit(agent, PLUGINS_REMOVE_PATH, { plugin: TAGS, password: '' });
    assert.equal(refused.status, 400);
    assert.equal(await folderVersion(pluginsDir, TAGS), '2.0.0');

    const result = await submit(agent, PLUGINS_REMOVE_PATH, { plugin: TAGS, password: PASSWORD });
    assert.equal(result.status, 303);
    assert.equal(await folderVersion(pluginsDir, TAGS), undefined);
    assert.ok(result.flash.some((message) => message.includes(`Removed ${TAGS} 2.0.0`)));
    assert.match(result.html, /Removed:[\s\S]*@acme\/plugin-tags/);
    const [entry] = await record(dataDir);
    assert.deepEqual(
      [entry?.['action'], entry?.['name'], entry?.['from']],
      ['remove', TAGS, '2.0.0'],
    );

    const reload = await submit(agent, PLUGINS_RELOAD_PATH, {});
    assert.equal(reload.status, 303);
    assert.equal(current.reloads, 1);
  });
});

describe('Remove an enabled plugin (TASK-306)', () => {
  it('is not offered, and the confirm screen and the POST refuse it until it is disabled', async () => {
    const { agent, pluginsDir, dataDir } = await site({ installed: [`${TAGS}@2.0.0`] });
    const enabled = await submit(agent, `${PLUGINS_PATH}/enable`, { plugin: TAGS });
    assert.equal(enabled.status, 303);
    assert.ok(!row(enabled.html, TAGS).includes('action=remove'));

    const confirm = await screen(
      agent,
      `${PLUGINS_CONFIRM_PATH}?action=remove&plugin=${encodeURIComponent(TAGS)}`,
    );
    assert.match(confirm, /@acme\/plugin-tags is enabled\. Disable it first\./);
    assert.ok(!confirm.includes(`action="${PLUGINS_REMOVE_PATH}"`));

    const refused = await submit(agent, PLUGINS_REMOVE_PATH, { plugin: TAGS, password: PASSWORD });
    assert.ok(
      refused.flash.includes(`${TAGS} is enabled. Disable it first.`),
      refused.flash.join(' | '),
    );
    assert.equal(await folderVersion(pluginsDir, TAGS), '2.0.0');
    assert.deepEqual(await record(dataDir), []);

    const disabled = await submit(agent, `${PLUGINS_PATH}/disable`, { plugin: TAGS });
    assert.ok(row(disabled.html, TAGS).includes('action=remove'));
  });
});

describe('plugins the site config passes (TASK-306)', () => {
  it('are managed in code, with no Update or Remove', async () => {
    const inCode = definePlugin({
      name: '@acme/plugin-in-code',
      version: '1.0.0',
      label: 'In code',
      description: 'Passed in plugins on the config.',
      hostApi: HOST_API_VERSION,
      register() {},
    });
    const { agent } = await site({ config: { plugins: [inCode] }, installed: [`${LLM}@1.0.0`] });
    await submit(agent, PLUGINS_CHECK_PATH, {});
    const html = await screen(agent);
    const coded = row(html, '@acme/plugin-in-code');
    assert.match(coded, /Managed in code/);
    assert.ok(!coded.includes(PLUGINS_CONFIRM_PATH));
    assert.ok(row(html, LLM).includes('action=remove'));
  });

  it('refuses to remove a plugin that is not in the plugins folder', async () => {
    const { agent } = await site();
    const result = await submit(agent, PLUGINS_REMOVE_PATH, { plugin: LLM, password: PASSWORD });
    assert.ok(result.flash.some((message) => message.includes('is not in the plugins folder')));
  });
});

describe('GEEKITY_PLUGIN_INSTALL=off (TASK-306)', () => {
  it('hides every control and refuses every request with the reason', async () => {
    const { agent, pluginsDir, dataDir } = await site({
      config: { pluginInstall: false },
      installed: [`${LLM}@1.0.0`],
    });
    const html = await screen(agent);
    for (const url of [
      PLUGINS_ADD_PATH,
      PLUGINS_CHECK_PATH,
      PLUGINS_CONFIRM_PATH,
      PLUGINS_UPDATE_ALL_PATH,
    ]) {
      assert.ok(!html.includes(url), `${url} is not on the screen`);
    }
    assert.match(html, /GEEKITY_PLUGIN_INSTALL/);

    for (const [url, fields] of [
      [PLUGINS_ADD_PATH, { package: TAGS }],
      [PLUGINS_UPDATE_PATH, { plugin: LLM }],
      [PLUGINS_UPDATE_ALL_PATH, {}],
      [PLUGINS_REMOVE_PATH, { plugin: LLM }],
      [PLUGINS_CHECK_PATH, {}],
    ] as const) {
      const result = await submit(agent, url, { ...fields, password: PASSWORD });
      assert.ok(
        result.flash.some((message) => /turned off on this site/.test(message)),
        `${url}: ${result.flash.join(' | ')}`,
      );
    }
    const confirm = await agent.get(`${PLUGINS_CONFIRM_PATH}?action=update-all`);
    assert.equal(confirm.status, 303);
    assert.equal(await folderVersion(pluginsDir, LLM), '1.0.0');
    assert.equal(await folderVersion(pluginsDir, TAGS), undefined);
    assert.deepEqual(await record(dataDir), []);
  });
});
