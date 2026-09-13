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

/** What a user's followers file is called, inside their own directory. */
export const FOLLOWERS_FILE = 'followers.json';

/** The directory of monthly inbox logs, relative to the content directory. */
export const INBOX_DIRECTORY = `${FEDERATION_DATA_DIRECTORY}/inbox`;

/**
 * The directory one user's federation files live in, relative to the content
 * directory: `_data/federation/{username}`.
 *
 * decision-14 makes every user an actor, and an actor's followers are its own
 * — an actor that was followed and forgotten simply stops hearing from the
 * site — so the one file doc-4 had becomes one per user. The name is the
 * username verbatim, because it is also the name in the actor's id and in the
 * key files, and a directory nobody can match to a person would be worse than
 * one with an unusual name in it.
 *
 * `inbox` is not a username: it is where the shared log lives, and
 * `web/authors.ts` reserves the path for exactly that reason. A name that
 * could climb out of the directory is refused rather than sanitised, because
 * sanitising two different usernames into one directory would merge two
 * people's followers.
 */
export function userDirectory(username: string): string {
  if (username === '' || username === '.' || username === '..' || /[/\\]/.test(username)) {
    throw new Error(`"${username}" cannot name a federation directory.`);
  }
  return `${FEDERATION_DATA_DIRECTORY}/${username}`;
}

/** The absolute path of one user's `content/_data/federation/{username}/followers.json`. */
export function followersFile(contentDir: string, username: string): string {
  return path.join(contentDir, ...userDirectory(username).split('/'), FOLLOWERS_FILE);
}

/**
 * Every user the content directory holds federation files for, sorted.
 *
 * Read from the directory rather than from `data/users.json`, because
 * decision-9 makes the files the truth: a rebuilt database has to put back
 * exactly what is on disk, including the followers of a user whose account was
 * removed — deleting the account is not the same act as unfollowing everybody
 * on their behalf, and only one of the two can be taken back.
 */
export function federatedUsernames(contentDir: string): string[] {
  let entries: { name: string; isDirectory: () => boolean }[];
  try {
    entries = readdirSync(path.join(contentDir, ...FEDERATION_DATA_DIRECTORY.split('/')), {
      withFileTypes: true,
    });
  } catch {
    // No directory is a site nobody has federated with yet.
    return [];
  }

  return entries
    .filter((entry) => entry.isDirectory() && entry.name !== 'inbox')
    .map((entry) => entry.name)
    .sort();
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
 * One user's followers, as their `followers.json` says them, oldest follow
 * first.
 *
 * A missing file is an empty list, which is what a site nobody has followed
 * yet has. Anything else that is not a list of deliverable followers throws,
 * naming the file: this is read at boot to build the index, and a damaged file
 * read as "no followers" would quietly unfollow everybody — the one thing
 * doc-4 says an ActivityPub site can never take back.
 */
export function readFollowers(contentDir: string, username: string): Follower[] {
  const file = followersFile(contentDir, username);
  const source = readFileIfPresentSync(file);
  if (source === undefined) return [];

  return parseFollowers(source, file, username);
}

/**
 * Record a follow of one user: append the follower to that user's file, or
 * refresh the profile of one already there, and put the same thing in the
 * index.
 *
 * Following twice is not two followers. The file is keyed by actor id exactly
 * as the index is, and an actor already in it keeps its place and its original
 * follow time — a repeated or redelivered `Follow` refreshes the name and the
 * avatar and nothing else.
 */
export async function addFollower(
  records: FederationRecords,
  username: string,
  follower: Omit<NewFollower, 'username'>,
): Promise<Follower> {
  const { admin, contentDir } = records;
  const file = followersFile(contentDir, username);

  return await withFileLock(file, () => {
    const held = readFollowers(contentDir, username);
    const existing = held.find((entry) => entry.actorId === follower.actorId);
    const stored: Follower = {
      username,
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
 * Forget one of a user's followers: an `Undo(Follow)`, or an actor deleting
 * itself.
 *
 * Returns whether anything was there to forget. The index is emptied of the
 * actor whether or not the file held it, so a row left over from a file that
 * was edited by hand cannot go on being delivered to.
 */
export async function removeFollower(
  records: FederationRecords,
  username: string,
  actorId: string,
): Promise<boolean> {
  const { admin, contentDir } = records;
  const file = followersFile(contentDir, username);

  return await withFileLock(file, () => {
    const held = readFollowers(contentDir, username);
    const next = held.filter((entry) => entry.actorId !== actorId);
    if (next.length !== held.length) writeFileAtomicallySync(file, followersJson(next));

    const indexed = admin.deleteFollower(username, actorId);
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
  /**
   * The user it was addressed to, or `null` for one delivered to the shared
   * inbox without naming an actor of this site.
   *
   * decision-14 makes every user an actor, so "what the inbox was told" is no
   * longer one question: a `Follow` is a follow *of somebody*, and a reply is
   * a reply to somebody's post. The log stays one chronological record, as it
   * is a record of what this server was told, and each line says whose it was.
   */
  readonly recipient: string | null;
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
  options: { recipient?: string | null | undefined; receivedAt?: string | undefined } = {},
): Promise<InboxActivity | undefined> {
  const { admin, contentDir } = records;
  const receivedAt = options.receivedAt ?? new Date().toISOString();
  const line: InboxLine = { receivedAt, recipient: options.recipient ?? null, json };
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
    recipient: line.recipient,
    receivedAt: line.receivedAt,
    json: line.json,
  };
}

/** What a rebuild put in the index. */
export interface FederationIndexReport {
  /** How many followers the files named, across every user. */
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

  const followers = federatedUsernames(contentDir).flatMap((username) =>
    readFollowers(contentDir, username),
  );
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
 * Write an older site's inbox rows out as files, once.
 *
 * Before decision-9 the table was the source rather than an index of one, so a
 * site upgrading has rows that no file carries. The rule is the simple one the
 * other decision-9 migrations use, and it is simple here because the log did
 * not exist as a file at all before: a log that is already there wins outright
 * and is not touched, and rows are written out only where there is none. The
 * lines it writes name no recipient, because the site they came from had one
 * actor and it is gone (decision-14).
 *
 * The site actor's followers are **not** migrated. decision-14 replaces one
 * site actor with one actor per user, and there is no honest answer to which
 * user inherited the followers of an account that no longer exists: a follow
 * is an agreement with somebody, and handing it to whoever happens to have the
 * lowest user id would be answering it for them. A site that federated as the
 * site actor starts again as its users, and the old
 * `content/_data/federation/followers.json` is left exactly where it is for an
 * operator who wants to move rows into a user's file by hand.
 *
 * The table is not dropped, unlike `settings`, `actor_keys` and `users`: it
 * stays as the index the rest of the CMS reads. {@link rebuildFederationIndexes}
 * is what runs next and puts the files back into it.
 */
export function migrateFederationToFiles(records: FederationRecords): void {
  const { admin, contentDir } = records;

  if (inboxFiles(contentDir).length === 0) {
    const byMonth = new Map<string, InboxLine[]>();
    for (const activity of [...admin.listInboxActivities()].reverse()) {
      const line: InboxLine = {
        receivedAt: activity.receivedAt,
        recipient: activity.recipient,
        json: activity.json,
      };
      const month = inboxFile(contentDir, activity.receivedAt);
      byMonth.set(month, [...(byMonth.get(month) ?? []), line]);
    }
    for (const [month, lines] of byMonth) writeFileAtomicallySync(month, inboxJsonl(lines));
  }
}

/**
 * One user's followers as their file spells them: an array, indented, newline
 * ended.
 *
 * The username is not written into the entries. It is the name of the
 * directory the file is in, and saying it again once per follower would be a
 * second place for it to be wrong.
 */
function followersJson(followers: readonly Follower[]): string {
  const entries = followers.map(({ username: _username, ...rest }) => rest);
  return `${JSON.stringify(entries, null, 2)}\n`;
}

/**
 * `followers.json` as the followers it names, or a thrown error naming it.
 *
 * An entry with no actor id or no inbox is refused rather than dropped. Those
 * two are the whole of what a follower is for — something to deliver to, and a
 * name to key it by — and skipping such an entry would leave the file and the
 * index quietly disagreeing about who follows the site.
 */
function parseFollowers(source: string, file: string, username: string): Follower[] {
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
      username,
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

    // `receivedAt` and `recipient` are the log's own words and everything else
    // is the activity, so taking them off leaves exactly what the peer
    // delivered.
    const { receivedAt, recipient, ...activity } = parsed;
    lines.push({
      receivedAt: typeof receivedAt === 'string' ? receivedAt : '',
      recipient: typeof recipient === 'string' && recipient !== '' ? recipient : null,
      json: JSON.stringify(activity),
    });
  }

  return lines;
}

/** The lines as the file spells them: one compact JSON object each. */
function inboxJsonl(lines: readonly InboxLine[]): string {
  return lines
    .map(
      (line) =>
        `${JSON.stringify({
          receivedAt: line.receivedAt,
          // Absent rather than null for a shared-inbox delivery that named
          // nobody, so a log written before decision-14 and one written after
          // it read the same.
          ...(line.recipient === null ? {} : { recipient: line.recipient }),
          ...JSON.parse(line.json),
        })}\n`,
    )
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
