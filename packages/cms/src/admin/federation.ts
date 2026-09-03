import type { Hono } from 'hono';

import type { ContentStore } from '../content/store.ts';
import type { GeekityEnv } from '../env.ts';
import { avatarUrl } from '../federation/actor.ts';
import type { DeliveryReport } from '../federation/delivery.ts';
import { SITE_ACTOR_IDENTIFIER } from '../federation/keys.ts';
import { ACTOR_PATH, federationOrigin, FEDERATION_PREFIX } from '../federation/paths.ts';
import { editorPath, POST_KIND } from './documents.ts';
import type { AdminRender } from './documents.ts';
import { flash } from './flash.ts';
import { readSiteSettings } from './settings.ts';
import type { SiteSettings } from './settings.ts';
import { ADMIN_PREFIX } from './session.ts';
import type {
  Delivery,
  DeliveryStatus,
  Follower,
  InboxActivity,
  OutboundActivity,
} from './store.ts';
import { ADMIN_TEMPLATES } from './templates.ts';

/** Where the federation screen lives. */
export const FEDERATION_PATH = `${ADMIN_PREFIX}/federation`;

/** Where a post's Redeliver button posts. */
export const REDELIVER_PATH = `${FEDERATION_PATH}/redeliver`;

/** The field the Redeliver form submits. */
export const FEDERATION_FIELDS = { activityId: 'activity_id' } as const;

/**
 * How many rows each of the screen's lists holds.
 *
 * One number for all of them, because the screen is a look at what is
 * happening now rather than an archive: the store pages, and a site that wants
 * the whole log has `cms.admin` to read it with.
 */
export const FEDERATION_RECENT = 50;

/** What {@link mountFederationScreen} needs from the admin around it. */
export interface MountFederationScreenOptions {
  /** The admin's renderer, which injects the chrome, the CSRF token and the flash. */
  render: AdminRender;
}

/**
 * Register `/admin/federation`: who the site is to the fediverse, who follows
 * it, what arrived in the inbox, and how the posts that went out landed.
 *
 * Everything on it is read out of SQLite rather than fetched: doc-4 keeps the
 * followers, the inbox log and the delivery log there precisely so the admin
 * can show them without dereferencing a remote actor per row.
 */
export function mountFederationScreen(
  app: Hono<GeekityEnv>,
  options: MountFederationScreenOptions,
): void {
  const { render } = options;

  app.get(FEDERATION_PATH, (c) => {
    const admin = c.var.admin;
    const baseUrl = c.var.config.baseUrl;
    const post = localPosts(c.var.store, baseUrl);

    return render(c, ADMIN_TEMPLATES.federation, {
      section: 'federation',
      redeliverUrl: REDELIVER_PATH,
      fields: FEDERATION_FIELDS,
      actor: actorSummary(readSiteSettings(admin), {
        baseUrl,
        followers: admin.countFollowers(),
      }),
      followers: admin
        .listFollowers({ limit: FEDERATION_RECENT })
        .map((follower) => followerRow(follower)),
      // The inbox log holds the follow traffic as well, and only a fraction of
      // it survives {@link inboxRows}, so more is read than is shown.
      inbox: inboxRows(admin.listInboxActivities({ limit: FEDERATION_RECENT * 4 }), {
        followers: admin.listFollowers(),
        post,
      }),
      posts: deliveryRows(admin.listOutboundActivities({ limit: FEDERATION_RECENT * 4 }), {
        counts: (activityId) => admin.countDeliveriesByStatus(activityId),
        post,
      }).slice(0, FEDERATION_RECENT),
    });
  });

  /**
   * Send one post's latest activity to every follower the site has now.
   *
   * The activity is named rather than the post, so the button sends exactly
   * what the row it sits in says it will: a post edited between the page load
   * and the click has a newer activity, and re-sending that one instead would
   * be a different thing from what was asked for.
   */
  app.post(REDELIVER_PATH, async (c) => {
    const body = await c.req.parseBody();
    const activityId = body[FEDERATION_FIELDS.activityId];

    const report =
      typeof activityId === 'string' ? await c.var.delivery.redeliver(activityId) : undefined;

    if (report === undefined) {
      flash(c, 'error', 'There is no record of that activity, so it cannot be sent again.');
    } else {
      flash(c, report.deliveries.some(failed) ? 'error' : 'notice', redeliveryMessage(report));
    }

    return c.redirect(FEDERATION_PATH, 303);
  });
}

/** Whether one delivery is a failure, for deciding how a flash reads. */
function failed(delivery: Delivery): boolean {
  return delivery.status === 'failed';
}

/**
 * What a redelivery came to, in one line.
 *
 * The failures are counted even when there are none, because that zero is the
 * answer to the question the button was pressed to ask.
 */
export function redeliveryMessage(report: DeliveryReport): string {
  const total = report.deliveries.length;
  if (total === 0) {
    return `Nobody follows the site, so the ${report.activityType} had nowhere to go.`;
  }

  const counts: Record<DeliveryStatus, number> = { sent: 0, queued: 0, failed: 0 };
  for (const delivery of report.deliveries) counts[delivery.status] += 1;

  const parts = [`${String(counts.sent)} sent`];
  if (counts.queued > 0) parts.push(`${String(counts.queued)} queued`);
  parts.push(`${String(counts.failed)} failed`);

  const followers = total === 1 ? '1 follower' : `${String(total)} followers`;
  return `Redelivered ${report.activityType} to ${followers}: ${parts.join(', ')}.`;
}

/** One post that has been federated, and how its latest activity landed. */
export interface DeliveryRow {
  /** The post, or its slug when the file has since gone. */
  readonly post: LocalPost;
  /** The activity the Redeliver button would send. */
  readonly activityId: string;
  /** `Create`, `Update` or `Delete`. */
  readonly activityType: string;
  /** When that activity was first built. */
  readonly createdAt: string;
  /** How many followers it reached, is still queued for, and failed for. */
  readonly counts: Record<DeliveryStatus, number>;
}

/** What {@link deliveryRows} needs to fill a row in. */
export interface DeliveryRowsContext {
  /** How one activity's deliveries ended, by status. */
  readonly counts: (activityId: string) => Record<DeliveryStatus, number>;
  /** Resolve one of the site's ActivityStreams object ids to a post. */
  readonly post: (objectId: string | null) => LocalPost | null;
}

/**
 * One row per post, holding the newest activity that post has: what the screen
 * shows and what its Redeliver button sends.
 *
 * A post is usually several activities — a `Create` and every `Update` since —
 * and listing all of them would make the panel a log rather than a status. The
 * newest is the one that matters, because it is the version a follower who
 * missed everything is owed. The activities arrive newest first, so the first
 * one seen for an object is that one.
 */
export function deliveryRows(
  activities: readonly OutboundActivity[],
  context: DeliveryRowsContext,
): DeliveryRow[] {
  const rows: DeliveryRow[] = [];
  const seen = new Set<string>();

  for (const activity of activities) {
    if (seen.has(activity.objectId)) continue;
    seen.add(activity.objectId);

    // A `Delete` is about a post that is no longer in the index, so the slug
    // the activity was built with is the only name left for it.
    const post = context.post(activity.objectId) ?? slugOnlyPost(activity.slug);
    if (post === null) continue;

    rows.push({
      post,
      activityId: activity.activityId,
      activityType: activity.activityType,
      createdAt: activity.createdAt,
      counts: context.counts(activity.activityId),
    });
  }

  return rows;
}

/** A post the index no longer holds, named by the slug the activity kept. */
function slugOnlyPost(slug: string | null): LocalPost | null {
  if (slug === null || slug === '') return null;
  return { slug, title: slug, editUrl: editorPath(POST_KIND, slug) };
}

/** The site's own actor, as the top of the screen describes it. */
export interface ActorSummary {
  /** `@handle@host`, the way somebody would type it into a search box. */
  readonly handle: string;
  /** `Person` or `Service`. */
  readonly type: string;
  /** The display name, which is the site title. */
  readonly name: string;
  /** The summary, which is the tagline. May be empty. */
  readonly summary: string;
  /** The actor's ActivityStreams id, which is also where it is served. */
  readonly actorId: string;
  /** The profile a human would open, which is the site itself. */
  readonly url: string;
  /**
   * The avatar the actor's `icon` carries, absolute, or `null` when the site
   * has none — which is what the screen draws a placeholder for.
   */
  readonly avatarUrl: string | null;
  /** How many actors follow it. */
  readonly followers: number;
}

/**
 * The site's actor as the screen shows it.
 *
 * The handle's host and the actor's id both come from the base URL's origin
 * rather than from the whole of it, because that is where the federation
 * endpoints are served: a site under `/blog` is still `@blog@example.com`.
 */
export function actorSummary(
  settings: SiteSettings,
  context: {
    /** The base URL actually in effect, which the settings' own may not be. */
    baseUrl: string;
    followers: number;
  },
): ActorSummary {
  const baseUrl = context.baseUrl === '' ? 'http://localhost' : context.baseUrl;
  const origin = federationOrigin(baseUrl);

  return {
    handle: `@${settings.actorHandle}@${origin.handleHost}`,
    avatarUrl: avatarUrl(settings.avatar, baseUrl) ?? null,
    type: settings.actorType,
    name: settings.title,
    summary: settings.tagline,
    actorId: new URL(ACTOR_PATH.replace('{identifier}', SITE_ACTOR_IDENTIFIER), origin.webOrigin)
      .href,
    url: baseUrl,
    followers: context.followers,
  };
}

/**
 * The inbox types the screen shows, and the word each of them reads as.
 *
 * The follow traffic is deliberately not here. `Follow`, `Undo` and `Delete`
 * are already in the log because doc-4 records everything the inbox was told,
 * but their effect is the follower list a few centimetres up the page: showing
 * them again would bury the three things that have nowhere else to appear.
 */
export const INBOX_INTERACTIONS: Readonly<Record<string, string>> = {
  Like: 'liked',
  Announce: 'boosted',
  Create: 'replied to',
};

/** One inbound interaction, as the list renders it. */
export interface InboxRow {
  /** The log's row id, which is also the order things arrived in. */
  readonly id: number;
  /** `Like`, `Announce` or `Create`. */
  readonly type: string;
  /** What that type reads as: "liked", "boosted", "replied to". */
  readonly action: string;
  /** Who did it. */
  readonly actorId: string;
  /** Their name or handle when they follow the site, else their id. */
  readonly actorLabel: string;
  /** When it arrived. */
  readonly receivedAt: string;
  /**
   * Where the remote thing lives: the reply itself, or the activity that
   * carried the like or the boost. `null` when it arrived without an id.
   */
  readonly remoteUrl: string | null;
  /** The site's own post it was about, when it was about one. */
  readonly post: LocalPost | null;
}

/** One of the site's posts, as an inbound activity or a delivery names it. */
export interface LocalPost {
  readonly slug: string;
  /** The post's title, or its slug when the file is no longer there. */
  readonly title: string;
  /** Where its editor is. */
  readonly editUrl: string;
}

/** What {@link inboxRows} needs to turn ids into names. */
export interface InboxRowsContext {
  /** The site's followers, so a familiar actor is shown by name. */
  readonly followers: readonly Follower[];
  /** Resolve one of the site's ActivityStreams object ids to a post. */
  readonly post: (objectId: string | null) => LocalPost | null;
}

/**
 * The inbox log as the screen's "recent activity" list, newest first.
 *
 * Only {@link INBOX_INTERACTIONS} survive, and only as much of each row as the
 * screen shows: doc-4 stores the whole JSON-LD because it could not know what
 * a later phase would want, and this is that phase deciding.
 */
export function inboxRows(
  activities: readonly InboxActivity[],
  context: InboxRowsContext,
): InboxRow[] {
  const names = new Map(
    context.followers.map((follower) => [
      follower.actorId,
      follower.name ?? follower.handle ?? follower.actorId,
    ]),
  );

  const rows: InboxRow[] = [];

  for (const activity of activities) {
    const action = INBOX_INTERACTIONS[activity.activityType];
    if (action === undefined) continue;

    const object = replyObject(activity);

    rows.push({
      id: activity.id,
      type: activity.activityType,
      action,
      actorId: activity.actorId,
      actorLabel: names.get(activity.actorId) ?? activity.actorId,
      receivedAt: activity.receivedAt,
      // A reply is a thing of its own with a page of its own; a like or a
      // boost is only ever the activity that announced it.
      remoteUrl: object === null ? activity.activityId : (object.url ?? object.id),
      post: context.post(object === null ? activity.objectId : object.inReplyTo),
    });
  }

  return rows;
}

/**
 * The Note a `Create` carried: where it can be read, and what it replied to.
 *
 * `null` for anything that is not a `Create` with an embedded object, which
 * includes a `Create` whose object arrived as a bare id — there is nothing to
 * link to there but the activity, and that is what the caller falls back to.
 */
function replyObject(
  activity: InboxActivity,
): { id: string | null; url: string | null; inReplyTo: string | null } | null {
  if (activity.activityType !== 'Create') return null;

  let json: unknown;
  try {
    json = JSON.parse(activity.json);
  } catch {
    return null;
  }

  const object = property(json, 'object');
  if (typeof object !== 'object' || object === null) return null;

  return {
    id: text(property(object, 'id')),
    url: text(property(object, 'url')),
    inReplyTo: text(property(object, 'inReplyTo')),
  };
}

/**
 * Resolve one of the site's own ActivityStreams ids to the post behind it.
 *
 * An id from anywhere else — a like of somebody else's post that reached the
 * shared inbox, a reply to a reply — is `null` rather than a guess, and so is
 * one whose slug the index has never heard of.
 */
export function localPosts(
  store: ContentStore,
  baseUrl: string,
): (objectId: string | null) => LocalPost | null {
  const origin = federationOrigin(baseUrl === '' ? 'http://localhost' : baseUrl).webOrigin;
  const prefix = `${FEDERATION_PREFIX}/posts/`;

  return (objectId) => {
    if (objectId === null) return null;

    let url: URL;
    try {
      url = new URL(objectId);
    } catch {
      return null;
    }

    if (url.origin !== origin || !url.pathname.startsWith(prefix)) return null;

    const slug = decodeURIComponent(url.pathname.slice(prefix.length));
    if (slug === '') return null;

    const document = store.getBySlug(slug);
    return {
      slug,
      title: document?.title ?? slug,
      editUrl: editorPath(POST_KIND, slug),
    };
  };
}

/** One property of a value that may not be an object at all. */
function property(value: unknown, key: string): unknown {
  if (typeof value !== 'object' || value === null) return undefined;
  return (value as Record<string, unknown>)[key];
}

/** A JSON-LD value as a string, or `null` for anything else. */
function text(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

/** One follower, as the table renders it. */
export interface FollowerRow {
  readonly actorId: string;
  /** The display name, or the handle, or the id: whichever the actor gave. */
  readonly name: string;
  /** `@name@host`, or the id when the actor published no username. */
  readonly handle: string;
  /** The avatar, or `null` for the initial the template draws instead. */
  readonly iconUrl: string | null;
  /** Where a click on the row goes: the actor's profile, else its id. */
  readonly url: string;
  readonly followedAt: string;
}

/**
 * One stored follower as the screen shows it.
 *
 * Every display column is nullable, because they are a copy of what the actor
 * said about itself and an actor need say none of it. The id is the fallback
 * for all of them: it is the one thing a follower always has, and it is
 * usually legible enough to recognise an instance by.
 */
export function followerRow(follower: Follower): FollowerRow {
  return {
    actorId: follower.actorId,
    name: follower.name ?? follower.handle ?? follower.actorId,
    handle: follower.handle ?? follower.actorId,
    iconUrl: follower.iconUrl,
    url: follower.url ?? follower.actorId,
    followedAt: follower.followedAt,
  };
}
