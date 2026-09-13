import { createPrivateKey, createPublicKey } from 'node:crypto';
import type { KeyObject } from 'node:crypto';

import { exportJwk } from '@fedify/fedify';

import { setUserWordPressActor } from '../admin/accounts.ts';
import type { AdminStore, Follower, NewFollower } from '../admin/store.ts';
import { readFileIfPresentSync } from '../files/atomic.ts';
import { actorKeyFile, loadActorKeyPairs, writeActorKeyFile } from './keys.ts';
import type { ActorKeyAlgorithm } from './keys.ts';
import { addFollower, readFollowers } from './records.ts';
import { actorHandle, uriOf } from './replies.ts';

/**
 * Bringing one person across from the WordPress ActivityPub plugin
 * (decision-14, TASK-71).
 *
 * Three things a site leaving the plugin cannot regenerate, and this is where
 * they arrive: the RSA key pair its followers have cached, the actor id its
 * followers key the account by, and the followers themselves. Everything else
 * about the move — the posts, their ids, the compatibility paths — comes in
 * with the content or is a setting.
 *
 * Nothing here is a screen, on purpose. A stored actor id is identity for the
 * life of the account (doc-4), and identity is not something a form should be
 * able to retype.
 */

/** The algorithm the plugin signs with, and the only one it has a key for. */
const RSA = 'RSASSA-PKCS1-v1_5';

/** What {@link importWordPressActor} is given. */
export interface ImportWordPressActorOptions {
  /** The index the followers are written into as the files are written. */
  readonly admin: AdminStore;
  /** Where `users.json` and `keys/` live. */
  readonly dataDir: string;
  /** Where `_data/federation/{username}/followers.json` lives. */
  readonly contentDir: string;
  /** Which account on this site the plugin's actor becomes. */
  readonly username: string;
  /**
   * The actor's id exactly as WordPress published it, query string and all:
   * `https://example.com/?author=2`.
   */
  readonly actorId: string;
  /** The WordPress user id, which is the number in every one of its paths. */
  readonly wordpressActorId: number;
  /** The private key as PEM, PKCS#1 or PKCS#8, as `wp` printed it. */
  readonly privateKeyPem: string;
  /**
   * The public key as PEM, when the export carried one.
   *
   * Checked against the private half rather than stored: the public key is
   * derivable, so the only thing a second file can tell us is whether the two
   * halves of the export belong together — and a pair that does not is an
   * export somebody got wrong, which is worth finding out now rather than
   * after the DNS has moved.
   */
  readonly publicKeyPem?: string | undefined;
  /**
   * Where the followers come from.
   *
   * Left off, the plugin's public followers collection on the actor id's own
   * origin, which is the whole point of running this before the DNS moves. A
   * URL asks a different one; a path reads a saved collection out of a file,
   * for a site that is already gone; `false` skips the step, for a run that is
   * only there to put the key and the ids in place.
   */
  readonly followers?: string | false | undefined;
  /** Replace a key pair this user already has. Refused without it. */
  readonly force?: boolean | undefined;
}

/** What happened to one key file. */
export interface ImportedKey {
  /** The file, absolute. */
  readonly file: string;
  /** Which pair it holds. */
  readonly algorithm: ActorKeyAlgorithm;
  /** What the run did with it. */
  readonly state: 'imported' | 'generated' | 'unchanged' | 'replaced';
}

/** One follower the collection named and nothing could be made of. */
export interface UnreachableFollower {
  /** The actor the collection named. */
  readonly actor: string;
  /** Why it was skipped, for the report. */
  readonly reason: string;
}

/** What the followers step did. */
export interface FollowersImportReport {
  /** The collection it read, or `undefined` when the step was skipped. */
  readonly source: string | undefined;
  /** Actors written into the file for the first time. */
  readonly added: readonly string[];
  /** Actors the file already held, with nothing about them changed. */
  readonly unchanged: readonly string[];
  /** Actors whose profile the file held and this run refreshed. */
  readonly refreshed: readonly string[];
  /**
   * Actors that could not be turned into followers, and why.
   *
   * Reported rather than fatal: an instance that is down, or an account that
   * has been deleted, must not stop the other hundred followers from coming
   * across, and the owner can run the command again once it is back.
   */
  readonly failed: readonly UnreachableFollower[];
}

/** What the run did. */
export interface ImportWordPressActorReport {
  /** Who was imported. */
  readonly username: string;
  /** The id their followers hold. */
  readonly actorId: string;
  /** The number the plugin's paths are built from. */
  readonly wordpressActorId: number;
  /**
   * Whether the two ids had to be written, or the record already said so.
   */
  readonly identity: 'set' | 'unchanged';
  /** One entry per key file, RSA first, as the key loader orders them. */
  readonly keys: readonly ImportedKey[];
  /** What came of the followers collection. */
  readonly followers: FollowersImportReport;
  /** Whether anything on disk is different because of this run. */
  readonly changed: boolean;
}

/**
 * Thrown when the user already has a key pair and this run was not told to
 * replace it.
 *
 * Its own class because the answer is a flag rather than a correction, and
 * because losing a private key is the one mistake this CMS cannot help with:
 * every follower's server has cached the public half, and a new key means none
 * of them can verify this person again.
 */
export class ExistingKeyPairError extends Error {
  override readonly name = 'ExistingKeyPairError';
  /** The file that is already there. */
  readonly file: string;

  constructor(username: string, file: string) {
    super(
      `${username} already has a different key pair, in ${file}. Importing over it would ` +
        'change their identity: every follower has cached the public half of the key that is ' +
        'there, and none of them could verify this person again. Pass --force only if you are ' +
        'sure the pair being imported is the one the followers hold.',
    );
    this.file = file;
  }
}

/** Thrown when the PEM is not an RSA private key at all. */
export class UnusableKeyPemError extends Error {
  override readonly name = 'UnusableKeyPemError';

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
  }
}

/**
 * Bring one WordPress actor's key pair across, and say what changed.
 *
 * Run twice with the same inputs it changes nothing and says so, which is what
 * makes it safe to run again after a follower's server was down.
 */
export async function importWordPressActor(
  options: ImportWordPressActorOptions,
): Promise<ImportWordPressActorReport> {
  const { dataDir, username } = options;

  // Everything that can be refused is decided before anything is written, so a
  // run that is going to stop stops with the disk as it was.
  const planned = await planKeyImport(options);

  const identity = (await setUserWordPressActor({
    dataDir,
    username,
    actorId: options.actorId,
    wordpressActorId: options.wordpressActorId,
  }))
    ? 'set'
    : 'unchanged';

  const keys = [applyKeyImport(dataDir, username, planned)];

  // The Ed25519 pair is minted here rather than left to the first request,
  // because this is also what proves the file just written imports: Fedify
  // swallows what a key pairs dispatcher throws, so an unusable key found at
  // request time would be found by nobody.
  const ed25519File = actorKeyFile(dataDir, username, 'Ed25519');
  const hadEd25519 = readFileIfPresentSync(ed25519File) !== undefined;
  await loadActorKeyPairs(dataDir, username);
  keys.push({
    file: ed25519File,
    algorithm: 'Ed25519',
    state: hadEd25519 ? 'unchanged' : 'generated',
  });

  const followers = await importFollowers(options);

  return {
    username,
    actorId: options.actorId,
    wordpressActorId: options.wordpressActorId,
    identity,
    keys,
    followers,
    changed:
      identity === 'set' ||
      keys.some((key) => key.state !== 'unchanged') ||
      followers.added.length > 0 ||
      followers.refreshed.length > 0,
  };
}

/**
 * Bring the followers across: read the collection, work out who each item is,
 * and put them in the user's `followers.json` and the index.
 *
 * The plugin's collection carries nothing but a `first` page, and the page's
 * `orderedItems` are bare actor URLs, so almost every follower here costs one
 * fetch. That is the one step of the import that is really a network
 * operation, which is why it can be pointed at a file instead: an owner who
 * saved the collection before the DNS moved has everything they need offline.
 *
 * {@link addFollower} is what writes, so a follower already in the file keeps
 * the place and the follow time it has — running this again after an instance
 * came back adds the missing people and moves nobody.
 */
async function importFollowers(
  options: ImportWordPressActorOptions,
): Promise<FollowersImportReport> {
  const empty: FollowersImportReport = {
    source: undefined,
    added: [],
    unchanged: [],
    refreshed: [],
    failed: [],
  };
  if (options.followers === false) return empty;

  const { admin, contentDir, username } = options;
  const source = options.followers ?? followersCollectionUrl(options);
  const added: string[] = [];
  const unchanged: string[] = [];
  const refreshed: string[] = [];
  const failed: UnreachableFollower[] = [];

  for (const item of await collectionItems(source)) {
    const actor = uriOf(item) ?? String(item);
    try {
      const document =
        isRecord(item) && uriOf(item['inbox']) !== null ? item : await fetchAs(actor);
      const follower = followerFrom(document);
      const held = readFollowers(contentDir, username).find(
        (entry) => entry.actorId === follower.actorId,
      );
      await addFollower({ admin, contentDir }, username, follower);

      if (held === undefined) added.push(follower.actorId);
      else if (sameFollower(held, follower)) unchanged.push(follower.actorId);
      else refreshed.push(follower.actorId);
    } catch (error) {
      failed.push({ actor, reason: messageOf(error) });
    }
  }

  return { source, added, unchanged, refreshed, failed };
}

/**
 * The plugin's public followers collection for this actor.
 *
 * Built from the stored actor id's own origin rather than from anything the
 * command was told separately: the id is the one URL an owner is certain to
 * have right, and it is the site the followers are still pointed at.
 */
function followersCollectionUrl(options: ImportWordPressActorOptions): string {
  const number = String(options.wordpressActorId);
  return new URL(`/wp-json/activitypub/1.0/actors/${number}/followers`, options.actorId).href;
}

/**
 * Everything a followers collection names, in the order it names them.
 *
 * A collection with no items of its own is followed through `first`, and a
 * page through `next`, until there is nowhere left to go; either may be a URL
 * to fetch or a page already embedded in the document. URLs already visited
 * are not visited again, because a server whose `next` points back at itself
 * would otherwise be an endless import.
 */
async function collectionItems(source: string): Promise<unknown[]> {
  const items: unknown[] = [];
  const seen = new Set<string>();
  let document: unknown = isUrl(source) ? await fetchAs(source) : readJsonFile(source);
  if (isUrl(source)) seen.add(source);

  while (isRecord(document)) {
    const listed: unknown = document['orderedItems'] ?? document['items'];
    const here: unknown[] | undefined = Array.isArray(listed) ? (listed as unknown[]) : undefined;
    if (here !== undefined) items.push(...here);

    // `next` on a page; `first` only when this document listed nothing itself,
    // which is the plugin's outer collection.
    const onward = document['next'] ?? (here === undefined ? document['first'] : undefined);
    if (onward === undefined || onward === null) break;
    if (isRecord(onward)) {
      document = onward;
      continue;
    }

    const url = uriOf(onward);
    if (url === null || seen.has(url)) break;
    seen.add(url);
    document = await fetchAs(url);
  }

  return items;
}

/** A saved collection, as the JSON it holds. */
function readJsonFile(file: string): unknown {
  const source = readFileIfPresentSync(file);
  if (source === undefined) {
    throw new Error(`There is no followers collection at ${file}.`);
  }
  try {
    return JSON.parse(source);
  } catch (error) {
    throw new Error(`${file} could not be read as JSON: ${messageOf(error)}`, { cause: error });
  }
}

/** Whether a `--followers` value is a URL to fetch rather than a file to read. */
function isUrl(source: string): boolean {
  try {
    const url = new URL(source);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/** What a peer should ask a fediverse server for. */
const ACTIVITY_STREAMS_ACCEPT =
  'application/activity+json, application/ld+json; profile="https://www.w3.org/ns/activitystreams"';

/** One ActivityStreams document, or a thrown error naming the URL and the status. */
async function fetchAs(url: string): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, { headers: { accept: ACTIVITY_STREAMS_ACCEPT } });
  } catch (error) {
    throw new Error(`${url} could not be fetched: ${messageOf(error)}`, { cause: error });
  }
  if (!response.ok) {
    throw new Error(`${url} answered ${String(response.status)} ${response.statusText}`.trim());
  }
  try {
    return await response.json();
  } catch (error) {
    throw new Error(`${url} did not answer with JSON: ${messageOf(error)}`, { cause: error });
  }
}

/**
 * One actor document as the follower it stands for.
 *
 * Read straight out of the JSON rather than through Fedify's vocabulary,
 * because this is the one place in the CMS that has a plain document and no
 * federation context to dereference with. The six fields are the ones
 * `followers.json` holds (doc-4): two to deliver with, four to show.
 */
function followerFrom(document: unknown): Omit<NewFollower, 'username'> {
  if (!isRecord(document)) throw new Error('that is not an actor document');

  const actorId = uriOf(document['id']);
  const inboxId = uriOf(document['inbox']);
  if (actorId === null) throw new Error('that actor document has no id');
  if (inboxId === null) throw new Error(`${actorId} publishes no inbox to deliver to`);

  const endpoints = document['endpoints'];
  const icon = document['icon'];

  return {
    actorId,
    inboxId,
    sharedInboxId: isRecord(endpoints) ? uriOf(endpoints['sharedInbox']) : null,
    handle: handleOf(document, actorId),
    name: textOf(document['name']) ?? null,
    iconUrl: uriOf(isRecord(icon) ? icon['url'] : icon),
    url: uriOf(document['url']),
  };
}

/**
 * `@name@host` for an actor, from its `preferredUsername` where it has one.
 *
 * Falling back to {@link actorHandle}, which guesses from the URL, for the
 * server that publishes no `preferredUsername` at all.
 */
function handleOf(document: Record<string, unknown>, actorId: string): string | null {
  const preferred = textOf(document['preferredUsername']);
  if (preferred === undefined || preferred === '') return actorHandle(actorId) ?? null;
  try {
    return `@${preferred.replace(/^@/, '')}@${new URL(actorId).host}`;
  } catch {
    return null;
  }
}

/** Whether a stored follower already says everything this one does. */
function sameFollower(held: Follower, incoming: Omit<NewFollower, 'username'>): boolean {
  return (
    held.inboxId === incoming.inboxId &&
    held.sharedInboxId === incoming.sharedInboxId &&
    held.handle === incoming.handle &&
    held.name === incoming.name &&
    held.iconUrl === incoming.iconUrl &&
    held.url === incoming.url
  );
}

/** A JSON-LD string value, which may be wrapped in a language map. */
function textOf(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = textOf(item);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (isRecord(value)) return textOf(value['@value']);
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A key file's contents and what writing them would amount to. */
interface PlannedKey extends ImportedKey {
  /** The JWK to write, or `undefined` when the file already holds it. */
  readonly jwk: string | undefined;
}

/**
 * Work out what the exported PEM means for
 * `data/keys/{username}.rsassa-pkcs1-v1_5.jwk`, without touching it.
 *
 * A file already holding this very key is left alone and reported unchanged —
 * that is what makes the whole command idempotent — and one holding a
 * different key is refused unless the run was told to replace it.
 */
async function planKeyImport(options: ImportWordPressActorOptions): Promise<PlannedKey> {
  const { dataDir, username } = options;
  const privateKey = privateKeyFrom(options.privateKeyPem);
  assertPairMatches(privateKey, options.publicKeyPem);

  const jwk = `${JSON.stringify(await privateJwkOf(privateKey), undefined, 2)}\n`;
  const file = actorKeyFile(dataDir, username, RSA);
  const held = readFileIfPresentSync(file);

  if (held === undefined) return { file, algorithm: RSA, state: 'imported', jwk };
  if (sameKeyFile(held, jwk)) return { file, algorithm: RSA, state: 'unchanged', jwk: undefined };
  if (options.force !== true) throw new ExistingKeyPairError(username, file);
  return { file, algorithm: RSA, state: 'replaced', jwk };
}

/** Carry out what {@link planKeyImport} decided. */
function applyKeyImport(dataDir: string, username: string, planned: PlannedKey): ImportedKey {
  const { jwk, ...key } = planned;
  if (jwk !== undefined) writeActorKeyFile(dataDir, username, key.algorithm, jwk);
  return key;
}

/**
 * The PEM as a key object, whichever of the two encodings the export used.
 *
 * PHP writes `-----BEGIN PRIVATE KEY-----` (PKCS#8) on OpenSSL 3 and
 * `-----BEGIN RSA PRIVATE KEY-----` (PKCS#1) on older builds, and an owner
 * copying one out of `wp option get` has no reason to know which they have.
 * `createPrivateKey` reads both.
 */
function privateKeyFrom(pem: string): KeyObject {
  const text = pem.trim();
  if (text === '') {
    throw new UnusableKeyPemError('The private key is empty. Check what the export wrote.');
  }

  let key: KeyObject;
  try {
    key = createPrivateKey({ key: text, format: 'pem' });
  } catch (error) {
    throw new UnusableKeyPemError(
      `That is not a PEM private key: ${messageOf(error)}. It should begin with ` +
        '"-----BEGIN PRIVATE KEY-----" or "-----BEGIN RSA PRIVATE KEY-----".',
      { cause: error },
    );
  }

  if (key.asymmetricKeyType !== 'rsa') {
    throw new UnusableKeyPemError(
      `That is a ${String(key.asymmetricKeyType)} key, and the WordPress ActivityPub plugin ` +
        'signs with RSA. Check that the right key was exported.',
    );
  }
  return key;
}

/** Refuse an export whose two halves are not halves of one pair. */
function assertPairMatches(privateKey: KeyObject, publicKeyPem: string | undefined): void {
  const text = (publicKeyPem ?? '').trim();
  if (text === '') return;

  let given: KeyObject;
  try {
    given = createPublicKey({ key: text, format: 'pem' });
  } catch (error) {
    throw new UnusableKeyPemError(`That is not a PEM public key: ${messageOf(error)}.`, {
      cause: error,
    });
  }

  const derived = createPublicKey(privateKey);
  if (
    !given
      .export({ type: 'spki', format: 'der' })
      .equals(derived.export({ type: 'spki', format: 'der' }))
  ) {
    throw new UnusableKeyPemError(
      'The public and private keys are not two halves of one pair. Export both again from the ' +
        'same WordPress user, or leave the public key off — it is derived from the private one.',
    );
  }
}

/**
 * The private JWK the key file holds, produced the way a generated one is.
 *
 * The PEM goes to DER through node:crypto, into WebCrypto, and out through
 * Fedify's `exportJwk` — the same call `loadActorKeyPairs` makes when it mints
 * a pair. Going the long way round rather than asking node:crypto for the JWK
 * directly is what guarantees an imported file and a generated one carry the
 * same members in the same shape, `alg: "RS256"` included, which is what the
 * loader's boot check insists on.
 */
async function privateJwkOf(privateKey: KeyObject): Promise<JsonWebKey> {
  const pkcs8 = privateKey.export({ type: 'pkcs8', format: 'der' });
  const key = await crypto.subtle.importKey('pkcs8', pkcs8, { name: RSA, hash: 'SHA-256' }, true, [
    'sign',
  ]);
  return await exportJwk(key);
}

/**
 * Whether a key file already holds the key being imported.
 *
 * Compared as the parsed JWK rather than as bytes, so a file somebody
 * reindented is still the same key.
 */
function sameKeyFile(held: string, incoming: string): boolean {
  try {
    return (
      JSON.stringify(JSON.parse(held) as unknown) ===
      JSON.stringify(JSON.parse(incoming) as unknown)
    );
  } catch {
    return false;
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
