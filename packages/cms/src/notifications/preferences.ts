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
 */

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

/** Every event with what this user has it set to, for the users screen. */
export function notificationSwitches(
  user: User,
): { name: string; label: string; description: string; on: boolean }[] {
  return NOTIFICATION_EVENTS.map((event) => ({
    name: event.name,
    label: event.label,
    description: event.description,
    on: notificationWanted(user, event.name),
  }));
}
