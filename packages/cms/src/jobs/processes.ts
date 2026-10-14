import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { hostname } from 'node:os';

import type { Claimer } from './types.ts';

let self: Claimer | undefined;

/** This process, as a running job record names it. */
export function thisProcess(): Claimer {
  if (self === undefined) {
    const since = startOf(process.pid);
    self = { host: hostname(), pid: process.pid, ...(since === undefined ? {} : { since }) };
  }
  return self;
}

/**
 * Whether the process that claimed a job is still running it. Only another
 * process on this host can be seen: one on another host, or with this
 * process's own id, is gone. A process id that is alive but started at
 * another time was given to a new process after the claimer died.
 */
export function isClaimerAlive(claimer: Claimer): boolean {
  if (claimer.host !== hostname() || claimer.pid === process.pid || !isAlive(claimer.pid)) {
    return false;
  }
  return claimer.since === undefined || startOf(claimer.pid) === claimer.since;
}

/** Whether a process with this id runs on this host. */
export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** When a process started, in the operating system's own terms: `/proc` on Linux, `ps` elsewhere. */
function startOf(pid: number): string | undefined {
  try {
    if (process.platform === 'linux') {
      const stat = readFileSync(`/proc/${String(pid)}/stat`, 'utf8');
      return stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19];
    }
    const started = execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], {
      encoding: 'utf8',
      env: { ...process.env, LC_ALL: 'C' },
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return started === '' ? undefined : started;
  } catch {
    return undefined;
  }
}
