import { exportJwk, generateCryptoKeyPair, importJwk } from '@fedify/fedify';

import { ACTOR_KEY_ALGORITHMS } from '../admin/store.ts';
import type { ActorKeyAlgorithm, AdminStore } from '../admin/store.ts';

/**
 * The site actor's internal identifier.
 *
 * Fedify keys actors by an identifier rather than by handle, and the two are
 * deliberately not the same thing here: the handle is a setting somebody may
 * change, while the identifier is what the actor's id, its inbox, its outbox
 * and its stored keys are all built from. Renaming `@blog@example.com` to
 * `@notes@example.com` therefore leaves every URL — and every follower — alone.
 */
export const SITE_ACTOR_IDENTIFIER = 'actor';

/**
 * The actor's key pairs, generated on the first call and read from SQLite on
 * every one after that.
 *
 * Both of {@link ACTOR_KEY_ALGORITHMS} are returned, in that order, which is
 * the order Fedify wants them in: the RSA pair signs HTTP Signatures for
 * Mastodon and friends, the Ed25519 pair signs FEP-8b32 integrity proofs.
 *
 * A stored pair that will not import — a half-written row, a key from a JWK
 * shape that has since changed — is replaced rather than thrown, so a damaged
 * table heals on the next boot instead of wedging every boot after it. That
 * costs the site its old key for that algorithm, which is why the two are
 * stored and healed independently.
 */
export async function loadActorKeyPairs(
  store: AdminStore,
  identifier: string,
): Promise<CryptoKeyPair[]> {
  const stored = new Map(store.listActorKeys(identifier).map((key) => [key.algorithm, key]));
  const pairs: CryptoKeyPair[] = [];

  for (const algorithm of ACTOR_KEY_ALGORITHMS) {
    const row = stored.get(algorithm);
    const imported =
      row === undefined ? undefined : await importPair(row.privateJwk, row.publicJwk);
    pairs.push(imported ?? (await generatePair(store, identifier, algorithm)));
  }

  return pairs;
}

/** A stored pair as `CryptoKey`s, or `undefined` when it will not import. */
async function importPair(
  privateJwk: string,
  publicJwk: string,
): Promise<CryptoKeyPair | undefined> {
  try {
    return {
      privateKey: await importJwk(JSON.parse(privateJwk) as JsonWebKey, 'private'),
      publicKey: await importJwk(JSON.parse(publicJwk) as JsonWebKey, 'public'),
    };
  } catch {
    return undefined;
  }
}

/** A fresh pair, written to the store before it is handed back. */
async function generatePair(
  store: AdminStore,
  identifier: string,
  algorithm: ActorKeyAlgorithm,
): Promise<CryptoKeyPair> {
  const pair = await generateCryptoKeyPair(algorithm);
  store.putActorKey({
    identifier,
    algorithm,
    privateJwk: JSON.stringify(await exportJwk(pair.privateKey)),
    publicJwk: JSON.stringify(await exportJwk(pair.publicKey)),
  });
  return pair;
}
