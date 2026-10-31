import { statSync } from 'node:fs';
import path from 'node:path';

import { readFileIfPresentSync, withFileLock, writeFileAtomicallySync } from '../files/atomic.ts';
import { messageOf } from '../util/errors.ts';
import { isRecord } from '../util/guards.ts';
import { FEDERATION_DATA_DIRECTORY } from './records.ts';

/**
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

export function resolvedReplyTarget(contentDir: string, url: string): string | null | undefined {
  return readCached(replyTargetsFile(contentDir))[url];
}

export async function recordReplyTarget(
  contentDir: string,
  url: string,
  objectId: string | null,
): Promise<void> {
  const file = replyTargetsFile(contentDir);
  await withFileLock(file, () => {
    let targets: ReplyTargets;
    try {
      targets = parseReplyTargets(file);
    } catch (error) {
      console.warn(`${messageOf(error)} Writing nothing to it until it is fixed.`);
      return;
    }
    if (targets[url] === objectId) return;
    writeFileAtomicallySync(file, `${JSON.stringify({ ...targets, [url]: objectId }, null, 2)}\n`);
    cache.delete(file);
  });
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
