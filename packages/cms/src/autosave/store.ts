import { createHash } from 'node:crypto';
import { readdirSync, rmSync, statSync, unlinkSync } from 'node:fs';
import path from 'node:path';

import { isDocumentType } from '../content/document.ts';
import type { DocumentType } from '../content/document.ts';
import { readFileIfPresentSync, writeFileAtomicallySync } from '../files/atomic.ts';
import { AUTOSAVE, dataFolder, dataPath } from '../files/data-files.ts';
import { isNotFound } from '../util/files.ts';
import { isRecord } from '../util/guards.ts';

export const AUTOSAVE_KEEP_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

const COPY_MODE = 0o600;

export interface AutosaveRecord {
  readonly type: DocumentType;
  readonly kind?: string;
  readonly path?: string;
  readonly hash: string;
  readonly fields: Readonly<Record<string, string>>;
  readonly savedAt: string;
}

export interface AutosaveCopy extends AutosaveRecord {
  readonly key: string;
}

export interface AutosaveCopies {
  save(userId: number, key: string, record: AutosaveRecord): void;
  read(userId: number, key: string): AutosaveCopy | undefined;
  list(userId: number): AutosaveCopy[];
  discard(userId: number, key: string): boolean;
  discardUser(userId: number): void;
  prune(now: Date): number;
}

export function autosaveCopies(dataDir: string): AutosaveCopies {
  const userFolder = (userId: number): string => dataPath(dataDir, AUTOSAVE, userPart(userId));
  const fileFor = (userId: number, key: string): string =>
    dataPath(dataDir, AUTOSAVE, userPart(userId), `${digest(key)}.json`);

  return {
    save(userId, key, record) {
      const copy: AutosaveCopy = { key, ...record };
      writeFileAtomicallySync(fileFor(userId, key), `${JSON.stringify(copy, null, 2)}\n`, {
        mode: COPY_MODE,
      });
    },

    read(userId, key) {
      const copy = copyIn(fileFor(userId, key));
      return copy?.key === key ? copy : undefined;
    },

    list(userId) {
      return copyFilesIn(userFolder(userId))
        .map(copyIn)
        .filter((copy) => copy !== undefined)
        .sort((a, b) => (a.savedAt < b.savedAt ? 1 : a.savedAt > b.savedAt ? -1 : 0));
    },

    discard(userId, key) {
      return removed(fileFor(userId, key));
    },

    discardUser(userId) {
      rmSync(userFolder(userId), { recursive: true, force: true });
    },

    prune(now) {
      const cutoff = now.getTime() - AUTOSAVE_KEEP_DAYS * DAY_MS;
      const root = dataFolder(dataDir, AUTOSAVE);
      let pruned = 0;
      for (const user of entriesOf(root)) {
        for (const file of copyFilesIn(path.join(root, user))) {
          const saved = Date.parse(copyIn(file)?.savedAt ?? '');
          const when = Number.isNaN(saved) ? statSync(file).mtimeMs : saved;
          if (when < cutoff && removed(file)) pruned += 1;
        }
      }
      return pruned;
    },
  };
}

function userPart(userId: number): string {
  if (!Number.isSafeInteger(userId) || userId < 1) {
    throw new Error(`${String(userId)} is not a user id.`);
  }
  return String(userId);
}

function digest(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

function entriesOf(folder: string): string[] {
  try {
    return readdirSync(folder);
  } catch (error) {
    if (isNotFound(error)) return [];
    throw error;
  }
}

function copyFilesIn(folder: string): string[] {
  return entriesOf(folder)
    .filter((name) => name.endsWith('.json'))
    .map((name) => path.join(folder, name));
}

function removed(file: string): boolean {
  try {
    unlinkSync(file);
    return true;
  } catch (error) {
    if (isNotFound(error)) return false;
    throw error;
  }
}

function copyIn(file: string): AutosaveCopy | undefined {
  const text = readFileIfPresentSync(file);
  if (text === undefined) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  return isCopy(parsed) ? parsed : undefined;
}

function isCopy(value: unknown): value is AutosaveCopy {
  if (!isRecord(value)) return false;
  const { key, type, kind, path: documentPath, hash, fields, savedAt } = value;
  return (
    typeof key === 'string' &&
    isDocumentType(type) &&
    (kind === undefined || typeof kind === 'string') &&
    (documentPath === undefined || typeof documentPath === 'string') &&
    typeof hash === 'string' &&
    typeof savedAt === 'string' &&
    isRecord(fields) &&
    Object.values(fields).every((field) => typeof field === 'string')
  );
}
