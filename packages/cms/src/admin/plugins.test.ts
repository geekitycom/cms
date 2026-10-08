/**
 * Plugins at runtime (decision-33, TASK-281): what Admin > Plugins shows,
 * what Enable and Disable write into `content/_data/site.json`, and what the
 * public site answers on the very next request.
 */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import type { Cms } from '../index.ts';
import { createCms } from '../index.ts';
import { definePlugin, HOST_API_VERSION } from '../plugin.ts';
import type { Plugin } from '../plugin.ts';
import { DuplicatePluginError } from '../plugins/registry.ts';
import { flashes } from './__testing__/flash.ts';
import { csrfField, sandbox, signedIn } from './__testing__/harness.ts';
import type { Browser } from './__testing__/harness.ts';
import { PLUGINS_PATH } from './plugins.ts';

const box = sandbox();
after(() => box.cleanup());

const BASE = '@test/plugin-base';
const HELLO = '@test/plugin-hello';

/** A plugin with a public route, which requires {@link BASE}. */
function hello(calls: string[] = []): Plugin {
  return definePlugin({
    name: HELLO,
    version: '1.2.3',
    label: 'Hello',
    description: 'Says hello on a page of its own.',
    hostApi: HOST_API_VERSION,
    requires: { [BASE]: '^0.1.0' },
    register(host) {
      host.get('/hello-plugin/:who', ({ params }) => new Response(`Hello, ${params['who'] ?? ''}`));
    },
    start: () => {
      calls.push(`start ${HELLO}`);
    },
    stop: () => {
      calls.push(`stop ${HELLO}`);
    },
  });
}

function base(calls: string[] = []): Plugin {
  return definePlugin({
    name: BASE,
    version: '0.1.4',
    label: 'Base',
    description: 'What Hello stands on.',
    hostApi: HOST_API_VERSION,
    register() {},
    start: () => {
      calls.push(`start ${BASE}`);
    },
    stop: () => {
      calls.push(`stop ${BASE}`);
    },
  });
}

async function site(
  plugins: Plugin[],
  enabled: string[] = [],
): Promise<{ cms: Cms; agent: Browser; contentDir: string }> {
  const contentDir = await box.dir('geekity-plugins-content-');
  const dataDir = await box.dir('geekity-plugins-data-');
  await mkdir(path.join(contentDir, '_data'), { recursive: true });
  await writeFile(
    path.join(contentDir, '_data', 'site.json'),
    JSON.stringify({
      title: 'A Site',
      plugins: Object.fromEntries(enabled.map((name) => [name, { enabled: true }])),
    }),
  );
  const cms = await box.open({ contentDir, dataDir, plugins });
  return { cms, agent: await signedIn(cms), contentDir };
}

async function siteJson(contentDir: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path.join(contentDir, '_data', 'site.json'), 'utf8')) as Record<
    string,
    unknown
  >;
}

/** Hand-edit the enabled set, the way somebody editing site.json would. */
async function enableByHand(contentDir: string, names: string[]): Promise<void> {
  const file = await siteJson(contentDir);
  file['plugins'] = Object.fromEntries(names.map((name) => [name, { enabled: true }]));
  await writeFile(path.join(contentDir, '_data', 'site.json'), JSON.stringify(file));
}

async function screen(agent: Browser): Promise<string> {
  const response = await agent.get(PLUGINS_PATH);
  assert.equal(response.status, 200);
  return response.text();
}

/** The row for one plugin on the screen. */
function row(html: string, name: string): string {
  const id = `plugin-${name.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
  const start = html.indexOf(`id="${id}"`);
  assert.notEqual(start, -1, `the screen has a row for ${name}`);
  const end = html.indexOf('id="plugin-', start + 1);
  return html.slice(start, end === -1 ? undefined : end);
}

/** Press Enable or Disable on one plugin's row. */
async function press(
  agent: Browser,
  action: 'enable' | 'disable',
  name: string,
): Promise<{ status: number; flash: string[] }> {
  const token = csrfField(await screen(agent));
  assert.ok(token !== undefined);
  const response = await agent.post(`${PLUGINS_PATH}/${action}`, {
    csrf_token: token,
    plugin: name,
  });
  const after = await screen(agent);
  return { status: response.status, flash: flashes(after).map((entry) => entry.message) };
}

describe('Admin > Plugins', () => {
  it('lists every installed plugin with what it is, where it came from and its state', async () => {
    const broken = definePlugin({
      name: '@test/plugin-orphan',
      version: '0.0.1',
      label: 'Orphan',
      description: 'Requires something nobody installed.',
      hostApi: HOST_API_VERSION,
      requires: { '@test/plugin-nowhere': '^9.0.0' },
      register() {},
    });
    const { agent } = await site([hello(), base(), broken], [BASE]);
    const html = await screen(agent);

    const helloRow = row(html, HELLO);
    for (const text of [
      'Hello',
      'Says hello on a page of its own.',
      HELLO,
      '1.2.3',
      'site config',
    ]) {
      assert.ok(helloRow.includes(text), `the Hello row says ${text}`);
    }
    assert.match(helloRow, /Disabled/);
    assert.ok(
      helloRow.includes(`${BASE}</code> <code>^0.1.0`),
      'the row names the dependency and its range',
    );

    assert.match(row(html, BASE), /Enabled/);

    const orphan = row(html, '@test/plugin-orphan');
    assert.match(orphan, /Unavailable/);
    assert.ok(orphan.includes('It requires @test/plugin-nowhere ^9.0.0, which is not installed.'));
    assert.doesNotMatch(orphan, /<button[^>]*>\s*Enable/, 'an unavailable plugin offers no Enable');
  });

  it('serves a plugin route only while it is enabled, on the next request, without a restart', async () => {
    const { cms, agent } = await site([hello(), base()], [BASE]);

    const absent = await cms.app.request('/hello-plugin/world');
    assert.equal(absent.status, 404);
    assert.ok(!(await absent.text()).includes('Hello, world'));

    assert.equal((await press(agent, 'enable', HELLO)).status, 303);
    const served = await cms.app.request('/hello-plugin/world');
    assert.equal(served.status, 200);
    assert.equal(await served.text(), 'Hello, world');

    await press(agent, 'disable', HELLO);
    const gone = await cms.app.request('/hello-plugin/world');
    assert.equal(gone.status, 404);
    const control = await cms.app.request('/hello-plugin-never-existed/world');
    assert.equal(
      (await gone.text()).replaceAll('/hello-plugin/world', ''),
      (await control.text()).replaceAll('/hello-plugin-never-existed/world', ''),
      'a disabled route answers what an absent route answers',
    );
  });

  it('follows a hand edit of site.json on the next request', async () => {
    const { cms, contentDir } = await site([hello(), base()]);
    assert.equal((await cms.app.request('/hello-plugin/x')).status, 404);
    await enableByHand(contentDir, [HELLO, BASE]);
    assert.equal((await cms.app.request('/hello-plugin/x')).status, 200);
    await enableByHand(contentDir, [HELLO]);
    assert.equal(
      (await cms.app.request('/hello-plugin/x')).status,
      404,
      'a plugin whose dependency is disabled by hand does not run',
    );
  });

  it('refuses to enable a plugin until what it requires is enabled, naming it and its range', async () => {
    const { agent, contentDir } = await site([hello(), base()]);

    const html = await screen(agent);
    const helloRow = row(html, HELLO);
    assert.ok(
      helloRow.includes(`href="#plugin-test-plugin-base"`),
      'the row links to the plugin to enable',
    );
    assert.match(helloRow, /Needs[^<]*<code>@test\/plugin-base<\/code> <code>\^0\.1\.0<\/code>/);

    const refused = await press(agent, 'enable', HELLO);
    assert.deepEqual(refused.flash, [
      'Hello was not enabled. It requires @test/plugin-base ^0.1.0, which is disabled.',
    ]);
    assert.deepEqual((await siteJson(contentDir))['plugins'], {});

    assert.deepEqual((await press(agent, 'enable', BASE)).flash, ['Base is enabled.']);
    assert.deepEqual((await press(agent, 'enable', HELLO)).flash, ['Hello is enabled.']);
    const file = await siteJson(contentDir);
    assert.equal(file['title'], 'A Site', 'the rest of site.json is kept');
    assert.deepEqual(file['plugins'], { [BASE]: { enabled: true }, [HELLO]: { enabled: true } });
  });

  it('refuses to disable a plugin that enabled plugins require, naming them', async () => {
    const { agent, contentDir } = await site([hello(), base()], [BASE, HELLO]);
    assert.deepEqual((await press(agent, 'disable', BASE)).flash, [
      'Base was not disabled. Hello (@test/plugin-hello) requires it; disable that first.',
    ]);
    assert.deepEqual((await siteJson(contentDir))['plugins'], {
      [BASE]: { enabled: true },
      [HELLO]: { enabled: true },
    });

    await press(agent, 'disable', HELLO);
    assert.deepEqual((await press(agent, 'disable', BASE)).flash, ['Base is disabled.']);
    assert.deepEqual((await siteJson(contentDir))['plugins'], {
      [BASE]: { enabled: false },
      [HELLO]: { enabled: false },
    });
  });

  it('starts on enable, dependencies first, and stops on disable and close, dependents first', async () => {
    const calls: string[] = [];
    const { cms, agent } = await site([hello(calls), base(calls)]);
    await press(agent, 'enable', BASE);
    await press(agent, 'enable', HELLO);
    await press(agent, 'disable', HELLO);
    await press(agent, 'enable', HELLO);
    await cms.close();
    assert.deepEqual(calls, [
      `start ${BASE}`,
      `start ${HELLO}`,
      `stop ${HELLO}`,
      `start ${HELLO}`,
      `stop ${HELLO}`,
      `stop ${BASE}`,
    ]);
  });

  it('starts the enabled plugins when the site serves', async () => {
    const calls: string[] = [];
    const contentDir = await box.dir('geekity-plugins-serve-content-');
    await mkdir(path.join(contentDir, '_data'), { recursive: true });
    await writeFile(
      path.join(contentDir, '_data', 'site.json'),
      JSON.stringify({ plugins: { [BASE]: { enabled: true }, [HELLO]: { enabled: true } } }),
    );
    const cms = createCms({
      contentDir,
      dataDir: await box.dir('geekity-plugins-serve-data-'),
      port: 0,
      watch: false,
      plugins: [hello(calls), base(calls)],
    });
    try {
      await cms.serve();
      assert.deepEqual(calls, [`start ${BASE}`, `start ${HELLO}`]);
    } finally {
      await cms.close();
    }
    assert.deepEqual(calls.slice(2), [`stop ${HELLO}`, `stop ${BASE}`]);
  });

  it('refuses to boot with two plugins of one name, naming both', async () => {
    const dataDir = await box.dir('geekity-plugins-twice-data-');
    const contentDir = await box.dir('geekity-plugins-twice-content-');
    assert.throws(
      () => createCms({ contentDir, dataDir, watch: false, plugins: [base(), hello(), base()] }),
      (error: unknown) =>
        error instanceof DuplicatePluginError &&
        error.message.includes('plugins[0]') &&
        error.message.includes('plugins[2]'),
    );
  });
});
