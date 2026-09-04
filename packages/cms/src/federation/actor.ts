import type { Context, RequestContext } from '@fedify/fedify';
import { Application, Endpoints, Group, Image, Organization, Person, Service } from '@fedify/vocab';
import type { Actor } from '@fedify/vocab';

import { ACTOR_TYPES, DEFAULT_SITE_SETTINGS } from '../admin/settings.ts';
import type { SiteSettings } from '../admin/settings.ts';
import { absoluteUrl } from '../web/negotiate.ts';

/**
 * The vocabulary class behind each of {@link ACTOR_TYPES}.
 *
 * The setting is a string, because it is a form field and a key in
 * `site.json`; this is where it becomes the class the actor document is built
 * from.
 */
export const ACTOR_CLASSES = {
  Person,
  Organization,
  Service,
  Group,
  Application,
} as const satisfies Record<string, new (values: Record<string, never>) => Actor>;

/** What {@link siteActor} needs beyond the Fedify context. */
export interface SiteActorOptions {
  /** The settings the profile is built from. */
  settings: SiteSettings;
  /**
   * The base URL actually in effect, which the settings' own may not be: it is
   * what the avatar's path is resolved against. Defaults to the setting.
   */
  baseUrl?: string | undefined;
}

/**
 * The site's avatar as the absolute URL an `icon` carries, or `undefined` when
 * the site has none.
 *
 * The setting holds what the upload endpoint handed back —
 * `/uploads/2026/09/me.png` — because that is where the site serves the file
 * and where an Eleventy build of the same content copies it through to. A peer
 * reading the actor has no site to resolve that against, so it is made
 * absolute here. An avatar already given as an absolute URL is left alone.
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
 * The site's ActivityPub actor, as doc-4 describes it: one actor for the whole
 * site, whose profile fields are the settings.
 *
 * Every URL comes from the Fedify context rather than from string
 * concatenation, so the ids stay in step with the paths the dispatchers are
 * registered under. The keys come from the key pairs dispatcher: `publicKey`
 * is the RSA one Mastodon verifies HTTP Signatures with, `assertionMethods`
 * are the multikeys FEP-8b32 proofs are checked against.
 */
export async function siteActor(
  context: RequestContext<unknown> | Context<unknown>,
  identifier: string,
  options: SiteActorOptions,
): Promise<Actor> {
  const { settings } = options;
  // The base URL in effect, which is what the profile's own URL and the
  // avatar's are built on; the setting is the fallback for a caller that has
  // no resolved config in hand.
  const baseUrl = options.baseUrl ?? settings.baseUrl;
  const icon = avatarUrl(settings.avatar, baseUrl);
  const keys = await context.getActorKeyPairs(identifier);
  // Fedify catches whatever the key pairs dispatcher throws and hands back an
  // empty list, so this is the only place a key file damaged since boot can be
  // noticed. An actor document with no `publicKey` is worse than no answer: a
  // peer caches it, and every signature the site makes fails to verify against
  // what the peer holds. Failing the request keeps the last good document in
  // the peer's cache instead.
  if (keys.length === 0) {
    throw new Error(
      `The actor ${identifier} has no usable key pairs. Its key files under the ` +
        'data directory could not be read; see the error the key loader raised. ' +
        'Restore them from a backup, or delete them to ask for new keys on purpose.',
    );
  }
  const ActorClass = actorClassFor(settings.actorType);

  return new ActorClass({
    id: context.getActorUri(identifier),
    preferredUsername: settings.actorHandle,
    name: settings.title,
    summary: settings.tagline === '' ? null : settings.tagline,
    url: urlOrNull(baseUrl),
    icon: icon === undefined ? null : new Image({ url: new URL(icon) }),
    inbox: context.getInboxUri(identifier),
    outbox: context.getOutboxUri(identifier),
    followers: context.getFollowersUri(identifier),
    following: context.getFollowingUri(identifier),
    endpoints: new Endpoints({ sharedInbox: context.getInboxUri() }),
    publicKey: keys[0]?.cryptographicKey ?? null,
    assertionMethods: keys.map((key) => key.multikey),
    // A blog actor accepts every follower, and says so, rather than leaving a
    // client to guess whether a follow will ever be answered.
    manuallyApprovesFollowers: false,
    discoverable: true,
    indexable: true,
  });
}

/**
 * The class for an actor type, falling back to the default when the stored
 * setting is one this version does not know.
 */
export function actorClassFor(
  actorType: string,
): (typeof ACTOR_CLASSES)[keyof typeof ACTOR_CLASSES] {
  const known = ACTOR_TYPES.includes(actorType) ? actorType : DEFAULT_SITE_SETTINGS.actorType;
  return ACTOR_CLASSES[known as keyof typeof ACTOR_CLASSES] ?? Person;
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
