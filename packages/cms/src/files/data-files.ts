import { readdirSync } from 'node:fs';
import type { Dirent } from 'node:fs';
import path from 'node:path';

import { isNotFound } from '../util/files.ts';

/**
 * What a file under `data/` is to the site, and so what a site export does
 * with it. Decide with an exhaustive `switch` on `kind`, so a new
 * member breaks every place that has to decide about it.
 */
export type DataClass =
  /** The site cannot be rebuilt without it. Always exported. */
  | { readonly kind: 'kept' }
  /** Typed in again from another service: an API key, a login. Exported only when asked. */
  | { readonly kind: 'credential' }
  /** The site makes it again, fetches it again, or falls back to a default. Never exported. */
  | { readonly kind: 'rebuildable' }
  /** Work not done yet, tied to this host. Never exported; drained before a move. */
  | { readonly kind: 'pending' }
  /** Left by a write or a lock in flight. Never exported. */
  | { readonly kind: 'scratch' };

export interface DataFileDeclaration {
  /** Under `dataDir`, `/`-separated. `*` is any run of characters in one segment and `**` any depth: `keys/*.jwk`, `images/**`. */
  readonly pattern: string;
  readonly dataClass: DataClass;
  /** One sentence for the docs and `geekity export --list`: what is lost if it is lost. */
  readonly lost: string;
}

const ANY_DEPTH = '**';

function segmentsOf(pattern: string): string[] {
  return pattern.split('/');
}

function isWildcard(segment: string): boolean {
  return segment.includes('*');
}

function segmentMatches(glob: string, segment: string): boolean {
  if (segment === '' || segment === '.' || segment === '..') return false;
  const source = glob
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('[^/]*');
  return new RegExp(`^${source}$`).test(segment);
}

function segmentsMatch(globs: readonly string[], segments: readonly string[]): boolean {
  const [glob, ...restGlobs] = globs;
  if (glob === undefined) return segments.length === 0;
  if (glob === ANY_DEPTH) {
    return (
      segments.some((_, index) => segmentsMatch(restGlobs, segments.slice(index))) ||
      segmentsMatch(restGlobs, [])
    );
  }
  const [segment, ...restSegments] = segments;
  return (
    segment !== undefined && segmentMatches(glob, segment) && segmentsMatch(restGlobs, restSegments)
  );
}

export function dataFileMatches(declaration: DataFileDeclaration, relative: string): boolean {
  return segmentsMatch(segmentsOf(declaration.pattern), segmentsOf(relative));
}

/**
 * The declaration that covers a `/`-separated path, or `undefined` when none
 * does. A scratch declaration wins over any other, wherever it is in the list,
 * so a temporary file inside a kept folder is scratch. Among the rest, the
 * first that covers it wins.
 */
export function dataFileFor(
  declarations: readonly DataFileDeclaration[],
  relative: string,
): DataFileDeclaration | undefined {
  const covering = declarations.filter((declaration) => dataFileMatches(declaration, relative));
  return covering.find((declaration) => declaration.dataClass.kind === 'scratch') ?? covering[0];
}

export function writtenPrivately(declaration: DataFileDeclaration): boolean {
  return declaration.dataClass.kind === 'credential';
}

export function declareDataFile(declaration: DataFileDeclaration): DataFileDeclaration {
  const segments = segmentsOf(declaration.pattern);
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw new Error(`${declaration.pattern} is not a relative pattern of named segments.`);
  }
  return Object.freeze({ ...declaration });
}

export function dataPath(dataDir: string, file: DataFileDeclaration, ...parts: string[]): string {
  const refuse = (): never => {
    throw new Error(`${parts.join('/')} is not a path ${file.pattern} declares under data/.`);
  };
  const built: string[] = [];
  let next = 0;
  for (const glob of segmentsOf(file.pattern)) {
    if (!isWildcard(glob)) {
      built.push(glob);
      continue;
    }
    const taken = glob === ANY_DEPTH ? parts.slice(next) : parts.slice(next, next + 1);
    if (taken.length === 0) refuse();
    if (!taken.every((part) => segmentMatches(glob === ANY_DEPTH ? '*' : glob, part))) refuse();
    built.push(...taken);
    next += taken.length;
  }
  if (next !== parts.length) refuse();
  return path.join(dataDir, ...built);
}

/** The folder that holds what `folder` declares: `keys/` for `keys/*.jwk`, `images/` for `images/**`. */
export function dataFolder(
  dataDir: string,
  folder: DataFileDeclaration,
  ...parts: string[]
): string {
  const segments = segmentsOf(folder.pattern);
  if (segments.length < 2) throw new Error(`${folder.pattern} declares a file, not a folder.`);
  return dataPath(dataDir, { ...folder, pattern: segments.slice(0, -1).join('/') }, ...parts);
}

const KEPT: DataClass = { kind: 'kept' };
const REBUILDABLE: DataClass = { kind: 'rebuildable' };
const PENDING: DataClass = { kind: 'pending' };
const SCRATCH: DataClass = { kind: 'scratch' };

export const TEMPORARY_FILES = declareDataFile({
  pattern: '**/*.*-*.tmp',
  dataClass: SCRATCH,
  lost: 'Nothing. An atomic write that crashed can leave one behind.',
});

export const LOCK_FILES = declareDataFile({
  pattern: '**/*.lock',
  dataClass: SCRATCH,
  lost: 'Nothing. A stale lock is taken over.',
});

export const LOCK_TAKEOVER_FILES = declareDataFile({
  pattern: '**/*.lock.takeover',
  dataClass: SCRATCH,
  lost: 'Nothing. A waiter holds it while it removes a stale lock.',
});

export const IMPORT_MARKER = declareDataFile({
  pattern: '.geekity-import',
  dataClass: SCRATCH,
  lost: 'Nothing. geekity import leaves it until an import is finished, so a second run knows the folder is its own.',
});

export const IMPORT_STAGING = declareDataFile({
  pattern: '.geekity-importing/**',
  dataClass: SCRATCH,
  lost: 'Nothing. geekity import unpacks an archive here and moves it into place; a stopped import leaves it for the next run to remove.',
});

export const IMPORT_ASIDE = declareDataFile({
  pattern: '.geekity-before-import-*/**',
  dataClass: SCRATCH,
  lost: 'What the folder held before geekity import --replace. Delete it once the imported site is checked.',
});

export const EXPORTS = declareDataFile({
  pattern: 'exports/**',
  dataClass: SCRATCH,
  lost: 'Nothing. A site export written for the admin to download, made again on request.',
});

export const ACTOR_KEYS = declareDataFile({
  pattern: 'keys/*.jwk',
  dataClass: KEPT,
  lost: "The actors' signing keys: remote servers reject signatures until they fetch the actor again, and proofs on objects already sent stop verifying.",
});

export const USERS = declareDataFile({
  pattern: 'users.json',
  dataClass: KEPT,
  lost: 'Every account: usernames, which are the actor ids, emails, password hashes and profiles.',
});

export const NOTIFICATION_SECRET = declareDataFile({
  pattern: 'notification-secret',
  dataClass: KEPT,
  lost: 'Every moderation and unsubscribe link in mail already sent stops working.',
});

export const COMMENT_SALT = declareDataFile({
  pattern: 'comment-salt',
  dataClass: KEPT,
  lost: 'Address hashes written before the loss can no longer be compared with new ones.',
});

export const COMMENT_EMAILS = declareDataFile({
  pattern: 'comments/*.json',
  dataClass: KEPT,
  lost: "Commenters' emails, and their reply subscriptions.",
});

export const CONTACT_MESSAGES = declareDataFile({
  pattern: 'contact/*.json',
  dataClass: KEPT,
  lost: 'Contact messages.',
});

export const COMMENT_OPTOUTS = declareDataFile({
  pattern: 'comment-optouts.json',
  dataClass: KEPT,
  lost: 'The list of people who unsubscribed, so the site would write to them again.',
});

export const INDIEAUTH_TOKENS = declareDataFile({
  pattern: 'indieauth-tokens.json',
  dataClass: KEPT,
  lost: 'Every connected IndieAuth or Micropub app has to sign in again.',
});

export const LOCATIONS = declareDataFile({
  pattern: 'locations.json',
  dataClass: KEPT,
  lost: 'Where each post was written.',
});

export const KEPT_PROPERTIES = declareDataFile({
  pattern: 'kept-properties.json',
  dataClass: KEPT,
  lost: 'Micropub properties the site does not understand, such as an RSVP.',
});

export const PLUGIN_CHANGES = declareDataFile({
  pattern: 'plugin-changes.json',
  dataClass: KEPT,
  lost: 'Who added, updated and removed which plugin. Nothing else holds it.',
});

export const JOBS = declareDataFile({
  pattern: 'jobs.json',
  dataClass: KEPT,
  lost: 'Queued jobs and the last five results for each job name.',
});

export const DEV_MODE_RECORD = declareDataFile({
  pattern: 'dev-mode.jsonl',
  dataClass: KEPT,
  lost: 'The record that proves a migration was silent.',
});

export const FOLLOWER_HISTORY = declareDataFile({
  pattern: 'follower-history.jsonl',
  dataClass: KEPT,
  lost: 'Every follow and unfollow with the follower count after it, which the dashboard charts. The followers file holds only who follows now.',
});

export const INDIEAUTH_ACTIVITY = declareDataFile({
  pattern: 'indieauth-activity.json',
  dataClass: REBUILDABLE,
  lost: 'The last IndieAuth and Micropub requests, which exist for debugging.',
});

export const NOTIFICATION_DIGESTS = declareDataFile({
  pattern: 'notification-digests.json',
  dataClass: REBUILDABLE,
  lost: 'When each user last had a digest, so one digest may come a window early.',
});

export const MICROPUB_MEDIA = declareDataFile({
  pattern: 'micropub-media.json',
  dataClass: REBUILDABLE,
  lost: "Each user's last upload for Micropub's q=last, empty until the next upload.",
});

export const DATABASE = declareDataFile({
  pattern: 'geekity.db',
  dataClass: REBUILDABLE,
  lost: 'The index, rebuilt from files, and sessions, delivery outcomes and other caches, which start empty.',
});

export const DATABASE_LOG = declareDataFile({
  pattern: 'geekity.db-*',
  dataClass: REBUILDABLE,
  lost: "The database's write-ahead log, which goes with the database.",
});

export const IMAGES = declareDataFile({
  pattern: 'images/**',
  dataClass: REBUILDABLE,
  lost: 'Image variants and icons, derived again from content/uploads/ when a page asks for them.',
});

export const AVATARS = declareDataFile({
  pattern: 'avatars/*',
  dataClass: REBUILDABLE,
  lost: 'Cached avatars, fetched again by the avatar sweep.',
});

export const QUEUE = declareDataFile({
  pattern: 'queue.sqlite',
  dataClass: PENDING,
  lost: "Queued deliveries, inbox work and Fedify's scheduled retries.",
});

export const QUEUE_LOG = declareDataFile({
  pattern: 'queue.sqlite-*',
  dataClass: PENDING,
  lost: "The queue's write-ahead log, which goes with the queue.",
});

export const CORE_DATA_FILES: readonly DataFileDeclaration[] = [
  TEMPORARY_FILES,
  LOCK_FILES,
  LOCK_TAKEOVER_FILES,
  IMPORT_MARKER,
  IMPORT_STAGING,
  IMPORT_ASIDE,
  EXPORTS,
  ACTOR_KEYS,
  USERS,
  NOTIFICATION_SECRET,
  COMMENT_SALT,
  COMMENT_EMAILS,
  CONTACT_MESSAGES,
  COMMENT_OPTOUTS,
  INDIEAUTH_TOKENS,
  LOCATIONS,
  KEPT_PROPERTIES,
  PLUGIN_CHANGES,
  JOBS,
  DEV_MODE_RECORD,
  FOLLOWER_HISTORY,
  INDIEAUTH_ACTIVITY,
  NOTIFICATION_DIGESTS,
  MICROPUB_MEDIA,
  DATABASE,
  DATABASE_LOG,
  IMAGES,
  AVATARS,
  QUEUE,
  QUEUE_LOG,
];

export const WATCH_PROBE = declareDataFile({
  pattern: '.geekity-watch-*/**',
  dataClass: SCRATCH,
  lost: 'Nothing. The content watcher makes it and removes it to check that it works.',
});

export const CONTENT_SCRATCH_FILES: readonly DataFileDeclaration[] = [
  TEMPORARY_FILES,
  IMPORT_MARKER,
  IMPORT_STAGING,
  IMPORT_ASIDE,
  WATCH_PROBE,
];

export interface ClassifiedFile {
  /** Under the folder walked, `/`-separated. */
  readonly relative: string;
  readonly absolute: string;
  /** The declaration {@link dataFileFor} gives it, or `undefined` when none covers it. */
  readonly declaration: DataFileDeclaration | undefined;
}

/**
 * The folder `fsck` keeps at the root of an ext filesystem, owned by root. A
 * `content/` or `data/` that is a mount point holds one. It is the
 * filesystem's, not the site's: nothing walks it, exports it or moves it.
 */
export const LOST_AND_FOUND = 'lost+found';

export const OTHER_ENTRY_KINDS = ['a symbolic link', 'a socket', 'a FIFO', 'a device'] as const;

export type OtherEntryKind = (typeof OTHER_ENTRY_KINDS)[number];

export interface ClassifiedOther extends ClassifiedFile {
  readonly kind: OtherEntryKind;
}

export interface ClassifiedEntries {
  readonly files: ClassifiedFile[];
  readonly others: ClassifiedOther[];
}

function kindOf(entry: Dirent): OtherEntryKind {
  if (entry.isSymbolicLink()) return 'a symbolic link';
  if (entry.isSocket()) return 'a socket';
  if (entry.isFIFO()) return 'a FIFO';
  return 'a device';
}

function byRelative(a: ClassifiedFile, b: ClassifiedFile): number {
  return a.relative < b.relative ? -1 : a.relative > b.relative ? 1 : 0;
}

export function classifyEntries(
  dir: string,
  declarations: readonly DataFileDeclaration[],
): ClassifiedEntries {
  const files: ClassifiedFile[] = [];
  const others: ClassifiedOther[] = [];
  const walk = (folder: string): void => {
    let entries;
    try {
      entries = readdirSync(folder, { withFileTypes: true });
    } catch (error) {
      if (isNotFound(error)) return;
      throw error;
    }
    for (const entry of entries) {
      const absolute = path.join(folder, entry.name);
      if (entry.isDirectory()) {
        if (folder !== dir || entry.name !== LOST_AND_FOUND) walk(absolute);
        continue;
      }
      const relative = path.relative(dir, absolute).split(path.sep).join('/');
      const classified = { relative, absolute, declaration: dataFileFor(declarations, relative) };
      if (entry.isFile()) files.push(classified);
      else others.push({ ...classified, kind: kindOf(entry) });
    }
  };
  walk(dir);
  return { files: files.sort(byRelative), others: others.sort(byRelative) };
}

/** Every regular file under `dir`, sorted by its relative path, with the declaration that covers it. */
export function classifyFiles(
  dir: string,
  declarations: readonly DataFileDeclaration[],
): ClassifiedFile[] {
  return classifyEntries(dir, declarations).files;
}
