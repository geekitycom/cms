import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const packageDir = join(here, '..', '..');
const work = await mkdtemp(join(tmpdir(), 'offline-'));
after(() => rm(work, { recursive: true, force: true }));

/** Run a test file the way `pnpm test` does, and report how it ended. */
async function runTest(name: string, source: string): Promise<{ code: number; output: string }> {
  const file = join(work, name);
  await writeFile(file, source);
  return await new Promise((resolve) => {
    execFile(
      process.execPath,
      ['--import', 'tsx', '--import', join(here, 'offline.ts'), file],
      { cwd: packageDir },
      (error, stdout, stderr) => {
        resolve({ code: error === null ? 0 : Number(error.code), output: stdout + stderr });
      },
    );
  });
}

describe('the test network guard (TASK-279)', () => {
  test('fails a test that fetches a remote host without stubbing fetch, naming the host', async () => {
    const run = await runTest(
      'fetches.test.mjs',
      `import { test } from 'node:test';
       test('fetches', async () => { await fetch('https://rpc.rsscloud.io/ping'); });`,
    );

    assert.notEqual(run.code, 0);
    assert.match(run.output, /reached rpc\.rsscloud\.io without stubbing it/);
  });

  test('fails the test even when the code under test swallows the failed fetch', async () => {
    const run = await runTest(
      'swallows.test.mjs',
      `import { test } from 'node:test';
       test('swallows', async () => {
         await fetch('https://news.indieweb.org/en/webmention').catch(() => undefined);
         await new Promise((resolve) => setTimeout(resolve, 10));
       });`,
    );

    assert.notEqual(run.code, 0);
    assert.match(run.output, /reached news\.indieweb\.org without stubbing it/);
  });

  test('fails a test that resolves a remote name', async () => {
    const run = await runTest(
      'resolves.test.mjs',
      `import { test } from 'node:test';
       import { lookup } from 'node:dns/promises';
       test('resolves', async () => { await lookup('brid.gy'); });`,
    );

    assert.notEqual(run.code, 0);
    assert.match(run.output, /reached brid\.gy without stubbing it/);
  });

  test('answers every remote host as missing once a file says they do not exist', async () => {
    const run = await runTest(
      'missing.test.mjs',
      `import assert from 'node:assert/strict';
       import { lookup } from 'node:dns/promises';
       import { test } from 'node:test';
       import { remoteHostsDoNotExist } from ${JSON.stringify(join(here, 'offline.ts'))};
       remoteHostsDoNotExist();
       test('missing', async () => {
         await assert.rejects(fetch('https://peer.example/'), { name: 'TypeError', message: 'fetch failed' });
         await assert.rejects(lookup('peer.example'), { code: 'ENOTFOUND' });
       });`,
    );

    assert.equal(run.code, 0, run.output);
  });

  test('passes a test that stubs fetch or talks to a server on this machine', async () => {
    const run = await runTest(
      'local.test.mjs',
      `import assert from 'node:assert/strict';
       import { createServer } from 'node:http';
       import { test } from 'node:test';
       test('stubbed', async () => {
         const guarded = globalThis.fetch;
         globalThis.fetch = async () => new Response('stubbed');
         try {
           assert.equal(await (await fetch('https://brid.gy/publish/webmention')).text(), 'stubbed');
         } finally {
           globalThis.fetch = guarded;
         }
       });
       test('loopback', async () => {
         const server = createServer((_request, response) => response.end('local'));
         await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
         const { port } = server.address();
         try {
           assert.equal(await (await fetch('http://127.0.0.1:' + port + '/')).text(), 'local');
           assert.equal(await (await fetch('http://localhost:' + port + '/')).text(), 'local');
         } finally {
           server.close();
         }
       });`,
    );

    assert.equal(run.code, 0, run.output);
  });
});
