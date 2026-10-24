import { statSync } from 'node:fs';
import path from 'node:path';

import { readFileIfPresentSync, withFileLock, writeFileAtomicallySync } from '../files/atomic.ts';
import { messageOf } from '../util/errors.ts';
import { FEDERATION_DATA_DIRECTORY } from './records.ts';

/**
 * The object ids this site has sent a `Delete` for, and the ids a post was
 * federated under after one of them.
 *
 * Mastodon keeps a `Tombstone` for every id it is sent a `Delete` of, for
 * good, and from then on drops a `Create` of that id and every search that
 * would fetch it. A post that comes back, published again from a draft or the
 * trash or moved back to a permalink it had, therefore has to come back under
 * an id nobody holds a tombstone for: its natural id (the permalink, or the
 * `activitypub.id` its file names) with a revision query, `?v=2`, `?v=3`, …,
 * which the permalink route ignores, so the id still dereferences to the post.
 *
 * Keyed by the natural id, and kept in `content/_data/federation/` beside the
 * followers, because the files are the truth: a rebuilt database
 * must not forget what the fediverse has been told is gone.
 */
export interface ObjectIdRecord {
  readonly deleted: readonly string[];
  /** The ids each natural id was federated under since, oldest first; the last is current. */
  readonly reissued: Readonly<Record<string, readonly string[]>>;
}

/** Every id a post has had: its natural id, then each one it was reissued under. */
export type ObjectIds = readonly [natural: string, ...reissued: string[]];

const OBJECT_IDS_FILE = `${FEDERATION_DATA_DIRECTORY}/objectIds.json`;

const EMPTY: ObjectIdRecord = { deleted: [], reissued: {} };

const REVISION = /[?&]v=\d+$/;

function objectIdsFile(contentDir: string): string {
  return path.join(contentDir, ...OBJECT_IDS_FILE.split('/'));
}

interface Cached {
  readonly version: string;
  /** `undefined` for a damaged file. */
  readonly record: ObjectIdRecord | undefined;
}

const cache = new Map<string, Cached>();

/**
 * The record, parsed once per version of the file rather than on every read:
 * every object id a page or a collection names goes through here.
 *
 * A damaged file reads as empty, with one warning per version of it, so a
 * hand edit gone wrong costs the fresh ids rather than every page and every
 * fetch; {@link claimObjectId} and {@link recordDeleted} refuse to write over
 * it, so nothing it held is lost.
 */
export function readObjectIds(contentDir: string): ObjectIdRecord {
  return readCached(objectIdsFile(contentDir)) ?? EMPTY;
}

function readCached(file: string): ObjectIdRecord | undefined {
  const version = versionOf(file);
  const cached = cache.get(file);
  if (cached?.version === version) return cached.record;

  let record: ObjectIdRecord | undefined;
  try {
    record = parseObjectIds(file);
  } catch (error) {
    console.warn(
      `${messageOf(error)} Reading it as empty, and writing nothing to it, until it is fixed.`,
    );
  }
  cache.set(file, { version, record });
  return record;
}

export function currentObjectId(record: ObjectIdRecord, naturalId: string): string {
  return record.reissued[naturalId]?.at(-1) ?? naturalId;
}

export function objectIdsOf(record: ObjectIdRecord, naturalId: string): ObjectIds {
  return [naturalId, ...(record.reissued[naturalId] ?? [])];
}

/**
 * Whether `objectId` is one this site has federated the post whose natural id
 * is `naturalId` under: what an inbound activity has to name to be about it.
 */
export function isObjectIdOf(record: ObjectIdRecord, naturalId: string, objectId: string): boolean {
  return objectIdsOf(record, naturalId).includes(objectId);
}

export function naturalObjectId(objectId: string): string {
  return objectId.replace(REVISION, '');
}

export async function recordDeleted(contentDir: string, objectId: string): Promise<void> {
  const file = objectIdsFile(contentDir);
  await withFileLock(file, () => {
    const record = parseObjectIds(file);
    if (record.deleted.includes(objectId)) return;
    write(file, { ...record, deleted: [...record.deleted, objectId] });
  });
}

/**
 * Add the ids a `Delete` went out for before this file kept them, read off the
 * delivery log: run at every boot, it writes only when the log names one the
 * file does not, and runs before anything else can write the file.
 */
export function backfillDeleted(contentDir: string, deletedIds: readonly string[]): void {
  const file = objectIdsFile(contentDir);
  const record = readCached(file);
  if (record === undefined) return;
  const missing = [...new Set(deletedIds)].filter((id) => !record.deleted.includes(id));
  if (missing.length === 0) return;
  write(file, { ...record, deleted: [...record.deleted, ...missing] });
}

export async function claimObjectId(contentDir: string, naturalId: string): Promise<string> {
  const file = objectIdsFile(contentDir);
  return await withFileLock(file, () => {
    const record = parseObjectIds(file);
    const current = currentObjectId(record, naturalId);
    if (!record.deleted.includes(current)) return current;

    const reissued = record.reissued[naturalId] ?? [];
    const fresh = withRevision(naturalId, reissued.length + 2);
    write(file, { ...record, reissued: { ...record.reissued, [naturalId]: [...reissued, fresh] } });
    return fresh;
  });
}

function withRevision(naturalId: string, revision: number): string {
  return `${naturalId}${naturalId.includes('?') ? '&' : '?'}v=${String(revision)}`;
}

function versionOf(file: string): string {
  const stats = statSync(file, { throwIfNoEntry: false });
  return stats === undefined
    ? ''
    : `${String(stats.ino)}:${String(stats.size)}:${String(stats.mtimeMs)}`;
}

function parseObjectIds(file: string): ObjectIdRecord {
  const source = readFileIfPresentSync(file);
  if (source === undefined) return EMPTY;

  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    throw new Error(`${file} could not be read as JSON: ${messageOf(error)}.`, { cause: error });
  }
  if (!isObjectIdRecord(parsed)) {
    throw new Error(`${file} should hold "deleted", a list of ids, and "reissued", ids by id.`);
  }
  return parsed;
}

function write(file: string, record: ObjectIdRecord): void {
  writeFileAtomicallySync(file, `${JSON.stringify(record, null, 2)}\n`);
  cache.set(file, { version: versionOf(file), record });
}

function isObjectIdRecord(value: unknown): value is ObjectIdRecord {
  if (typeof value !== 'object' || value === null) return false;
  const { deleted, reissued } = value as Record<string, unknown>;
  return (
    isStringList(deleted) &&
    typeof reissued === 'object' &&
    reissued !== null &&
    Object.values(reissued).every(isStringList)
  );
}

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}
