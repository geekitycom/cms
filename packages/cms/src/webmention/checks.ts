import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { withFileLock, writeFileAtomicallySync } from '../files/atomic.ts';
import { dataPath, WEBMENTION_CHECKS } from '../files/data-files.ts';
import { lockFileFor, withLockFile } from '../files/lock-file.ts';
import { isRecord } from '../util/guards.ts';

/** One webmention or pingback the site has accepted, as it was sent. */
export interface AcceptedWebmention {
  readonly source: string;
  readonly target: string;
  /** Where the request came from, **unhashed**, for the checker. */
  readonly address?: string | undefined;
  readonly userAgent?: string | undefined;
  readonly referrer?: string | undefined;
}

/** An accepted webmention whose check has not finished. */
export interface WaitingCheck extends AcceptedWebmention {
  readonly id: string;
  readonly acceptedAt: string;
  /** How many checks of it could not read the source. */
  readonly failures: number;
  readonly dueAt: string;
}

/**
 * The accepted webmentions not yet checked, in `data/webmention-checks.json`.
 * Every change reads the file, changes it and renames a new copy over it,
 * under the in-process lock and a lock file beside it.
 */
export interface WaitingChecks {
  /**
   * The waiting check for the same source and target when there is one,
   * else a new one; `undefined` when `limit` checks are already waiting.
   */
  add(accepted: AcceptedWebmention, at: Date): Promise<WaitingCheck | undefined>;
  list(): Promise<WaitingCheck[]>;
  /** Count one more failure and set when it is next due; `undefined` when it is no longer waiting. */
  postpone(id: string, dueAt: Date): Promise<WaitingCheck | undefined>;
  remove(id: string): Promise<void>;
  /** Put a removed check back as it was, unless it or another for the same pair is waiting. */
  restore(check: WaitingCheck): Promise<void>;
}

export function waitingChecks(dataDir: string, limit: number): WaitingChecks {
  const file = dataPath(dataDir, WEBMENTION_CHECKS);
  const lockFile = lockFileFor(file);
  const read = (): Promise<WaitingCheck[]> => readChecks(file);

  function change<T>(edit: (checks: WaitingCheck[]) => { checks?: WaitingCheck[]; value: T }) {
    return withFileLock(file, () =>
      withLockFile(lockFile, async () => {
        const { checks, value } = edit(await read());
        if (checks !== undefined) {
          writeFileAtomicallySync(file, `${JSON.stringify(checks, null, 2)}\n`, { mode: 0o600 });
        }
        return value;
      }),
    );
  }

  return {
    add(accepted, at) {
      const check: WaitingCheck = {
        id: randomUUID(),
        source: accepted.source,
        target: accepted.target,
        ...(accepted.address === undefined ? {} : { address: accepted.address }),
        ...(accepted.userAgent === undefined ? {} : { userAgent: accepted.userAgent }),
        ...(accepted.referrer === undefined ? {} : { referrer: accepted.referrer }),
        acceptedAt: at.toISOString(),
        failures: 0,
        dueAt: at.toISOString(),
      };
      return change((checks) => {
        const same = checks.find(
          (one) => one.source === accepted.source && one.target === accepted.target,
        );
        if (same !== undefined) return { value: same };
        if (checks.length >= limit) return { value: undefined };
        return { checks: [...checks, check], value: check };
      });
    },

    list: read,

    postpone(id, dueAt) {
      return change((checks) => {
        const index = checks.findIndex((check) => check.id === id);
        const check = checks[index];
        if (check === undefined) return { value: undefined };
        const later = { ...check, failures: check.failures + 1, dueAt: dueAt.toISOString() };
        return { checks: checks.with(index, later), value: later };
      });
    },

    async remove(id) {
      await change((checks) =>
        checks.some((check) => check.id === id)
          ? { checks: checks.filter((check) => check.id !== id), value: undefined }
          : { value: undefined },
      );
    },

    async restore(check) {
      await change((checks) =>
        checks.some(
          (one) =>
            one.id === check.id || (one.source === check.source && one.target === check.target),
        )
          ? { value: undefined }
          : { checks: [...checks, check], value: undefined },
      );
    },
  };
}

/**
 * How many checks `data/webmention-checks.json` holds, read without taking its
 * lock, for a reader that must write nothing under `data/`. A file the
 * service could not read throws here too.
 */
export async function countWaitingChecks(dataDir: string): Promise<number> {
  return (await readChecks(dataPath(dataDir, WEBMENTION_CHECKS))).length;
}

async function readChecks(file: string): Promise<WaitingCheck[]> {
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const parsed: unknown = JSON.parse(text);
  if (!Array.isArray(parsed)) throw new Error(`${file} is not a list of webmention checks.`);
  return parsed.filter(isWaitingCheck);
}

function isWaitingCheck(value: unknown): value is WaitingCheck {
  if (!isRecord(value)) return false;
  const optional = (field: unknown): boolean => field === undefined || typeof field === 'string';
  return (
    typeof value['id'] === 'string' &&
    typeof value['source'] === 'string' &&
    typeof value['target'] === 'string' &&
    typeof value['acceptedAt'] === 'string' &&
    typeof value['failures'] === 'number' &&
    typeof value['dueAt'] === 'string' &&
    !Number.isNaN(Date.parse(value['dueAt'])) &&
    optional(value['address']) &&
    optional(value['userAgent']) &&
    optional(value['referrer'])
  );
}
