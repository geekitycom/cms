import type { Document } from './document.ts';
import type { DocumentChange } from './sync.ts';
import { isServed } from '../web/documents.ts';

export const MIGRATED_FRONT_MATTER_KEY = 'migrated';

export function isMigrated(document: Pick<Document, 'extra'>): boolean {
  return document.extra[MIGRATED_FRONT_MATTER_KEY] === true;
}

export function isMigratedArrival(change: DocumentChange, now: Date): boolean {
  const { previous, next } = change;
  if (next === undefined || !isMigrated(next)) return false;
  return previous === undefined || !isServed(previous, now);
}
