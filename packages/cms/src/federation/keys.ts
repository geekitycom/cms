import { mkdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { exportJwk, generateCryptoKeyPair, importJwk } from '@fedify/fedify';

import type { AdminStore } from '../admin/store.ts';
import {
  readFileIfPresentSync,
  updateFileAtomically,
  writeFileAtomicallySync,
} from '../files/atomic.ts';

/**
 * The algorithms an actor holds a key pair for, in the order Fedify wants them:
 * the RSA pair signs HTTP Signatures for Mastodon and friends, the Ed25519
 * pair signs FEP-8b32 integrity proofs.
 */
export const ACTOR_KEY_ALGORITHMS = ['RSASSA-PKCS1-v1_5', 'Ed25519'] as const;

/** One of {@link ACTOR_KEY_ALGORITHMS}. */
export type ActorKeyAlgorithm = (typeof ACTOR_KEY_ALGORITHMS)[number];

/** Where an actor's key files live: `data/keys`, beside the disposable index. */
export function actorKeysDir(dataDir: string): string {
  return path.join(dataDir, 'keys');
}

/**
 * The file one key pair lives in, e.g. `data/keys/ada.ed25519.jwk`.
 *
 * The identifier is the user's username (decision-14), which is also what
 * their actor id is built from, so a site can tell at a glance whose key a
 * file is; and the algorithm is in the name too, so the two pairs are
 * independent files that can be backed up, restored and regenerated one at a
 * time.
 *
 * `algorithm` is a bare string rather than an {@link ActorKeyAlgorithm}, for
 * the migration's sake: a row written by a version that knows an algorithm
 * this one does not still has to reach a file before the table is dropped.
 */
export function actorKeyFile(dataDir: string, identifier: string, algorithm: string): string {
  return path.join(actorKeysDir(dataDir), `${fileToken(identifier)}.${fileToken(algorithm)}.jwk`);
}

/**
 * One user's key pairs, generated on the first call and read from
 * `data/keys` on every one after that.
 *
 * Both of {@link ACTOR_KEY_ALGORITHMS} are returned, in that order. Each file
 * holds the private JWK alone, because the public key is derivable from it:
 * one file per pair is one thing to back up and one thing that cannot fall
 * half out of step with itself.
 *
 * A file that will not import is thrown over rather than replaced (decision-9).
 * The old code healed a damaged row by generating a new pair, which is exactly
 * the wrong thing to do with an identity: every follower holds the public key
 * and would stop verifying the site's posts. A site that really does want a
 * new key deletes the file, which is a deliberate act rather than an accident
 * of a half-written byte.
 */
export async function loadActorKeyPairs(
  dataDir: string,
  identifier: string,
): Promise<CryptoKeyPair[]> {
  const pairs: CryptoKeyPair[] = [];
  for (const algorithm of ACTOR_KEY_ALGORITHMS) {
    pairs.push(await loadPair(dataDir, identifier, algorithm));
  }
  return pairs;
}

/**
 * Turn an older site's `actor_keys` rows into files under `data/keys`, once,
 * and drop the table.
 *
 * The rows this writes out are the site actor's, which no version after
 * TASK-68 has: decision-14 replaced it with one actor per user, and a user's
 * keys are named after their username rather than after the sentinel `actor`.
 * The files are still written rather than dropped on the floor, because a
 * private key is the one thing this CMS never deletes for somebody — an
 * operator who wants the old identity back has it on disk to move.
 *
 * This is the migration decision-9 calls the one that must not fail. Settings
 * a site could type again and followers a site could ask for again; an actor's
 * private key is the site's identity, and losing it means every follower's
 * cached public key stops verifying its posts for good. So the rows are
 * written out before the table goes, never after, and a file that is already
 * there always wins — a site that has booted this version once has the truth
 * on disk, and a row left over from before it did must not overwrite it.
 *
 * Synchronous because `createCms` is: it runs before the server is listening
 * and before anything has asked for a key.
 */
export function migrateActorKeysToFiles(options: { admin: AdminStore; dataDir: string }): void {
  const { admin, dataDir } = options;
  const rows = admin.legacyActorKeys();

  if (rows !== undefined && rows.length > 0) {
    ensureKeysDir(dataDir);
    for (const row of rows) {
      const file = actorKeyFile(dataDir, row.identifier, row.algorithm);
      // Only the private half is written: the public one is derived from it,
      // and a stored pair whose halves disagreed would be worse than none. The
      // row is written out as it stands, byte for byte apart from the trailing
      // newline every file here ends with — a key is not something to
      // re-encode on the way past.
      if (readFileIfPresentSync(file) === undefined) {
        writeFileAtomicallySync(file, `${row.privateJwk.trimEnd()}\n`, { mode: KEY_FILE_MODE });
      }
    }
  }

  // Dropped whether or not it had rows: a fresh database gets the table from
  // migration 4, which has shipped and so is never edited, and a site that has
  // been migrated must not be asked again on the next boot.
  admin.dropLegacyTable('actor_keys');
}

/**
 * Refuse to boot on a key file that is there but is not a key.
 *
 * `loadActorKeyPairs` throws over such a file, but nothing useful happens to
 * that throw: Fedify catches whatever the key pairs dispatcher raises and
 * hands back an empty list, so the site would go on answering with an actor
 * that publishes no `publicKey` and no `assertionMethod` — unverifiable to
 * every follower, and silent about it. Boot is where that is caught instead,
 * and refusing to start is the report: a site is down for a minute and the
 * message names the file to restore, rather than up for a week signing
 * nothing.
 *
 * The checks are the ones `importJwk` makes, minus the arithmetic, because
 * they are all that can be made without an `await` inside a synchronous boot.
 * That is enough for every way a key file really goes wrong — truncated by a
 * crash, emptied, replaced by something that is not a key at all. A JWK that
 * is well formed and still will not import is left to
 * {@link loadActorKeyPairs}, which throws the same error with the same advice.
 */
export function assertActorKeysUsable(dataDir: string, identifier: string): void {
  for (const algorithm of ACTOR_KEY_ALGORITHMS) {
    const file = actorKeyFile(dataDir, identifier, algorithm);
    const contents = readFileIfPresentSync(file);
    // Absent is not damaged: the first boot of a new site has no key files at
    // all, and the first actor request writes them.
    if (contents === undefined) continue;

    let jwk: unknown;
    try {
      jwk = JSON.parse(contents);
    } catch (error) {
      throw unusableKey(file, error);
    }

    const problem = jwkProblem(jwk, algorithm);
    if (problem !== undefined) throw unusableKey(file, new Error(problem));
  }
}

/** What is wrong with a parsed key file, or `undefined` when nothing is. */
function jwkProblem(jwk: unknown, algorithm: ActorKeyAlgorithm): string | undefined {
  if (typeof jwk !== 'object' || jwk === null) return 'it is not a JSON object';
  const key = jwk as Record<string, unknown>;
  const has = (member: string): boolean => typeof key[member] === 'string';

  if (!has('d')) return 'it carries no private key: a JWK with no "d" is only the public half';

  if (algorithm === 'RSASSA-PKCS1-v1_5') {
    if (key['kty'] !== 'RSA') return `its "kty" is ${JSON.stringify(key['kty'])}, not "RSA"`;
    if (key['alg'] !== 'RS256') return `its "alg" is ${JSON.stringify(key['alg'])}, not "RS256"`;
    if (!has('n') || !has('e')) return 'an RSA key needs both "n" and "e"';
    return undefined;
  }

  if (key['kty'] !== 'OKP') return `its "kty" is ${JSON.stringify(key['kty'])}, not "OKP"`;
  if (key['crv'] !== 'Ed25519') {
    return `its "crv" is ${JSON.stringify(key['crv'])}, not "Ed25519"`;
  }
  if (!has('x')) return 'an Ed25519 key needs an "x"';
  return undefined;
}

/** One algorithm's pair: the file's, or a new one written to the file. */
async function loadPair(
  dataDir: string,
  identifier: string,
  algorithm: ActorKeyAlgorithm,
): Promise<CryptoKeyPair> {
  const file = actorKeyFile(dataDir, identifier, algorithm);
  const stored = await readIfPresent(file);
  if (stored !== undefined) return await importPair(file, stored);

  // Absent: generate. The write goes through the queue and looks again inside
  // it, so two first calls racing each other cannot each mint a key and leave
  // the site publishing one it does not hold.
  let jwk = '';
  ensureKeysDir(dataDir);
  await updateFileAtomically(
    file,
    async (current) => {
      if (current !== undefined) {
        jwk = current;
        return current;
      }
      const pair = await generateCryptoKeyPair(algorithm);
      jwk = `${JSON.stringify(await exportJwk(pair.privateKey), undefined, 2)}\n`;
      return jwk;
    },
    { mode: KEY_FILE_MODE },
  );

  return await importPair(file, jwk);
}

/** A file's contents, or `undefined` when it is not there. */
async function readIfPresent(file: string): Promise<string | undefined> {
  try {
    return await readFile(file, 'utf8');
  } catch {
    return undefined;
  }
}

/**
 * The pair a stored private JWK stands for, or a thrown error naming the file.
 *
 * The public half is derived rather than stored: the private JWK carries every
 * public member already, so dropping the private ones leaves exactly the
 * public key. Nothing else could be true — a stored public key that disagreed
 * with the private one would be a site signing with a key nobody could check.
 */
async function importPair(file: string, contents: string): Promise<CryptoKeyPair> {
  let jwk: JsonWebKey;
  try {
    jwk = JSON.parse(contents) as JsonWebKey;
  } catch (error) {
    throw unusableKey(file, error);
  }

  try {
    return {
      privateKey: await importJwk(jwk, 'private'),
      publicKey: await importJwk(publicHalfOf(jwk), 'public'),
    };
  } catch (error) {
    throw unusableKey(file, error);
  }
}

/**
 * The public members of a JWK, and only those.
 *
 * `d`, `p`, `q`, `dp`, `dq` and `qi` are the private ones; `key_ops` has to go
 * too, because a key exported for signing says `["sign"]` and importing it for
 * verification with that still on it is refused.
 */
function publicHalfOf(jwk: JsonWebKey): JsonWebKey {
  const publicMembers = ['kty', 'alg', 'crv', 'n', 'e', 'x'] as const;
  const half: JsonWebKey = {};
  for (const member of publicMembers) {
    if (jwk[member] !== undefined) half[member] = jwk[member];
  }
  return half;
}

/** The error a key file that will not import raises, with what to do about it. */
function unusableKey(file: string, cause: unknown): Error {
  return new Error(
    `The actor key file ${file} could not be read as a JWK private key: ` +
      `${cause instanceof Error ? cause.message : String(cause)}. ` +
      'It has deliberately not been replaced, because a new key would change the ' +
      'actor’s identity and every follower would stop verifying the site. Restore ' +
      'the file from a backup, or delete it to ask for a new key on purpose.',
    { cause },
  );
}

/** The permissions a private key file is created and rewritten with. */
const KEY_FILE_MODE = 0o600;

/** The permissions `data/keys` is created with, when this is what creates it. */
const KEYS_DIR_MODE = 0o700;

/**
 * The part of a file name one identifier or algorithm contributes.
 *
 * Lower case, because `RSASSA-PKCS1-v1_5` on a case-insensitive filesystem is
 * the same file as `rsassa-pkcs1-v1_5` and only one of them should ever be
 * written; and anything that is not a letter, a digit, a dash or an underscore
 * becomes a dash, so nothing a name carries — a dot, a slash, a `..` — can
 * reach out of `data/keys` or split the file name into more parts than it has.
 */
function fileToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
}

/**
 * Make `data/keys` before anything is written into it, so it exists with the
 * permissions a directory of private keys wants rather than the ones the
 * atomic writer's `mkdir -p` would give it.
 */
function ensureKeysDir(dataDir: string): void {
  mkdirSync(actorKeysDir(dataDir), { recursive: true, mode: KEYS_DIR_MODE });
}
