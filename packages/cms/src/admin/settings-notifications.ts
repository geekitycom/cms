/**
 * Notifications: what the site emails the signed-in user about, and how often.
 *
 * A settings page in every way but what it saves. Its form carries no site
 * setting: it saves the signed-in user's own switches to `data/users.json`, so
 * two admins each see and change only their own. The events come from the
 * registry in `site/notification-preferences.ts`, so adding one adds a row
 * here and nothing else.
 */

import type { Context } from 'hono';

import type { GeekityEnv } from '../web/env.ts';
import { editUserPath } from '../site/admin-paths.ts';
import { notificationSwitches } from '../site/notification-preferences.ts';
import { findUserById, setUserNotifications } from '../site/users.ts';
import { stringOrEmpty } from '../util/forms.ts';
import { flashAndRedirect } from './flash.ts';
import { settingsPagePath } from './settings-page.ts';
import type { SettingsPage, SubmittedBody } from './settings-page.ts';
import { ADMIN_TEMPLATES } from './templates.ts';

/**
 * The fields the form submits.
 *
 * A browser sends nothing for an unticked box, so the form also lists the
 * events it showed: an event in that list with no tick is off, and an event
 * added after the form was drawn is left as it was.
 */
export const NOTIFICATIONS_FIELDS = {
  events: 'events',
  on: (event: string) => `notify_${event}`,
  mode: (event: string) => `mode_${event}`,
} as const;

/** The Notifications settings page. */
export const NOTIFICATIONS_SETTINGS: SettingsPage = {
  child: 'notifications',
  label: 'Notifications',
  path: settingsPagePath('notifications'),
  template: ADMIN_TEMPLATES.settingsNotifications,
  fields: [],

  panels: (c) => {
    const user = signedInUser(c);
    return {
      notices: (user === undefined ? [] : notificationSwitches(user)).map((notice) => ({
        ...notice,
        onField: NOTIFICATIONS_FIELDS.on(notice.name),
        modeField: NOTIFICATIONS_FIELDS.mode(notice.name),
      })),
      eventsField: NOTIFICATIONS_FIELDS.events,
      noticeEmail: user?.email ?? '',
      mailConfigured: c.var.mailConfigured,
      ...(user === undefined ? {} : { accountUrl: editUserPath(user.id) }),
    };
  },

  save: saveNotifications,
};

async function saveNotifications(c: Context<GeekityEnv>, body: SubmittedBody): Promise<Response> {
  const here = NOTIFICATIONS_SETTINGS.path;
  const user = signedInUser(c);
  if (user === undefined) return c.redirect(here, 303);

  const shown = stringOrEmpty(body[NOTIFICATIONS_FIELDS.events]).split(/\s+/).filter(Boolean);
  await setUserNotifications({
    dataDir: c.var.config.dataDir,
    userId: user.id,
    choices: shown.map((event) => ({
      event,
      on: stringOrEmpty(body[NOTIFICATIONS_FIELDS.on(event)]) !== '',
      mode: optionalString(body[NOTIFICATIONS_FIELDS.mode(event)]),
    })),
  });

  return flashAndRedirect(c, 'notice', 'Notification settings saved.', here);
}

function signedInUser(c: Context<GeekityEnv>) {
  const userId = c.var.session?.userId;
  return userId == null ? undefined : findUserById(c.var.config.dataDir, userId);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}
