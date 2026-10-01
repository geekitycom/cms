import type { Context, Hono } from 'hono';

import { findUserById, listUsers } from '../admin/accounts.ts';
import type { User } from '../admin/accounts.ts';
import type { AdminRender } from '../admin/documents.ts';
import { ADMIN_PREFIX } from '../admin/session.ts';
import { effectiveBaseUrl, readSiteSettings } from '../admin/settings.ts';
import { ADMIN_TEMPLATES } from '../admin/templates.ts';
import type { GeekityEnv } from '../env.ts';
import { isPrivateHost } from '../webmention/public-address.ts';
import { fetchClientInformation } from './client.ts';
import type { ClientInformation } from './client.ts';
import { AUTHORIZATION_PATH, authorizationServerMetadata } from './discovery.ts';
import { meForSignIn } from './identity.ts';
import { profileResponse, redeemCode, redemptionForm } from './redeem.ts';
import { parseAuthorizationRequest } from './request.ts';
import type { Scope } from './request.ts';

/**
 * Where the person approves or denies a sign-in. Under `/admin`, so the admin
 * guard signs them in first and checks the form's CSRF token.
 */
export const CONSENT_PATH = `${ADMIN_PREFIX}/indieauth/consent`;

/** What each scope lets a client learn or do, as the consent and connected apps screens say it. */
export const SCOPE_LABELS: Readonly<Record<Scope, string>> = {
  profile: 'Your name, URL and photo',
  email: 'Your email address',
  create: 'Create posts as you',
  update: 'Edit your posts',
  delete: 'Delete your posts',
  media: 'Upload media to your site',
};

/**
 * The authorization endpoint (TASK-158, TASK-159).
 *
 * A GET is the person arriving from a client, and is handed, query and all,
 * to the consent screen. The screen is under `/admin` so that the admin's
 * guard, login and headers apply to it; the endpoint is not, because a POST
 * here is a client redeeming its code for the profile, with no admin session.
 * No access token is issued on this path; that is the token endpoint's job.
 * Not exempt from maintenance mode: the identity URLs that advertise it
 * answer 503 then too.
 */
export function mountAuthorizationEndpoint(app: Hono<GeekityEnv>): void {
  app.get(AUTHORIZATION_PATH, (c) =>
    c.redirect(`${CONSENT_PATH}${new URL(c.req.url).search}`, 302),
  );

  app.post(AUTHORIZATION_PATH, async (c) => {
    c.header('cache-control', 'no-store');
    const { config } = c.var;
    const form = redemptionForm(await c.req.parseBody());
    const redeemed = redeemCode(c.var.indieauth.codes, form);
    if (!redeemed.ok) {
      return c.json({ error: redeemed.error, error_description: redeemed.description }, 400);
    }
    const { grant } = redeemed;
    const user = findUserById(config.dataDir, grant.userId);
    if (user === undefined) {
      return c.json(
        { error: 'invalid_grant', error_description: 'The person who approved this is gone.' },
        400,
      );
    }
    const baseUrl = effectiveBaseUrl(config, readSiteSettings(config.contentDir));
    return c.json(profileResponse(grant, user, baseUrl));
  });
}

/** Register the consent screen and the Approve and Deny buttons behind it. */
export function mountConsentScreen(app: Hono<GeekityEnv>, options: { render: AdminRender }): void {
  const { render } = options;

  function refuse(c: Context<GeekityEnv>, message: string): Response {
    c.status(400);
    return render(c, ADMIN_TEMPLATES.indieauthRefused, { message });
  }

  app.get(CONSENT_PATH, async (c) => {
    const { config } = c.var;
    const user = signedInUser(c);
    if (user === undefined) return c.redirect(ADMIN_PREFIX, 302);
    const settings = readSiteSettings(config.contentDir);
    const baseUrl = effectiveBaseUrl(config, settings);

    const parsed = parseAuthorizationRequest(new URL(c.req.url).searchParams, baseUrl);
    if (parsed.kind === 'unredirectable') return refuse(c, parsed.message);
    const { clientId, redirectUri } = parsed.kind === 'valid' ? parsed.request : parsed;
    const client = await clientInformation(c, clientId);
    if (!mayRedirect(clientId, redirectUri, client)) {
      return refuse(
        c,
        'The app asked to send you back to an address it has not published as its own.',
      );
    }

    if (parsed.kind === 'refused') {
      return c.redirect(
        answer(redirectUri, baseUrl, {
          error: parsed.error,
          error_description: parsed.description,
          state: parsed.state,
        }),
        302,
      );
    }

    const { request } = parsed;
    const me = meForSignIn(request.me, user, {
      baseUrl,
      users: listUsers(config.dataDir),
      settings,
    });
    const pending = c.var.indieauth.consents.put({
      request,
      userId: user.id,
      me,
      ...(client.name === undefined ? {} : { clientName: client.name }),
    });
    const redirect = new URL(redirectUri);

    c.set('cspFormAction', formActionSource(redirect));
    return render(c, ADMIN_TEMPLATES.indieauthConsent, {
      consentUrl: CONSENT_PATH,
      pending,
      client: { name: client.name ?? clientId, id: clientId, named: client.name !== undefined },
      redirectHost: redirect.host === '' ? redirect.protocol : redirect.host,
      loopback: redirect.hostname !== '' && isPrivateHost(redirect.hostname),
      identity: me,
      resource: request.resource,
      scopes: request.scopes.map((scope) => ({ name: scope, label: SCOPE_LABELS[scope] })),
    });
  });

  app.post(CONSENT_PATH, async (c) => {
    const { config } = c.var;
    const user = signedInUser(c);
    if (user === undefined) return c.redirect(ADMIN_PREFIX, 302);
    const body = await c.req.parseBody({ all: true });

    const pending = c.var.indieauth.consents.take(text(body['request']));
    if (pending?.userId !== user.id) {
      return refuse(
        c,
        'This sign-in was already answered or has expired. Start again from the app.',
      );
    }

    const { request } = pending;
    const baseUrl = effectiveBaseUrl(config, readSiteSettings(config.contentDir));
    if (text(body['decision']) !== 'approve') {
      return c.redirect(
        answer(request.redirectUri, baseUrl, { error: 'access_denied', state: request.state }),
        303,
      );
    }

    const ticked = new Set([body['scope']].flat().map(text));
    const code = c.var.indieauth.codes.put({
      clientId: request.clientId,
      ...(pending.clientName === undefined ? {} : { clientName: pending.clientName }),
      redirectUri: request.redirectUri,
      codeChallenge: request.codeChallenge,
      userId: user.id,
      me: pending.me,
      scopes: request.scopes.filter((scope) => ticked.has(scope)),
      ...(request.resource === undefined ? {} : { resource: request.resource }),
    });
    return c.redirect(answer(request.redirectUri, baseUrl, { code, state: request.state }), 303);
  });
}

function signedInUser(c: Context<GeekityEnv>): User | undefined {
  const userId = c.var.session?.userId;
  return userId == null ? undefined : findUserById(c.var.config.dataDir, userId);
}

/** What the client says about itself, or nothing when it could not be read. */
async function clientInformation(
  c: Context<GeekityEnv>,
  clientId: string,
): Promise<ClientInformation> {
  const fetched = await fetchClientInformation(clientId, { lookup: c.var.config.hostLookup });
  if (fetched.ok) return fetched.client;
  console.warn(`Could not read IndieAuth client ${clientId}: ${fetched.reason}`);
  return { redirectUris: [] };
}

/**
 * Whether a client may be sent back to `redirectUri`: always on its own
 * origin, and elsewhere only when its metadata lists that exact URL.
 */
function mayRedirect(clientId: string, redirectUri: string, client: ClientInformation): boolean {
  const target = new URL(redirectUri);
  const sameOrigin =
    (target.protocol === 'https:' || target.protocol === 'http:') &&
    target.origin === new URL(clientId).origin;
  return sameOrigin || client.redirectUris.includes(redirectUri);
}

/** `redirectUri` with the answer and the issuer added to its query. */
function answer(
  redirectUri: string,
  baseUrl: string,
  fields: Record<string, string | undefined>,
): string {
  const url = new URL(redirectUri);
  for (const [name, value] of Object.entries(fields)) {
    if (value !== undefined) url.searchParams.set(name, value);
  }
  url.searchParams.set('iss', authorizationServerMetadata(baseUrl).issuer);
  return url.href;
}

/** The CSP source that lets a form's redirect reach `url`. */
function formActionSource(url: URL): string {
  return url.protocol === 'https:' || url.protocol === 'http:' ? url.origin : url.protocol;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
