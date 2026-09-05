import type { User } from '../admin/accounts.ts';

/**
 * Which notices a user wants, as a switchboard rather than a field per notice.
 *
 * The point of this module is that adding the next event — a new follower, a
 * digest of what could not be delivered — is one entry in
 * {@link NOTIFICATION_EVENTS} and nothing else. The users screen renders a
 * checkbox per entry, `data/users.json` stores whatever is not the default,
 * and the feature that sends asks {@link notificationRecipients} who wants it.
 * Nothing else has to be edited, and nothing anywhere hard-codes the word
 * "comments".
 *
 * Two rules keep a stored preference honest across versions:
 *
 * - **A default rather than a value.** An event a user has said nothing about
 *   is at its default, so a site that upgrades into a new notice gets it
 *   without anybody visiting the users screen, and turning one off is the only
 *   thing that has to be written down.
 * - **An unknown name is not a preference.** A key for an event this version
 *   has never heard of is dropped on the way in and on the way out, so a file
 *   written by a newer version does not leave a switch nothing can reach.
 *
 * An event may also say that it can be *batched* (TASK-60), which adds a
 * second question beside the switch: not whether to send it, but how often. The
 * two are separate on purpose — a user who wants none of a notice turns it off,
 * and a user who wants it in one message a day is still a recipient. Both
 * rules above apply to the mode exactly as they do to the switch: the default
 * is not written down, and a mode this version has never heard of is dropped
 * and read as the default.
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

/**
 * What a user who has never chosen gets: the behaviour every notice had before
 * this existed, so upgrading changes nothing for anybody.
 */
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

/** What the users screen calls each mode. */
export const DELIVERY_MODE_LABELS: Readonly<Record<NotificationDeliveryMode, string>> = {
  immediately: 'As they arrive',
  hourly: 'Hourly digest',
  daily: 'Daily digest',
};

/** Whether a mode collects things up rather than sending each one. */
export function isBatchedMode(mode: NotificationDeliveryMode): boolean {
  return DELIVERY_WINDOW_MS[mode] > 0;
}

/** One thing a user can be told about. */
export interface NotificationEvent {
  /** What it is called in `data/users.json` and in the form. */
  readonly name: string;
  /** What the users screen calls it. */
  readonly label: string;
  /** The sentence under the label, so a switch says what it will send. */
  readonly description: string;
  /** Whether a user who has said nothing gets it. */
  readonly byDefault: boolean;
  /**
   * Whether a user may choose how often it arrives (TASK-60).
   *
   * `false` for a notice that is only ever one message about one thing — a
   * password having been changed, say — where "hourly" would mean nothing. An
   * event that says `true` gets a delivery mode beside its switch, and
   * whatever sends it is responsible for honouring one.
   */
  readonly batched: boolean;
}

/**
 * Every event, in the order the users screen offers them.
 *
 * One line each. TASK-55 ships the first.
 */
export const NOTIFICATION_EVENTS: readonly NotificationEvent[] = [
  {
    name: 'comments',
    label: 'New comments',
    description:
      'A comment or a webmention has arrived and is waiting to be approved. The message carries ' +
      'approve, spam and delete links that work without signing in.',
    byDefault: true,
    batched: true,
  },
];

/** The event of that name, or `undefined` for one nothing here knows. */
export function notificationEvent(name: string): NotificationEvent | undefined {
  return NOTIFICATION_EVENTS.find((event) => event.name === name);
}

/**
 * Whether this user wants that notice.
 *
 * `false` for an event nothing knows about, and for no user at all, so a
 * caller can hand in whatever it has.
 */
export function notificationWanted(user: User | undefined, name: string): boolean {
  const event = notificationEvent(name);
  if (user === undefined || event === undefined) return false;

  const stored = user.notifications?.[name];
  return stored ?? event.byDefault;
}

/**
 * How often this user wants that notice.
 *
 * {@link DEFAULT_DELIVERY_MODE} for an event nothing knows about, for one that
 * cannot be batched, for no user at all, and for a stored value this version
 * does not recognise — so a caller can hand in whatever it has and always gets
 * a mode it can act on.
 */
export function notificationMode(user: User | undefined, name: string): NotificationDeliveryMode {
  const event = notificationEvent(name);
  if (user === undefined || event === undefined || !event.batched) return DEFAULT_DELIVERY_MODE;

  return deliveryMode(user.notificationModes?.[name]) ?? DEFAULT_DELIVERY_MODE;
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
): { user: User; email: string }[] {
  const wanted: { user: User; email: string }[] = [];

  for (const user of users) {
    if (user.email === undefined || user.email === '') continue;
    if (!notificationWanted(user, name)) continue;
    wanted.push({ user, email: user.email });
  }

  return wanted;
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
 * reasons: a mode that matches the default, a mode this version does not know,
 * and an event that cannot be batched are all things the file should not be
 * carrying. The last two are how a value written by hand, or by a newer
 * version, is cleaned up rather than left to sit there meaning nothing.
 */
export function withNotificationMode(
  stored: Readonly<Record<string, string>> | undefined,
  name: string,
  mode: string,
): Record<string, string> | undefined {
  const event = notificationEvent(name);
  const wanted = deliveryMode(mode);
  if (event === undefined || !event.batched)
    return stored === undefined ? undefined : { ...stored };

  const next: Record<string, string> = { ...stored };
  if (wanted === undefined || wanted === DEFAULT_DELIVERY_MODE) delete next[name];
  else next[name] = wanted;

  return Object.keys(next).length === 0 ? undefined : next;
}

/** One event as the users screen renders it: the switch, and the mode when it has one. */
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

/** Every event with what this user has it set to, for the users screen. */
export function notificationSwitches(user: User): NotificationSwitch[] {
  return NOTIFICATION_EVENTS.map((event) => {
    const mode = notificationMode(user, event.name);
    return {
      name: event.name,
      label: event.label,
      description: event.description,
      on: notificationWanted(user, event.name),
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
