import type { Hono } from 'hono';

import type { GeekityEnv } from './env.ts';
import { REGISTERED_CLIENTS_PATH, REGISTRATION_PATH } from './indieauth-discovery.ts';
import {
  clientMetadata,
  decodeClient,
  parseRegistration,
  registeredClientId,
} from '../indieauth/registration.ts';
import { readWithin } from '../webmention/fetch-public.ts';

/** The most of a registration request that is read. */
const REGISTRATION_MAX_BYTES = 16 * 1024;

/** What every registered client may do, and how it authenticates: by PKCE alone. */
const PUBLIC_CLIENT = {
  grant_types: ['authorization_code', 'refresh_token'],
  response_types: ['code'],
  token_endpoint_auth_method: 'none',
} as const;

/** The site's registered clients prefix, as an absolute URL. */
export function registeredClientsUrl(baseUrl: string): string {
  return `${baseUrl}${REGISTERED_CLIENTS_PATH}`;
}

/**
 * The registration endpoint, and the client metadata document at each
 * client_id it hands out. Whatever authentication method a client asks for, it
 * is told `none`: it holds no secret, since its id is the whole record.
 * Outside `/admin`, because the client registering has no admin session, and
 * behind the maintenance gate like the token endpoint.
 */
export function mountClientRegistration(app: Hono<GeekityEnv>): void {
  app.post(REGISTRATION_PATH, async (c) => {
    c.header('cache-control', 'no-store');
    const read = await readWithin(c.req.raw, REGISTRATION_MAX_BYTES, 'refuse');
    let metadata: unknown;
    try {
      metadata = read === undefined ? undefined : JSON.parse(new TextDecoder().decode(read.body));
    } catch {
      metadata = undefined;
    }
    if (metadata === undefined) {
      return c.json(
        { error: 'invalid_client_metadata', error_description: 'The body must be a JSON object.' },
        400,
      );
    }

    const registration = parseRegistration(metadata);
    if (!registration.ok) {
      return c.json(
        { error: registration.error, error_description: registration.description },
        400,
      );
    }
    const { client } = registration;
    return c.json(
      {
        client_id: registeredClientId(registeredClientsUrl(c.var.config.baseUrl), client),
        client_id_issued_at: Math.floor(c.var.config.now().getTime() / 1000),
        ...clientMetadata(client),
        ...PUBLIC_CLIENT,
      },
      201,
    );
  });

  app.get(`${REGISTERED_CLIENTS_PATH}:payload`, (c) => {
    const payload = c.req.param('payload');
    const client = decodeClient(payload);
    if (client === undefined) return c.notFound();
    return c.json({
      client_id: `${registeredClientsUrl(c.var.config.baseUrl)}${payload}`,
      ...clientMetadata(client),
      ...PUBLIC_CLIENT,
    });
  });
}
