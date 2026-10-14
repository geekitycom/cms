import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import net from 'node:net';
import { hostname } from 'node:os';
import path from 'node:path';

import { createFileRecords } from '../jobs/file-records.ts';
import type { JobStatus } from '../jobs/types.ts';
import { controlSocketPath } from '../supervisor/control.ts';

export async function recordJob(
  dataDir: string,
  name: string,
  state: 'queued' | 'running',
): Promise<JobStatus> {
  await mkdir(dataDir, { recursive: true });
  const records = createFileRecords(path.join(dataDir, 'jobs.json'));
  const queued = {
    id: randomUUID(),
    name,
    payload: null,
    queuedAt: '2026-10-14T00:00:00.000Z',
    state: 'queued' as const,
    attempt: 1,
  };
  await records.create(queued);
  if (state === 'queued') return queued;
  const running = {
    state: 'running' as const,
    attempt: 1,
    owner: 'the server',
    claimer: { host: hostname(), pid: process.pid },
    startedAt: '2026-10-14T00:00:00.000Z',
  };
  await records.transition(queued.id, { state: 'queued', attempt: 1 }, running);
  return { ...queued, ...running };
}

export async function serverAnswering(dataDir: string): Promise<{ close(): Promise<void> }> {
  const server = net.createServer((socket) => socket.end());
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(controlSocketPath(dataDir), resolve);
  });
  return {
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
