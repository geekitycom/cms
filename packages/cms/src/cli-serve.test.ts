import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import {
  cleanupTemporaryDirs,
  exists,
  PACKAGE_ROOT,
  readJson,
  temporaryDir,
} from './__testing__/cli.ts';

after(cleanupTemporaryDirs);

const CLI = path.join(PACKAGE_ROOT, 'src', 'cli.ts');
const TSX = import.meta.resolve('tsx');

/** A `geekity serve` that is up, and how to stop it. */
interface Serving {
  port: number;
  stdout: string;
  stop(): Promise<void>;
}

/**
 * Start `geekity serve` in a site directory with no config file, on a port the
 * system picks, and wait until it says it is serving.
 */
async function serve(cwd: string, env: Record<string, string>): Promise<Serving> {
  const inherited = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !name.startsWith('GEEKITY_') && name !== 'PORT'),
  );
  const child = spawn(process.execPath, ['--import', TSX, CLI, 'serve'], {
    cwd,
    env: { ...inherited, GEEKITY_PORT: '0', GEEKITY_WATCH: 'false', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));

  let stdout = '';
  let stderr = '';
  child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));

  const port = await new Promise<number>((resolve, reject) => {
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
      const match = /on port (\d+)/.exec(stdout);
      if (match !== null) resolve(Number(match[1]));
    });
    child.once('exit', (code) => reject(new Error(`serve exited with ${String(code)}: ${stderr}`)));
  });

  return {
    port,
    stdout,
    async stop() {
      child.kill('SIGTERM');
      await exited;
    },
  };
}

describe('geekity serve', () => {
  it('seeds a missing content directory with the starter site and then serves it', async () => {
    const site = await temporaryDir('geekity-serve-seed-');

    const running = await serve(site, {
      GEEKITY_SEED_CONTENT: 'true',
      GEEKITY_BASE_URL: 'https://blog.example',
    });
    try {
      const health = await fetch(`http://127.0.0.1:${String(running.port)}/healthz`);
      assert.equal(health.status, 200);
      const post = await fetch(`http://127.0.0.1:${String(running.port)}/about/`);
      assert.equal(post.status, 200);
    } finally {
      await running.stop();
    }

    const content = path.join(site, 'content');
    assert.ok(await exists(path.join(content, 'posts', '2026-01-01-hello-world.md')));
    const settings = await readJson(path.join(content, '_data', 'site.json'));
    assert.equal(settings['url'], 'https://blog.example');
    assert.equal(running.stdout.match(/seeded/gi)?.length, 1, running.stdout);
  });

  it('seeds a content directory that exists with nothing in it', async () => {
    const site = await temporaryDir('geekity-serve-seed-empty-');
    await fs.mkdir(path.join(site, 'content'));

    const running = await serve(site, { GEEKITY_SEED_CONTENT: 'true' });
    await running.stop();

    assert.ok(await exists(path.join(site, 'content', 'pages', 'about.md')));
  });

  it('writes nothing into a content directory that has anything in it', async () => {
    const site = await temporaryDir('geekity-serve-seed-busy-');
    const content = path.join(site, 'content');
    await fs.mkdir(content);
    await fs.writeFile(path.join(content, '.keep'), '', 'utf8');

    const running = await serve(site, { GEEKITY_SEED_CONTENT: 'true' });
    await running.stop();

    assert.deepEqual(await fs.readdir(content), ['.keep']);
    assert.doesNotMatch(running.stdout, /seeded/i);
  });

  it('writes nothing into an empty content directory when seeding is off, as it is by default', async () => {
    const site = await temporaryDir('geekity-serve-noseed-');
    const content = path.join(site, 'content');
    await fs.mkdir(content);

    const running = await serve(site, {});
    await running.stop();

    assert.deepEqual(await fs.readdir(content), []);
    assert.doesNotMatch(running.stdout, /seeded/i);
  });
});
