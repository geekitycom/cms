import type { Context, RequestContext, SenderKeyPair } from '@fedify/fedify';
import { CryptographicKey, Endpoints, Image, Multikey, Person, PropertyValue } from '@fedify/vocab';
import type { Actor } from '@fedify/vocab';

import { listUsers } from '../admin/accounts.ts';
import type { User } from '../admin/accounts.ts';
import { authorHref, profileContext } from '../web/authors.ts';
import { absoluteUrl } from '../web/negotiate.ts';
import { handleHref } from './paths.ts';

/**
 * A user as the fediverse sees them (decision-14).
 *
 * Everything a peer reads about a person is built here, off one rule: the
 * actor's id is the author URL, and every other id — the key, the multikey,
 * the aliases — hangs off that same value rather than being spelled again.
 * {@link actorId} is where that value is decided, and it is the only thing
 * TASK-69 has to change to serve a user under the id they had elsewhere.
 */

/**
 * One user by their username, or `undefined` when nobody has it.
 *
 * The username is the Fedify identifier (decision-14), so this is what every
 * dispatcher and every inbox handler starts with: an identifier nobody answers
 * to is `null` back to Fedify, which is a 404, rather than an empty collection.
 */
export function userByUsername(dataDir: string, username: string): User | undefined {
  return listUsers(dataDir).find((user) => user.username === username);
}

/**
 * An avatar as the absolute URL an `icon` carries, or `undefined` when there
 * is none.
 *
 * A profile holds what the upload endpoint handed back —
 * `/uploads/2026/09/me.png` — because that is where the site serves the file
 * and where an Eleventy build of the same content copies it through to. A peer
 * reading the actor has no site to resolve that against, so it is made
 * absolute here. One already given as an absolute URL is left alone.
 */
export function avatarUrl(avatar: string, baseUrl: string): string | undefined {
  const value = avatar.trim();
  if (value === '') return undefined;
  if (urlOrNull(value) !== null) return value;
  if (baseUrl === '') return undefined;

  try {
    return absoluteUrl(value, baseUrl);
  } catch {
    return undefined;
  }
}

/**
 * One user's ActivityStreams id.
 *
 * The author URL, which is what Fedify derives from the dispatcher path, so
 * today this is `ctx.getActorUri(user.username)` and nothing else. It is a
 * function of its own because decision-14 says a user record may carry the
 * actor id they had elsewhere, and that id is identity rather than cache: when
 * TASK-69 lands, this answers the stored id where there is one and the derived
 * one where there is not, and every id built from it — the key id, the
 * multikey, the `actor` of every activity, the sender key pairs — follows
 * without another line changing (doc-8).
 */
export function actorId(context: Context<unknown>, user: User): URL {
  return context.getActorUri(user.username);
}

/**
 * The keys a user signs with, as the sender Fedify is handed.
 *
 * An explicit list rather than `{ identifier }`, which is the whole point:
 * Fedify derives a key id from the dispatcher path and would go on doing so
 * under a stored actor id, signing with a key id no peer could dereference.
 * Built from {@link actorId} instead, so the `Signature-Input` header and the
 * integrity proof name keys the actor document really publishes.
 *
 * The order is {@link ACTOR_KEY_ALGORITHMS}: RSA first, which Mastodon
 * verifies HTTP Signatures with and which is `#main-key`; then Ed25519, whose
 * multikey Fedify numbers `#multikey-1` because RSA took slot zero.
 */
export async function senderKeyPairs(
  context: Context<unknown>,
  user: User,
): Promise<SenderKeyPair[]> {
  const id = actorId(context, user);
  const keys = await context.getActorKeyPairs(user.username);

  return keys.map((key, index) => ({
    keyId: keyIdFor(id, index),
    privateKey: key.privateKey,
  }));
}

/**
 * The id a signature names for one of an actor's keys.
 *
 * The RSA pair signs HTTP Signatures and is published as `publicKey`, which
 * every peer looks for at `#main-key`; the rest sign FEP-8b32 proofs and are
 * named by the multikey they are published as.
 */
export function keyIdFor(id: URL, index: number): URL {
  return index === 0 ? mainKeyId(id) : multikeyId(id, index);
}

/** `{actor}#main-key`: the RSA key a peer verifies an HTTP Signature with. */
export function mainKeyId(id: URL): URL {
  return new URL(`${id.href}#main-key`, id);
}

/**
 * `{actor}#multikey-{n}`: one entry of `assertionMethod`.
 *
 * Fedify numbers its own multikeys in `ACTOR_KEY_ALGORITHMS` order, so RSA is
 * 0 and Ed25519 is 1 (doc-8), and the numbering is kept because a peer that
 * cached the document holds these ids.
 */
export function multikeyId(id: URL, index: number): URL {
  return new URL(`${id.href}#multikey-${String(index)}`, id);
}

/** The three URLs a user answers to, which WebFinger and `alsoKnownAs` list. */
export function actorAliases(context: Context<unknown>, user: User, baseUrl: string): URL[] {
  const aliases = [
    actorId(context, user),
    new URL(absoluteUrl(handleHref(user.username), baseUrl)),
  ];
  const archive = new URL(absoluteUrl(authorHref(user.username), baseUrl));
  if (!aliases.some((alias) => alias.href === archive.href)) aliases.splice(1, 0, archive);
  return aliases;
}

/** What {@link userActor} needs beyond the Fedify context. */
export interface UserActorOptions {
  /**
   * The base URL actually in effect, which is what the archive URL and the
   * avatar's path are resolved against.
   */
  baseUrl: string;
}

/**
 * One user's ActivityPub actor, as decision-14 describes it.
 *
 * A `Person`, always: a user is a person, and the site is no longer an actor
 * at all, so there is nothing left for the old `actorType` setting to choose
 * between. The profile fields are exactly what the archive prints — the same
 * {@link profileContext} a theme is handed — so the page and the actor cannot
 * say different things about somebody.
 *
 * The keys are built by hand rather than taken from `getActorKeyPairs`, whose
 * `cryptographicKey` and `multikey` carry ids Fedify derived from the
 * dispatcher path. Under a stored actor id those would name keys the document
 * does not publish, and a peer that cannot dereference the key id in a
 * signature rejects the signature (doc-8).
 */
export async function userActor(
  context: RequestContext<unknown> | Context<unknown>,
  user: User,
  options: UserActorOptions,
): Promise<Actor> {
  const { baseUrl } = options;
  const profile = profileContext(user);
  const id = actorId(context, user);
  const icon = profile.avatar === undefined ? undefined : avatarUrl(profile.avatar, baseUrl);

  const keys = await context.getActorKeyPairs(user.username);
  // Fedify catches whatever the key pairs dispatcher throws and hands back an
  // empty list, so this is the only place a key file damaged since boot can be
  // noticed. An actor document with no `publicKey` is worse than no answer: a
  // peer caches it, and every signature that user makes fails to verify
  // against what the peer holds. Failing the request keeps the last good
  // document in the peer's cache instead.
  if (keys.length === 0) {
    throw new Error(
      `The actor ${user.username} has no usable key pairs. Its key files under the ` +
        'data directory could not be read; see the error the key loader raised. ' +
        'Restore them from a backup, or delete them to ask for new keys on purpose.',
    );
  }

  const rsa = keys[0];

  return new Person({
    id,
    preferredUsername: user.username,
    name: profile.name,
    summary: profile.bio ?? null,
    url: new URL(absoluteUrl(authorHref(user.username), baseUrl)),
    icon: icon === undefined ? null : new Image({ url: new URL(icon) }),
    inbox: context.getInboxUri(user.username),
    outbox: context.getOutboxUri(user.username),
    followers: context.getFollowersUri(user.username),
    following: context.getFollowingUri(user.username),
    endpoints: new Endpoints({ sharedInbox: context.getInboxUri() }),
    // Every URL this person answers to, which is what a peer reads to know
    // that two ids are one account. WordPress's plugin publishes exactly this
    // list, and `@fedify/vocab` serialises it as `alsoKnownAs`.
    aliases: actorAliases(context, user, baseUrl),
    publicKey:
      rsa === undefined
        ? null
        : new CryptographicKey({
            id: mainKeyId(id),
            owner: id,
            publicKey: rsa.publicKey,
          }),
    assertionMethods: keys.map(
      (key, index) =>
        new Multikey({ id: multikeyId(id, index), controller: id, publicKey: key.publicKey }),
    ),
    // Somewhere else this person is, as the property attachments every
    // fediverse client renders under a profile.
    attachments: (profile.links ?? []).map(
      (link) =>
        new PropertyValue({
          name: link.label,
          value: `<a href="${escapeHtml(link.href)}" rel="me nofollow noopener">${escapeHtml(link.href)}</a>`,
        }),
    ),
    // A blog's author accepts every follower, and says so, rather than leaving
    // a client to guess whether a follow will ever be answered.
    manuallyApprovesFollowers: false,
    discoverable: true,
    indexable: true,
  });
}

/** The five characters that cannot travel unescaped inside an attribute. */
function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** A URL, or `null` when the string is empty or is not one. */
function urlOrNull(value: string): URL | null {
  if (value === '') return null;
  try {
    return new URL(value);
  } catch {
    return null;
  }
}
