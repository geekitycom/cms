import { readdirSync } from 'node:fs';
import path from 'node:path';

/**
 * What a file under `data/` is to the site, and so what a site export does
 * with it (decision-55). Decide with an exhaustive `switch` on `kind`, so a new
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

/** Whether a `/`-separated path under the data directory is one this declaration covers. */
export function dataFileMatches(declaration: DataFileDeclaration, relative: string): boolean {
  return segmentsMatch(segmentsOf(declaration.pattern), segmentsOf(relative));
}

/** The first declaration that covers a `/`-separated path, or `undefined` when none does. */
export function dataFileFor(
  declarations: readonly DataFileDeclaration[],
  relative: string,
): DataFileDeclaration | undefined {
  return declarations.find((declaration) => dataFileMatches(declaration, relative));
}

export function declareDataFile(declaration: DataFileDeclaration): DataFileDeclaration {
  const segments = segmentsOf(declaration.pattern);
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw new Error(`${declaration.pattern} is not a relative pattern of named segments.`);
  }
  return Object.freeze({ ...declaration });
}

/**
 * The one way to build a path under `dataDir`. The pattern's literal segments
 * are taken as they are, and each wildcard segment takes the next part, which
 * has to match it; `**` takes every part left. Parts that run out stop the path
 * at the folder, which is how a caller reaches `keys/` or `images/`.
 */
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
    if (next === parts.length) break;
    const taken = glob === ANY_DEPTH ? parts.slice(next) : parts.slice(next, next + 1);
    if (!taken.every((part) => segmentMatches(glob === ANY_DEPTH ? '*' : glob, part))) refuse();
    built.push(...taken);
    next += taken.length;
  }
  if (next !== parts.length) refuse();
  return path.join(dataDir, ...built);
}

const KEPT: DataClass = { kind: 'kept' };
const REBUILDABLE: DataClass = { kind: 'rebuildable' };
const PENDING: DataClass = { kind: 'pending' };
const SCRATCH: DataClass = { kind: 'scratch' };

export const TEMPORARY_FILES = declareDataFile({
  pattern: '**/*.tmp',
  dataClass: SCRATCH,
  lost: 'Nothing. An atomic write that crashed can leave one behind.',
});

export const LOCK_FILES = declareDataFile({
  pattern: '**/*.lock*',
  dataClass: SCRATCH,
  lost: 'Nothing. A stale lock is taken over.',
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

/**
 * Every file core writes under `data/`, apart from the settings registry's,
 * which the registry declares, and the plugins' folders. Scratch comes first,
 * so a temporary file inside a declared folder reads as scratch.
 */
export const CORE_DATA_FILES: readonly DataFileDeclaration[] = [
  TEMPORARY_FILES,
  LOCK_FILES,
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

/** Everything under `content/` is kept, apart from these. */
export const CONTENT_SCRATCH_FILES: readonly DataFileDeclaration[] = [
  TEMPORARY_FILES,
  LOCK_FILES,
  WATCH_PROBE,
];

export interface ClassifiedFile {
  /** Under the folder walked, `/`-separated. */
  readonly relative: string;
  readonly absolute: string;
  /** The first declaration that covers it, or `undefined` when none does. */
  readonly declaration: DataFileDeclaration | undefined;
}

/**
 * Every regular file under `dir`, sorted by its relative path, with the
 * declaration that covers it. Links and other non-files are not walked. A
 * folder that is not there holds nothing.
 */
export function classifyFiles(
  dir: string,
  declarations: readonly DataFileDeclaration[],
): ClassifiedFile[] {
  let entries;
  try {
    entries = readdirSync(dir, { recursive: true, withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const absolute = path.join(entry.parentPath, entry.name);
      const relative = path.relative(dir, absolute).split(path.sep).join('/');
      return { relative, absolute, declaration: dataFileFor(declarations, relative) };
    })
    .sort((a, b) => (a.relative < b.relative ? -1 : a.relative > b.relative ? 1 : 0));
}
