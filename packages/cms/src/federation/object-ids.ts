import path from 'node:path';

import { readFileIfPresentSync, withFileLock, writeFileAtomicallySync } from '../files/atomic.ts';
import { FEDERATION_DATA_DIRECTORY } from './records.ts';

/**
 * The object ids this site has sent a `Delete` for, and the ids a post was
 * federated under after one of them (TASK-417).
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
 * followers, because the files are the truth (decision-9): a rebuilt database
 * must not forget what the fediverse has been told is gone.
 */
export interface ObjectIdRecord {
  /** Every object id a `Delete` went out for, oldest first. */
  readonly deleted: readonly string[];
  /** The ids each natural id was federated under since, oldest first; the last is current. */
  readonly reissued: Readonly<Record<string, readonly string[]>>;
}

export const OBJECT_IDS_FILE = `${FEDERATION_DATA_DIRECTORY}/objectIds.json`;

const EMPTY: ObjectIdRecord = { deleted: [], reissued: {} };

const REVISION = /[?&]v=\d+$/;

export function objectIdsFile(contentDir: string): string {
  return path.join(contentDir, ...OBJECT_IDS_FILE.split('/'));
}

/** The record, or an empty one for a site that never deleted anything. A damaged file throws. */
export function readObjectIds(contentDir: string): ObjectIdRecord {
  const file = objectIdsFile(contentDir);
  const source = readFileIfPresentSync(file);
  if (source === undefined) return EMPTY;

  const parsed: unknown = JSON.parse(source);
  if (!isObjectIdRecord(parsed)) {
    throw new Error(`${file} should hold "deleted", a list of ids, and "reissued", ids by id.`);
  }
  return parsed;
}

/** The id a post with this natural id federates under now. */
export function currentObjectId(record: ObjectIdRecord, naturalId: string): string {
  return record.reissued[naturalId]?.at(-1) ?? naturalId;
}

/** Every id a post with this natural id has federated under, the natural one first. */
export function objectIdsOf(record: ObjectIdRecord, naturalId: string): string[] {
  return [naturalId, ...(record.reissued[naturalId] ?? [])];
}

/** The natural id an id names: the id without the revision a reissue added. */
export function naturalObjectId(objectId: string): string {
  return objectId.replace(REVISION, '');
}

/** Remember that a `Delete` of this id went out. */
export async function recordDeleted(contentDir: string, objectId: string): Promise<void> {
  const file = objectIdsFile(contentDir);
  await withFileLock(file, () => {
    const record = readObjectIds(contentDir);
    if (record.deleted.includes(objectId)) return;
    write(file, { ...record, deleted: [...record.deleted, objectId] });
  });
}

/**
 * The id to announce a post with this natural id under: the current one, or,
 * when a `Delete` of that one went out, the next revision nobody was ever sent
 * a `Delete` of, which becomes current.
 */
export async function claimObjectId(contentDir: string, naturalId: string): Promise<string> {
  const file = objectIdsFile(contentDir);
  return await withFileLock(file, () => {
    const record = readObjectIds(contentDir);
    const current = currentObjectId(record, naturalId);
    const deleted = new Set(record.deleted);
    if (!deleted.has(current)) return current;

    const held = objectIdsOf(record, naturalId);
    let revision = held.length + 1;
    while (deleted.has(withRevision(naturalId, revision))) revision += 1;
    const fresh = withRevision(naturalId, revision);
    write(file, {
      ...record,
      reissued: { ...record.reissued, [naturalId]: [...held.slice(1), fresh] },
    });
    return fresh;
  });
}

function withRevision(naturalId: string, revision: number): string {
  return `${naturalId}${naturalId.includes('?') ? '&' : '?'}v=${String(revision)}`;
}

function write(file: string, record: ObjectIdRecord): void {
  writeFileAtomicallySync(file, `${JSON.stringify(record, null, 2)}\n`);
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
