import type { User } from './users.ts';

/**
 * Which notices a user wants, as a switchboard rather than a field per notice.
 *
 * The point of this module is that adding the next event — a new follower, a
 * digest of what could not be delivered — is one entry in
 * {@link NOTIFICATION_EVENTS} and nothing else. Settings > Notifications
 * renders a switch per entry, `data/users.json` stores whatever is not the default,
 * and the feature that sends asks {@link notificationRecipients} who wants it.
 * Nothing else has to be edited, and nothing anywhere hard-codes the word
 * "comments".
 *
 * Two rules keep a stored preference honest across versions:
 *
 * - **A default rather than a value.** An event a user has said nothing about
 *   is at its default, so a site that upgrades into a new notice gets it
 *   without anybody visiting the Notifications page, and turning one off is the only
 *   thing that has to be written down.
 * - **An unknown name is not a preference.** A key for an event this version
 *   has never heard of is dropped on the way in and on the way out, so a file
 *   written by a newer version does not leave a switch nothing can reach.
 *
 * An event may also say that it can be *batched*, which adds a
 * second question beside the switch: not whether to send it, but how often. The
 * two are separate on purpose — a user who wants none of a notice turns it off,
 * and a user who wants it in one message a day is still a recipient. Both
 * rules above apply to the mode exactly as they do to the switch: each batched
 * event names its own default mode, so a noisy one can start as a digest; that
 * default is not written down, and a mode this version has never heard of is
 * dropped and read as the default.
 */

/**
 * How often a notice that can be batched arrives.
 *
 * `immediately` is one message per thing that happened, which is what every
 * notice did before there was a choice. The other two are one message per
 * window listing everything still waiting, which is what makes a spam wave a
 * single email rather than fifty.
 */
export const NOTIFICATION_DELIVERY_MODES = ['immediately', 'hourly', 'daily'] as const;

/** One of {@link NOTIFICATION_DELIVERY_MODES}. */
export type NotificationDeliveryMode = (typeof NOTIFICATION_DELIVERY_MODES)[number];

export const DEFAULT_DELIVERY_MODE: NotificationDeliveryMode = 'immediately';

/**
 * How long a batched mode waits between messages.
 *
 * `immediately` is zero because it never waits: it is here so that the map is
 * total and nothing has to special-case the mode that does not batch.
 */
export const DELIVERY_WINDOW_MS: Readonly<Record<NotificationDeliveryMode, number>> = {
  immediately: 0,
  hourly: 60 * 60 * 1000,
  daily: 24 * 60 * 60 * 1000,
};

export const DELIVERY_MODE_LABELS: Readonly<Record<NotificationDeliveryMode, string>> = {
  immediately: 'As they arrive',
  hourly: 'Hourly digest',
  daily: 'Daily digest',
};

/** Whether a mode collects things up rather than sending each one. */
export function isBatchedMode(mode: NotificationDeliveryMode): boolean {
  return DELIVERY_WINDOW_MS[mode] > 0;
}

interface NotificationEventBase {
  readonly name: string;
  readonly label: string;
  /** The sentence under the label, so a switch says what it will send. */
  readonly description: string;
  /** Whether a user who has said nothing gets it. */
  readonly byDefault: boolean;
}

export type NotificationEvent = NotificationEventBase &
  (
    | { readonly batched: false }
    | { readonly batched: true; readonly defaultMode: NotificationDeliveryMode }
  );

export const NOTIFICATION_EVENTS: readonly NotificationEvent[] = [
  {
    name: 'comments',
    label: 'Waiting for review',
    description:
      'A comment, a webmention or a held fediverse reply has arrived and is waiting to be ' +
      'approved. The message carries ' +
      'approve, spam and delete links that work without signing in.',
    byDefault: true,
    batched: true,
    defaultMode: 'immediately',
  },
  {
    name: 'published',
    label: 'New published comments and replies',
    description:
      'A comment, a webmention or a fediverse reply went on a page without anybody ' +
      'approving it: a returning commenter, or a reply the review rule lets through. ' +
      'Approving something yourself sends nothing.',
    byDefault: true,
    batched: true,
    defaultMode: 'immediately',
  },
  {
    name: 'reactions',
    label: 'Likes and boosts',
    description:
      'Somebody on the fediverse liked or boosted one of your posts. An undone like or boost ' +
      'is taken out of a digest that has not gone yet.',
    byDefault: false,
    batched: true,
    defaultMode: 'daily',
  },
  {
    name: 'quotes',
    label: 'Quotes',
    description:
      'Somebody on the fediverse quoted one of your posts, with what they said about it.',
    byDefault: true,
    batched: true,
    defaultMode: 'daily',
  },
  {
    name: 'followers',
    label: 'New followers',
    description:
      'Somebody on the fediverse followed one of the site’s accounts. Relays the site ' +
      'subscribes to are not followers and send nothing.',
    byDefault: true,
    batched: true,
    defaultMode: 'daily',
  },
];

/** The event of that name, or `undefined` for one nothing here knows. */
export function notificationEvent(
  name: string,
  events: readonly NotificationEvent[] = NOTIFICATION_EVENTS,
): NotificationEvent | undefined {
  return events.find((event) => event.name === name);
}

/**
 * Whether this user wants that notice.
 *
 * `false` for an event nothing knows about, and for no user at all, so a
 * caller can hand in whatever it has.
 */
export function notificationWanted(
  user: User | undefined,
  name: string,
  events: readonly NotificationEvent[] = NOTIFICATION_EVENTS,
): boolean {
  const event = notificationEvent(name, events);
  if (user === undefined || event === undefined) return false;

  const stored = user.notifications?.[name];
  return stored ?? event.byDefault;
}

/**
 * How often this user wants that notice.
 *
 * The event's own default for no user at all and for a stored value this
 * version does not recognise, and {@link DEFAULT_DELIVERY_MODE} for an event
 * nothing knows about or one that cannot be batched — so a caller can hand in
 * whatever it has and always gets a mode it can act on.
 */
export function notificationMode(
  user: User | undefined,
  name: string,
  events: readonly NotificationEvent[] = NOTIFICATION_EVENTS,
): NotificationDeliveryMode {
  const event = notificationEvent(name, events);
  if (event === undefined || !event.batched) return DEFAULT_DELIVERY_MODE;

  return deliveryMode(user?.notificationModes?.[name]) ?? event.defaultMode;
}

/** That string as a mode, or `undefined` for one this version has never heard of. */
export function deliveryMode(value: unknown): NotificationDeliveryMode | undefined {
  return NOTIFICATION_DELIVERY_MODES.find((mode) => mode === value);
}

/**
 * Everybody who should get one message of this kind: a user with an address
 * who has not turned it off.
 *
 * The address is what makes somebody a recipient. A user with none has said,
 * by leaving the field empty, that the site has nowhere to write.
 */
export function notificationRecipients(
  users: readonly User[],
  name: string,
  events: readonly NotificationEvent[] = NOTIFICATION_EVENTS,
): { user: User; email: string }[] {
  const wanted: { user: User; email: string }[] = [];

  for (const user of users) {
    if (user.email === undefined || user.email === '') continue;
    if (!notificationWanted(user, name, events)) continue;
    wanted.push({ user, email: user.email });
  }

  return wanted;
}

export function immediateRecipients(
  users: readonly User[],
  name: string,
): { user: User; email: string }[] {
  return notificationRecipients(users, name).filter(
    (recipient) => !isBatchedMode(notificationMode(recipient.user, name)),
  );
}

/**
 * The stored map with one switch moved, or `undefined` when nothing needs
 * storing any more.
 *
 * A preference that matches its default is removed rather than written as
 * `true`, so the file says only what somebody actually changed and the default
 * stays the thing this module decides.
 */
export function withNotification(
  stored: Readonly<Record<string, boolean>> | undefined,
  name: string,
  on: boolean,
): Record<string, boolean> | undefined {
  const event = notificationEvent(name);
  if (event === undefined) return stored === undefined ? undefined : { ...stored };

  const next: Record<string, boolean> = { ...stored };
  if (on === event.byDefault) delete next[name];
  else next[name] = on;

  return Object.keys(next).length === 0 ? undefined : next;
}

/**
 * The stored mode map with one event moved, or `undefined` when nothing needs
 * storing any more.
 *
 * The twin of {@link withNotification}, and it drops for the same three
 * reasons: a mode that matches the event's default, a mode this version does not know,
 * and an event that cannot be batched are all things the file should not be
 * carrying. The last two are how a value written by hand, or by a newer
 * version, is cleaned up rather than left to sit there meaning nothing.
 */
export function withNotificationMode(
  stored: Readonly<Record<string, string>> | undefined,
  name: string,
  mode: string,
  events: readonly NotificationEvent[] = NOTIFICATION_EVENTS,
): Record<string, string> | undefined {
  const event = notificationEvent(name, events);
  const wanted = deliveryMode(mode);
  if (event === undefined || !event.batched)
    return stored === undefined ? undefined : { ...stored };

  const next: Record<string, string> = { ...stored };
  if (wanted === undefined || wanted === event.defaultMode) delete next[name];
  else next[name] = wanted;

  return Object.keys(next).length === 0 ? undefined : next;
}

export interface NotificationSwitch {
  /** The event's name, which is what the form submits. */
  name: string;
  /** What the screen calls it. */
  label: string;
  /** The sentence that says what it will send. */
  description: string;
  /** Whether this user gets it. */
  on: boolean;
  /** Whether it offers a delivery mode at all. */
  batched: boolean;
  /** How often this user gets it. {@link DEFAULT_DELIVERY_MODE} when it does not batch. */
  mode: NotificationDeliveryMode;
  /** The modes to offer, which is nothing at all for an event that cannot batch. */
  modes: { value: NotificationDeliveryMode; label: string; chosen: boolean }[];
}

export function notificationSwitches(
  user: User,
  events: readonly NotificationEvent[] = NOTIFICATION_EVENTS,
): NotificationSwitch[] {
  return events.map((event) => {
    const mode = notificationMode(user, event.name, events);
    return {
      name: event.name,
      label: event.label,
      description: event.description,
      on: notificationWanted(user, event.name, events),
      batched: event.batched,
      mode,
      modes: event.batched
        ? NOTIFICATION_DELIVERY_MODES.map((candidate) => ({
            value: candidate,
            label: DELIVERY_MODE_LABELS[candidate],
            chosen: candidate === mode,
          }))
        : [],
    };
  });
}
