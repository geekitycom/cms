import { createHash } from 'node:crypto';

import type { User } from '../admin/accounts.ts';
import { avatarUrl } from '../federation/actor.ts';
import type { AuthorizationCode, ExpiringStore } from './grants.ts';

/** The OAuth errors a redemption can end in. */
export type RedemptionError = 'invalid_request' | 'invalid_grant' | 'unsupported_grant_type';

export type Redemption =
  | { readonly ok: true; readonly grant: AuthorizationCode }
  | { readonly ok: false; readonly error: RedemptionError; readonly description: string };

/** The form fields a client posts to redeem a code, as they arrived. */
export type RedemptionForm = Readonly<Record<string, string | undefined>>;

/** A parsed form body as a {@link RedemptionForm}, a file upload read as absent. */
export function redemptionForm(body: Readonly<Record<string, unknown>>): RedemptionForm {
  return Object.fromEntries(
    Object.entries(body).map(([name, value]) => [
      name,
      typeof value === 'string' ? value : undefined,
    ]),
  );
}

/**
 * Take the code a client posts and check it against what it was issued for
 * (TASK-159). The token endpoint (TASK-160) redeems codes through this too,
 * so the two cannot disagree about what makes a code good.
 *
 * The code is taken before it is checked, so a try with the wrong verifier,
 * client or redirect spends it: a code somebody is guessing the verifier for
 * is a code that has leaked. `grant_type` may be left out, as clients written
 * to the IndieAuth spec before 2020 do.
 */
export function redeemCode(
  codes: ExpiringStore<AuthorizationCode>,
  form: RedemptionForm,
): Redemption {
  const grantType = form['grant_type'];
  if (grantType !== undefined && grantType !== 'authorization_code') {
    return refuse('unsupported_grant_type', 'Only authorization_code is supported.');
  }
  const code = form['code'];
  const clientId = form['client_id'];
  const redirectUri = form['redirect_uri'];
  const verifier = form['code_verifier'];
  if (!code || !clientId || !redirectUri || !verifier) {
    return refuse(
      'invalid_request',
      'code, client_id, redirect_uri and code_verifier are all required.',
    );
  }

  const grant = codes.take(code);
  if (grant === undefined) {
    return refuse('invalid_grant', 'The code is unknown, expired or already used.');
  }
  if (grant.clientId !== clientId || grant.redirectUri !== redirectUri) {
    return refuse('invalid_grant', 'The code was issued to another client or redirect_uri.');
  }
  if (createHash('sha256').update(verifier).digest('base64url') !== grant.codeChallenge) {
    return refuse('invalid_grant', 'The code_verifier does not match the code_challenge.');
  }
  return { ok: true, grant };
}

function refuse(error: RedemptionError, description: string): Redemption {
  return { ok: false, error, description };
}

/** The IndieAuth profile URL response: who signed in, and what they let the client see. */
export interface ProfileResponse {
  readonly me: string;
  readonly profile?: {
    readonly name?: string;
    readonly url?: string;
    readonly photo?: string;
    readonly email?: string;
  };
}

/**
 * What profile redemption hands back for `grant`, signed in as `user`. The
 * token endpoint answers it beside the token, for a code or a refresh.
 *
 * The name, url and photo come with the profile scope and the email with the
 * email scope; the IndieAuth spec keeps all four under `profile`. The url is
 * the me, the page that already carries this person's h-card.
 */
export function profileResponse(
  grant: Pick<AuthorizationCode, 'me' | 'scopes'>,
  user: User,
  baseUrl: string,
): ProfileResponse {
  const photo =
    user.profile?.avatar === undefined ? undefined : avatarUrl(user.profile.avatar, baseUrl);
  const profile = {
    ...(grant.scopes.includes('profile')
      ? {
          name: user.profile?.displayName ?? user.username,
          url: grant.me,
          ...(photo === undefined ? {} : { photo }),
        }
      : {}),
    ...(grant.scopes.includes('email') && user.email !== undefined ? { email: user.email } : {}),
  };
  return Object.keys(profile).length === 0 ? { me: grant.me } : { me: grant.me, profile };
}
