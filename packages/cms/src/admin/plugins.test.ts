/**
 * Plugins at runtime (decision-33, TASK-281): what Admin > Plugins shows,
 * what Enable and Disable write into `content/_data/site.json`, and what the
 * public site answers on the very next request.
 */
import assert from 'node:assert/strict';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it, mock } from 'node:test';

import type { Cms } from '../index.ts';
import { createCms } from '../index.ts';
import { definePlugin, HOST_API_VERSION } from '../plugin.ts';
import type { Plugin } from '../plugin.ts';
import { DuplicatePluginError } from '../plugins/registry.ts';
import { flashes } from './__testing__/flash.ts';
import { csrfField, sandbox, signedIn } from './__testing__/harness.ts';
import type { Browser } from './__testing__/harness.ts';
import { scanPluginFolders } from '../plugins/folder.ts';
import type { ReloadOutcome, Supervision } from '../supervisor/supervision.ts';
import { PLUGINS_PATH, PLUGINS_RELOAD_PATH } from './plugins.ts';

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
): Promise<{ cms: Cms; agent: Browser; contentDir: string; dataDir: string }> {
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
  return { cms, agent: await signedIn(cms), contentDir, dataDir };
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

describe('a plugin screen (TASK-282)', () => {
  const SCREENED = '@test/plugin-screened';

  function screened(): Plugin {
    return definePlugin({
      name: SCREENED,
      version: '1.0.0',
      label: 'Screened',
      description: 'Has a screen of its own.',
      hostApi: HOST_API_VERSION,
      register(host) {
        host.screen({
          title: 'Old paths',
          render: ({ site }) => [
            {
              title: 'Paths <asked for>',
              blocks: [
                {
                  table: {
                    caption: 'Paths',
                    columns: ['Path', 'Last asked for'],
                    rows: [
                      [{ code: '/old/inbox' }, { time: '2026-09-01T10:00:00.000Z' }],
                      [{ code: '/old/outbox' }, { time: null }],
                    ],
                  },
                },
                {
                  paragraph: [
                    `${String(site.users().length)} users. Run `,
                    { code: 'geekity old import' },
                    ' to add one.',
                  ],
                },
              ],
            },
          ],
        });
      },
    });
  }

  const screenPath = `${PLUGINS_PATH}/${SCREENED}`;

  it('draws the cards a plugin renders, under Plugins, while it is enabled', async () => {
    const { agent } = await site([screened()], [SCREENED]);

    const response = await agent.get(screenPath);
    assert.equal(response.status, 200);
    const html = await response.text();

    assert.match(html, /<h1[^>]*>Old paths<\/h1>/);
    assert.match(html, /Paths &lt;asked for&gt;/, 'plugin text is escaped');
    assert.match(html, /<code>\/old\/inbox<\/code>/);
    assert.match(html, /2026/, 'an instant is drawn as a date');
    assert.match(html, /Never/, 'and a null one as never');
    assert.match(html, /1 users\. Run <code>geekity old import<\/code> to add one\./);
    assert.match(
      html,
      new RegExp(`href="${screenPath}"[^>]*aria-current="page"[^>]*>\\s*Old paths`),
      'the menu lists it under Plugins, current',
    );
  });

  it('is absent, from the menu and at its URL, while the plugin is disabled', async () => {
    const { agent } = await site([screened()]);

    assert.equal((await agent.get(screenPath)).status, 404);
    assert.doesNotMatch(await (await agent.get(PLUGINS_PATH)).text(), /Old paths/);
  });
});

describe('plugin settings on its screen (TASK-283)', () => {
  const CONFIGURED = '@test/plugin-configured';
  const VARIABLE = 'TEST_PLUGIN_CONFIGURED__API_KEY';
  const screenPath = `${PLUGINS_PATH}/${CONFIGURED}`;
  const SECRET = 'sk-very-secret-4242';

  /** A plugin with every kind of field and a Test button that reports what it was handed. */
  function configured(): Plugin {
    return definePlugin({
      name: CONFIGURED,
      version: '1.0.0',
      label: 'Configured',
      description: 'Has settings.',
      hostApi: HOST_API_VERSION,
      register(host) {
        const settings = host.settings([
          { type: 'url', key: 'base_url', label: 'Base URL', default: 'https://llm.example/v1' },
          { type: 'secret', key: 'api_key', label: 'API key' },
          { type: 'text', key: 'model', label: 'Default model', default: 'small' },
          {
            type: 'select',
            key: 'tone',
            label: 'Tone',
            default: 'plain',
            options: [
              { value: 'plain', label: 'Plain' },
              { value: 'warm', label: 'Warm' },
            ],
          },
          { type: 'checkbox', key: 'verbose', label: 'Verbose' },
        ]);
        host.screen({
          title: 'Configured',
          render: () => [],
          actions: [
            {
              id: 'test',
              label: 'Test it',
              run: () => {
                const { api_key: key, model } = settings.current();
                return key === undefined
                  ? { ok: false, message: 'No key <set>.' }
                  : { ok: true, message: `Answered by ${model}.` };
              },
            },
          ],
        });
      },
    });
  }

  async function page(agent: Browser): Promise<string> {
    const response = await agent.get(screenPath);
    assert.equal(response.status, 200);
    return response.text();
  }

  async function save(agent: Browser, fields: Record<string, string>): Promise<Response> {
    const token = csrfField(await page(agent));
    assert.ok(token !== undefined);
    return agent.post(screenPath, { csrf_token: token, action: 'save', ...fields });
  }

  async function act(agent: Browser, id: string): Promise<string[]> {
    const token = csrfField(await page(agent));
    assert.ok(token !== undefined);
    const response = await agent.post(screenPath, { csrf_token: token, action: id });
    assert.equal(response.status, 303);
    return flashes(await page(agent)).map((entry) => entry.message);
  }

  it('draws every field with its value, and each secret as not set with its variable', async () => {
    const { agent } = await site([configured()], [CONFIGURED]);
    const html = await page(agent);
    for (const label of ['Base URL', 'API key', 'Default model', 'Tone', 'Verbose']) {
      assert.ok(html.includes(label), `the form has ${label}`);
    }
    assert.match(html, /value="https:\/\/llm\.example\/v1"/);
    assert.match(html, /value="small"/);
    assert.match(html, /<option value="plain" selected>/);
    assert.match(html, /Not set/);
    assert.ok(html.includes(`<code>${VARIABLE}</code>`), 'the variable name is printed');
    assert.match(html, /type="password"[^>]*value=""/);
  });

  it('saves public values to site.json and the secret to secrets.json, never drawing it', async () => {
    const { agent, contentDir, dataDir } = await site([configured()], [CONFIGURED]);
    const logged: string[] = [];
    for (const method of ['log', 'info', 'warn', 'error'] as const) {
      mock.method(console, method, (...args: unknown[]) => {
        logged.push(args.map(String).join(' '));
      });
    }
    try {
      const response = await save(agent, {
        'setting.base_url': 'http://127.0.0.1:9/v1',
        'setting.api_key': SECRET,
        'setting.model': 'big',
        'setting.tone': 'warm',
        'setting.verbose': '1',
      });
      assert.equal(response.status, 303);

      const html = await page(agent);
      assert.deepEqual(
        flashes(html).map((entry) => entry.message),
        ['Settings saved.'],
      );
      assert.ok(!html.includes(SECRET), 'the secret is not on the page');
      assert.match(
        html,
        /Set in <code>data\/plugins\/@test\/plugin-configured\/secrets\.json<\/code>/,
      );
      assert.deepEqual(await act(agent, 'test'), ['Answered by big.']);

      const file = await siteJson(contentDir);
      assert.ok(!JSON.stringify(file).includes(SECRET), 'nor in site.json');
      assert.deepEqual((file['plugins'] as Record<string, unknown>)[CONFIGURED], {
        enabled: true,
        base_url: 'http://127.0.0.1:9/v1',
        model: 'big',
        tone: 'warm',
        verbose: true,
      });
      const secrets = path.join(dataDir, 'plugins', '@test', 'plugin-configured', 'secrets.json');
      assert.deepEqual(JSON.parse(await readFile(secrets, 'utf8')), { api_key: SECRET });
      assert.equal((await stat(secrets)).mode & 0o777, 0o600);

      assert.equal((await save(agent, { 'setting.api_key': '' })).status, 303);
      assert.deepEqual(JSON.parse(await readFile(secrets, 'utf8')), { api_key: SECRET });
      assert.deepEqual(await act(agent, 'test'), ['Answered by big.'], 'blank keeps the secret');
    } finally {
      mock.restoreAll();
    }
    assert.ok(!logged.some((line) => line.includes(SECRET)), 'nor in a log line');
  });

  it('forgets a stored secret when asked, and reports a failed action as an error', async () => {
    const { agent } = await site([configured()], [CONFIGURED]);
    await save(agent, { 'setting.api_key': SECRET });
    await save(agent, { 'forget.api_key': '1' });
    assert.match(await page(agent), /Not set/);
    assert.deepEqual(await act(agent, 'test'), ['No key &lt;set&gt;.']);
  });

  it('refuses an invalid value, naming the field, and keeps what was typed', async () => {
    const { agent, contentDir } = await site([configured()], [CONFIGURED]);
    const response = await save(agent, {
      'setting.base_url': 'ftp://nope',
      'setting.model': 'typed',
    });
    assert.equal(response.status, 400);
    const html = await response.text();
    assert.match(html, /Base URL must be an http:\/\/ or https:\/\/ URL\./);
    assert.match(html, /value="typed"/);
    const entry = ((await siteJson(contentDir))['plugins'] as Record<string, unknown>)[CONFIGURED];
    assert.deepEqual(entry, { enabled: true });
  });

  it('says when a stored value is invalid and the default is in use', async () => {
    const { agent, contentDir } = await site([configured()], [CONFIGURED]);
    const file = await siteJson(contentDir);
    file['plugins'] = { [CONFIGURED]: { enabled: true, base_url: 'nope', tone: 'shouty' } };
    await writeFile(path.join(contentDir, '_data', 'site.json'), JSON.stringify(file));
    const html = await page(agent);
    assert.equal(
      [...html.matchAll(/The value in site\.json is not [^<]*, so the default is in use\./g)]
        .length,
      2,
    );
    assert.match(html, /value="https:\/\/llm\.example\/v1"/);
  });

  it('shows a secret the environment sets as set there, and the form cannot change it', async () => {
    process.env[VARIABLE] = 'sk-from-env';
    try {
      const { agent, dataDir } = await site([configured()], [CONFIGURED]);
      const html = await page(agent);
      assert.ok(html.includes(`Set by the environment variable <code>${VARIABLE}</code>`));
      assert.doesNotMatch(html, /name="setting\.api_key"/, 'there is no box for it');
      assert.ok(!html.includes('sk-from-env'));

      await save(agent, { 'setting.api_key': 'sk-typed', 'forget.api_key': '1' });
      await assert.rejects(
        stat(path.join(dataDir, 'plugins', '@test', 'plugin-configured', 'secrets.json')),
      );
      assert.deepEqual(await act(agent, 'test'), ['Answered by small.']);
    } finally {
      delete process.env[VARIABLE];
    }
  });

  it('names both packages whose variables would share a prefix, on the Plugins screen', async () => {
    const twin = (name: string) =>
      definePlugin({
        name,
        version: '1.0.0',
        label: name,
        description: 'A twin.',
        hostApi: HOST_API_VERSION,
        register() {},
      });
    const { agent } = await site([twin('@a/b-c'), twin('@a-b/c')]);
    const html = await screen(agent);
    assert.ok(
      html.includes('Its environment variables would start A_B_C__, as those of @a-b/c would'),
    );
    assert.ok(
      html.includes('Its environment variables would start A_B_C__, as those of @a/b-c would'),
    );
  });
});

describe('Reload (TASK-288)', () => {
  /** A bundle as a plugins folder holds it. */
  async function installFolder(pluginsDir: string, name: string, marker = ''): Promise<void> {
    await mkdir(path.join(pluginsDir, name), { recursive: true });
    await writeFile(path.join(pluginsDir, name, 'index.js'), `export default {};${marker}\n`);
  }

  /** A supervisor that answers every reload with `outcome`, counting the asks. */
  function supervisor(
    pluginsDir: string,
    outcome: ReloadOutcome = { ok: true },
  ): Supervision & { asked: number } {
    const fake = {
      asked: 0,
      loaded: scanPluginFolders(pluginsDir),
      lastFailure: undefined as string | undefined,
      reload() {
        fake.asked += 1;
        if (!outcome.ok) fake.lastFailure = outcome.error;
        return Promise.resolve(outcome);
      },
    };
    return fake;
  }

  async function supervised(
    outcome?: ReloadOutcome,
  ): Promise<{ agent: Browser; pluginsDir: string; supervision: Supervision & { asked: number } }> {
    const pluginsDir = await box.dir('geekity-plugins-folder-');
    await installFolder(pluginsDir, '@test/plugin-kept');
    await installFolder(pluginsDir, '@test/plugin-updated');
    await installFolder(pluginsDir, 'plugin-removed');
    const supervision = supervisor(pluginsDir, outcome);
    const cms = await box.open(
      {
        contentDir: await box.dir('geekity-plugins-content-'),
        dataDir: await box.dir('geekity-plugins-data-'),
        pluginsDir,
      },
      { serve: { supervision } },
    );
    return { agent: await signedIn(cms), pluginsDir, supervision };
  }

  async function changeFolder(pluginsDir: string): Promise<void> {
    await installFolder(pluginsDir, '@test/plugin-added');
    await installFolder(pluginsDir, '@test/plugin-updated', '// 2');
    await rm(path.join(pluginsDir, 'plugin-removed'), { recursive: true });
  }

  it('offers no Reload while the plugins folder is what the running server loaded', async () => {
    const { agent } = await supervised();
    assert.ok(!(await screen(agent)).includes(PLUGINS_RELOAD_PATH));
  });

  it('offers no Reload on a server that is not supervised, whatever the folder holds', async () => {
    const pluginsDir = await box.dir('geekity-plugins-folder-');
    const cms = await box.open({
      contentDir: await box.dir('geekity-plugins-content-'),
      dataDir: await box.dir('geekity-plugins-data-'),
      pluginsDir,
    });
    await installFolder(pluginsDir, '@test/plugin-added');
    assert.ok(!(await screen(await signedIn(cms))).includes(PLUGINS_RELOAD_PATH));
  });

  it('offers Reload naming the folders added, removed and updated since this server loaded them', async () => {
    const { agent, pluginsDir } = await supervised();
    await changeFolder(pluginsDir);

    const html = await screen(agent);
    const start = html.indexOf('id="plugins-reload"');
    assert.notEqual(start, -1, 'the screen has a Reload card');
    const card = html.slice(start, html.indexOf('</form>', start));
    assert.match(card, new RegExp(`action="${PLUGINS_RELOAD_PATH}"`));
    assert.match(card, /name="csrf_token"/);
    assert.match(card, /Added:[\s\S]*@test\/plugin-added/);
    assert.match(card, /Removed:[\s\S]*plugin-removed/);
    assert.match(card, /Updated:[\s\S]*@test\/plugin-updated/);
    assert.ok(!card.includes('@test/plugin-kept'), 'an unchanged folder is not named');
    assert.match(card, /reloads by itself once the folder has stood still/);
  });

  it('refuses a Reload posted without the form’s CSRF token', async () => {
    const { agent, pluginsDir, supervision } = await supervised();
    await changeFolder(pluginsDir);

    const response = await agent.post(PLUGINS_RELOAD_PATH, {});
    assert.equal(response.status, 403);
    assert.equal(supervision.asked, 0);
  });

  it('asks the supervisor for a new server and sends the browser to it on a new connection', async () => {
    const { agent, pluginsDir, supervision } = await supervised();
    await changeFolder(pluginsDir);
    const token = csrfField(await screen(agent)) ?? '';

    const response = await agent.post(PLUGINS_RELOAD_PATH, { csrf_token: token });
    assert.equal(response.status, 303);
    assert.equal(response.headers.get('location'), `${PLUGINS_PATH}?reloaded=1`);
    assert.equal(response.headers.get('connection'), 'close');
    assert.equal(supervision.asked, 1);
    assert.match(await (await agent.get(`${PLUGINS_PATH}?reloaded=1`)).text(), /Plugins reloaded/);
  });

  it('shows why a reload failed, on the server that carried on', async () => {
    const { agent, pluginsDir } = await supervised({
      ok: false,
      error: 'Two plugins are named @test/plugin-added.',
    });
    await changeFolder(pluginsDir);
    const token = csrfField(await screen(agent)) ?? '';

    const response = await agent.post(PLUGINS_RELOAD_PATH, { csrf_token: token });
    assert.equal(response.status, 303);
    assert.equal(response.headers.get('location'), PLUGINS_PATH);

    const html = await screen(agent);
    assert.match(html, /The last reload failed, so this server carried on/);
    assert.match(html, /Two plugins are named @test\/plugin-added\./);
  });
});
