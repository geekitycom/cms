import { statSync } from 'node:fs';
import path from 'node:path';

import { readFileIfPresentSync, withFileLock, writeFileAtomicallySync } from '../files/atomic.ts';
import { lockFileFor, withLockFile } from '../files/lock-file.ts';
import { messageOf } from '../util/errors.ts';
import { isRecord } from '../util/guards.ts';
import { FEDERATION_DATA_DIRECTORY } from './records.ts';

/**
 * The object id each URL a post replies to, likes or reposts was last found
 * to name, or `null` for a URL found to name none.
 *
 * Mastodon keeps a status whose `inReplyTo` it cannot fetch as a reply to
 * nothing, and leaves it out of every home feed and the profile's posts. So a
 * reply to a page with no fediverse object behind it is sent with no
 * `inReplyTo` at all.
 */
export type ReplyTargets = Readonly<Record<string, string | null>>;

const REPLY_TARGETS_FILE = `${FEDERATION_DATA_DIRECTORY}/replyTargets.json`;

interface Cached {
  readonly version: string;
  readonly targets: ReplyTargets;
}

const cache = new Map<string, Cached>();

function replyTargetsFile(contentDir: string): string {
  return path.join(contentDir, ...REPLY_TARGETS_FILE.split('/'));
}

export function resolvedTarget(contentDir: string, url: string): string | null | undefined {
  return readCached(replyTargetsFile(contentDir))[url];
}

export async function recordResolvedTarget(
  contentDir: string,
  url: string,
  objectId: string | null,
): Promise<void> {
  const file = replyTargetsFile(contentDir);
  await withFileLock(file, async () => {
    const before = readTargets(file);
    if (before === undefined || before[url] === objectId) return;
    // Decided again under the lock file a CLI process beside the server takes too.
    await withLockFile(lockFileFor(file), () => {
      const targets = readTargets(file);
      if (targets === undefined || targets[url] === objectId) return Promise.resolve();
      writeFileAtomicallySync(
        file,
        `${JSON.stringify({ ...targets, [url]: objectId }, null, 2)}\n`,
      );
      cache.delete(file);
      return Promise.resolve();
    });
  });
}

function readTargets(file: string): ReplyTargets | undefined {
  try {
    return parseReplyTargets(file);
  } catch (error) {
    console.warn(`${messageOf(error)} Writing nothing to it until it is fixed.`);
    return undefined;
  }
}

function readCached(file: string): ReplyTargets {
  const version = versionOf(file);
  const cached = cache.get(file);
  if (cached?.version === version) return cached.targets;

  let targets: ReplyTargets = {};
  try {
    targets = parseReplyTargets(file);
  } catch (error) {
    console.warn(`${messageOf(error)} Reading it as empty until it is fixed.`);
  }
  cache.set(file, { version, targets });
  return targets;
}

function versionOf(file: string): string {
  const stats = statSync(file, { throwIfNoEntry: false });
  return stats === undefined
    ? ''
    : `${String(stats.ino)}:${String(stats.size)}:${String(stats.mtimeMs)}`;
}

function parseReplyTargets(file: string): ReplyTargets {
  const source = readFileIfPresentSync(file);
  if (source === undefined) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    throw new Error(`${file} could not be read as JSON: ${messageOf(error)}.`, { cause: error });
  }
  if (
    !isRecord(parsed) ||
    !Object.values(parsed).every((id) => id === null || typeof id === 'string')
  ) {
    throw new Error(`${file} should hold an object id, or null, by the URL a reply cites.`);
  }
  return parsed as ReplyTargets;
}
