/**
 * A post that was public somewhere else before it reached this site
 * (TASK-296, decision-36):
 *
 * ```yaml
 * migrated: true
 * ```
 *
 * Its readers have already seen it, so its arrival here is news to nobody.
 * Whether its followers hold it is a separate record, `activitypub.published`,
 * and a migrated post without one is never federated at all.
 */
import type { Document } from './document.ts';
import type { DocumentChange } from './sync.ts';
import { isServed } from '../web/documents.ts';

export const MIGRATED_FRONT_MATTER_KEY = 'migrated';

export function isMigrated(document: Pick<Document, 'extra'>): boolean {
  return document.extra[MIGRATED_FRONT_MATTER_KEY] === true;
}

/**
 * Whether a change only brings a migrated document into public view: a file
 * arriving, a draft published, a scheduled date passing. Nothing about it is
 * new to anybody, so no webmention, feed ping or IndexNow submission goes out.
 * A change to a version that was already public is a real edit and goes out
 * as any edit does.
 */
export function isMigratedArrival(change: DocumentChange, now: Date): boolean {
  const { previous, next } = change;
  if (next === undefined || !isMigrated(next)) return false;
  return previous === undefined || !isServed(previous, now);
}
