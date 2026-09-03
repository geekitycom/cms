import type { Context, RequestContext } from '@fedify/fedify';
import { Application, Endpoints, Group, Image, Organization, Person, Service } from '@fedify/vocab';
import type { Actor } from '@fedify/vocab';

import { ACTOR_TYPES, DEFAULT_SITE_SETTINGS } from '../admin/settings.ts';
import type { SiteSettings } from '../admin/settings.ts';

/**
 * The vocabulary class behind each of {@link ACTOR_TYPES}.
 *
 * The setting is a string, because it is a form field and a SQLite row; this
 * is where it becomes the class the actor document is built from.
 */
export const ACTOR_CLASSES = {
  Person,
  Organization,
  Service,
  Group,
  Application,
} as const satisfies Record<string, new (values: Record<string, never>) => Actor>;

/**
 * The settings key an avatar URL lives under.
 *
 * There is no avatar field on {@link SiteSettings} yet — no screen uploads one
 * — so federation reads the raw key instead, and the actor simply has no
 * `icon` until something writes it. That keeps the settings form, its
 * validator and its `site.json` mirror out of this task while leaving the
 * actor's `icon` wired up for whichever one adds the upload.
 */
export const AVATAR_SETTING = 'avatar';

/** What {@link siteActor} needs beyond the Fedify context. */
export interface SiteActorOptions {
  /** The settings the profile is built from. */
  settings: SiteSettings;
  /** Absolute URL of the site's avatar, when it has one. */
  avatarUrl?: string | undefined;
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
  const keys = await context.getActorKeyPairs(identifier);
  const ActorClass = actorClassFor(settings.actorType);

  return new ActorClass({
    id: context.getActorUri(identifier),
    preferredUsername: settings.actorHandle,
    name: settings.title,
    summary: settings.tagline === '' ? null : settings.tagline,
    url: absoluteUrl(settings.baseUrl),
    icon:
      options.avatarUrl === undefined || options.avatarUrl === ''
        ? null
        : new Image({ url: absoluteUrl(options.avatarUrl) }),
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
function absoluteUrl(value: string): URL | null {
  if (value === '') return null;
  try {
    return new URL(value);
  } catch {
    return null;
  }
}
