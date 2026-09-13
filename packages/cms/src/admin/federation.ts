import type { Hono } from 'hono';

import type { Document } from '../content/document.ts';
import { isTrashedPath } from '../content/store.ts';
import type { ContentStore } from '../content/store.ts';
import type { GeekityEnv } from '../env.ts';
import { listUsers } from './accounts.ts';
import type { User } from './accounts.ts';
import { avatarUrl } from '../federation/actor.ts';
import type { DeliveryReport } from '../federation/delivery.ts';
import type { WebmentionReport } from '../webmention/service.ts';
import { ACTOR_PATH, federationOrigin } from '../federation/paths.ts';
import { authorHref, profileContext, userForAuthor } from '../web/authors.ts';
import { postObjectId, publicDocumentAt } from '../web/documents.ts';
import { absoluteUrl } from '../web/negotiate.ts';
import { editorPath, POST_KIND } from './documents.ts';
import type { AdminRender } from './documents.ts';
import { flash } from './flash.ts';
import { ADMIN_PREFIX } from './session.ts';
import type {
  Delivery,
  DeliveryStatus,
  Follower,
  InboxActivity,
  Relay,
  RelayState,
  WebmentionSendStatus,
} from './store.ts';
import { ADMIN_TEMPLATES } from './templates.ts';

/** Where the federation screen lives. */
export const FEDERATION_PATH = `${ADMIN_PREFIX}/federation`;

/** Where a post's Resend button posts. */
export const RESEND_PATH = `${FEDERATION_PATH}/resend`;

/** Where a relay's Retry button posts. */
export const RELAY_RETRY_PATH = `${FEDERATION_PATH}/relays/retry`;

/** The fields the screen's forms submit. */
export const FEDERATION_FIELDS = { slug: 'slug', relay: 'relay' } as const;

/** What each relay state reads as on the screen. */
export const RELAY_STATE_LABELS: Readonly<Record<RelayState, string>> = {
  pending: 'Waiting',
  accepted: 'Accepted',
  rejected: 'Rejected',
};

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
 * Nothing on it is fetched: the followers and the inbox log are indexed in
 * SQLite from the files that hold them precisely so the admin can show them
 * without dereferencing a remote actor per row.
 *
 * The delivery panel is the one that reads two sources at once. Which posts
 * belong on it is a question for the content index — the posts carrying an
 * `activitypub.published`, which is the same thing as the posts a follower
 * holds a copy of — and how each of them last landed is a question for the outcome
 * cache. That order matters: the cache is disposable (decision-9), so a site
 * that has just deleted its database sees every federated post listed with
 * nothing yet recorded against it, rather than an empty panel.
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
    const users = listUsers(c.var.config.dataDir);

    return render(c, ADMIN_TEMPLATES.federation, {
      section: 'federation',
      child: 'followers',
      resendUrl: RESEND_PATH,
      fields: FEDERATION_FIELDS,
      actors: users.map((user) =>
        actorSummary(user, {
          baseUrl,
          followerCount: admin.countFollowers(user.username),
          followers: admin
            .listFollowers(user.username, { limit: FEDERATION_RECENT })
            .map((follower) => followerRow(follower)),
        }),
      ),
      // The inbox log holds the follow traffic as well, and only a fraction of
      // it survives {@link inboxRows}, so more is read than is shown.
      inbox: inboxRows(admin.listInboxActivities({ limit: FEDERATION_RECENT * 4 }), {
        followers: admin.listFollowers(),
        post,
      }),
      relayRetryUrl: RELAY_RETRY_PATH,
      relays: admin
        .listRelays()
        .map((relay) => relayRow(relay, admin.lastDeliveryToInbox(relay.inboxId))),
      posts: deliveryRows(c.var.store.listFederated({ limit: FEDERATION_RECENT }), {
        baseUrl,
        author: (document) => userForAuthor(users, document.author)?.username ?? null,
        lastDelivery: (objectId) => admin.lastDeliveryToObject(objectId),
        counts: (activityId) => admin.countDeliveriesByStatus(activityId),
        webmentions: (slug) => admin.countSentWebmentionsByStatus(slug),
      }),
    });
  });

  /**
   * Send one relay's `Follow` again.
   *
   * The relay is named by its inbox, which is what the settings hold and what
   * the row shows: a subscription is identified by where it was made, not by
   * the follow it is currently waiting on, which is the thing a retry replaces.
   */
  app.post(RELAY_RETRY_PATH, async (c) => {
    const body = await c.req.parseBody();
    const inboxId = body[FEDERATION_FIELDS.relay];

    const relay = typeof inboxId === 'string' ? await c.var.relays.retry(inboxId) : undefined;

    if (relay === undefined) {
      flash(c, 'error', 'The site does not subscribe to that relay, so there is nothing to retry.');
    } else {
      flash(
        c,
        'notice',
        `The follow has been sent to ${relay.inboxId} again. A relay may take a while to answer.`,
      );
    }

    return c.redirect(FEDERATION_PATH, 303);
  });

  /**
   * Send one post as it now reads to every follower and every accepted relay.
   *
   * The post is named rather than an activity, which is the whole of what
   * decision-9 changed here: the activity is built from the file when the
   * button is pressed, so a post edited between the page load and the click
   * goes out as it is now — which is what somebody pressing Resend is asking
   * for — rather than as the row said it was.
   */
  app.post(RESEND_PATH, async (c) => {
    const body = await c.req.parseBody();
    const slug = body[FEDERATION_FIELDS.slug];

    const report = typeof slug === 'string' ? await c.var.delivery.resend(slug) : undefined;
    // The webmentions go with it, because "send this post out again" is one
    // thing to the person pressing the button and the links are as much a part
    // of a post going out as the followers are (TASK-51). It is asked for
    // separately because it answers for a post that has never federated at
    // all, which `resend` says nothing about.
    const links = typeof slug === 'string' ? await c.var.webmentions.send(slug) : undefined;

    if (report === undefined && links === undefined) {
      flash(c, 'error', 'There is no post to send under that name, so nothing was sent.');
    } else {
      const failedSomewhere =
        (report?.deliveries.some(failed) ?? false) ||
        (links?.sent.some((one) => one.status === 'failed') ?? false);
      flash(c, failedSomewhere ? 'error' : 'notice', resendMessage(report, links));
    }

    return c.redirect(FEDERATION_PATH, 303);
  });
}

/** Whether one delivery is a failure, for deciding how a flash reads. */
function failed(delivery: Delivery): boolean {
  return delivery.status === 'failed';
}

/**
 * What a resend came to, in one line.
 *
 * The failures are counted even when there are none, because that zero is the
 * answer to the question the button was pressed to ask. The activity type is
 * named because it is not something the person choosing to resend chose: it
 * follows from the state the post is in, and a `Delete` where somebody
 * expected an `Update` is worth reading about.
 */
export function resendMessage(
  report: DeliveryReport | undefined,
  links?: WebmentionReport,
): string {
  return [deliveryMessage(report), webmentionMessage(links)]
    .filter((part) => part !== undefined)
    .join(' ');
}

/** What the ActivityPub half of a resend came to. */
function deliveryMessage(report: DeliveryReport | undefined): string | undefined {
  if (report === undefined) return undefined;

  const total = report.deliveries.length;
  if (total === 0) {
    return (
      `Nobody follows the site and no relay has accepted it, ` +
      `so the ${report.activityType} had nowhere to go.`
    );
  }

  const counts: Record<DeliveryStatus, number> = { sent: 0, queued: 0, failed: 0 };
  for (const delivery of report.deliveries) counts[delivery.status] += 1;

  const parts = [`${String(counts.sent)} sent`];
  if (counts.queued > 0) parts.push(`${String(counts.queued)} queued`);
  parts.push(`${String(counts.failed)} failed`);

  // "Recipients" rather than "followers": a relay is one of them too, and it
  // is not a follower.
  const recipients = total === 1 ? '1 recipient' : `${String(total)} recipients`;
  return `Sent ${report.activityType} to ${recipients}: ${parts.join(', ')}.`;
}

/**
 * What the webmention half came to, or nothing at all when the post links
 * nowhere outside the site.
 *
 * Silence rather than "0 webmentions", because most posts link to nothing and
 * a line about it on every resend would be noise about a thing that did not
 * happen.
 */
function webmentionMessage(links: WebmentionReport | undefined): string | undefined {
  if (links === undefined || links.sent.length === 0) return undefined;

  const counts = { sent: 0, none: 0, failed: 0 };
  for (const one of links.sent) counts[one.status] += 1;

  const linked =
    links.sent.length === 1 ? '1 linked page' : `${String(links.sent.length)} linked pages`;
  const parts = [`${String(counts.sent)} told`];
  if (counts.none > 0) parts.push(`${String(counts.none)} take none`);
  parts.push(`${String(counts.failed)} failed`);
  return `Webmentions to ${linked}: ${parts.join(', ')}.`;
}

/** One post the fediverse holds a copy of, and how it last landed. */
export interface DeliveryRow {
  /** The post, as the row names and links to it. */
  readonly post: LocalPost;
  /**
   * The username whose actor announced it, or `null` when its `author` names
   * nobody this site knows — in which case the site's first account announced
   * it, which the screen says nothing about because it is a fallback rather
   * than an attribution.
   */
  readonly author: string | null;
  /** What the Resend button submits. */
  readonly slug: string;
  /** Whether the post is in the trash, which is why its last activity was a `Delete`. */
  readonly trashed: boolean;
  /**
   * The last activity about this post the cache remembers, or `null` when it
   * remembers none — which is what a database deleted since is, and is not a
   * reason to leave the post off the screen.
   */
  readonly lastActivity: {
    /** `Create`, `Update` or `Delete`. */
    readonly activityType: string;
    /** When it was delivered. */
    readonly attemptedAt: string;
    /** How many recipients it reached, is still queued for, and failed for. */
    readonly counts: Record<DeliveryStatus, number>;
  } | null;
  /**
   * How the post's outgoing webmentions stand: how many linked pages were
   * told, how many advertise no endpoint, and how many refused (TASK-51).
   *
   * All zero for a post that links nowhere outside the site, and for one whose
   * links have never been sent — which, like the delivery counts, is what a
   * deleted database looks like rather than a fact about the post.
   */
  readonly webmentions: Record<WebmentionSendStatus, number>;
}

/** What {@link deliveryRows} needs to fill a row in. */
export interface DeliveryRowsContext {
  /** The site's public origin, which a post's object id is built on. */
  readonly baseUrl: string;
  /** Whose actor announced one post, or `null` when its `author` names nobody. */
  readonly author: (document: Document) => string | null;
  /** The newest outcome recorded about one object id, or `undefined`. */
  readonly lastDelivery: (objectId: string) => Delivery | undefined;
  /** How one activity's deliveries ended, by status. */
  readonly counts: (activityId: string) => Record<DeliveryStatus, number>;
  /** How one post's outgoing webmentions ended, by status. */
  readonly webmentions: (slug: string) => Record<WebmentionSendStatus, number>;
}

/**
 * One row per post the site has announced, newest post first.
 *
 * The posts come from the content index and the outcomes from the cache, in
 * that order and not the other way round, because they are answers to two
 * different questions. Which posts belong here is a fact about the files: a
 * post carrying an `activitypub.published` is one some follower holds a copy
 * of, and that stays true however often the database is thrown away. How each of them
 * landed is a fact about the last delivery, which is exactly the sort of thing
 * a cache is allowed to forget.
 *
 * A post is usually several activities — a `Create` and every `Update` since —
 * and the newest is the only one worth showing: it is the version a follower
 * who missed everything is owed, and the one a resend supersedes anyway.
 */
export function deliveryRows(
  documents: readonly Document[],
  context: DeliveryRowsContext,
): DeliveryRow[] {
  return documents.map((document) => {
    const last = context.lastDelivery(postObjectId(document, context.baseUrl));

    return {
      post: {
        slug: document.slug,
        title: document.title,
        editUrl: editorPath(POST_KIND, document.slug),
      },
      author: context.author(document),
      slug: document.slug,
      trashed: isTrashedPath(document.path),
      lastActivity:
        last === undefined
          ? null
          : {
              activityType: last.activityType,
              attemptedAt: last.attemptedAt,
              counts: context.counts(last.activityId),
            },
      webmentions: context.webmentions(document.slug),
    };
  });
}

/** One user's actor, as a panel of the screen describes it. */
export interface ActorSummary {
  /** Their login, which is also their Fedify identifier and their handle. */
  readonly username: string;
  /** `@username@host`, the way somebody would type it into a search box. */
  readonly handle: string;
  /** The display name, or the username when they have written none. */
  readonly name: string;
  /** The summary, which is their bio. May be empty. */
  readonly summary: string;
  /** The actor's ActivityStreams id, which is also their archive. */
  readonly actorId: string;
  /** The profile a human would open, which is that same archive. */
  readonly url: string;
  /**
   * The avatar the actor's `icon` carries, absolute, or `null` when they have
   * none — which is what the screen draws a placeholder for.
   */
  readonly avatarUrl: string | null;
  /** How many actors follow them. */
  readonly followerCount: number;
  /** The newest of those followers, as the table renders them. */
  readonly followers: readonly FollowerRow[];
}

/**
 * One user's actor as the screen shows it (decision-14).
 *
 * The handle's host and the actor's id both come from the base URL's origin
 * rather than from the whole of it, because that is where the federation
 * endpoints are served: a site under `/blog` still answers `@ada@example.com`.
 * The id is built from {@link ACTOR_PATH} rather than from `authorHref` for
 * the same reason — it is the path Fedify dispatches the actor at, and the
 * screen should say what a peer would get.
 */
export function actorSummary(
  user: User,
  context: {
    /** The base URL actually in effect, which the settings' own may not be. */
    baseUrl: string;
    followerCount: number;
    followers: readonly FollowerRow[];
  },
): ActorSummary {
  const baseUrl = context.baseUrl === '' ? 'http://localhost' : context.baseUrl;
  const origin = federationOrigin(baseUrl);
  const profile = profileContext(user);

  return {
    username: user.username,
    handle: `@${user.username}@${origin.handleHost}`,
    avatarUrl: profile.avatar === undefined ? null : (avatarUrl(profile.avatar, baseUrl) ?? null),
    name: profile.name,
    summary: profile.bio ?? '',
    actorId: new URL(
      ACTOR_PATH.replace('{identifier}', encodeURIComponent(user.username)),
      origin.webOrigin,
    ).href,
    url: absoluteUrl(authorHref(user.username), baseUrl),
    followerCount: context.followerCount,
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
 * A post's id is its permalink (decision-13), so this is a lookup by URL
 * against the content index: an id from anywhere else — a like of somebody
 * else's post that reached the shared inbox, a reply to a reply — is `null`
 * rather than a guess, and so is one whose path the index has never heard of.
 */
export function localPosts(
  store: ContentStore,
  baseUrl: string,
): (objectId: string | null) => LocalPost | null {
  const site = baseUrl === '' ? 'http://localhost' : baseUrl;
  const origin = new URL(site).origin;

  return (objectId) => {
    if (objectId === null) return null;

    let url: URL;
    try {
      url = new URL(objectId);
    } catch {
      return null;
    }
    if (url.origin !== origin) return null;

    const document =
      store.getByStoredObjectId(objectId) ??
      publicDocumentAt(store, decodeURIComponent(url.pathname));
    if (document === undefined || document.type !== 'post') return null;

    return {
      slug: document.slug,
      title: document.title,
      editUrl: editorPath(POST_KIND, document.slug),
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

/** One relay subscription, as the panel renders it. */
export interface RelayRow {
  /** The relay's inbox, which is what the settings list and what identifies it. */
  readonly inboxId: string;
  /** Where the subscription stands. */
  readonly state: RelayState;
  /** What that state reads as: "Waiting", "Accepted", "Rejected". */
  readonly stateLabel: string;
  /** The relay's actor, once it has answered, for a human following the link. */
  readonly actorId: string | null;
  /** When the site subscribed. */
  readonly createdAt: string;
  /** When it was accepted or refused, which for a waiting one is when it was asked. */
  readonly updatedAt: string;
  /** Why it refused, or what went wrong sending the follow, or `null`. */
  readonly reason: string | null;
  /** The last activity delivered there and how it went, or `null` for nothing yet. */
  readonly lastDelivery: {
    readonly activityId: string;
    /** `Create`, `Update` or `Delete`. */
    readonly activityType: string;
    readonly status: DeliveryStatus;
    readonly error: string | null;
    readonly attemptedAt: string;
  } | null;
  /** Whether the row offers Retry: only a subscription still waiting to be answered. */
  readonly retriable: boolean;
}

/**
 * One stored relay as the screen shows it.
 *
 * The last outcome is looked up by inbox rather than by actor, because that is
 * the column a relay is guaranteed to have: a subscription that has not been
 * accepted has no actor id at all, and the point of the row is to say so. The
 * outcome carries what the activity was, so there is nothing else to look up.
 */
export function relayRow(relay: Relay, lastDelivery: Delivery | undefined): RelayRow {
  return {
    inboxId: relay.inboxId,
    state: relay.state,
    stateLabel: RELAY_STATE_LABELS[relay.state],
    actorId: relay.actorId,
    createdAt: relay.createdAt,
    updatedAt: relay.updatedAt,
    reason: relay.reason,
    lastDelivery:
      lastDelivery === undefined
        ? null
        : {
            activityId: lastDelivery.activityId,
            activityType: lastDelivery.activityType,
            status: lastDelivery.status,
            error: lastDelivery.error,
            attemptedAt: lastDelivery.attemptedAt,
          },
    // A rejected relay is not retried from here: it said no, and asking again
    // is a decision to take by removing it and adding it back, not a button
    // that quietly re-asks a server that refused.
    retriable: relay.state === 'pending',
  };
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
