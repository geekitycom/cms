import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import fs from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, describe, it } from 'node:test';

import { createFederation, generateCryptoKeyPair, MemoryKvStore } from '@fedify/fedify';
import { SqliteMessageQueue } from '@fedify/sqlite';
import { Create, Note } from '@fedify/vocab';

import { cleanupTemporaryDirs, PACKAGE_ROOT, temporaryDir } from './__testing__/cli.ts';
import { nextEvent } from './__testing__/wait.ts';
import { FEDERATION_QUEUE_TABLE } from './federation/queue.ts';
import { askToReload, isServing } from './supervisor/control.ts';

after(cleanupTemporaryDirs);

const CLI = path.join(PACKAGE_ROOT, 'src', 'cli.ts');
const TSX = import.meta.resolve('tsx');
const PROCESS_EVENT_TIMEOUT_MS = 90_000;
const MESSAGES = 20;
const ORIGIN = 'https://blog.example';

const running: ChildProcess[] = [];
after(() => {
  for (const child of running) child.kill('SIGKILL');
});

interface Peer {
  readonly inbox: string;
  readonly received: string[];
  arrived(count: number): Promise<void>;
  release(): void;
  close(): Promise<void>;
}

async function heldPeer(): Promise<Peer> {
  const received: string[] = [];
  const listeners = new Set<() => void>();
  let release = (): void => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const server = createServer((request, response) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk: string) => (body += chunk));
    request.on('end', () => {
      received.push(String((JSON.parse(body) as { id?: unknown }).id));
      for (const listener of listeners) listener();
      void held.then(() => {
        response.writeHead(202).end();
      });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    inbox: `http://127.0.0.1:${String(port)}/inbox`,
    received,
    arrived: (count) =>
      nextEvent(
        `${String(count)} deliveries at the peer`,
        (done) => {
          const check = () => {
            if (received.length >= count) done();
          };
          listeners.add(check);
          check();
          return () => listeners.delete(check);
        },
        PROCESS_EVENT_TIMEOUT_MS,
      ),
    release,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

async function queueDeliveries(dataDir: string, inbox: string): Promise<string[]> {
  const db = new DatabaseSync(path.join(dataDir, 'queue.sqlite'));
  const queue = new SqliteMessageQueue(db, { tableName: FEDERATION_QUEUE_TABLE });
  const federation = createFederation<void>({
    kv: new MemoryKvStore(),
    queue,
    manuallyStartQueue: true,
    allowPrivateAddress: true,
  });
  const context = federation.createContext(new URL(ORIGIN), undefined);
  const { privateKey } = await generateCryptoKeyPair('RSASSA-PKCS1-v1_5');
  const actor = new URL(`${ORIGIN}/author/ada/`);
  const ids: string[] = [];
  for (let n = 1; n <= MESSAGES; n += 1) {
    const id = `${ORIGIN}/posts/${String(n)}#create`;
    ids.push(id);
    await context.sendActivity(
      { keyId: new URL(`${actor.href}#main-key`), privateKey },
      { id: new URL('https://peer.example/users/bob'), inboxId: new URL(inbox) },
      new Create({
        id: new URL(id),
        actor,
        object: new Note({ id: new URL(`${ORIGIN}/posts/${String(n)}`), content: 'Hello.' }),
      }),
    );
  }
  queue[Symbol.dispose]();
  return ids;
}

function serve(directory: string): {
  child: ChildProcess;
  printed(line: string): Promise<void>;
  exited: Promise<number | null>;
} {
  const inherited = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !name.startsWith('GEEKITY_') && name !== 'PORT'),
  );
  const child = spawn(process.execPath, ['--import', TSX, CLI, 'serve'], {
    cwd: directory,
    env: { ...inherited, GEEKITY_PORT: '0', GEEKITY_WATCH: 'false', GEEKITY_ACCESS_LOG: 'false' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  running.push(child);
  let output = '';
  const listeners = new Set<() => void>();
  const heard = (chunk: string) => {
    output += chunk;
    for (const listener of listeners) listener();
  };
  child.stdout?.setEncoding('utf8').on('data', heard);
  child.stderr?.setEncoding('utf8').on('data', heard);
  return {
    child,
    printed: (line) =>
      nextEvent(
        `the server printing ${line}`,
        (done) => {
          const check = () => {
            if (output.includes(line)) done();
          };
          listeners.add(check);
          check();
          return () => listeners.delete(check);
        },
        PROCESS_EVENT_TIMEOUT_MS,
      ),
    exited: new Promise((resolve) => child.once('close', resolve)),
  };
}

describe('the federation queue under geekity serve (TASK-379)', () => {
  it('delivers each queued message once across a reload, though both workers read one file (AC #3)', async () => {
    const directory = await fs.realpath(await temporaryDir('geekity-federation-queue-'));
    const dataDir = path.join(directory, 'data');
    await fs.mkdir(path.join(directory, 'content', '_data'), { recursive: true });
    await fs.mkdir(dataDir, { recursive: true });
    await fs.writeFile(
      path.join(directory, 'content', '_data', 'site.json'),
      JSON.stringify({ title: 'Queue' }),
    );
    await fs.writeFile(
      path.join(directory, 'geekity.config.ts'),
      'export default { federation: { allowPrivateAddress: true } };\n',
    );
    const peer = await heldPeer();
    after(() => peer.close());
    const ids = await queueDeliveries(dataDir, peer.inbox);

    const server = serve(directory);
    await peer.arrived(1);
    while (!(await isServing(dataDir)));
    const reloaded = askToReload(dataDir);
    await server.printed('Reloading: the running server is draining.');
    peer.release();
    assert.deepEqual(await reloaded, { ok: true });
    await peer.arrived(MESSAGES);

    server.child.kill('SIGTERM');
    assert.equal(await server.exited, 0);

    assert.deepEqual(
      [...peer.received].sort(),
      [...ids].sort(),
      'every message was delivered, and none twice',
    );
    const db = new DatabaseSync(path.join(dataDir, 'queue.sqlite'));
    const left = db.prepare(`SELECT COUNT(*) AS count FROM ${FEDERATION_QUEUE_TABLE}`).get();
    db.close();
    assert.equal(Number(left?.['count']), 0);
  });
});
