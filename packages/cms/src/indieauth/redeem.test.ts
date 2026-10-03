/**
 * Redeeming an authorization code (TASK-159): the rules every redemption
 * keeps, whichever endpoint it arrives at, and what profile redemption hands
 * back.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { User } from '../admin/accounts.ts';
import { CODE_LIFETIME_MS, createIndieAuthState } from './grants.ts';
import type { AuthorizationCode } from './grants.ts';
import { profileResponse, redeemCode } from './redeem.ts';

// RFC 7636's own example pair.
const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

const BASE = 'https://blog.example';

const CODE: AuthorizationCode = {
  clientId: 'https://app.example/',
  redirectUri: 'https://app.example/callback',
  codeChallenge: { method: 'S256', value: CHALLENGE },
  userId: 1,
  me: 'https://blog.example/',
  scopes: ['profile'],
};

function issued(
  clock: () => Date = () => new Date('2026-10-01T00:00:00Z'),
  grant: AuthorizationCode = CODE,
) {
  const { codes } = createIndieAuthState(clock);
  return { codes, code: codes.put(grant) };
}

const UNCHALLENGED: AuthorizationCode = { ...CODE, codeChallenge: { method: 'none' } };

function form(code: string, changes: Record<string, string | undefined> = {}) {
  return {
    grant_type: 'authorization_code',
    code,
    client_id: CODE.clientId,
    redirect_uri: CODE.redirectUri,
    code_verifier: VERIFIER,
    ...changes,
  };
}

describe('redeeming a code', () => {
  it('answers what the code was issued for when every field matches', () => {
    const { codes, code } = issued();
    assert.deepEqual(redeemCode(codes, form(code)), { ok: true, grant: CODE });
  });

  it('accepts a request that leaves grant_type out, as older clients do', () => {
    const { codes, code } = issued();
    assert.equal(redeemCode(codes, form(code, { grant_type: undefined })).ok, true);
  });

  for (const [what, changes] of [
    ['a wrong code_verifier', { code_verifier: 'not-the-verifier-that-made-the-challenge-xx' }],
    ['a different client_id', { client_id: 'https://other.example/' }],
    ['a client_id that differs only by a trailing slash', { client_id: 'https://app.example' }],
    ['a different redirect_uri', { redirect_uri: 'https://app.example/elsewhere' }],
  ] as const) {
    it(`refuses ${what} with invalid_grant, and the code is spent`, () => {
      const { codes, code } = issued();
      const refused = redeemCode(codes, form(code, changes));
      assert.equal(refused.ok, false);
      assert.equal(!refused.ok && refused.error, 'invalid_grant');
      assert.equal(redeemCode(codes, form(code)).ok, false, 'a failed try burns the code');
    });
  }

  it('refuses a code that was never issued', () => {
    const { codes } = issued();
    const refused = redeemCode(codes, form('made-up'));
    assert.equal(!refused.ok && refused.error, 'invalid_grant');
  });

  it('refuses an expired code', () => {
    let now = new Date('2026-10-01T00:00:00Z');
    const { codes, code } = issued(() => now);
    now = new Date(now.getTime() + CODE_LIFETIME_MS);
    const refused = redeemCode(codes, form(code));
    assert.equal(!refused.ok && refused.error, 'invalid_grant');
  });

  it('refuses a code already redeemed', () => {
    const { codes, code } = issued();
    assert.equal(redeemCode(codes, form(code)).ok, true);
    const replayed = redeemCode(codes, form(code));
    assert.equal(!replayed.ok && replayed.error, 'invalid_grant');
  });

  it('refuses another grant type with unsupported_grant_type, leaving the code', () => {
    const { codes, code } = issued();
    const refused = redeemCode(codes, form(code, { grant_type: 'refresh_token' }));
    assert.equal(!refused.ok && refused.error, 'unsupported_grant_type');
    assert.equal(redeemCode(codes, form(code)).ok, true);
  });

  for (const field of ['code', 'client_id', 'redirect_uri'] as const) {
    it(`refuses a request with no ${field} as invalid_request`, () => {
      const { codes, code } = issued();
      const refused = redeemCode(codes, form(code, { [field]: undefined }));
      assert.equal(!refused.ok && refused.error, 'invalid_request');
    });
  }
});

describe('redeeming a code issued without a challenge (TASK-225)', () => {
  const NOW = () => new Date('2026-10-01T00:00:00Z');

  it('needs no code_verifier', () => {
    const { codes, code } = issued(NOW, UNCHALLENGED);
    assert.deepEqual(redeemCode(codes, form(code, { code_verifier: undefined })), {
      ok: true,
      grant: UNCHALLENGED,
    });
  });

  it('still checks the client_id and redirect_uri', () => {
    const { codes, code } = issued(NOW, UNCHALLENGED);
    const refused = redeemCode(
      codes,
      form(code, { code_verifier: undefined, redirect_uri: 'https://app.example/elsewhere' }),
    );
    assert.equal(!refused.ok && refused.error, 'invalid_grant');
  });
});

describe('a redemption that tries to drop PKCE from a code issued with a challenge', () => {
  for (const [what, verifier] of [
    ['no code_verifier', undefined],
    ['an empty code_verifier', ''],
  ] as const) {
    it(`is refused when it sends ${what}, and the code is spent`, () => {
      const { codes, code } = issued();
      const refused = redeemCode(codes, form(code, { code_verifier: verifier }));
      assert.equal(!refused.ok && refused.error, 'invalid_request');
      assert.equal(redeemCode(codes, form(code)).ok, false, 'a downgrade attempt burns the code');
    });
  }
});

describe('what profile redemption hands back', () => {
  const ADA: User = {
    id: 1,
    username: 'ada',
    createdAt: '2026-01-01T00:00:00Z',
    email: 'ada@blog.example',
    profile: { displayName: 'Ada Lovelace', avatar: '/uploads/2026/09/ada.png' },
  };
  const BOB: User = { id: 2, username: 'bob', createdAt: '2026-01-01T00:00:00Z' };

  it('is me alone when no scope was approved', () => {
    assert.deepEqual(profileResponse({ ...CODE, scopes: [] }, ADA, BASE), {
      me: 'https://blog.example/',
    });
  });

  it('adds the name, url and an absolute photo for profile', () => {
    assert.deepEqual(profileResponse(CODE, ADA, BASE), {
      me: 'https://blog.example/',
      profile: {
        name: 'Ada Lovelace',
        url: 'https://blog.example/',
        photo: 'https://blog.example/uploads/2026/09/ada.png',
      },
    });
  });

  it('adds the email only when email was approved too', () => {
    const both = profileResponse({ ...CODE, scopes: ['profile', 'email'] }, ADA, BASE);
    assert.equal(both.profile?.email, 'ada@blog.example');
  });

  it('names a user with no display name or picture by their username', () => {
    assert.deepEqual(profileResponse(CODE, BOB, BASE).profile, {
      name: 'bob',
      url: 'https://blog.example/',
    });
  });

  it('says nothing about email for a user who has none', () => {
    const answer = profileResponse({ ...CODE, scopes: ['profile', 'email'] }, BOB, BASE);
    assert.equal(answer.profile !== undefined && 'email' in answer.profile, false);
  });
});
