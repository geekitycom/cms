/**
 * Users > Connected apps (TASK-162): the apps that hold a token for whoever is
 * signed in, and the button that cuts one off.
 *
 * Only ever your own connections, because a token acts as the person who
 * approved it. Revoking deletes the connection from `data/indieauth-tokens.json`,
 * so the access token and the refresh token stop working on the next request.
 */

import type { Context, Hono } from 'hono';

import type { AdminRender } from '../admin/documents.ts';
import { flash } from '../admin/flash.ts';
import { formatInTimezone } from '../admin/formatting.ts';
import { findUserById, listUsers } from '../admin/accounts.ts';
import { readSiteSettings, updateSiteSettings } from '../admin/settings.ts';
import { ADMIN_TEMPLATES } from '../admin/templates.ts';
import { CONNECTED_APPS_CHILD, CONNECTED_APPS_PATH } from '../admin/users.ts';
import type { GeekityEnv } from '../env.ts';
import { clientIdentifier, sameClient } from './client-id.ts';
import { SCOPE_LABELS } from './consent.ts';
import { SCOPES, siteBaseUrl } from './discovery.ts';
import { meForSignIn } from './identity.ts';
import type { Scope } from './request.ts';
import { createToken, lapsesAt, listTokens, revokeConnection } from './tokens.ts';
import type { StoredToken } from './tokens.ts';

/** Where a Revoke button posts. */
export const REVOKE_CONNECTION_PATH = `${CONNECTED_APPS_PATH}/revoke`;

/** The field a Revoke button submits: the connection's id. */
export const CONNECTION_FIELD = 'connection';

export const ADD_CLIENT_WITHOUT_PKCE_PATH = `${CONNECTED_APPS_PATH}/without-pkce`;

export const REMOVE_CLIENT_WITHOUT_PKCE_PATH = `${ADD_CLIENT_WITHOUT_PKCE_PATH}/remove`;

export const CLIENT_FIELD = 'client_id';

export const CREATE_TOKEN_PATH = `${CONNECTED_APPS_PATH}/tokens`;

const TOKEN_LIFETIME_DAYS = [7, 30, 90, 365] as const;

const DEFAULT_TOKEN_LIFETIME_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

const NAME_LIMIT = 100;

interface TokenForm {
  name: string;
  scopes: readonly string[];
  expires: string;
}

type TokenProblems = Partial<Record<keyof TokenForm, string>>;

type TokenOutcome =
  | { readonly refused: TokenForm; readonly problems: TokenProblems }
  | { readonly created: { readonly name: string; readonly token: string } };

interface RefusedClient {
  value: string;
  problem: string;
}

/**
 * Register the screen and its Revoke button. Mounted before the users
 * screens, whose `/admin/users/:id` would otherwise answer `apps` with a 404.
 */
export function mountConnectedApps(app: Hono<GeekityEnv>, options: { render: AdminRender }): void {
  const { render } = options;

  app.get(CONNECTED_APPS_PATH, (c) => render(c, ADMIN_TEMPLATES.connectedApps, screen(c)));

  app.post(ADD_CLIENT_WITHOUT_PKCE_PATH, async (c) => {
    const value = text((await c.req.parseBody())[CLIENT_FIELD]).trim();
    const refuse = (problem: string): Response => {
      c.status(400);
      return render(c, ADMIN_TEMPLATES.connectedApps, screen(c, { value, problem }));
    };
    if (clientIdentifier(value) === undefined) return refuse(NOT_A_CLIENT_ID);
    let listed = false;
    await updateSiteSettings({
      contentDir: c.var.config.contentDir,
      change: (current) => {
        listed = current.clientsWithoutPkce.some((id) => sameClient(id, value));
        return listed
          ? current
          : { ...current, clientsWithoutPkce: [...current.clientsWithoutPkce, value] };
      },
    });
    if (listed) return refuse(`${value} is already on the list.`);
    flash(c, 'notice', `${value} may now sign in without PKCE.`);
    return c.redirect(CONNECTED_APPS_PATH, 303);
  });

  app.post(REMOVE_CLIENT_WITHOUT_PKCE_PATH, async (c) => {
    const value = text((await c.req.parseBody())[CLIENT_FIELD]);
    let removed = false;
    await updateSiteSettings({
      contentDir: c.var.config.contentDir,
      change: (current) => {
        const kept = current.clientsWithoutPkce.filter((id) => id !== value);
        removed = kept.length < current.clientsWithoutPkce.length;
        return { ...current, clientsWithoutPkce: kept };
      },
    });
    if (removed) flash(c, 'notice', `${value} must use PKCE again.`);
    else flash(c, 'warning', 'That app was already off the list.');
    return c.redirect(CONNECTED_APPS_PATH, 303);
  });

  app.post(CREATE_TOKEN_PATH, async (c) => {
    const { config } = c.var;
    const body = await c.req.parseBody({ all: true });
    const form: TokenForm = {
      name: text(body['name']).trim(),
      scopes: [body['scope'] ?? []].flat().map(text),
      expires: text(body['expires']),
    };
    const user =
      c.var.session?.userId == null
        ? undefined
        : findUserById(config.dataDir, c.var.session.userId);
    const scopes = form.scopes.filter((scope): scope is Scope =>
      (SCOPES as readonly string[]).includes(scope),
    );
    const days = TOKEN_LIFETIME_DAYS.find((choice) => String(choice) === form.expires);
    const problems: TokenProblems = {
      ...(form.name === '' ? { name: 'Give the token a name, so you can tell it apart.' } : {}),
      ...(form.name.length > NAME_LIMIT
        ? { name: `Keep the name to ${NAME_LIMIT} characters.` }
        : {}),
      ...(scopes.length === 0 || scopes.length < form.scopes.length
        ? { scopes: 'Choose at least one thing the token may do.' }
        : {}),
      ...(days === undefined ? { expires: 'Choose when the token expires.' } : {}),
    };
    if (user === undefined || days === undefined || Object.keys(problems).length > 0) {
      c.status(400);
      return render(
        c,
        ADMIN_TEMPLATES.connectedApps,
        screen(c, undefined, { refused: form, problems }),
      );
    }

    const baseUrl = siteBaseUrl(c);
    const { accessToken } = await createToken(
      config.dataDir,
      {
        userId: user.id,
        me: meForSignIn(`${baseUrl}/`, user, {
          baseUrl,
          users: listUsers(config.dataDir),
          settings: readSiteSettings(config.contentDir),
        }),
        name: form.name,
        scopes,
        resource: baseUrl,
        lifetimeMs: days * DAY_MS,
      },
      config.now(),
    );
    return showTokenOnceWithoutStoringIt(c, render, form.name, accessToken);
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

const NOT_A_CLIENT_ID =
  'Enter the app’s client_id exactly as it sends it: an http or https URL with a domain name, such as https://ia.net/writer.';

function screen(
  c: Context<GeekityEnv>,
  refused?: RefusedClient,
  token?: TokenOutcome,
): Record<string, unknown> {
  const { config } = c.var;
  const userId = c.var.session?.userId;
  const settings = readSiteSettings(config.contentDir);
  const now = config.now().getTime();
  const connections = listTokens(config.dataDir)
    .filter((stored) => stored.userId === userId && Date.parse(lapsesAt(stored)) > now)
    .sort((a, b) => b.issuedAt.localeCompare(a.issuedAt))
    .map((stored) => row(stored, settings.timezone));
  const form = token !== undefined && 'refused' in token ? token.refused : undefined;
  const chosen = new Set(form?.scopes ?? []);
  return {
    section: 'users',
    child: CONNECTED_APPS_CHILD,
    revokeUrl: REVOKE_CONNECTION_PATH,
    connectionField: CONNECTION_FIELD,
    connections,
    withoutPkce: {
      clients: settings.clientsWithoutPkce,
      addUrl: ADD_CLIENT_WITHOUT_PKCE_PATH,
      removeUrl: REMOVE_CLIENT_WITHOUT_PKCE_PATH,
      field: CLIENT_FIELD,
      value: refused?.value ?? '',
      problem: refused?.problem ?? '',
    },
    createToken: {
      url: CREATE_TOKEN_PATH,
      name: form?.name ?? '',
      scopes: SCOPES.map((scope) => ({
        name: scope,
        label: SCOPE_LABELS[scope],
        checked: chosen.has(scope),
      })),
      expiries: TOKEN_LIFETIME_DAYS.map((days) => ({
        days,
        selected: String(days) === (form?.expires ?? String(DEFAULT_TOKEN_LIFETIME_DAYS)),
      })),
      problems: token !== undefined && 'problems' in token ? token.problems : {},
      created: token !== undefined && 'created' in token ? token.created : undefined,
    },
  };
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** One connection as the table shows it. */
function row(token: StoredToken, timezone: string) {
  const when = (instant: string) => ({ iso: instant, text: formatInTimezone(instant, timezone) });
  return {
    id: token.id,
    name: clientLabel(token),
    url: token.kind === 'created' ? undefined : token.clientId,
    scopes: token.scopes.map((scope) => SCOPE_LABELS[scope]),
    issued: when(token.issuedAt),
    lastUsed: token.lastUsedAt === undefined ? undefined : when(token.lastUsedAt),
    expires: when(lapsesAt(token)),
  };
}

function clientLabel(token: StoredToken): string {
  if (token.kind === 'created') return token.name;
  return token.clientName ?? token.clientId;
}

function showTokenOnceWithoutStoringIt(
  c: Context<GeekityEnv>,
  render: AdminRender,
  name: string,
  token: string,
): Response | Promise<Response> {
  c.header('cache-control', 'no-store');
  return render(
    c,
    ADMIN_TEMPLATES.connectedApps,
    screen(c, undefined, { created: { name, token } }),
  );
}
