import { createHash, randomBytes } from 'node:crypto';
import path from 'node:path';

import { readFileIfPresentSync, updateFileAtomically } from '../files/atomic.ts';
import type { AuthorizationCode } from './grants.ts';
import type { RedemptionForm } from './redeem.ts';
import type { Scope } from './request.ts';

/**
 * The access tokens the token endpoint has issued: `data/indieauth-tokens.json`
 * (TASK-160, decision-24).
 *
 * A token is irreducible state under decision-9: a client holding one cannot
 * be handed it again, so losing it signs the person out of every app. So it
 * lives in a file in `data/`, written 0600 like `users.json`, and holds a
 * SHA-256 hash of each token rather than the token. A token is 32 random
 * bytes, so the hash needs no salt: nobody can guess their way back to one.
 *
 * One record per connection, that is per approval of a client: a refresh
 * replaces both hashes in place, so the record keeps the id and the time the
 * person approved it while the tokens change under it.
 */

/** The file, relative to `dataDir`. */
export const TOKENS_FILE = 'indieauth-tokens.json';

/** The permissions the file is written with: nobody but the site's own user. */
export const TOKENS_FILE_MODE = 0o600;

/** How long an access token works for. */
export const ACCESS_TOKEN_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

/** How long a refresh token works for, counted from its own issue: each refresh starts it again. */
export const REFRESH_TOKEN_LIFETIME_MS = 60 * 24 * 60 * 60 * 1000;

/** One connection as the file keeps it. */
export interface StoredToken {
  /** Stable for the life of the connection, so a screen can name it. */
  readonly id: string;
  readonly userId: number;
  /** The canonical me URL the client was handed. */
  readonly me: string;
  readonly clientId: string;
  readonly scopes: readonly Scope[];
  /** The RFC 8707 resource the token is good at, or absent when the client named none. */
  readonly resource?: string;
  /** When the person approved the connection, as an ISO 8601 instant. */
  readonly issuedAt: string;
  readonly accessTokenHash: string;
  /** When the current access token stops working. */
  readonly expiresAt: string;
  readonly refreshTokenHash: string;
  /** When the current refresh token stops working. */
  readonly refreshExpiresAt: string;
}

/** Tokens just issued: the only time the tokens themselves exist anywhere. */
export interface IssuedTokens {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly token: StoredToken;
}

/**
 * Who is asking a token to be checked: a resource server, by the resource
 * identifier clients name it with.
 *
 * `acceptsUnbound` says whether it takes a token issued with no resource
 * named. Micropub clients predate RFC 8707 and name none, so the Micropub
 * endpoint will; MCP clients always name one, and the MCP spec asks a server
 * to take only tokens issued for it, so the MCP endpoint will not.
 */
export interface Audience {
  readonly resource: string;
  readonly acceptsUnbound: boolean;
}

export type Refresh =
  | { readonly ok: true; readonly issued: IssuedTokens }
  | {
      readonly ok: false;
      readonly error: 'invalid_request' | 'invalid_grant';
      readonly description: string;
    };

interface TokensFile {
  tokens: StoredToken[];
}

/** Where the tokens file lives for a given data directory. */
export function tokensFile(dataDir: string): string {
  return path.join(dataDir, TOKENS_FILE);
}

/** Every connection in the file, live or not. */
export function listTokens(dataDir: string): StoredToken[] {
  const text = readFileIfPresentSync(tokensFile(dataDir));
  return text === undefined ? [] : (JSON.parse(text) as TokensFile).tokens;
}

/** Issue an access token and a refresh token for an approved code. */
export async function issueTokens(
  dataDir: string,
  grant: AuthorizationCode,
  now: Date,
): Promise<IssuedTokens> {
  const minted = mint(now);
  const token: StoredToken = {
    id: randomBytes(16).toString('base64url'),
    userId: grant.userId,
    me: grant.me,
    clientId: grant.clientId,
    scopes: grant.scopes,
    ...(grant.resource === undefined ? {} : { resource: grant.resource }),
    issuedAt: now.toISOString(),
    ...minted.hashes,
  };
  await update(dataDir, now, (tokens) => [...tokens, token]);
  return { accessToken: minted.accessToken, refreshToken: minted.refreshToken, token };
}

/**
 * Trade a refresh token for new tokens, from the client it was issued to.
 *
 * Both tokens rotate: the old access token and the old refresh token stop
 * working the moment this returns. The scopes and resource stay the ones the
 * person approved; a `scope` in the request is ignored, which RFC 6749 allows
 * because the answer says the scope it holds.
 */
export async function refreshTokens(
  dataDir: string,
  form: RedemptionForm,
  now: Date,
): Promise<Refresh> {
  const presented = form['refresh_token'];
  const clientId = form['client_id'];
  if (!presented || !clientId) {
    return {
      ok: false,
      error: 'invalid_request',
      description: 'refresh_token and client_id are both required.',
    };
  }

  const hash = hashToken(presented);
  const refused: Refresh = {
    ok: false,
    error: 'invalid_grant',
    description: 'The refresh token is unknown, expired, already used or another client’s.',
  };
  // Looked for before the write, so a client guessing tokens cannot make the
  // site rewrite the file; the write below checks again under its lock.
  const matches = (token: StoredToken) =>
    token.refreshTokenHash === hash &&
    token.clientId === clientId &&
    Date.parse(token.refreshExpiresAt) > now.getTime();
  if (!listTokens(dataDir).some(matches)) return refused;

  let issued: IssuedTokens | undefined;
  await update(dataDir, now, (tokens) =>
    tokens.map((token) => {
      if (!matches(token)) return token;
      const minted = mint(now);
      const rotated = { ...token, ...minted.hashes };
      issued = {
        accessToken: minted.accessToken,
        refreshToken: minted.refreshToken,
        token: rotated,
      };
      return rotated;
    }),
  );
  if (issued === undefined) return refused;
  return { ok: true, issued };
}

/**
 * The connection a live access token belongs to, when `audience` may accept
 * it; `undefined` for a token that is unknown, expired or bound to another
 * resource.
 */
export function verifyAccessToken(
  dataDir: string,
  accessToken: string,
  audience: Audience,
  now: Date,
): StoredToken | undefined {
  const hash = hashToken(accessToken);
  const token = listTokens(dataDir).find((candidate) => candidate.accessTokenHash === hash);
  if (token === undefined || Date.parse(token.expiresAt) <= now.getTime()) return undefined;
  const bound =
    token.resource === undefined ? audience.acceptsUnbound : token.resource === audience.resource;
  return bound ? token : undefined;
}

/** Revoke every token `userId` holds. */
export async function revokeTokensForUser(dataDir: string, userId: number): Promise<void> {
  if (listTokens(dataDir).every((token) => token.userId !== userId)) return;
  await update(dataDir, new Date(), (tokens) => tokens.filter((token) => token.userId !== userId));
}

/**
 * Rewrite the file through `change`, dropping every connection whose refresh
 * token has expired first: such a connection can never be used again, and
 * sweeping on write keeps the file to the ones that can.
 */
async function update(
  dataDir: string,
  now: Date,
  change: (tokens: StoredToken[]) => StoredToken[],
): Promise<void> {
  await updateFileAtomically(
    tokensFile(dataDir),
    (current) => {
      const tokens = current === undefined ? [] : (JSON.parse(current) as TokensFile).tokens;
      const live = tokens.filter((token) => Date.parse(token.refreshExpiresAt) > now.getTime());
      return `${JSON.stringify({ tokens: change(live) } satisfies TokensFile, null, 2)}\n`;
    },
    { mode: TOKENS_FILE_MODE },
  );
}

function mint(now: Date) {
  const accessToken = randomBytes(32).toString('base64url');
  const refreshToken = randomBytes(32).toString('base64url');
  return {
    accessToken,
    refreshToken,
    hashes: {
      accessTokenHash: hashToken(accessToken),
      expiresAt: new Date(now.getTime() + ACCESS_TOKEN_LIFETIME_MS).toISOString(),
      refreshTokenHash: hashToken(refreshToken),
      refreshExpiresAt: new Date(now.getTime() + REFRESH_TOKEN_LIFETIME_MS).toISOString(),
    },
  };
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('base64url');
}
