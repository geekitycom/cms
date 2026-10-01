/**
 * Users > Connected apps (TASK-162): the apps that hold a token for whoever is
 * signed in, and the button that cuts one off.
 *
 * Only ever your own connections, because a token acts as the person who
 * approved it. Revoking deletes the connection from `data/indieauth-tokens.json`,
 * so the access token and the refresh token stop working on the next request.
 */

import type { Hono } from 'hono';

import type { AdminRender } from '../admin/documents.ts';
import { flash } from '../admin/flash.ts';
import { formatInTimezone } from '../admin/formatting.ts';
import { readSiteSettings } from '../admin/settings.ts';
import { ADMIN_TEMPLATES } from '../admin/templates.ts';
import { CONNECTED_APPS_CHILD, CONNECTED_APPS_PATH } from '../admin/users.ts';
import type { GeekityEnv } from '../env.ts';
import { SCOPE_LABELS } from './consent.ts';
import { listTokens, revokeConnection } from './tokens.ts';
import type { StoredToken } from './tokens.ts';

/** Where a Revoke button posts. */
export const REVOKE_CONNECTION_PATH = `${CONNECTED_APPS_PATH}/revoke`;

/** The field a Revoke button submits: the connection's id. */
export const CONNECTION_FIELD = 'connection';

/**
 * Register the screen and its Revoke button. Mounted before the users
 * screens, whose `/admin/users/:id` would otherwise answer `apps` with a 404.
 */
export function mountConnectedApps(app: Hono<GeekityEnv>, options: { render: AdminRender }): void {
  const { render } = options;

  app.get(CONNECTED_APPS_PATH, (c) => {
    const { config } = c.var;
    const userId = c.var.session?.userId;
    const timezone = readSiteSettings(config.contentDir).timezone;
    const now = config.now().getTime();
    const connections = listTokens(config.dataDir)
      .filter((token) => token.userId === userId && Date.parse(token.refreshExpiresAt) > now)
      .sort((a, b) => b.issuedAt.localeCompare(a.issuedAt))
      .map((token) => row(token, timezone));
    return render(c, ADMIN_TEMPLATES.connectedApps, {
      section: 'users',
      child: CONNECTED_APPS_CHILD,
      revokeUrl: REVOKE_CONNECTION_PATH,
      connectionField: CONNECTION_FIELD,
      connections,
    });
  });

  app.post(REVOKE_CONNECTION_PATH, async (c) => {
    const { config, session } = c.var;
    const id = (await c.req.parseBody())[CONNECTION_FIELD];
    const revoked =
      typeof id === 'string' && session?.userId != null
        ? await revokeConnection(config.dataDir, session.userId, id, config.now())
        : undefined;
    if (revoked === undefined) flash(c, 'warning', 'That app was already disconnected.');
    else flash(c, 'notice', `${clientLabel(revoked)} can no longer act as you.`);
    return c.redirect(CONNECTED_APPS_PATH, 303);
  });
}

/** One connection as the table shows it. */
function row(token: StoredToken, timezone: string) {
  const when = (instant: string) => ({ iso: instant, text: formatInTimezone(instant, timezone) });
  return {
    id: token.id,
    name: clientLabel(token),
    url: token.clientId,
    scopes: token.scopes.map((scope) => SCOPE_LABELS[scope]),
    issued: when(token.issuedAt),
    lastUsed: token.lastUsedAt === undefined ? undefined : when(token.lastUsedAt),
    expires: when(token.refreshExpiresAt),
  };
}

/** What to call a client: its own name, or its URL when it gave none. */
function clientLabel(token: StoredToken): string {
  return token.clientName ?? token.clientId;
}
