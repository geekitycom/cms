/**
 * Users > App activity (TASK-221): the recent requests apps made to the
 * IndieAuth and Micropub endpoints, newest first, failures marked, and one
 * request in full. Where a site owner looks when an app will not sign in or
 * post. Any signed-in admin may read it, as with the other admin screens.
 */
import type { Hono } from 'hono';

import type { AdminRender } from '../admin/documents.ts';
import { formatInTimezone } from '../admin/formatting.ts';
import { readSiteSettings } from '../admin/settings.ts';
import { ADMIN_TEMPLATES } from '../admin/templates.ts';
import { APP_ACTIVITY_CHILD, APP_ACTIVITY_PATH } from '../admin/users.ts';
import type { GeekityEnv } from '../env.ts';
import { isFailure, isFresh, readActivityLog } from './activity-log.ts';
import type { ActivityEndpoint, ActivityEntry, CarriedField } from './activity-log.ts';

/** What each endpoint is called on the screen. */
const ENDPOINT_LABELS: Readonly<Record<ActivityEndpoint, string>> = {
  authorization: 'Authorization',
  token: 'Token',
  micropub: 'Micropub',
  media: 'Media',
};

/** The query that narrows the list to failures. */
const FAILURES_QUERY = 'show=failures';

/** Register the list and the screen for one entry. */
export function mountAppActivity(app: Hono<GeekityEnv>, options: { render: AdminRender }): void {
  const { render } = options;

  app.get(APP_ACTIVITY_PATH, async (c) => {
    const { config } = c.var;
    const timezone = readSiteSettings(config.contentDir).timezone;
    const entries = await freshEntries(config.dataDir, config.now());
    const failuresOnly = c.req.query('show') === 'failures';
    const failures = entries.filter(isFailure);
    return render(c, ADMIN_TEMPLATES.appActivity, {
      section: 'users',
      child: APP_ACTIVITY_CHILD,
      tabs: [
        { label: 'All', url: APP_ACTIVITY_PATH, count: entries.length, current: !failuresOnly },
        {
          label: 'Failures',
          url: `${APP_ACTIVITY_PATH}?${FAILURES_QUERY}`,
          count: failures.length,
          current: failuresOnly,
        },
      ],
      rows: (failuresOnly ? failures : entries).map((entry) => row(entry, timezone)),
    });
  });

  app.get(`${APP_ACTIVITY_PATH}/:id`, async (c) => {
    const { config } = c.var;
    const entries = await freshEntries(config.dataDir, config.now());
    const entry = entries.find((candidate) => candidate.id === c.req.param('id'));
    if (entry === undefined) return c.notFound();
    const timezone = readSiteSettings(config.contentDir).timezone;
    return render(c, ADMIN_TEMPLATES.appActivityEntry, {
      section: 'users',
      child: APP_ACTIVITY_CHILD,
      listUrl: APP_ACTIVITY_PATH,
      entry: row(entry, timezone),
      details: details(entry),
      carried: entry.carried.map(carriedRow),
    });
  });
}

async function freshEntries(dataDir: string, now: Date): Promise<ActivityEntry[]> {
  return (await readActivityLog(dataDir)).filter((entry) => isFresh(entry, now));
}

/** One entry as the list shows it. */
function row(entry: ActivityEntry, timezone: string) {
  const failed = isFailure(entry);
  return {
    url: `${APP_ACTIVITY_PATH}/${entry.id}`,
    when: { iso: entry.at, text: formatInTimezone(entry.at, timezone) },
    endpoint: ENDPOINT_LABELS[entry.endpoint],
    action: entry.action,
    app: entry.clientId,
    user: entry.user,
    status: entry.status,
    failed,
    error: entry.error,
    errorDescription: entry.errorDescription,
  };
}

/** What only the full view shows: the method, and what an endpoint adds of its own. */
function details(entry: ActivityEntry): { label: string; value: string }[] {
  const lines = [{ label: 'Method', value: entry.method }];
  if (entry.endpoint === 'authorization' && entry.action === 'request') {
    lines.push(
      {
        label: 'PKCE',
        value: entry.pkce ? 'An S256 code_challenge was sent' : 'No S256 code_challenge was sent',
      },
      { label: 'Scopes asked for', value: listed(entry.scopes) },
    );
  }
  if (entry.endpoint === 'token') {
    lines.push({ label: 'Scopes granted', value: listed(entry.scopes) });
  }
  return lines;
}

function listed(values: readonly string[]): string {
  return values.length === 0 ? 'None' : values.join(' ');
}

/** One field the request carried, as its row in the full view says it. */
function carriedRow(field: CarriedField): { name: string; value: string; note: boolean } {
  if ('file' in field) {
    const { filename, type, size } = field.file;
    return {
      name: field.name,
      value: `${filename} (${type === '' ? 'no type' : type}, ${String(size)} bytes)`,
      note: true,
    };
  }
  if ('redacted' in field) return { name: field.name, value: 'Sent, not recorded', note: true };
  return { name: field.name, value: field.value, note: false };
}
