import { isActor } from '@fedify/vocab';

import { followerFrom } from '../../federation/inbox.ts';
import { addFollower } from '../../federation/records.ts';
import { siteLoaders } from '../../federation/site-loaders.ts';
import { messageOf } from '../../util/errors.ts';
import { nullable } from '../../util/json-schema.ts';
import { federationContextData } from '../../web/federation-routes.ts';
import { webUrl } from '../../webmention/fetch-public.ts';
import { defineTool } from '../tools.ts';
import { REPAIR } from './schemas.ts';

const INBOXES = {
  type: 'object',
  properties: { inbox: { type: 'string' }, sharedInbox: nullable({ type: 'string' }) },
  required: ['inbox', 'sharedInbox'],
} as const;

export const refreshActor = defineTool({
  name: 'refresh_actor',
  title: 'Refresh a remote actor',
  description:
    'Fetch a remote actor’s document again, signed as the site, and rewrite every follower record of that actor with the inbox, shared inbox, name and avatar it publishes now, keeping when it followed. Updates the stored profile of an actor that is not a follower too. Use it when deliveries fail because an actor moved its inbox. Returns what the actor publishes and each follower record’s inboxes before the refresh.',
  scope: 'repair',
  annotations: REPAIR,
  inputSchema: {
    type: 'object',
    properties: {
      actor: { type: 'string', description: 'The actor’s id, an http or https URL.' },
    },
    required: ['actor'],
    additionalProperties: false,
  },
  outputSchema: {
    type: 'object',
    properties: {
      actorId: { type: 'string' },
      handle: nullable({ type: 'string' }),
      name: nullable({ type: 'string' }),
      inbox: { type: 'string', description: 'The inbox the actor publishes now.' },
      sharedInbox: nullable({ type: 'string', description: 'Its shared inbox now, if any.' }),
      followers: {
        type: 'array',
        description:
          'Each follower record rewritten: the local user followed, and the inboxes it held.',
        items: {
          type: 'object',
          properties: { username: { type: 'string' }, before: INBOXES },
          required: ['username', 'before'],
        },
      },
      profileUpdated: {
        type: 'boolean',
        description:
          'Whether a stored profile of the actor, kept for one who is not a follower, was rewritten.',
      },
    },
    required: ['actorId', 'handle', 'name', 'inbox', 'sharedInbox', 'followers', 'profileUpdated'],
  },
  run: async (args, { site, signal }) => {
    const { admin, config } = site;
    const actorId = args.actor;
    if (webUrl(actorId) === undefined) {
      return { ok: false, message: 'actor must be an http or https URL.' };
    }

    const context = site.federation.createContext(
      new Request(config.baseUrl),
      federationContextData(site),
    );
    const loaders = await siteLoaders(context, signal);
    let fetched: Awaited<ReturnType<typeof followerFrom>>;
    try {
      const found = await context.lookupObject(actorId, loaders);
      fetched = isActor(found) ? await followerFrom(found, loaders) : undefined;
    } catch (error) {
      return { ok: false, message: `Could not read the actor at ${actorId}: ${messageOf(error)}` };
    }
    if (fetched === undefined) {
      return { ok: false, message: `${actorId} did not answer with an actor that has an inbox.` };
    }
    const refetchedUnderStoredId = { ...fetched, actorId };

    const held = admin.listFollowers().filter((follower) => follower.actorId === actorId);
    const records = { admin, contentDir: config.contentDir, dataDir: config.dataDir };
    for (const follower of held) {
      await addFollower(records, follower.username, refetchedUnderStoredId);
    }
    const profileUpdated = admin.getActorProfile(actorId) !== undefined;
    if (profileUpdated) {
      const { handle, name, iconUrl, url } = refetchedUnderStoredId;
      admin.putActorProfile({
        actorId,
        handle,
        name,
        iconUrl,
        url,
        fetchedAt: config.now().toISOString(),
      });
    }

    const moved = held.filter(
      (follower) =>
        follower.inboxId !== refetchedUnderStoredId.inboxId ||
        follower.sharedInboxId !== refetchedUnderStoredId.sharedInboxId,
    ).length;
    return {
      ok: true,
      summary: `${actorId} publishes inbox ${refetchedUnderStoredId.sharedInboxId ?? refetchedUnderStoredId.inboxId}; rewrote ${String(held.length)} follower ${held.length === 1 ? 'record' : 'records'}, ${String(moved)} of them with a new inbox.`,
      structured: {
        actorId,
        handle: refetchedUnderStoredId.handle,
        name: refetchedUnderStoredId.name,
        inbox: refetchedUnderStoredId.inboxId,
        sharedInbox: refetchedUnderStoredId.sharedInboxId,
        followers: held.map((follower) => ({
          username: follower.username,
          before: { inbox: follower.inboxId, sharedInbox: follower.sharedInboxId },
        })),
        profileUpdated,
      },
    };
  },
});
