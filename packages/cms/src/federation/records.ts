import { readdirSync } from 'node:fs';
import path from 'node:path';

import type {
  AdminStore,
  Follower,
  InboxActivity,
  NewFollower,
  NewInboxActivity,
} from '../admin/store.ts';
import { readFileIfPresentSync, withFileLock, writeFileAtomicallySync } from '../files/atomic.ts';
import { uriOf } from './replies.ts';

/**
 * The two things an ActivityPub site cannot regenerate, as files it publishes.
 *
 * decision-9 makes the filesystem the source of truth for everything durable,
 * and for federation that is the followers and the log of what the inbox was
 * told. Both live under `content/_data/federation/`, which puts them in git
 * beside the posts, hands them to an Eleventy build of the same directory as
 * `federation.followers` and `federation.inbox`, and leaves SQLite holding
 * nothing but an index of them — one that is rebuilt from these files on every
 * boot and may be deleted at rest.
 *
 * Two rules make that safe, and both live here so no handler has to remember
 * them:
 *
 * - **The file first, the index inside the same step.** Every writer takes
 *   {@link withFileLock} over the file it is about to change and writes the
 *   index before it lets go, so a follow and an unfollow arriving together
 *   cannot leave the index saying something the file does not. SQLite's
 *   transactions used to cover this and cover nothing here any more.
 * - **The index is derived, never told.** A row is built from a line of the
 *   log by {@link inboxRowFrom} whether it is being written for the first time
 *   or rebuilt at boot, so a rebuilt index cannot differ from the live one.
 */

/** Where the federation files live, relative to the content directory. */
export const FEDERATION_DATA_DIRECTORY = '_data/federation';

/** The followers file, relative to the content directory. */
export const FOLLOWERS_FILE = `${FEDERATION_DATA_DIRECTORY}/followers.json`;

/** The directory of monthly inbox logs, relative to the content directory. */
export const INBOX_DIRECTORY = `${FEDERATION_DATA_DIRECTORY}/inbox`;

/** The absolute path of one site's `content/_data/federation/followers.json`. */
export function followersFile(contentDir: string): string {
  return path.join(contentDir, ...FOLLOWERS_FILE.split('/'));
}

/** The absolute path of one site's `content/_data/federation/inbox`. */
export function inboxDirectory(contentDir: string): string {
  return path.join(contentDir, ...INBOX_DIRECTORY.split('/'));
}

/**
 * The month an instant falls in, `yyyy-mm`, in UTC.
 *
 * UTC rather than the site's zone because the log is a record of what a server
 * was told, not of a site's day: the name of a file that has been written must
 * not move when somebody changes the `timezone` setting.
 */
export function inboxMonth(instant: string): string {
  const at = new Date(instant);
  if (Number.isNaN(at.getTime())) return instant.slice(0, 7);
  return `${String(at.getUTCFullYear()).padStart(4, '0')}-${String(at.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** The log file an activity that arrived at this instant belongs in. */
export function inboxFile(contentDir: string, instant: string): string {
  return path.join(inboxDirectory(contentDir), `${inboxMonth(instant)}.jsonl`);
}

/** What every writer here needs: the file it owns, and the index over it. */
export interface FederationRecords {
  /** The index the files are rebuilt into. */
  readonly admin: AdminStore;
  /** The content directory the files live under. */
  readonly contentDir: string;
}

/**
 * The followers, as `followers.json` says them, oldest follow first.
 *
 * A missing file is an empty list, which is what a site nobody has followed
 * yet has. Anything else that is not a list of deliverable followers throws,
 * naming the file: this is read at boot to build the index, and a damaged file
 * read as "no followers" would quietly unfollow everybody — the one thing
 * doc-4 says an ActivityPub site can never take back.
 */
export function readFollowers(contentDir: string): Follower[] {
  const file = followersFile(contentDir);
  const source = readFileIfPresentSync(file);
  if (source === undefined) return [];

  return parseFollowers(source, file);
}

/**
 * Record a follow: append the follower to the file, or refresh the profile of
 * one already there, and put the same thing in the index.
 *
 * Following twice is not two followers. The file is keyed by actor id exactly
 * as the index is, and an actor already in it keeps its place and its original
 * follow time — a repeated or redelivered `Follow` refreshes the name and the
 * avatar and nothing else.
 */
export async function addFollower(
  records: FederationRecords,
  follower: NewFollower,
): Promise<Follower> {
  const { admin, contentDir } = records;
  const file = followersFile(contentDir);

  return await withFileLock(file, () => {
    const held = readFollowers(contentDir);
    const existing = held.find((entry) => entry.actorId === follower.actorId);
    const stored: Follower = {
      actorId: follower.actorId,
      inboxId: follower.inboxId,
      sharedInboxId: follower.sharedInboxId,
      handle: follower.handle,
      name: follower.name,
      iconUrl: follower.iconUrl,
      url: follower.url,
      // The file remembers when the follow began, so a profile refresh cannot
      // move an actor to the top of the list it has been on for a year.
      followedAt: existing?.followedAt ?? follower.followedAt ?? new Date().toISOString(),
    };

    const next =
      existing === undefined
        ? [...held, stored]
        : held.map((entry) => (entry.actorId === stored.actorId ? stored : entry));

    writeFileAtomicallySync(file, followersJson(next));
    admin.putFollower(stored);
    return stored;
  });
}

/**
 * Forget a follower: an `Undo(Follow)`, or an actor deleting itself.
 *
 * Returns whether anything was there to forget. The index is emptied of the
 * actor whether or not the file held it, so a row left over from a file that
 * was edited by hand cannot go on being delivered to.
 */
export async function removeFollower(
  records: FederationRecords,
  actorId: string,
): Promise<boolean> {
  const { admin, contentDir } = records;
  const file = followersFile(contentDir);

  return await withFileLock(file, () => {
    const held = readFollowers(contentDir);
    const next = held.filter((entry) => entry.actorId !== actorId);
    if (next.length !== held.length) writeFileAtomicallySync(file, followersJson(next));

    const indexed = admin.deleteFollower(actorId);
    return next.length !== held.length || indexed;
  });
}

/**
 * One line of the inbox log: an activity, and when the site was told it.
 *
 * The line is the activity's own compacted JSON-LD with `receivedAt` in front
 * of it. That is the one thing the activity cannot say for itself — a peer
 * publishes when a note was written, not when this server heard about it — and
 * it is what the federation screen orders by, so an index rebuilt from the log
 * would otherwise have to invent it.
 */
export interface InboxLine {
  /** When the activity arrived, as an ISO 8601 instant. */
  readonly receivedAt: string;
  /** The activity as compacted JSON-LD, exactly as it arrived. */
  readonly json: string;
}

/**
 * The whole inbox log, oldest month first and, within a month, in the order
 * the activities arrived.
 *
 * Every month file under `content/_data/federation/inbox` is read; a file or a
 * line that will not parse throws, naming the file. Fedify answers a throwing
 * dispatcher by swallowing the throw, so a log this cannot read has to stop
 * the boot rather than wait to be noticed through a request.
 */
export function readInboxLog(contentDir: string): InboxLine[] {
  const lines: InboxLine[] = [];
  for (const file of inboxFiles(contentDir)) lines.push(...readInboxFile(file));
  return lines;
}

/**
 * Record one inbound activity: append it to the month's log and index it.
 *
 * `json` is the activity as compacted JSON-LD, which is what the handler has
 * and what doc-4 says to keep whole — nothing is picked out of it here beyond
 * the columns the index pages and counts by, because what a later phase will
 * want out of an activity is not knowable from here.
 *
 * An activity with no actor is dropped and nothing is written: Fedify has
 * already refused anything whose signature does not match its actor, so one
 * without an actor is malformed rather than anonymous. A redelivery of an
 * activity the month already holds replaces its line where it stands, which is
 * what the index's unique key on the activity id does to the row.
 */
export async function appendInboxActivity(
  records: FederationRecords,
  json: string,
  receivedAt: string = new Date().toISOString(),
): Promise<InboxActivity | undefined> {
  const { admin, contentDir } = records;
  const line: InboxLine = { receivedAt, json };
  const row = inboxRowFrom(line);
  if (row === undefined) return undefined;

  const file = inboxFile(contentDir, receivedAt);

  return await withFileLock(file, () => {
    const held = readInboxFile(file);
    const at = row.activityId === null ? -1 : held.findIndex(sameActivity(row.activityId));
    const next = at === -1 ? [...held, line] : held.with(at, line);

    writeFileAtomicallySync(file, inboxJsonl(next));
    return admin.logInboxActivity(row);
  });
}

/**
 * One line of the log as the index row it makes, or `undefined` when it is not
 * an activity the log keeps.
 *
 * This is the only place a row is derived, and the live append and the boot
 * rebuild both go through it, so a row rebuilt from the log cannot say
 * something different from the row the activity made when it arrived. Every
 * column is read out of the JSON, so the file really is the whole story;
 * `inReplyTo` is the one the store derives for itself, from this same JSON and
 * by the same rule.
 */
export function inboxRowFrom(line: InboxLine): NewInboxActivity | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line.json);
  } catch {
    return undefined;
  }
  if (!isRecord(parsed)) return undefined;

  const actorId = uriOf(parsed['actor']);
  if (actorId === null) return undefined;

  return {
    activityId: uriOf(parsed['id']),
    activityType: activityTypeOf(parsed['type']),
    actorId,
    objectId: uriOf(parsed['object']),
    receivedAt: line.receivedAt,
    json: line.json,
  };
}

/** What a rebuild put in the index. */
export interface FederationIndexReport {
  /** How many followers the file named. */
  followers: number;
  /** How many activities the log held. */
  activities: number;
}

/**
 * Rebuild the followers and inbox indexes from the files.
 *
 * This is what makes `data/geekity.db` disposable for federation (decision-9):
 * the two tables hold nothing but what these files say, so every boot throws
 * away what they hold and reads them again. That is also what makes editing
 * `followers.json` by hand and restarting a supported thing to do, and why a
 * database deleted at rest costs a site nothing.
 *
 * Exported so `geekity rebuild` can call the very function boot calls. It is
 * synchronous because both callers are, and it reads before it writes: a file
 * that will not parse throws with the file named and leaves the index exactly
 * as it was, rather than emptying it and then failing.
 */
export function rebuildFederationIndexes(records: FederationRecords): FederationIndexReport {
  const { admin, contentDir } = records;

  const followers = readFollowers(contentDir);
  const activities: NewInboxActivity[] = [];
  for (const line of readInboxLog(contentDir)) {
    const row = inboxRowFrom(line);
    if (row !== undefined) activities.push(row);
  }

  admin.replaceFollowers(followers);
  admin.replaceInboxActivities(activities);

  return { followers: followers.length, activities: activities.length };
}

/**
 * Write an older site's followers and inbox rows out as files, once.
 *
 * Before this version the two tables were the source rather than an index of
 * one, so a site upgrading has rows that no file carries. The rule is the
 * simple one the other decision-9 migrations use, and it is simple here
 * because these files did not exist at all before: a file that is already
 * there wins outright and is not touched, and rows are written out only where
 * there is none.
 *
 * Neither table is dropped, unlike `settings`, `actor_keys` and `users`: they
 * stay as the index the rest of the CMS reads. {@link rebuildFederationIndexes}
 * is what runs next and puts the files back into them.
 */
export function migrateFederationToFiles(records: FederationRecords): void {
  const { admin, contentDir } = records;

  const file = followersFile(contentDir);
  if (readFileIfPresentSync(file) === undefined) {
    // `listFollowers` is newest first, which is the order the collection is
    // served in; the file is written oldest first, the order they arrived.
    const held = [...admin.listFollowers()].reverse();
    if (held.length > 0) writeFileAtomicallySync(file, followersJson(held));
  }

  if (inboxFiles(contentDir).length === 0) {
    const byMonth = new Map<string, InboxLine[]>();
    for (const activity of [...admin.listInboxActivities()].reverse()) {
      const line: InboxLine = { receivedAt: activity.receivedAt, json: activity.json };
      const month = inboxFile(contentDir, activity.receivedAt);
      byMonth.set(month, [...(byMonth.get(month) ?? []), line]);
    }
    for (const [month, lines] of byMonth) writeFileAtomicallySync(month, inboxJsonl(lines));
  }
}

/** The followers as the file spells them: an array, indented, newline ended. */
function followersJson(followers: readonly Follower[]): string {
  return `${JSON.stringify(followers, null, 2)}\n`;
}

/**
 * `followers.json` as the followers it names, or a thrown error naming it.
 *
 * An entry with no actor id or no inbox is refused rather than dropped. Those
 * two are the whole of what a follower is for — something to deliver to, and a
 * name to key it by — and skipping such an entry would leave the file and the
 * index quietly disagreeing about who follows the site.
 */
function parseFollowers(source: string, file: string): Follower[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    throw new Error(`${file} could not be read as JSON: ${messageOf(error)}`, { cause: error });
  }

  if (!Array.isArray(parsed)) {
    throw new Error(`${file} should be a list of followers, one object per follower.`);
  }

  return parsed.map((entry, index) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw new Error(`${file}: entry ${String(index + 1)} is not a follower object.`);
    }
    const follower = entry as Record<string, unknown>;
    const actorId = follower['actorId'];
    const inboxId = follower['inboxId'];
    if (typeof actorId !== 'string' || actorId === '') {
      throw new Error(`${file}: entry ${String(index + 1)} has no actorId.`);
    }
    if (typeof inboxId !== 'string' || inboxId === '') {
      throw new Error(`${file}: the follower "${actorId}" has no inboxId to deliver to.`);
    }

    return {
      actorId,
      inboxId,
      sharedInboxId: optionalText(follower['sharedInboxId']),
      handle: optionalText(follower['handle']),
      name: optionalText(follower['name']),
      iconUrl: optionalText(follower['iconUrl']),
      url: optionalText(follower['url']),
      followedAt: typeof follower['followedAt'] === 'string' ? follower['followedAt'] : '',
    };
  });
}

/** A value the file may have left out, as the text it holds or `null`. */
function optionalText(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

/** Every month log a site has, oldest first. */
function inboxFiles(contentDir: string): string[] {
  const directory = inboxDirectory(contentDir);
  let entries: string[];
  try {
    entries = readdirSync(directory);
  } catch {
    // No directory is no log, which is what a site nobody has interacted with
    // has. Every other way this can fail fails again on the next boot.
    return [];
  }

  // The names are `yyyy-mm`, so sorting them as text sorts them by month, and
  // reading them in that order is what makes the row ids the arrival order.
  return entries
    .filter((name) => name.endsWith('.jsonl'))
    .sort()
    .map((name) => path.join(directory, name));
}

/** One month's log as its lines, or a thrown error naming the file. */
function readInboxFile(file: string): InboxLine[] {
  const source = readFileIfPresentSync(file);
  if (source === undefined) return [];

  const lines: InboxLine[] = [];
  const rows = source.split('\n');
  for (const [index, row] of rows.entries()) {
    if (row.trim() === '') continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(row);
    } catch (error) {
      throw new Error(`${file}: line ${String(index + 1)} is not JSON: ${messageOf(error)}`, {
        cause: error,
      });
    }
    if (!isRecord(parsed)) {
      throw new Error(`${file}: line ${String(index + 1)} is not an activity.`);
    }

    // `receivedAt` is the log's own word and everything else is the activity,
    // so taking it off leaves exactly what the peer delivered.
    const { receivedAt, ...activity } = parsed;
    lines.push({
      receivedAt: typeof receivedAt === 'string' ? receivedAt : '',
      json: JSON.stringify(activity),
    });
  }

  return lines;
}

/** The lines as the file spells them: one compact JSON object each. */
function inboxJsonl(lines: readonly InboxLine[]): string {
  return lines
    .map((line) => `${JSON.stringify({ receivedAt: line.receivedAt, ...JSON.parse(line.json) })}\n`)
    .join('');
}

/** Whether a line carries this activity id, for the redelivery that replaces it. */
function sameActivity(activityId: string): (line: InboxLine) => boolean {
  return (line) => {
    const parsed: unknown = JSON.parse(line.json);
    return isRecord(parsed) && uriOf(parsed['id']) === activityId;
  };
}

/**
 * The short ActivityStreams type name an activity carries: `Like`, `Announce`,
 * `Create`.
 *
 * A compacted document usually spells it as that word, which is what the
 * `INBOX_INTERACTIONS` table on the federation screen keys on. Anything else
 * is reduced the way the type IRI is: the fragment, else the last path
 * segment, so an activity outside the core vocabulary still has a name rather
 * than a URL. An activity with several types is filed under the first, and one
 * with none is `Activity`, which is what it is.
 */
function activityTypeOf(value: unknown): string {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = activityTypeOf(item);
      if (found !== 'Activity') return found;
    }
    return 'Activity';
  }
  if (typeof value !== 'string' || value === '') return 'Activity';
  if (!value.includes(':')) return value;

  try {
    const url = new URL(value);
    if (url.hash !== '') return url.hash.slice(1);
    const last = url.pathname
      .split('/')
      .filter((segment) => segment !== '')
      .pop();
    return last ?? value;
  } catch {
    return value;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
