/**
 * `geekity serve` as a supervisor (TASK-288): a real server, driven over
 * HTTP, reloading its plugins folder under load, refusing a broken one,
 * respawning a worker that dies, and stopping on a signal.
 */
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { promisify } from 'node:util';

import { cleanupTemporaryDirs, PACKAGE_ROOT, runCli, temporaryDir } from './__testing__/cli.ts';
import { fakeNpmRegistry, pluginFiles } from './__testing__/npm-registry.ts';

after(cleanupTemporaryDirs);

const CLI = path.join(PACKAGE_ROOT, 'src', 'cli.ts');
const TSX = import.meta.resolve('tsx');
const PLUGINS_PATH = '/admin/plugins';
const RELOAD_PATH = '/admin/plugins/reload';

/** A `geekity serve` that is up. */
interface Serving {
  child: ChildProcess;
  port: number;
  url(pathname: string): string;
  output(): string;
  exited: Promise<number | null>;
}

const running: Serving[] = [];
after(() => {
  for (const server of running) server.child.kill('SIGKILL');
});

async function serve(
  site: string,
  pluginsDir: string,
  env: Readonly<Record<string, string>> = {},
): Promise<Serving> {
  const inherited = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !name.startsWith('GEEKITY_') && name !== 'PORT'),
  );
  const child = spawn(process.execPath, ['--import', TSX, CLI, 'serve'], {
    cwd: site,
    env: {
      ...inherited,
      GEEKITY_PORT: '0',
      GEEKITY_WATCH: 'false',
      GEEKITY_ACCESS_LOG: 'false',
      GEEKITY_PLUGINS_DIR: pluginsDir,
      GEEKITY_PLUGIN_WATCH: 'off',
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
  child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()));
  const exited = new Promise<number | null>((resolve) => child.once('close', resolve));

  const port = await new Promise<number>((resolve, reject) => {
    const check = () => {
      const match = /on port (\d+)/.exec(output);
      if (match !== null) resolve(Number(match[1]));
    };
    child.stdout.on('data', check);
    child.once('exit', (code) => reject(new Error(`serve exited with ${String(code)}: ${output}`)));
  });

  const server = {
    child,
    port,
    url: (pathname: string) => `http://127.0.0.1:${String(port)}${pathname}`,
    output: () => output,
    exited,
  };
  running.push(server);
  return server;
}

/** A bundle in a plugins folder, as `geekity plugin add` leaves one. */
async function installPlugin(pluginsDir: string, folder: string, name = folder): Promise<void> {
  await fs.mkdir(path.join(pluginsDir, folder), { recursive: true });
  await fs.writeFile(
    path.join(pluginsDir, folder, 'index.js'),
    `export default {
  name: ${JSON.stringify(name)},
  version: '1.0.0',
  label: ${JSON.stringify(`Label of ${folder}`)},
  description: 'From the plugins folder.',
  hostApi: 1,
  requires: {},
  register() {},
};
`,
  );
}

/** A browser over real HTTP: a cookie jar, and no redirect followed. */
function browser(server: Serving) {
  const cookies = new Map<string, string>();
  async function request(pathname: string, init: RequestInit = {}): Promise<Response> {
    const response = await fetch(server.url(pathname), {
      ...init,
      redirect: 'manual',
      headers: {
        ...(init.headers as Record<string, string> | undefined),
        cookie: [...cookies].map(([name, value]) => `${name}=${value}`).join('; '),
      },
    });
    for (const line of response.headers.getSetCookie()) {
      const [pair = ''] = line.split(';');
      const at = pair.indexOf('=');
      cookies.set(pair.slice(0, at), pair.slice(at + 1));
    }
    return response;
  }
  return {
    get: (pathname: string) => request(pathname),
    post: (pathname: string, fields: Record<string, string>) =>
      request(pathname, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(fields).toString(),
      }),
  };
}

type Browser = ReturnType<typeof browser>;

function csrf(html: string): string {
  const token = /name="csrf_token" value="([^"]+)"/.exec(html)?.[1];
  assert.ok(token !== undefined, 'the page carried a CSRF token');
  return token;
}

/** Set up the first admin through the setup form, which signs them in. */
async function signedIn(server: Serving): Promise<Browser> {
  const agent = browser(server);
  const form = await (await agent.get('/admin/setup')).text();
  const response = await agent.post('/admin/setup', {
    csrf_token: csrf(form),
    username: 'ada',
    password: 'correct horse battery',
    password_confirmation: 'correct horse battery',
  });
  assert.equal(response.status, 303, await response.text());
  return agent;
}

async function screen(agent: Browser, pathname = PLUGINS_PATH): Promise<string> {
  let response = await agent.get(pathname);
  for (let hops = 0; response.status === 307 && hops < 5; hops += 1) {
    response = await agent.get(response.headers.get('location') ?? pathname);
  }
  assert.equal(response.status, 200);
  return response.text();
}

async function reload(agent: Browser): Promise<Response> {
  return agent.post(RELOAD_PATH, { csrf_token: csrf(await screen(agent)) });
}

/**
 * Requests in a loop from several clients on keep-alive connections, until
 * stopped: every answer and every failure counted.
 */
function load(server: Serving, clients = 8) {
  const statuses = new Map<number, number>();
  const failures: string[] = [];
  let stopping = false;
  const loops = Array.from({ length: clients }, async (_, index) => {
    while (!stopping) {
      const pathname = index % 2 === 0 ? '/' : '/_geekity/health';
      try {
        const response = await fetch(server.url(pathname), { signal: AbortSignal.timeout(20_000) });
        await response.arrayBuffer();
        statuses.set(response.status, (statuses.get(response.status) ?? 0) + 1);
      } catch (error) {
        failures.push(String((error as { cause?: unknown }).cause ?? error));
      }
    }
  });
  return {
    async stop() {
      stopping = true;
      await Promise.all(loops);
      return { statuses: Object.fromEntries(statuses), failures };
    },
  };
}

/** A keep-alive connection that answers one request and then sits idle. */
async function idleConnection(server: Serving) {
  const socket = net.connect(server.port, '127.0.0.1');
  const events: string[] = [];
  socket.on('end', () => events.push('end'));
  socket.on('error', (error: NodeJS.ErrnoException) => events.push(`error ${error.code ?? ''}`));
  const closed = new Promise<void>((resolve) => socket.once('close', () => resolve()));
  await new Promise<void>((resolve) => socket.once('connect', () => resolve()));
  socket.write(
    'GET /_geekity/health HTTP/1.1\r\nHost: localhost\r\nConnection: keep-alive\r\n\r\n',
  );
  let received = '';
  await new Promise<void>((resolve) => {
    socket.on('data', (chunk: Buffer) => {
      received += chunk.toString();
      if (received.includes('"ok"')) resolve();
    });
  });
  assert.match(received, /^HTTP\/1\.1 200/);
  return { events, closed };
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(check: () => boolean, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) assert.fail('timed out waiting');
    await pause(100);
  }
}

async function site(): Promise<{ site: string; pluginsDir: string }> {
  const directory = await temporaryDir('geekity-reload-');
  const pluginsDir = path.join(directory, 'plugins');
  await fs.mkdir(path.join(directory, 'content', '_data'), { recursive: true });
  await fs.writeFile(
    path.join(directory, 'content', '_data', 'site.json'),
    JSON.stringify({ title: 'Reloading' }),
  );
  await installPlugin(pluginsDir, '@test/plugin-first');
  return { site: directory, pluginsDir };
}

describe('geekity serve, supervised', () => {
  it('reloads a changed plugins folder under load, refusing no request (AC #1, #2, #7)', async (t) => {
    const { site: directory, pluginsDir } = await site();
    const server = await serve(directory, pluginsDir);
    const agent = await signedIn(server);

    const before = await screen(agent);
    assert.match(before, /@test\/plugin-first/);
    assert.ok(!before.includes(RELOAD_PATH), 'nothing to reload yet');

    await installPlugin(pluginsDir, 'plugin-second');
    await fs.rm(path.join(pluginsDir, '@test'), { recursive: true });
    const offered = await screen(agent);
    assert.match(offered, /Added:[\s\S]*plugin-second/);
    assert.match(offered, /Removed:[\s\S]*@test\/plugin-first/);

    const traffic = load(server);
    await pause(500);
    const idle = await idleConnection(server);
    const started = Date.now();
    const response = await reload(agent);
    const took = Date.now() - started;
    assert.equal(response.status, 303);
    assert.equal(response.headers.get('location'), `${PLUGINS_PATH}?reloaded=1`);
    await pause(1500);
    const { statuses, failures } = await traffic.stop();
    t.diagnostic(`reload took ${String(took)} ms; answers ${JSON.stringify(statuses)}`);
    t.diagnostic(`failures ${String(failures.length)}`);

    assert.deepEqual(failures, [], 'no request failed');
    assert.deepEqual(Object.keys(statuses), ['200'], 'every request was answered 200');
    assert.ok((statuses[200] ?? 0) > 100, 'the load ran through the reload');

    await idle.closed;
    assert.deepEqual(idle.events, ['end'], 'the idle connection was closed, not reset');

    const after = await screen(agent, `${PLUGINS_PATH}?reloaded=1`);
    assert.match(after, /Plugins reloaded/);
    assert.match(after, /plugin-second/);
    assert.ok(!after.includes('@test/plugin-first'), 'the removed plugin is gone');
    assert.ok(!after.includes(RELOAD_PATH), 'the folder is what the new server loaded');
    assert.match(server.output(), /Reloaded/);

    server.child.kill('SIGTERM');
    assert.equal(await server.exited, 0, server.output());
  });

  it('keeps the running server when the new one fails to boot, and shows why (AC #6)', async () => {
    const { site: directory, pluginsDir } = await site();
    const server = await serve(directory, pluginsDir);
    const agent = await signedIn(server);

    await installPlugin(pluginsDir, 'plugin-twin', '@test/plugin-first');
    const response = await reload(agent);
    assert.equal(response.status, 303);
    assert.equal(response.headers.get('location'), PLUGINS_PATH);

    const html = await screen(agent);
    assert.match(html, /The last reload failed, so this server carried on/);
    assert.match(html, /@test\/plugin-first/);

    const write = await agent.post('/admin/plugins/enable', {
      csrf_token: csrf(html),
      plugin: '@test/plugin-first',
    });
    assert.equal(write.status, 303, 'the running server takes writes again');

    server.child.kill('SIGTERM');
    assert.equal(await server.exited, 0, server.output());
  });

  it('boots past plugin folders that cannot load or whose ranges are unmet, showing why (TASK-287 AC #4, #8)', async () => {
    const { site: directory, pluginsDir } = await site();
    await fs.mkdir(path.join(pluginsDir, '@test', 'plugin-throws'), { recursive: true });
    await fs.writeFile(
      path.join(pluginsDir, '@test', 'plugin-throws', 'index.js'),
      "throw new Error('broken at import');\n",
    );
    await installPlugin(pluginsDir, '@test/plugin-later');
    await fs.writeFile(
      path.join(pluginsDir, '@test', 'plugin-later', 'plugin.json'),
      JSON.stringify({
        name: '@test/plugin-later',
        version: '1.0.0',
        hostApi: 1,
        peerDependencies: { '@geekity/cms': '>=99.0.0', '@test/plugin-first': '^2.0.0' },
      }),
    );
    const server = await serve(directory, pluginsDir);
    const html = await screen(await signedIn(server));

    assert.match(html, /@test\/plugin-throws/);
    assert.match(html, /Its index\.js failed to load: broken at import/);
    assert.match(html, /It needs @geekity\/cms &gt;=99\.0\.0, and this core is /);
    assert.match(html, /Label of @test\/plugin-first/);

    server.child.kill('SIGTERM');
    assert.equal(await server.exited, 0, server.output());
  });

  it('reloads as soon as geekity plugin add has installed a plugin, with no restart (TASK-287 AC #1, TASK-309 AC #3)', async () => {
    const name = '@test/plugin-added';
    const registry = await fakeNpmRegistry([
      { name, version: '1.0.0', files: pluginFiles({ name, version: '1.0.0' }) },
    ]);
    const { site: directory, pluginsDir } = await site();
    const server = await serve(directory, pluginsDir);
    const agent = await signedIn(server);

    const added = await runCli(['plugin', 'add', name], directory, undefined, {
      GEEKITY_PLUGINS_DIR: pluginsDir,
      npm_config_registry: registry.url,
    });
    await registry.close();
    assert.equal(added.code, 0, added.stderr);
    assert.match(added.stdout, /The running site reloaded with the change\./);
    assert.match(server.output(), /Reloaded/, 'the watch is off: the command asked for it');

    const html = await screen(agent);
    assert.match(html, /Label of @test\/plugin-added/);
    assert.ok(!html.includes(RELOAD_PATH), 'the folder is what the new server loaded');

    const removed = await runCli(['plugin', 'remove', name], directory, undefined, {
      GEEKITY_PLUGINS_DIR: pluginsDir,
    });
    assert.equal(removed.code, 0, removed.stderr);
    assert.match(removed.stdout, /The running site reloaded with the change\./);

    server.child.kill('SIGTERM');
    assert.equal(await server.exited, 0, server.output());
  });

  it('reloads as soon as Add on the Plugins screen has installed a plugin (TASK-309 AC #2)', async () => {
    const name = '@test/plugin-from-admin';
    const registry = await fakeNpmRegistry([
      { name, version: '1.0.0', files: pluginFiles({ name, version: '1.0.0' }) },
    ]);
    const { site: directory, pluginsDir } = await site();
    const server = await serve(directory, pluginsDir, { npm_config_registry: registry.url });
    const agent = await signedIn(server);

    const response = await agent.post('/admin/plugins/add', {
      csrf_token: csrf(await screen(agent)),
      package: name,
      version: '',
      password: 'correct horse battery',
    });
    await registry.close();
    assert.equal(response.status, 303);
    assert.equal(response.headers.get('location'), `${PLUGINS_PATH}?reloaded=1`);

    const html = await screen(agent, `${PLUGINS_PATH}?reloaded=1`);
    assert.match(html, /Plugins reloaded/);
    assert.match(html, new RegExp(`Added ${name.replace('/', '\\/')} 1\\.0\\.0`));
    assert.match(html, /Label of @test\/plugin-from-admin/);
    assert.ok(!html.includes(RELOAD_PATH), 'the folder is what the new server loaded');

    server.child.kill('SIGTERM');
    assert.equal(await server.exited, 0, server.output());
  });

  it('loads a hand-copied plugin by itself once the folder settles, refusing no request (TASK-309 AC #1)', async (t) => {
    const { site: directory, pluginsDir } = await site();
    const server = await serve(directory, pluginsDir, { GEEKITY_PLUGIN_WATCH: 'on' });
    const agent = await signedIn(server);
    const traffic = load(server);

    const copying = path.join(pluginsDir, 'plugin-copied');
    await fs.mkdir(copying, { recursive: true });
    await fs.writeFile(path.join(copying, 'README.md'), 'Copied by hand, slowly.\n');
    await pause(3000);
    await installPlugin(pluginsDir, 'plugin-copied');
    const copied = Date.now();
    await until(() => /Reloaded/.test(server.output()), 20_000);
    const took = Date.now() - copied;
    await pause(1500);
    const { statuses, failures } = await traffic.stop();
    t.diagnostic(`reloaded ${String(took)} ms after the copy; answers ${JSON.stringify(statuses)}`);

    assert.ok(took >= 4000, 'not before the folder had stood still');
    assert.equal([...server.output().matchAll(/Reloading:/g)].length, 1, 'one reload for the copy');
    assert.deepEqual(failures, [], 'no request failed');
    assert.deepEqual(Object.keys(statuses), ['200'], 'every request was answered 200');

    const html = await screen(agent);
    assert.match(html, /Label of plugin-copied/);
    assert.ok(!html.includes(RELOAD_PATH), 'the folder is what the new server loaded');

    server.child.kill('SIGTERM');
    assert.equal(await server.exited, 0, server.output());
  });

  it('tries a folder that will not boot once, and waits for the next change (TASK-309 AC #4)', async () => {
    const { site: directory, pluginsDir } = await site();
    const server = await serve(directory, pluginsDir, { GEEKITY_PLUGIN_WATCH: 'on' });
    const agent = await signedIn(server);

    await installPlugin(pluginsDir, 'plugin-twin', '@test/plugin-first');
    await until(() => /Reload failed/.test(server.output()), 20_000);
    await pause(8000);
    assert.equal([...server.output().matchAll(/Reloading:/g)].length, 1, 'not tried again');
    const html = await screen(agent);
    assert.match(html, /The last reload failed, so this server carried on/);

    await fs.rm(path.join(pluginsDir, 'plugin-twin'), { recursive: true });
    await installPlugin(pluginsDir, 'plugin-fixed');
    await until(() => /Reloaded/.test(server.output()), 20_000);
    await pause(1500);
    assert.match(await screen(agent), /Label of plugin-fixed/);

    server.child.kill('SIGTERM');
    assert.equal(await server.exited, 0, server.output());
  });

  it('leaves a changed folder for Reload when GEEKITY_PLUGIN_WATCH is off (TASK-309 AC #5)', async () => {
    const { site: directory, pluginsDir } = await site();
    const server = await serve(directory, pluginsDir, { GEEKITY_PLUGIN_WATCH: 'off' });
    const agent = await signedIn(server);

    await installPlugin(pluginsDir, 'plugin-second');
    await pause(8000);
    assert.doesNotMatch(server.output(), /Reloading:/);
    assert.ok((await screen(agent)).includes(RELOAD_PATH), 'Reload is still offered');

    server.child.kill('SIGTERM');
    assert.equal(await server.exited, 0, server.output());
  });

  it('respawns a worker that dies, without the supervisor restarting', async () => {
    const { site: directory, pluginsDir } = await site();
    const server = await serve(directory, pluginsDir);
    const { stdout } = await promisify(execFile)('pgrep', [
      '-P',
      String(server.child.pid),
      '-f',
      'cli.ts',
    ]);
    const [worker] = stdout.trim().split('\n').map(Number);
    assert.ok(worker !== undefined && worker > 0, 'the supervisor runs a worker');

    process.kill(worker, 'SIGKILL');
    await until(() => /starting another/.test(server.output()));
    await until(() => [...server.output().matchAll(/on port (\d+)/g)].length === 2);
    const port = [...server.output().matchAll(/on port (\d+)/g)][1]?.[1] ?? '';
    assert.equal((await fetch(`http://127.0.0.1:${port}/_geekity/health`)).status, 200);
    assert.equal(server.child.exitCode, null, 'the supervisor kept running');

    server.child.kill('SIGINT');
    assert.equal(await server.exited, 0, server.output());
  });

  it('stops on SIGTERM, leaving nothing listening (AC #8)', async () => {
    const { site: directory, pluginsDir } = await site();
    const server = await serve(directory, pluginsDir);
    server.child.kill('SIGTERM');
    assert.equal(await server.exited, 0, server.output());
    await assert.rejects(fetch(server.url('/_geekity/health')));
  });
});
