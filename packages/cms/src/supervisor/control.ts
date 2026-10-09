import { createHash } from 'node:crypto';
import { chmodSync, rmSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { ReloadOutcome } from './supervision.ts';

const RELOAD = 'reload';

// The data folder can sit on a bind mount that cannot hold a socket, or at a
// path longer than the Unix socket path limit, so the socket lives in tmpdir().
export function controlSocketPath(dataDir: string): string {
  const id = createHash('sha256').update(path.resolve(dataDir)).digest('hex').slice(0, 16);
  return path.join(tmpdir(), `geekity-${id}.sock`);
}

export function listenForControl(options: {
  dataDir: string;
  reload: () => Promise<ReloadOutcome>;
  log: (line: string) => void;
}): { close(): void } {
  const socketPath = controlSocketPath(options.dataDir);
  let owned = false;
  const server = net.createServer((socket) => {
    let received = '';
    socket.setEncoding('utf8');
    socket.on('error', () => undefined);
    socket.on('data', (chunk: string) => {
      received += chunk;
      if (!received.includes('\n')) return;
      socket.pause();
      const outcome: Promise<ReloadOutcome> =
        received.trim() === RELOAD
          ? options.reload()
          : Promise.resolve({ ok: false, error: 'Unknown request.' });
      void outcome.then((answer) => socket.end(`${JSON.stringify(answer)}\n`));
    });
  });

  function listen(retry: boolean): void {
    server.once('error', (error: NodeJS.ErrnoException) => {
      if (error.code !== 'EADDRINUSE' || !retry) {
        options.log(`geekity plugin cannot reach this server (${error.message}).`);
        return;
      }
      const probe = net.connect(socketPath);
      probe.once('connect', () => {
        probe.destroy();
        options.log(
          `Another geekity serve for this data folder answers on ${socketPath}, so geekity plugin reaches that one.`,
        );
      });
      probe.once('error', () => {
        rmSync(socketPath, { force: true });
        listen(false);
      });
    });
    server.listen(socketPath, () => {
      owned = true;
      chmodSync(socketPath, 0o600);
    });
  }
  listen(true);

  return {
    close() {
      server.close();
      if (owned) rmSync(socketPath, { force: true });
    },
  };
}

export function askToReload(dataDir: string): Promise<ReloadOutcome | undefined> {
  return new Promise((resolve) => {
    const socket = net.connect(controlSocketPath(dataDir));
    let received = '';
    socket.setEncoding('utf8');
    socket.on('connect', () => socket.write(`${RELOAD}\n`));
    socket.on('data', (chunk: string) => (received += chunk));
    socket.on('error', () => resolve(undefined));
    socket.on('close', () => resolve(parseOutcome(received)));
  });
}

function parseOutcome(text: string): ReloadOutcome | undefined {
  try {
    const value = JSON.parse(text) as { ok?: unknown; error?: unknown } | null;
    if (value?.ok === true) return { ok: true };
    if (value?.ok === false && typeof value.error === 'string') {
      return { ok: false, error: value.error };
    }
  } catch {
    return undefined;
  }
  return undefined;
}
